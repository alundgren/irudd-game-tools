import {
  AnimationMixer,
  Bone,
  LoopOnce,
  MathUtils,
  Matrix4,
  Vector3,
  VectorKeyframeTrack,
} from "three";

const columns = 12,
  levels = 12,
  step = columns * (levels + 1);
const clamp = MathUtils.clamp;
function grid(u, t) {
  const x = (u % 1) * columns,
    y = clamp(t, 0, 1) * levels,
    c = Math.floor(x),
    r = Math.min(levels - 1, Math.floor(y));
  return { c, r, fx: x - c, fy: y - r };
}
export function addSkirtCage(s, bones, index) {
  if (s.part.cut?.kind !== "Skirt" || s.bones.length !== 3) return null;
  const obj = s.object,
    g = obj.geometry,
    pos = g.attributes.position,
    uv = g.attributes.uv,
    pts = [],
    waist = s.points[0],
    v = new Vector3(),
    sum = new Vector3();
  for (let i = 0; i < pos.count / 2; i++)
    pts.push(
      new Vector3()
        .fromBufferAttribute(pos, i)
        .applyMatrix4(obj.matrixWorld)
        .sub(waist),
    );
  const centers = [],
    pins = [],
    boneList = [],
    minRadius = new Float32Array(step).fill(Infinity);
  for (let r = 0; r <= levels; r++) {
    const t = r / levels,
      row = [];
    for (let c = 0; c < columns; c++) {
      const u = c / columns;
      let best = Infinity,
        chosen;
      for (let i = 0; i < pts.length; i++) {
        const delta = uv.getX(i) - u,
          dx = Math.min(Math.abs(delta), 1 - Math.abs(delta)),
          dy = 1 - uv.getY(i) - t,
          d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          chosen = pts[i];
        }
      }
      row.push(chosen.clone());
    }
    sum.set(0, 0, 0);
    for (const p of row) sum.add(p);
    const center = sum.clone().divideScalar(columns);
    centers.push(center);
    for (let c = 0; c < columns; c++) {
      const p = row[c],
        dir = p.clone().sub(center);
      dir.y = 0;
      dir.normalize();
      const bone = new Bone();
      bone.name = s.bones[0].name + "_Cloth_" + r + "_" + c;
      bone.userData.garmentSupport = true;
      bone.userData.region = s.part.id;
      bone.position.copy(p);
      s.bones[0].add(bone);
      index.set(bone, bones.length);
      bones.push(bone);
      boneList.push(bone);
      pins.push({ point: p, dir });
    }
  }
  // The inset of nearby folds sets the usable clearance under this station.
  for (let i = 0; i < pts.length; i++) {
    const { c, r } = grid(uv.getX(i), 1 - uv.getY(i));
    for (const rr of [r, r + 1])
      for (const cc of [c, (c + 1) % columns]) {
        const id = rr * columns + cc;
        minRadius[id] = Math.min(
          minRadius[id],
          v.copy(pts[i]).sub(centers[rr]).dot(pins[id].dir),
        );
      }
  }
  return { region: s, pins, centers, boneList, minRadius };
}
export function weightSkirt(cage, g, ids, weights, index) {
  if (!cage) return;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const { r, c, fx, fy } = grid(uv.getX(i), 1 - uv.getY(i));
    const stations = [
      r * columns + c,
      r * columns + ((c + 1) % columns),
      (r + 1) * columns + c,
      (r + 1) * columns + ((c + 1) % columns),
    ];
    const mix = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    for (let j = 0; j < 4; j++) {
      ids[4 * i + j] = mix[j] > 0 ? index.get(cage.boneList[stations[j]]) : 0;
      weights[4 * i + j] = mix[j];
    }
  }
}
function coveredSamples(mesh, regions, cage) {
  const carrier = regions.get(cage.region.part.parent)?.object,
    covered = new Set();
  if (!carrier) return [];
  for (const s of regions.values()) {
    if (
      s.object !== carrier &&
      !["thigh", "shin", "foot", "pelvis"].includes(s.role)
    )
      continue;
    let ancestor = s.object;
    while (ancestor && ancestor !== carrier) ancestor = ancestor.parent;
    if (ancestor === carrier) covered.add(s.part.id);
  }
  const names = mesh.userData.regionNames,
    g = mesh.geometry,
    a = g.attributes._region,
    pos = g.attributes.position,
    samples = [],
    seen = new Set();
  for (let i = 0; i < pos.count; i++) {
    const id = names[a.getX(i)];
    if (!covered.has(id)) continue;
    const key = [
      id,
      Math.round(pos.getX(i) * 1000),
      Math.round(pos.getY(i) * 1000),
      Math.round(pos.getZ(i) * 1000),
    ].join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(i);
  }
  return samples;
}
function envelope(cage, cloud, offsets) {
  const result = new Float32Array(step).fill(-Infinity);
  for (let row = 0; row <= levels; row++) {
    const center = cage.centers[row].clone().add(offsets[row]),
      near = cage.centers[row === levels ? row - 1 : row + 1]
        .clone()
        .add(offsets[row === levels ? row - 1 : row + 1]);
    const band = Math.max(0.018, Math.abs(near.y - center.y) * 0.9);
    for (const p of cloud) {
      if (Math.abs(p.y - center.y) > band) continue;
      const dx = p.x - center.x,
        dz = p.z - center.z;
      for (let c = 0; c < columns; c++) {
        const k = row * columns + c,
          n = cage.pins[k].dir;
        result[k] = Math.max(result[k], dx * n.x + dz * n.z);
      }
    }
  }
  return result;
}
// Bake portable joint motion from the legs that actually move in the clip.
// The skin has four ordinary glTF joint weights per vertex. No cloth runtime
// or extra vertex animation is required by the consuming game.
export function animateSkirts(actor, mesh, regions, cages, clips) {
  if (!cages.length) return;
  const mixer = new AnimationMixer(actor),
    v = new Vector3(),
    inv = new Matrix4(),
    p = mesh.geometry.attributes.position;
  for (const cage of cages) {
    const { region, pins, boneList } = cage,
      indices = coveredSamples(mesh, regions, cage);
    if (!indices.length) continue;
    const waist = region.bones[0];
    waist.updateWorldMatrix(true, false);
    inv.copy(waist.matrixWorld).invert();
    const cloud = indices.map((i) =>
      new Vector3().fromBufferAttribute(p, i).applyMatrix4(inv),
    );
    const neutral = Array.from({ length: levels + 1 }, () => new Vector3()),
      rest = envelope(cage, cloud, neutral);
    const base = region.points.map((p) => p.clone().sub(region.points[0]));
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      action.clampWhenFinished = true;
      action.setLoop(LoopOnce, 1).play();
      const frames = clip.name.startsWith("Pose · ") ? 1 : 32,
        times = [],
        values = pins.map(() => []);
      for (let k = 0; k <= frames; k++) {
        action.time = (clip.duration * k) / frames;
        mixer.update(0);
        actor.updateMatrixWorld(true);
        mesh.skeleton.update();
        inv.copy(waist.matrixWorld).invert();
        const shifted = region.bones.map((b, j) =>
          b.getWorldPosition(new Vector3()).applyMatrix4(inv).sub(base[j]),
        );
        const motion = neutral.map((_, r) => {
          const t = (r / levels) * 2,
            j = Math.min(1, Math.floor(t));
          return shifted[j].clone().lerp(shifted[j + 1], t - j);
        });
        for (let n = 0; n < indices.length; n++)
          mesh.getVertexPosition(indices[n], cloud[n]).applyMatrix4(inv);
        const support = envelope(cage, cloud, motion),
          extra = new Float32Array(step);
        for (let i = 0; i < step; i++) {
          if (!Number.isFinite(support[i])) continue;
          const room = cage.minRadius[i] - 0.019;
          extra[i] = Math.max(0, support[i] - Math.max(room, rest[i])) * 1.26;
        }
        times.push(action.time);
        for (let i = 0; i < step; i++) {
          const r = Math.floor(i / columns),
            c = i % columns;
          let amount = extra[i];
          for (const rr of [Math.max(0, r - 1), Math.min(levels, r + 1)])
            amount = Math.max(amount, 0.72 * extra[rr * columns + c]);
          for (const cc of [(c + 1) % columns, (c + columns - 1) % columns])
            amount = Math.max(amount, 0.72 * extra[r * columns + cc]);
          v.copy(pins[i].point)
            .add(motion[r])
            .addScaledVector(pins[i].dir, amount);
          values[i].push(v.x, v.y, v.z);
        }
      }
      action.stop();
      mixer.uncacheClip(clip);
      for (let i = 0; i < step; i++) {
        const coords = values[i],
          pt = pins[i].point;
        if (coords.some((v, j) => Math.abs(v - pt.getComponent(j % 3)) > 1e-5))
          clip.tracks.push(
            new VectorKeyframeTrack(
              boneList[i].name + ".position",
              times,
              coords,
            ).optimize(),
          );
      }
    }
  }
  mixer.uncacheRoot(actor);
  actor.updateMatrixWorld(true);
  mesh.skeleton.update();
}
