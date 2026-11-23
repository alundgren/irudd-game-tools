import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  Color,
  MathUtils,
} from "three";
import { randomStream } from "./random.js";
import { surfaceIndex } from "./surface-join.js";

const tau = 2 * Math.PI;
export const fibreDefaults = {
  count: 32,
  wave: 0.28,
  fall: 0.2,
  grey: 0.12,
  rooted: true,
};
export function acceptsFibres(part) {
  return (
    part?.shape === "sweep" &&
    !part.paint &&
    !part.sourceHairOnly &&
    !part.hairCap &&
    !part.blendSkin &&
    !part.wearFit &&
    !part.drape &&
    !part.grip &&
    part.anatomy !== "face"
  );
}
export function validFibres(s) {
  return (
    s &&
    Number.isInteger(s.count) &&
    s.count >= 4 &&
    s.count <= 96 &&
    ["wave", "fall", "grey"].every(
      (k) => Number.isFinite(s[k]) && s[k] >= 0 && s[k] <= 1,
    ) &&
    typeof s.rooted === "boolean" &&
    Number.isInteger(s.seed) &&
    s.seed >= 0 &&
    s.seed <= 0xffffffff
  );
}

// Read the rings after surface fitting and sculpting. A moved guide, resized
// body or bent spine changes the fibres without baking a second editable mesh.
function readGuide(g) {
  const p = g.attributes.position,
    uv = g.attributes.uv;
  let stride = 1;
  while (stride < uv.count && uv.getY(stride) === uv.getY(0)) stride++;
  if (stride < 4 || uv.count % stride !== 0)
    throw new Error("A fibre guide needs regular sweep sections.");
  const rows = [],
    sample = new Vector3();
  let length = 0;
  for (let offset = 0; offset < p.count; offset += stride) {
    const center = new Vector3();
    for (let i = 0; i < stride - 1; i++)
      center.add(sample.fromBufferAttribute(p, offset + i));
    center.divideScalar(stride - 1);
    if (rows.length) length += center.distanceTo(rows.at(-1).center);
    rows.push({ center, offset, length });
  }
  return { rows, p, stride, length };
}
// Spend a bounded part of the game mesh on continuous strands. If the whole
// coat exceeds the budget, keep an evenly spaced selection on every guide.
export function gameFibreDetail(guides, budget) {
  const total = guides.reduce((n, p) => n + p.fibres.count, 0);
  const max = Math.min(total, Math.max(guides.length, Math.floor(budget / 32)));
  const extra = Math.max(1, total - guides.length);
  const shares = guides.map((p) => {
    const wish = ((p.fibres.count - 1) * (max - guides.length)) / extra;
    return { id: p.id, count: 1 + Math.floor(wish), remainder: wish % 1 };
  });
  const spare = max - shares.reduce((n, g) => n + g.count, 0);
  shares.sort((a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < spare; i++) shares[i].count++;
  const spans = MathUtils.clamp(
    Math.floor((budget / Math.max(1, max) - 2) / 6),
    5,
    12,
  );
  return new Map(shares.map((g) => [g.id, { count: g.count, spans }]));
}
function fibreStations(line, radii, spans) {
  if (!spans || line.length <= spans + 1) return line.map((_, i) => i);
  const chosen = [0, line.length - 1],
    at = new Vector3();
  while (chosen.length <= spans) {
    let best = -1,
      station,
      insert;
    for (let k = 1; k < chosen.length; k++) {
      const a = chosen[k - 1],
        b = chosen[k];
      for (let j = a + 1; j < b; j++) {
        const t = (j - a) / (b - a);
        at.lerpVectors(line[a], line[b], t);
        const error =
          at.distanceToSquared(line[j]) +
          (radii[j] - MathUtils.lerp(radii[a], radii[b], t)) ** 2;
        if (error > best) {
          best = error;
          station = j;
          insert = k;
        }
      }
    }
    chosen.splice(insert, 0, station);
  }
  return chosen;
}
export function fibreGeometry(mesh, settings, color, rootAt, lod) {
  const guide = readGuide(mesh.geometry),
    { rows, p, stride, length } = guide;
  const random = randomStream(settings.seed),
    pos = [],
    colors = [],
    uv = [],
    indices = [],
    sources = [];
  const dark = new Color(color),
    grey = new Color("#c4bfb0");
  const edgeAt = (row, angle) => {
    const sector = ((((angle / tau) % 1) + 1) % 1) * (stride - 1),
      i = Math.floor(sector);
    return new Vector3()
      .fromBufferAttribute(p, row.offset + i)
      .lerp(
        new Vector3().fromBufferAttribute(p, row.offset + i + 1),
        sector - i,
      );
  };
  const down = new Vector3(0, -1, 0).transformDirection(
    mesh.matrixWorld.clone().invert(),
  );
  const localFromWorld = mesh.matrixWorld.clone().invert();
  const steps = Math.max(15, Math.min(48, rows.length)),
    sides = lod ? 3 : 5;
  for (let strand = 0; strand < settings.count; strand++) {
    const angle = strand * 2.39996323 + (random() - 0.5) * 0.31,
      phase = random() * tau,
      radial = Math.sqrt((strand + random()) / settings.count),
      start = random() * 0.32,
      finish = 0.77 + 0.23 * random(),
      fall = length * settings.fall * (0.28 + 0.75 * random()),
      lights =
        random() < settings.grey ? 0.13 + 0.53 * random() : 0.012 * random(),
      shade = dark
        .clone()
        .lerp(grey, lights)
        .multiplyScalar(0.7 + 0.3 * random()),
      thickness = 0.6 + 0.5 * random(),
      base = pos.length / 3;
    if (
      lod &&
      Math.floor(((strand + 1) * lod.count) / settings.count) ===
        Math.floor((strand * lod.count) / settings.count)
    )
      continue;
    const line = [],
      radii = [],
      bindings = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps,
        walk = fall > 0 ? Math.min(1, t / 0.84) : t,
        free = fall > 0 ? Math.max(0, (t - 0.84) / 0.16) : 0,
        d = length * MathUtils.lerp(start, finish, walk);
      let b = 1;
      while (b < rows.length - 1 && rows[b].length < d) b++;
      const lo = rows[b - 1],
        hi = rows[b],
        f = (d - lo.length) / Math.max(1e-9, hi.length - lo.length);
      const a =
          angle +
          settings.wave *
            (0.44 * Math.sin(phase + t * tau * 1.3) +
              0.22 * Math.sin(phase * 0.72 + t * tau * 2.7)),
        mid = lo.center.clone().lerp(hi.center, f),
        edge = edgeAt(lo, a).lerp(edgeAt(hi, a), f).sub(mid),
        radius = edge.length();
      const v = mid.addScaledVector(
        edge,
        radial * (1 + 0.16 * settings.wave * Math.sin(t * 9 + phase)),
      );
      if (free > 0) {
        const tangent = hi.center.clone().sub(lo.center).normalize();
        v.addScaledVector(
          tangent,
          fall * free * (1 - 0.55 * free),
        ).addScaledVector(down, fall * free * free * 0.74);
        v.addScaledVector(
          edge,
          free * (0.22 + 0.31 * settings.wave) * Math.sin(phase),
        );
      }
      line.push(v);
      const root = 0.44 + 0.56 * Math.min(1, t / 0.1),
        tip = 0.055 + 0.945 * (1 - t ** 2) ** 0.76;
      radii.push(
        Math.max(
          length * 0.00045,
          ((radius * thickness) / Math.sqrt(settings.count)) * 0.69,
        ) *
          root *
          tip,
      );
      const row = f < 0.5 ? lo : hi,
        sector = Math.round(((((a / tau) % 1) + 1) % 1) * (stride - 1));
      bindings.push(row.offset + sector);
    }
    if (rootAt) {
      const hit = rootAt(line[0].clone().applyMatrix4(mesh.matrixWorld));
      if (hit) {
        const bound = hit.point
          .clone()
          .addScaledVector(hit.normal, -0.0006)
          .applyMatrix4(localFromWorld);
        const delta = bound.sub(line[0]);
        for (let j = 0; j <= steps; j++)
          line[j].addScaledVector(
            delta,
            1 - MathUtils.smoothstep(j / steps, 0, 0.38),
          );
      }
    }
    const stations = fibreStations(line, radii, lod?.spans);
    let u = new Vector3(1, 0, 0);
    for (const [ring, j] of stations.entries()) {
      const along = line[Math.min(j + 1, steps)]
        .clone()
        .sub(line[Math.max(0, j - 1)])
        .normalize();
      if (Math.abs(along.dot(u)) > 0.94)
        u.set(
          0,
          Math.abs(along.y) < 0.8 ? 1 : 0,
          Math.abs(along.y) < 0.8 ? 0 : 1,
        );
      u.addScaledVector(along, -u.dot(along)).normalize();
      const v = new Vector3().crossVectors(along, u).normalize();
      for (let k = 0; k <= sides; k++) {
        const a = (tau * k) / sides,
          point = line[j]
            .clone()
            .addScaledVector(u, radii[j] * Math.cos(a))
            .addScaledVector(v, 0.69 * radii[j] * Math.sin(a));
        pos.push(point.x, point.y, point.z);
        colors.push(shade.r, shade.g, shade.b);
        uv.push(k / sides, j / steps);
        sources.push(bindings[j]);
        if (ring < stations.length - 1 && k < sides) {
          const i = base + ring * (sides + 1) + k;
          indices.push(
            i,
            i + 1,
            i + sides + 1,
            i + 1,
            i + sides + 2,
            i + sides + 1,
          );
        }
      }
    }
    // Closed ends stay visible in a game that culls back faces.
    for (let k = 1; k < sides - 1; k++) {
      indices.push(base, base + k + 1, base + k);
      const end = base + (stations.length - 1) * (sides + 1);
      indices.push(end, end + k, end + k + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const old = mesh.blendOwners;
  const owners = old
    ? {
        ids: old.ids,
        first: Uint8Array.from(sources, (i) => old.first[i]),
        second: Uint8Array.from(sources, (i) => old.second[i]),
        weight: Float32Array.from(sources, (i) => old.weight[i]),
      }
    : undefined;
  return { geometry: g, owners };
}
export function growGuideFibres(
  form,
  objects,
  plainView,
  material,
  gameBudget,
) {
  const guides = form.parts.filter((part) => {
    const mesh = objects.get(part.id);
    return (
      part.fibres &&
      mesh?.isMesh &&
      mesh.visible &&
      !mesh.userData.hiddenByOutfit
    );
  });
  const details = gameBudget ? gameFibreDetail(guides, gameBudget) : null;
  // Freeze the carrier surfaces before replacing any parent that is also a guide.
  const surfaces = new Map();
  for (const part of guides) {
    const parent = objects.get(part.parent);
    if (!part.fibres.rooted || !parent || surfaces.has(parent)) continue;
    parent.updateWorldMatrix(true, true);
    surfaces.set(parent, surfaceIndex(parent));
  }
  for (const part of guides) {
    const mesh = objects.get(part.id);
    mesh.updateWorldMatrix(true, false);
    const rootAt = part.fibres.rooted
      ? surfaces.get(objects.get(part.parent))
      : undefined;
    const color = plainView ? part.color : mesh.material.color;
    const { geometry, owners } = fibreGeometry(
      mesh,
      part.fibres,
      color,
      rootAt,
      details?.get(part.id),
    );
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.blendOwners = owners;
    mesh.material = material("#ffffff", "guide fibres");
    if (!plainView) {
      mesh.material.vertexColors = true;
      if (details) mesh.material.userData.fibreLOD = true;
    }
  }
}
