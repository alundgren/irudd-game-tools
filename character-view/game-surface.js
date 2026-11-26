import { Vector3 } from "three";

export function measureTileScale(mesh, batch, totals) {
  const geometry = mesh.geometry;
  const { position, uv } = geometry.attributes;
  if (!uv) return;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), scratch = new Vector3();
  for (let i = batch.start; i < batch.start + batch.count; i += 3) {
    const ia = geometry.index?.getX(i) ?? i;
    const ib = geometry.index?.getX(i + 1) ?? i + 1;
    const ic = geometry.index?.getX(i + 2) ?? i + 2;
    const du1 = uv.getX(ib) - uv.getX(ia), du2 = uv.getX(ic) - uv.getX(ia);
    const dv1 = uv.getY(ib) - uv.getY(ia), dv2 = uv.getY(ic) - uv.getY(ia);
    const area = Math.abs(du1 * dv2 - du2 * dv1);
    if (area < 1e-9) continue;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld).sub(a);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld).sub(a);
    totals.u += scratch.copy(b).multiplyScalar(dv2).addScaledVector(c, -dv1).length();
    totals.v += scratch.copy(c).multiplyScalar(du1).addScaledVector(b, -du2).length();
    totals.area += area;
  }
}

export function packSurfaceChannels(out, rough, metal, roughness, metalness, ambient = null, strength = 1) {
  for (let i = 0; i < out.length; i += 4) {
    out[i] = ambient ? Math.round(255 + strength * (ambient[i] - 255)) : 255;
    out[i + 3] = 255;
    out[i + 1] = Math.round(roughness * (rough ? rough[i + 1] : 255));
    out[i + 2] = Math.round(metalness * (metal ? metal[i + 2] : 255));
  }
}

export function packNormals(out, pixels, scale) {
  for (let i = 0; i < out.length; i += 4) {
    const x = (pixels[i] / 127.5 - 1) * scale.x;
    const y = (pixels[i+1] / 127.5 - 1) * scale.y;
    const z = pixels[i+2] / 127.5 - 1;
    const length = Math.hypot(x, y, z) || 1;
    out[i] = Math.round(127.5 + 127.5*x/length);
    out[i+1] = Math.round(127.5 + 127.5*y/length);
    out[i+2] = Math.round(127.5 + 127.5*z/length);
    out[i+3] = 255;
  }
}

export function heightNormals(out, heights, w, h, scale, totals, srgb) {
  const linear = Float64Array.from({ length: 256 }, (_, i) => {
    const v = i / 255;
    return srgb ? (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) : v;
  });
  const strengthU = totals.u > 0 ? scale * w * totals.area / totals.u : 0;
  const strengthV = totals.v > 0 ? scale * h * totals.area / totals.v : 0;
  for (let y = 0; y < h; y++) {
    const top = Math.max(0, y - 1), bottom = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const left = Math.max(0, x - 1), right = Math.min(w - 1, x + 1);
      const i = 4 * (y * w + x);
      const nx = strengthU * (linear[heights[4 * (y*w+left)]] - linear[heights[4 * (y*w+right)]]) / Math.max(1, right-left);
      const ny = strengthV * (linear[heights[4 * (bottom*w+x)]] - linear[heights[4 * (top*w+x)]]) / Math.max(1, bottom-top);
      const length = Math.hypot(nx, ny, 1);
      out[i] = Math.round(127.5 + 127.5 * nx / length);
      out[i+1] = Math.round(127.5 + 127.5 * ny / length);
      out[i+2] = Math.round(127.5 + 127.5 / length);
      out[i+3] = 255;
    }
  }
}
