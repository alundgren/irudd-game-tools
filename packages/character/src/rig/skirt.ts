// A skirt's cloth joints. Ported from addSkirtCage, weightSkirt and
// animateSkirts in character-view/skirt-rig.js at 2761eb1.
//
// A grid of joints hangs from the skirt's waist joint, one station per row
// and column of the pattern. The skin takes four ordinary joint weights per
// vertex from the stations around it, and each clip carries the joints'
// motion, baked from the legs that move in it, so a game needs no cloth
// runtime or vertex animation.

import * as T from "three";
import { isMesh } from "../mesh.js";
import type { Region } from "./region.js";

const columns = 12;
const levels = 12;
const step = columns * (levels + 1);

function grid(u: number, t: number) {
  const x = (u % 1) * columns;
  const y = T.MathUtils.clamp(t, 0, 1) * levels;
  const c = Math.floor(x);
  const r = Math.min(levels - 1, Math.floor(y));
  return { c, r, fx: x - c, fy: y - r };
}

interface Pin {
  readonly point: T.Vector3;
  readonly dir: T.Vector3;
}

export interface SkirtCage {
  readonly region: Region;
  readonly pins: ReadonlyArray<Pin>;
  readonly centers: ReadonlyArray<T.Vector3>;
  readonly boneList: ReadonlyArray<T.Bone>;
  readonly minRadius: Float32Array;
}

const item = <V>(list: ArrayLike<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Skirt station out of range.");
  return v;
};

/** The cloth joints of a fitted skirt with a three-joint waist chain, added under its waist joint. */
export function addSkirtCage(
  s: Region,
  bones: T.Bone[],
  index: Map<T.Bone, number>,
): SkirtCage | undefined {
  const waistBone = s.bones[0];
  const waist = s.points[0];
  if (s.part.mantle?.kind !== "Skirt" || s.bones.length !== 3 || !waistBone || !waist)
    return undefined;
  const obj = s.object;
  if (!isMesh(obj)) return undefined;
  const g = obj.geometry;
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const pts: T.Vector3[] = [];
  const v = new T.Vector3();
  const sum = new T.Vector3();
  for (let i = 0; i < pos.count / 2; i++)
    pts.push(new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld).sub(waist));
  const centers: T.Vector3[] = [];
  const pins: Pin[] = [];
  const boneList: T.Bone[] = [];
  const minRadius = new Float32Array(step).fill(Infinity);
  for (let r = 0; r <= levels; r++) {
    const t = r / levels;
    const row: T.Vector3[] = [];
    for (let c = 0; c < columns; c++) {
      const u = c / columns;
      let best = Infinity;
      let chosen: T.Vector3 | undefined;
      for (let i = 0; i < pts.length; i++) {
        const delta = uv.getX(i) - u;
        const dx = Math.min(Math.abs(delta), 1 - Math.abs(delta));
        const dy = 1 - uv.getY(i) - t;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          chosen = pts[i];
        }
      }
      if (!chosen) throw new Error("A skirt has no vertices.");
      row.push(chosen.clone());
    }
    sum.set(0, 0, 0);
    for (const p of row) sum.add(p);
    const center = sum.clone().divideScalar(columns);
    centers.push(center);
    for (let c = 0; c < columns; c++) {
      const p = item(row, c);
      const dir = p.clone().sub(center);
      dir.y = 0;
      dir.normalize();
      const bone = new T.Bone();
      bone.name = waistBone.name + "_Cloth_" + r + "_" + c;
      bone.userData["garmentSupport"] = true;
      bone.userData["region"] = s.part.id;
      bone.position.copy(p);
      waistBone.add(bone);
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
          item(minRadius, id),
          v.copy(item(pts, i)).sub(item(centers, rr)).dot(item(pins, id).dir),
        );
      }
  }
  return { region: s, pins, centers, boneList, minRadius };
}

/** Weight a skirt's vertices to the four stations around each. */
export function weightSkirt(
  cage: SkirtCage,
  g: T.BufferGeometry,
  ids: Uint16Array,
  weights: Float32Array,
  index: ReadonlyMap<T.Bone, number>,
): void {
  const uv = g.getAttribute("uv");
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
      const weight = item(mix, j);
      ids[4 * i + j] = weight > 0 ? (index.get(item(cage.boneList, item(stations, j))) ?? 0) : 0;
      weights[4 * i + j] = weight;
    }
  }
}

function coveredSamples(
  mesh: T.SkinnedMesh,
  regions: ReadonlyMap<string, Region>,
  cage: SkirtCage,
  regionIds: ReadonlyArray<string>,
): number[] {
  const parent = cage.region.part.parent;
  const carrier = parent === null ? undefined : regions.get(parent)?.object;
  const covered = new Set<string>();
  if (!carrier) return [];
  for (const s of regions.values()) {
    if (s.object !== carrier && !["thigh", "shin", "foot", "pelvis"].includes(s.role)) continue;
    let ancestor: T.Object3D | null = s.object;
    while (ancestor && ancestor !== carrier) ancestor = ancestor.parent;
    if (ancestor === carrier) covered.add(s.part.id);
  }
  const g = mesh.geometry;
  const a = g.getAttribute("_region");
  const pos = g.getAttribute("position");
  const samples: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i++) {
    const id = regionIds[a.getX(i)];
    if (id === undefined || !covered.has(id)) continue;
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

function envelope(
  cage: SkirtCage,
  cloud: ReadonlyArray<T.Vector3>,
  offsets: ReadonlyArray<T.Vector3>,
): Float32Array {
  const result = new Float32Array(step).fill(-Infinity);
  for (let row = 0; row <= levels; row++) {
    const other = row === levels ? row - 1 : row + 1;
    const center = item(cage.centers, row).clone().add(item(offsets, row));
    const near = item(cage.centers, other).clone().add(item(offsets, other));
    const band = Math.max(0.018, Math.abs(near.y - center.y) * 0.9);
    for (const p of cloud) {
      if (Math.abs(p.y - center.y) > band) continue;
      const dx = p.x - center.x;
      const dz = p.z - center.z;
      for (let c = 0; c < columns; c++) {
        const k = row * columns + c;
        const n = item(cage.pins, k).dir;
        result[k] = Math.max(item(result, k), dx * n.x + dz * n.z);
      }
    }
  }
  return result;
}

/**
 * Bake each clip's cloth joint motion from the legs that move in it. The
 * skin has four ordinary joint weights per vertex; `regionIds` names the
 * part of each `_region` index on the skinned mesh.
 */
export function animateSkirts(
  actor: T.Object3D,
  mesh: T.SkinnedMesh,
  regions: ReadonlyMap<string, Region>,
  cages: ReadonlyArray<SkirtCage>,
  clips: ReadonlyArray<T.AnimationClip>,
  regionIds: ReadonlyArray<string>,
): void {
  if (!cages.length) return;
  const mixer = new T.AnimationMixer(actor);
  const v = new T.Vector3();
  const inv = new T.Matrix4();
  const p = mesh.geometry.getAttribute("position");
  for (const cage of cages) {
    const { region, pins, boneList } = cage;
    const indices = coveredSamples(mesh, regions, cage, regionIds);
    if (!indices.length) continue;
    const waist = region.bones[0];
    const origin = region.points[0];
    if (!waist || !origin) continue;
    waist.updateWorldMatrix(true, false);
    inv.copy(waist.matrixWorld).invert();
    const cloud = indices.map((i) => new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(inv));
    const neutral = Array.from({ length: levels + 1 }, () => new T.Vector3());
    const rest = envelope(cage, cloud, neutral);
    const base = region.points.map((q) => q.clone().sub(origin));
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      action.clampWhenFinished = true;
      action.setLoop(T.LoopOnce, 1).play();
      const frames = clip.name.startsWith("Pose · ") ? 1 : 32;
      const times: number[] = [];
      const values: number[][] = pins.map(() => []);
      for (let k = 0; k <= frames; k++) {
        action.time = (clip.duration * k) / frames;
        mixer.update(0);
        actor.updateMatrixWorld(true);
        mesh.skeleton.update();
        inv.copy(waist.matrixWorld).invert();
        const shifted = region.bones.map((b, j) =>
          b.getWorldPosition(new T.Vector3()).applyMatrix4(inv).sub(item(base, j)),
        );
        const motion = neutral.map((_, r) => {
          const t = (r / levels) * 2;
          const j = Math.min(1, Math.floor(t));
          return item(shifted, j)
            .clone()
            .lerp(item(shifted, j + 1), t - j);
        });
        for (let n = 0; n < indices.length; n++)
          mesh.getVertexPosition(item(indices, n), item(cloud, n)).applyMatrix4(inv);
        const support = envelope(cage, cloud, motion);
        const extra = new Float32Array(step);
        for (let i = 0; i < step; i++) {
          const s = item(support, i);
          if (!Number.isFinite(s)) continue;
          const room = item(cage.minRadius, i) - 0.019;
          extra[i] = Math.max(0, s - Math.max(room, item(rest, i))) * 1.26;
        }
        times.push(action.time);
        for (let i = 0; i < step; i++) {
          const r = Math.floor(i / columns);
          const c = i % columns;
          let amount = item(extra, i);
          for (const rr of [Math.max(0, r - 1), Math.min(levels, r + 1)])
            amount = Math.max(amount, 0.72 * item(extra, rr * columns + c));
          for (const cc of [(c + 1) % columns, (c + columns - 1) % columns])
            amount = Math.max(amount, 0.72 * item(extra, r * columns + cc));
          v.copy(item(pins, i).point)
            .add(item(motion, r))
            .addScaledVector(item(pins, i).dir, amount);
          item(values, i).push(v.x, v.y, v.z);
        }
      }
      action.stop();
      mixer.uncacheClip(clip);
      for (let i = 0; i < step; i++) {
        const coords = item(values, i);
        const pt = item(pins, i).point;
        if (coords.some((x, j) => Math.abs(x - pt.getComponent(j % 3)) > 1e-5))
          clip.tracks.push(
            new T.VectorKeyframeTrack(
              item(boneList, i).name + ".position",
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
