export function render(meshes, { yaw = 0, center = [0, 0.96, 0], span = 2.06, width = 450, height = 618, background = [0.875, 0.898, 0.875], supersample = 2, mode = "colour" } = {}) {
  const W = width * supersample, H = height * supersample, scale = H / span, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const right = [cy, 0, -sy], toward = [sy, 0, cy];
  const depth = new Float32Array(W * H).fill(-Infinity), color = new Float32Array(W * H * 3);
  const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
  const key = unit([-0.45, 0.62, 0.64]), fill = unit([0.7, 0.15, 0.5]), rim = unit([0.2, 0.5, -0.85]);
  const flat = mode === "silhouette" ? [0.125, 0.216, 0.2] : mode === "clay" ? [0.68, 0.7, 0.68] : null;
  for (const mesh of meshes) {
    const { positions, indices } = mesh, count = positions.length / 3, nrm = mesh.normals ?? vertexNormals(positions, indices);
    const sx = new Float32Array(count), sY = new Float32Array(count), sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3] - center[0], y = positions[i * 3 + 1] - center[1], z = positions[i * 3 + 2] - center[2];
      sx[i] = (x * right[0] + z * right[2]) * scale + W / 2;
      sY[i] = H / 2 - y * scale;
      sz[i] = x * toward[0] + z * toward[2];
    }
    const tex = mesh.texture, uv = mesh.uvs;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const x0 = sx[a], y0 = sY[a], x1 = sx[b], y1 = sY[b], x2 = sx[c], y2 = sY[c], area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!area) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const fx = px + 0.5, fy = py + 0.5;
        const w0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area, w1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c], at = py * W + px;
        if (z <= depth[at]) continue;
        let tint = mesh.color;
        if (tex && uv) {
          const u = w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[c * 2], v = w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[c * 2 + 1];
          const tx = Math.min(tex.size - 1, Math.max(0, Math.floor((u - Math.floor(u)) * tex.size))), ty = Math.min(tex.size - 1, Math.max(0, Math.floor((v - Math.floor(v)) * tex.size))), o = (ty * tex.size + tx) * 4;
          if (mesh.cutout && tex.data[o + 3] < 102) continue;
          tint = [tex.data[o] / 255, tex.data[o + 1] / 255, tex.data[o + 2] / 255];
        }
        depth[at] = z;
        if (mode === "silhouette") { color.set(flat, at * 3); continue; }
        let nx = w0 * nrm[a * 3] + w1 * nrm[b * 3] + w2 * nrm[c * 3], ny = w0 * nrm[a * 3 + 1] + w1 * nrm[b * 3 + 1] + w2 * nrm[c * 3 + 1], nz = w0 * nrm[a * 3 + 2] + w1 * nrm[b * 3 + 2] + w2 * nrm[c * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        let lx = nx * right[0] + nz * right[2], ly = ny, lz = nx * toward[0] + nz * toward[2];
        if (lz < 0) { lx = -lx; ly = -ly; lz = -lz; }
        const d = Math.max(0, lx * key[0] + ly * key[1] + lz * key[2]) * 0.72 + Math.max(0, lx * fill[0] + ly * fill[1] + lz * fill[2]) * 0.2 + Math.max(0, lx * rim[0] + ly * rim[1] + lz * rim[2]) * 0.08 + 0.3 + 0.06 * ly;
        const base = flat ?? tint;
        color[at * 3] = base[0] * d; color[at * 3 + 1] = base[1] * d; color[at * 3 + 2] = base[2] * d;
      }
    }
  }
  const out = new Uint8Array(width * height * 4), mask = new Uint8Array(width * height), radius = Math.max(2, Math.round(0.012 * scale));
  const taps = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, covered = 0;
    for (let j = 0; j < supersample; j++) for (let i = 0; i < supersample; i++) {
      const px = x * supersample + i, py = y * supersample + j, at = py * W + px;
      if (depth[at] === -Infinity) { r += background[0]; g += background[1]; b += background[2]; continue; }
      covered++;
      let shade = 1;
      if (mode !== "silhouette") {
        let occ = 0;
        for (const [dx, dy] of taps) for (const m of [1, 2.2]) {
          const qx = Math.round(px + dx * radius * m), qy = Math.round(py + dy * radius * m);
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          const dz = depth[qy * W + qx] - depth[at];
          if (dz > 0.002 && dz < 0.08) occ += Math.min(1, dz / 0.02) / m;
        }
        shade = 1 - 0.45 * Math.min(1, occ / 9);
      }
      r += color[at * 3] * shade; g += color[at * 3 + 1] * shade; b += color[at * 3 + 2] * shade;
    }
    const k = 255 / (supersample * supersample), o = (y * width + x) * 4;
    out[o] = Math.min(255, r * k); out[o + 1] = Math.min(255, g * k); out[o + 2] = Math.min(255, b * k); out[o + 3] = 255;
    mask[y * width + x] = covered * 2 >= supersample * supersample ? 1 : 0;
  }
  return { width, height, data: out, mask, pixelsPerMetre: height / span, center, span };
}
function vertexNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2], vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += x; n[k + 1] += y; n[k + 2] += z; }
  }
  return n;
}
export function ruler(image, x = -0.66) {
  const { width, height, data, pixelsPerMetre: ppm, center } = image, px = Math.round(width / 2 + x * ppm), row = (y) => Math.round(height / 2 - (y - center[1]) * ppm);
  const dot = (cx, cy) => { if (cx >= 0 && cy >= 0 && cx < width && cy < height) data.set([65, 88, 76, 255], (cy * width + cx) * 4); };
  for (let y = Math.max(0, row(2)); y <= Math.min(height - 1, row(0)); y++) dot(px, y);
  for (let i = 0; i <= 20; i++) { const y = row(i / 10), reach = i % 10 === 0 ? 0.09 : i % 5 === 0 ? 0.06 : 0.03; for (let dx = 0; dx < reach * ppm; dx++) dot(px + dx, y); }
  return image;
}
export function join(images, gap = 4, vertical = false) {
  const w = vertical ? Math.max(...images.map((i) => i.width)) : images.reduce((t, i) => t + i.width, 0) + gap * (images.length - 1);
  const h = vertical ? images.reduce((t, i) => t + i.height, 0) + gap * (images.length - 1) : Math.max(...images.map((i) => i.height));
  const data = new Uint8Array(w * h * 4).fill(255);
  let at = 0;
  for (const image of images) {
    for (let y = 0; y < image.height; y++) data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), vertical ? (at + y) * w * 4 : (y * w + at) * 4);
    at += (vertical ? image.height : image.width) + gap;
  }
  return { width: w, height: h, data };
}
export function bestDepth(views, width, height, pixelsPerMetre, reach = 0.14) {
  let best = { shift: 0, overlap: -1 };
  const steps = Math.ceil(reach * pixelsPerMetre);
  for (let step = -steps; step <= steps; step++) {
    const shift = step / pixelsPerMetre;
    let total = 0;
    for (const { yaw, target, adult } of views) {
      const slide = Math.round(-shift * Math.sin(yaw) * pixelsPerMetre);
      let both = 0, either = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const a = target[y * width + x], from = x - slide, b = from >= 0 && from < width ? adult[y * width + from] : 0;
        both += a & b; either += a | b;
      }
      total += both / either;
    }
    if (total / views.length > best.overlap + 1e-9 || (Math.abs(total / views.length - best.overlap) <= 1e-9 && Math.abs(shift) < Math.abs(best.shift))) best = { shift, overlap: total / views.length };
  }
  return best;
}
