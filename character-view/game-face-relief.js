import { Vector3 } from "three";
import { raycaster } from "./human-style-kit.js";
import { rasterTriangles } from "./portrait-plate.js";

export function transferFaceNormals(
  pixels,
  width,
  height,
  geometry,
  highIndices,
  lowIndices,
) {
  const { normal, position, uv } = geometry.attributes;
  const xy = new Float32Array(2 * uv.count);
  for (let i = 0; i < uv.count; i++) {
    xy[2 * i] = uv.getX(i) * width;
    xy[2 * i + 1] = (1 - uv.getY(i)) * height;
  }
  const high = new Float32Array(width * height * 6);
  const normalAt = new Vector3(),
    point = new Vector3(),
    source = new Vector3();
  const edge1 = new Vector3(),
    edge2 = new Vector3(),
    scratch = new Vector3();
  const mixAttribute = (out, attr, a, b, c, u, v, w) =>
    out.set(
      u * attr.getX(a) + v * attr.getX(b) + w * attr.getX(c),
      u * attr.getY(a) + v * attr.getY(b) + w * attr.getY(c),
      u * attr.getZ(a) + v * attr.getZ(b) + w * attr.getZ(c),
    );
  function raster(indices, visit) {
    rasterTriangles(
      { index: { count: indices.length, getX: (i) => indices[i] } },
      xy,
      width,
      height,
      visit,
    );
  }
  raster(highIndices, (pixel, a, b, c, u, v, w) => {
    const k = pixel * 6;
    mixAttribute(normalAt, normal, a, b, c, u, v, w)
      .normalize()
      .toArray(high, k);
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
  raster(lowIndices, (pixel, a, b, c, u, v, w) => {
    if (seen[pixel]) return;
    const k = pixel * 6;
    source.fromArray(high, k);
    if (source.lengthSq() < 0.8) return;
    mixAttribute(normalAt, normal, a, b, c, u, v, w).normalize();
    if (source.dot(normalAt) < 0.72) return;
    mixAttribute(point, position, a, b, c, u, v, w);
    if (point.distanceToSquared(scratch.fromArray(high, k + 3)) > 0.004 ** 2)
      return;
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
    t.copy(tangent)
      .addScaledVector(normalAt, -normalAt.dot(tangent))
      .normalize();
    bdir.crossVectors(normalAt, t);
    if (bdir.dot(bitangent) < 0) bdir.negate();
    if (t.lengthSq() < 0.9) return;
    seen[pixel] = 1;
    baked
      .set(source.dot(t), source.dot(bdir), source.dot(normalAt))
      .normalize();
    const q = pixel * 4;
    detail
      .set(
        pixels[q] / 127.5 - 1,
        pixels[q + 1] / 127.5 - 1,
        pixels[q + 2] / 127.5 - 1,
      )
      .normalize();
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

const faceRays = Array.from({length: 32}, (_, i) => {
  const y = 1 - 2*(i + .5)/32, horizontal = Math.sqrt(1 - y*y);
  const phi = i * Math.PI * (3 - Math.sqrt(5));
  const x = Math.abs(Math.cos(phi)) * horizontal, z = Math.sin(phi) * horizontal;
  return [[x,y,z],[-x,y,z]];
}).flat();

export function bakeFaceOcclusion(pixels, width, height, geometry, indices) {
  const { position, normal, uv } = geometry.attributes;
  geometry.computeBoundingBox();
  const extent = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
  if (!(extent > 0)) return;
  const reach = extent * .20, offset = reach * .008;
  const cast = raycaster(position.array, indices, reach*.21);
  const visibility = new Float32Array(position.count), xy = new Float32Array(2*position.count);
  const p = new Vector3(), n = new Vector3(), origin = [0,0,0];
  const ramp = new Uint8Array(width*height).fill(255);
  for (const i of indices) {
    if (visibility[i]) continue;
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i).normalize();
    p.addScaledVector(n, offset).toArray(origin);
    let total = 0, blocked = 0;
    for (const dir of faceRays) {
      const weight = n.x*dir[0] + n.y*dir[1] + n.z*dir[2];
      if (weight <= 0) continue;
      total += weight;
      const hit = cast(origin, dir, reach);
      if (hit < reach) blocked += weight*(1-hit/reach)**2;
    }
    visibility[i] = total ? 1 - .90*blocked/total : 1;
    xy[2*i] = uv.getX(i)*width;
    xy[2*i+1] = (1-uv.getY(i))*height;
  }
  const faces = { index: { count: indices.length, getX: i => indices[i] } };
  rasterTriangles(faces, xy, width, height, (pixel, a,b,c, u,v,w) => {
    const access = Math.round(255*(u*visibility[a]+v*visibility[b]+w*visibility[c]));
    ramp[pixel] = Math.min(ramp[pixel], access);
  });
  for (let i=0; i<ramp.length; i++) pixels[4*i] = Math.round(pixels[4*i]*ramp[i]/255);
}
