import { BufferGeometry, Matrix3, Vector3 } from "three";
import { alignPoints, transformPoints } from "./alignment-points.js";
import type { HumanBody } from "./body.js";
import type { SmoothSurface } from "./smooth.js";
import type { studioPieces } from "./studio-data.js";

type Piece = (typeof studioPieces)[number];
const neighbours = new WeakMap<HumanBody, number[][]>();
function adjacent(body: HumanBody) {
  const exists = neighbours.get(body);
  if (exists) return exists;
  const triangles = body.studio.u16("triangles");
  const rings = Array.from({ length: body.studio.u8("settle").length }, () => new Set<number>());
  for (let t = 0; t < triangles.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = triangles[t + j] ?? 0,
        b = triangles[t + ((j + 1) % 3)] ?? 0;
      rings[a]?.add(b);
      rings[b]?.add(a);
    }
  const lists = rings.map((r) => Array.from(r));
  neighbours.set(body, lists);
  return lists;
}
export function studioFit(body: HumanBody, surface: SmoothSurface) {
  const pack = body.studio,
    vertices = pack.u16("bindingVertices"),
    shares = pack.f32("bindingShares"),
    rest = pack.f32("bindingRest"),
    settle = pack.u8("settle"),
    lips = pack.u8("lips"),
    control = pack.f32("control");
  const native = new Float32Array(rest.length);
  for (let i = 0; i < vertices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const k = 3 * (vertices[i + j] ?? 0),
        weight = shares[i + j] ?? 0;
      for (let d = 0; d < 3; d++)
        native[i + d] = (native[i + d] ?? 0) + weight * (surface.positions[k + d] ?? 0);
    }
  const weights = Float32Array.from(settle, (x) => 1 - x / 255);
  const { matrix, scale } = alignPoints(rest, native, { weights, scale: true });
  const rotation = new Matrix3().setFromMatrix4(matrix);
  const carried = transformPoints(control, matrix),
    base = transformPoints(rest, matrix);
  const change = Float32Array.from(native, (v, i) => v - (base[i] ?? 0));
  const rings = adjacent(body),
    moved = carried.slice();
  rings.forEach((ring, i) => {
    const keep = Math.max(0.5, (settle[i] ?? 0) / 255),
      part = 1 - (0.5 * (lips[i] ?? 0)) / 255;
    for (let d = 0; d < 3; d++) {
      const k = 3 * i + d,
        original = change[k] ?? 0,
        mean =
          ring.reduce((sum, j) => sum + (change[3 * j + d] ?? 0), 0) / Math.max(1, ring.length);
      moved[k] =
        (carried[k] ?? 0) + part * (ring.length ? keep * original + (1 - keep) * mean : original);
    }
  });
  const delta = Float32Array.from(moved, (v, i) => v - (carried[i] ?? 0));
  function standaloneDelta() {
    let offsets = Float32Array.from(native, (x, i) => x - (control[i] ?? 0));
    for (let pass = 0; pass < 3; pass++) {
      const next = new Float32Array(offsets.length);
      rings.forEach((ring, i) => {
        for (let d = 0; d < 3; d++)
          next[i * 3 + d] =
            ring.reduce((sum, j) => sum + (offsets[3 * j + d] ?? 0), offsets[3 * i + d] ?? 0) /
            (1 + ring.length);
      });
      offsets = next;
    }
    return offsets;
  }
  function position(
    name: Piece,
    origin: readonly [number, number, number],
    standalone?: Float32Array,
  ) {
    if (name === "skin") {
      const source = pack.u16("skin.source");
      return Float32Array.from(
        { length: source.length * 3 },
        (_, k) =>
          (moved[(source[Math.floor(k / 3)] ?? 0) * 3 + (k % 3)] ?? 0) - (origin[k % 3] ?? 0),
      );
    }
    const ties = pack.u16(name + ".ties"),
      share = pack.f32(name + ".shares"),
      raw = pack.f32(name + ".position");
    const p = standalone ? raw.slice() : transformPoints(raw, matrix),
      differences = standalone ?? delta;
    for (let i = 0; i < p.length; i += 3)
      for (let d = 0; d < 3; d++) {
        let x = (p[i + d] ?? 0) - (origin[d] ?? 0);
        for (let k = 0; k < 3; k++)
          x += (share[i + k] ?? 0) * (differences[3 * (ties[i + k] ?? 0) + d] ?? 0);
        p[i + d] = x;
      }
    return p;
  }
  return {
    native,
    moved,
    carried,
    settle,
    vertices,
    shares,
    position,
    matrix,
    scale,
    rotation,
    standaloneDelta,
  };
}
export type StudioFit = ReturnType<typeof studioFit>;
export function studioAccessoryFit(fit: StudioFit) {
  const cell = 0.018,
    spread = 0.013,
    grid = new Map<number, number[]>(),
    key = (x: number, y: number, z: number) => (x + 512) * 1048576 + (y + 512) * 1024 + z + 512;
  const { native, moved, settle } = fit,
    delta = Float32Array.from(
      moved,
      (x, k) => (1 - (settle[Math.floor(k / 3)] ?? 0) / 255) * (x - (native[k] ?? 0)),
    );
  const p = new Vector3(),
    base = new Vector3(),
    diff = new Vector3(),
    sum = new Vector3(),
    home = new Vector3();
  for (let i = 0; i < settle.length; i++) {
    home
      .fromArray(native, i * 3)
      .divideScalar(cell)
      .floor();
    const n = key(home.x, home.y, home.z),
      list = grid.get(n);
    if (list) list.push(i);
    else grid.set(n, [i]);
  }
  return (g: BufferGeometry) => {
    const coords = g.getAttribute("position");
    for (let v = 0; v < coords.count; v++) {
      p.fromBufferAttribute(coords, v);
      home.copy(p).divideScalar(cell).floor();
      sum.set(0, 0, 0);
      let total = 0;
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++)
          for (let c = -2; c <= 2; c++) {
            const list = grid.get(key(home.x + a, home.y + b, home.z + c));
            if (!list) continue;
            for (const i of list) {
              const w = Math.exp(
                -base.fromArray(native, i * 3).distanceToSquared(p) / (2 * spread * spread),
              );
              sum.addScaledVector(diff.fromArray(delta, 3 * i), w);
              total += w;
            }
          }
      if (total < 1e-9) {
        let best = Infinity;
        for (let i = 0; i < settle.length; i++) {
          const d = base.fromArray(native, 3 * i).distanceToSquared(p);
          if (d < best) {
            best = d;
            sum.fromArray(delta, 3 * i);
          }
        }
        total = 1;
      }
      p.addScaledVector(sum, 1 / total);
      coords.setXYZ(v, p.x, p.y, p.z);
    }
    coords.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  };
}
