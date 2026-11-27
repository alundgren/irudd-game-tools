import * as T from "three";
import type { HumanBody } from "./body.js";
import type { StudioFit } from "./studio-fit.js";
import type { SmoothSurface } from "./smooth.js";
import { boneNames } from "./catalogue.js";

export function finishStudioSkin(
  body: HumanBody,
  fit: StudioFit,
  s: SmoothSurface,
  g: T.BufferGeometry,
  normals: ArrayLike<number>,
  shade?: Float32Array,
) {
  const pack = body.studio,
    source = pack.u16("skin.source"),
    smooth = pack.u16("skin.smooth"),
    head = boneNames.indexOf("head");
  const weights = new Float32Array(4 * source.length),
    bones = new Uint16Array(weights.length);
  const near = new T.Vector3(),
    work = new T.Vector3(),
    blended = new T.Vector3(),
    nativeNormals = new Float32Array(fit.moved.length);
  const tint = g.getAttribute("color");
  for (let i = 0; i < fit.settle.length; i++) {
    near.set(0, 0, 0);
    for (let k = 0; k < 3; k++)
      near.addScaledVector(
        work.fromArray(normals, 3 * (fit.vertices[3 * i + k] ?? 0)),
        fit.shares[3 * i + k] ?? 0,
      );
    near.toArray(nativeNormals, 3 * i);
  }
  const uniqueNormals = (points: Float32Array) => {
    const base = new T.BufferGeometry();
    base.setAttribute("position", new T.BufferAttribute(points, 3));
    base.setIndex(new T.BufferAttribute(smooth, 1));
    base.computeVertexNormals();
    const own = base.getAttribute("normal");
    const out = new Float32Array(3 * source.length);
    source.forEach((v, i) => {
      blended
        .fromBufferAttribute(own, v)
        .lerp(near.fromArray(nativeNormals, 3 * v), (fit.settle[v] ?? 0) / 255)
        .normalize()
        .toArray(out, 3 * i);
    });
    base.dispose();
    return out;
  };
  const rest = uniqueNormals(fit.moved);
  g.setAttribute("normal", new T.BufferAttribute(rest, 3));
  const pool = new Map<number, number>();
  source.forEach((v, i) => {
    const t = (fit.settle[v] ?? 0) / 255;
    pool.clear();
    pool.set(head, 1 - t);
    blended.set(1, 1, 1);
    for (let k = 0; k < 3; k++) {
      const vertex = fit.vertices[3 * v + k] ?? 0,
        w = t * (fit.shares[3 * v + k] ?? 0);
      for (let j = 0; j < 4; j++) {
        const bone = s.boneIndices[4 * vertex + j] ?? 0;
        pool.set(bone, (pool.get(bone) ?? 0) + w * (s.weights[4 * vertex + j] ?? 0));
      }
      if (shade) blended.addScaledVector(work.fromArray(shade, 3 * vertex).subScalar(1), w);
    }
    tint.setXYZ(i, blended.x, blended.y, blended.z);
    const best = Array.from(pool)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
      sum = best.reduce((sum, r) => sum + r[1], 0);
    best.forEach(([bone, w], j) => {
      weights[4 * i + j] = w / sum;
      bones[4 * i + j] = bone;
    });
  });
  g.morphAttributes["normal"] = (g.morphAttributes["position"] ?? []).map((attr) => {
    const moved = fit.moved.slice();
    source.forEach((v, i) => {
      work
        .fromArray(fit.moved, 3 * v)
        .add(near.fromBufferAttribute(attr, i))
        .toArray(moved, 3 * v);
    });
    const next = uniqueNormals(moved);
    for (let i = 0; i < next.length; i++) next[i] = (next[i] ?? 0) - (rest[i] ?? 0);
    const normal = new T.BufferAttribute(next, 3);
    normal.name = attr.name;
    return normal;
  });
  return { boneIndices: Array.from(bones), weights: Array.from(weights), names: boneNames };
}
