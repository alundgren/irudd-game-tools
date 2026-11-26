// A painted face's relief on the game page (transferFaceNormals and
// bakeFaceOcclusion in character-view/game-face-relief.js, with rasterTriangles
// of portrait-plate.js, at 2761eb1). Simplifying the head loses the full
// surface's normals and the shelter of its folds; both are written back into
// the face's tile of the shared page at the same texture coordinates.

import {
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
} from "three";
import { raycaster } from "./raycast.js";

type Attribute = BufferAttribute | InterleavedBufferAttribute;
type Visit = (
  pixel: number,
  a: number,
  b: number,
  c: number,
  u: number,
  v: number,
  w: number,
) => void;

/** Visit every pixel centre inside each triangle of `indices`, laid out at `xy`, with its barycentric weights. */
export function rasterTriangles(
  indices: ArrayLike<number>,
  xy: Float32Array,
  width: number,
  height: number,
  visit: Visit,
): void {
  const at = (i: number) => xy[i] ?? 0;
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f] ?? 0,
      b = indices[f + 1] ?? 0,
      c = indices[f + 2] ?? 0;
    const ax = at(2 * a),
      ay = at(2 * a + 1),
      bx = at(2 * b),
      by = at(2 * b + 1),
      cx = at(2 * c),
      cy = at(2 * c + 1);
    const ux = bx - ax,
      uy = by - ay,
      vx = cx - ax,
      vy = cy - ay,
      det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-8) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))),
      y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const rx = x + 0.5 - ax,
          ry = y + 0.5 - ay,
          s = (rx * vy - ry * vx) / det,
          t = (ry * ux - rx * uy) / det,
          l = 1 - s - t;
        if (Math.min(s, t, l) >= -1e-6) visit(y * width + x, a, b, c, l, s, t);
      }
  }
}

function attributes(geometry: BufferGeometry) {
  const normal = geometry.getAttribute("normal"),
    position = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv");
  if (!normal || !position || !uv)
    throw new Error("A face without normals or texture coordinates.");
  return { normal, position, uv };
}

function layout(uv: Attribute, width: number, height: number): Float32Array {
  const xy = new Float32Array(2 * uv.count);
  for (let i = 0; i < uv.count; i++) {
    xy[2 * i] = uv.getX(i) * width;
    xy[2 * i + 1] = (1 - uv.getY(i)) * height;
  }
  return xy;
}

/**
 * Restore the normals of the full surface (`highIndices`) to the reduced mesh
 * (`lowIndices`) at the same coordinates on its texture chart, rotating the
 * tile's tangent-space detail in `pixels` by the difference.
 */
export function transferFaceNormals(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  geometry: BufferGeometry,
  highIndices: ArrayLike<number>,
  lowIndices: ArrayLike<number>,
): void {
  const { normal, position, uv } = attributes(geometry);
  const xy = layout(uv, width, height);
  const high = new Float32Array(width * height * 6);
  const normalAt = new Vector3(),
    point = new Vector3(),
    source = new Vector3();
  const edge1 = new Vector3(),
    edge2 = new Vector3(),
    scratch = new Vector3();
  const mixAttribute = (
    out: Vector3,
    attr: Attribute,
    a: number,
    b: number,
    c: number,
    u: number,
    v: number,
    w: number,
  ) =>
    out.set(
      u * attr.getX(a) + v * attr.getX(b) + w * attr.getX(c),
      u * attr.getY(a) + v * attr.getY(b) + w * attr.getY(c),
      u * attr.getZ(a) + v * attr.getZ(b) + w * attr.getZ(c),
    );
  rasterTriangles(highIndices, xy, width, height, (pixel, a, b, c, u, v, w) => {
    const k = pixel * 6;
    mixAttribute(normalAt, normal, a, b, c, u, v, w).normalize().toArray(high, k);
    mixAttribute(point, position, a, b, c, u, v, w).toArray(high, k + 3);
  });
  const tangent = new Vector3(),
    bitangent = new Vector3(),
    t = new Vector3(),
    bdir = new Vector3();
  const detail = new Vector3(),
    baked = new Vector3(),
    axis = new Vector3();
  let lastA = -1,
    lastB = -1,
    lastC = -1;
  const seen = new Uint8Array(width * height);
  const byte = (q: number) => pixels[q] ?? 0;
  rasterTriangles(lowIndices, xy, width, height, (pixel, a, b, c, u, v, w) => {
    if (seen[pixel]) return;
    const k = pixel * 6;
    source.fromArray(high, k);
    if (source.lengthSq() < 0.8) return;
    mixAttribute(normalAt, normal, a, b, c, u, v, w).normalize();
    // Opposing surfaces meet at the lids and the mouth. An overlapping island
    // or a shrunken triangle must not transfer detail from the other side.
    if (source.dot(normalAt) < 0.72) return;
    mixAttribute(point, position, a, b, c, u, v, w);
    if (point.distanceToSquared(scratch.fromArray(high, k + 3)) > 0.004 ** 2) return;
    if (a !== lastA || b !== lastB || c !== lastC) {
      lastA = a;
      lastB = b;
      lastC = c;
      scratch.fromBufferAttribute(position, a);
      edge1.fromBufferAttribute(position, b).sub(scratch);
      edge2.fromBufferAttribute(position, c).sub(scratch);
      const u1 = uv.getX(b) - uv.getX(a),
        v1 = uv.getY(b) - uv.getY(a);
      const u2 = uv.getX(c) - uv.getX(a),
        v2 = uv.getY(c) - uv.getY(a);
      const sign = Math.sign(u1 * v2 - u2 * v1);
      tangent
        .copy(edge1)
        .multiplyScalar(v2 * sign)
        .addScaledVector(edge2, -v1 * sign);
      bitangent
        .copy(edge2)
        .multiplyScalar(u1 * sign)
        .addScaledVector(edge1, -u2 * sign);
    }
    t.copy(tangent).addScaledVector(normalAt, -normalAt.dot(tangent)).normalize();
    bdir.crossVectors(normalAt, t);
    if (bdir.dot(bitangent) < 0) bdir.negate();
    if (t.lengthSq() < 0.9) return;
    seen[pixel] = 1;
    baked.set(source.dot(t), source.dot(bdir), source.dot(normalAt)).normalize();
    const q = pixel * 4;
    detail.set(byte(q) / 127.5 - 1, byte(q + 1) / 127.5 - 1, byte(q + 2) / 127.5 - 1).normalize();
    // Rotate the existing pore or crease normal by the shortest rotation from
    // the tangent-space pole to the full surface normal (Rodrigues' formula).
    axis.set(-baked.y, baked.x, 0);
    scratch.crossVectors(axis, detail);
    detail
      .add(scratch)
      .addScaledVector(point.crossVectors(axis, scratch), 1 / (1 + baked.z))
      .normalize();
    pixels[q] = Math.round(127.5 * (1 + detail.x));
    pixels[q + 1] = Math.round(127.5 * (1 + detail.y));
    pixels[q + 2] = Math.round(127.5 * (1 + detail.z));
  });
}

// Cosine-weight the visible hemisphere. Mirroring the samples about the
// sagittal plane keeps a symmetric fold equally sheltered on both sides.
const faceRays = Array.from({ length: 32 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 32,
    horizontal = Math.sqrt(1 - y * y);
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  const x = Math.abs(Math.cos(phi)) * horizontal,
    z = Math.sin(phi) * horizontal;
  return [
    [x, y, z],
    [-x, y, z],
  ] as const;
}).flat();

/**
 * The face carries a painted occlusion map, so its detail cannot use the
 * single contact value of the spare UV channel. Bake the visibility of the
 * full face into the red channel of its tile, before the lids and ears lose
 * detail.
 */
export function bakeFaceOcclusion(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  geometry: BufferGeometry,
  indices: ArrayLike<number>,
): void {
  const { position, normal, uv } = attributes(geometry);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const extent = box ? box.max.y - box.min.y : 0;
  if (!(extent > 0)) return;
  const reach = extent * 0.2,
    offset = reach * 0.008;
  const cast = raycaster(position.array, indices, reach * 0.21);
  const visibility = new Float32Array(position.count),
    xy = new Float32Array(2 * position.count);
  const p = new Vector3(),
    n = new Vector3(),
    origin = [0, 0, 0];
  const ramp = new Uint8Array(width * height).fill(255);
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k] ?? 0;
    if (visibility[i]) continue;
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i).normalize();
    p.addScaledVector(n, offset).toArray(origin);
    let total = 0,
      blocked = 0;
    for (const dir of faceRays) {
      const weight = n.x * dir[0] + n.y * dir[1] + n.z * dir[2];
      if (weight <= 0) continue;
      total += weight;
      const hit = cast(origin, dir, reach);
      if (hit < reach) blocked += weight * (1 - hit / reach) ** 2;
    }
    visibility[i] = total ? 1 - (0.9 * blocked) / total : 1;
    xy[2 * i] = uv.getX(i) * width;
    xy[2 * i + 1] = (1 - uv.getY(i)) * height;
  }
  const seen = (i: number) => visibility[i] ?? 0;
  rasterTriangles(indices, xy, width, height, (pixel, a, b, c, u, v, w) => {
    const access = Math.round(255 * (u * seen(a) + v * seen(b) + w * seen(c)));
    ramp[pixel] = Math.min(ramp[pixel] ?? 255, access);
  });
  for (let i = 0; i < ramp.length; i++)
    pixels[4 * i] = Math.round(((pixels[4 * i] ?? 0) * (ramp[i] ?? 255)) / 255);
}
