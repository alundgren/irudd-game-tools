// A small orthographic z-buffer renderer for checking styled humans without a browser.
// It shades smooth clay with a key and fill light, darkens creases from the depth
// buffer and tints back faces red so reversed winding is easy to spot.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function normals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += x; n[k + 1] += y; n[k + 2] += z; }
  }
  return n;
}

/** meshes: [{positions, indices, normals?, color:[r,g,b] in 0..1}] */
export function render(meshes, { yaw = 0, pitch = 0, center = [0, .9, 0], span = 2, width = 400, height = 800, background = [.93, .93, .92], supersample = 2 } = {}) {
  const W = width * supersample, H = height * supersample, scale = H / span;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Camera axes: yaw 0 looks at the front (+Z faces the camera).
  const right = [cy, 0, -sy], toward = [sy * cp, sp, cy * cp];
  const up = [toward[1] * right[2] - toward[2] * right[1], toward[2] * right[0] - toward[0] * right[2], toward[0] * right[1] - toward[1] * right[0]];
  const depth = new Float32Array(W * H).fill(-Infinity), color = new Float32Array(W * H * 3);
  const key = norm([-.45, .62, .64]), fill = norm([.7, .15, .5]), rim = norm([.2, .5, -.85]);
  for (const mesh of meshes) {
    const { positions, indices } = mesh, nrm = mesh.normals ?? normals(positions, indices);
    const count = positions.length / 3, sx = new Float32Array(count), syy = new Float32Array(count), sz = new Float32Array(count);
    const cn = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3] - center[0], y = positions[i * 3 + 1] - center[1], z = positions[i * 3 + 2] - center[2];
      sx[i] = (x * right[0] + z * right[2]) * scale + W / 2;
      syy[i] = H / 2 - (x * up[0] + y * up[1] + z * up[2]) * scale;
      sz[i] = x * toward[0] + y * toward[1] + z * toward[2];
      const a = nrm[i * 3], b = nrm[i * 3 + 1], c = nrm[i * 3 + 2], l = Math.hypot(a, b, c) || 1;
      cn[i * 3] = a / l; cn[i * 3 + 1] = b / l; cn[i * 3 + 2] = c / l;
    }
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const x0 = sx[a], y0 = syy[a], x1 = sx[b], y1 = syy[b], x2 = sx[c], y2 = syy[c];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (!area) continue;
      // Screen y points down, so a front face has negative signed area here.
      const back = area > 0;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const fx = px + .5, fy = py + .5;
        const w0 = ((x1 - fx) * (y2 - fy) - (x2 - fx) * (y1 - fy)) / area;
        const w1 = ((x2 - fx) * (y0 - fy) - (x0 - fx) * (y2 - fy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * sz[a] + w1 * sz[b] + w2 * sz[c], at = py * W + px;
        if (z <= depth[at]) continue;
        depth[at] = z;
        let nx = w0 * cn[a * 3] + w1 * cn[b * 3] + w2 * cn[c * 3];
        let ny = w0 * cn[a * 3 + 1] + w1 * cn[b * 3 + 1] + w2 * cn[c * 3 + 1];
        let nz = w0 * cn[a * 3 + 2] + w1 * cn[b * 3 + 2] + w2 * cn[c * 3 + 2];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        if (back) { nx = -nx; ny = -ny; nz = -nz; }
        // Lights are fixed to the camera so every turnaround view reads alike.
        const lx = nx * right[0] + nz * right[2], ly = nx * up[0] + ny * up[1] + nz * up[2], lz = nx * toward[0] + ny * toward[1] + nz * toward[2];
        const d = Math.max(0, lx * key[0] + ly * key[1] + lz * key[2]) * .78 + Math.max(0, lx * fill[0] + ly * fill[1] + lz * fill[2]) * .2
          + Math.max(0, lx * rim[0] + ly * rim[1] + lz * rim[2]) * .1 + .2 + .06 * ly;
        const tint = back ? [1, .25, .25] : mesh.color;
        color[at * 3] = tint[0] * d; color[at * 3 + 1] = tint[1] * d; color[at * 3 + 2] = tint[2] * d;
      }
    }
  }
  // Depth-based crease darkening: nearer neighbours occlude a pixel.
  const out = new Uint8Array(width * height * 4), radius = Math.max(2, Math.round(.012 * scale));
  const taps = [[1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < supersample; j++) for (let i = 0; i < supersample; i++) {
      const px = x * supersample + i, py = y * supersample + j, at = py * W + px;
      if (depth[at] === -Infinity) { r += background[0]; g += background[1]; b += background[2]; continue; }
      let occ = 0;
      for (const [dx, dy] of taps) for (const m of [1, 2.2]) {
        const qx = Math.round(px + dx * radius * m), qy = Math.round(py + dy * radius * m);
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        const dz = depth[qy * W + qx] - depth[at];
        if (dz > .002 && dz < .08) occ += Math.min(1, dz / .02) / m;
      }
      const shade = 1 - .5 * Math.min(1, occ / 9);
      r += color[at * 3] * shade; g += color[at * 3 + 1] * shade; b += color[at * 3 + 2] * shade;
    }
    const k = 255 / (supersample * supersample), o = (y * width + x) * 4;
    out[o] = Math.min(255, r * k); out[o + 1] = Math.min(255, g * k); out[o + 2] = Math.min(255, b * k); out[o + 3] = 255;
  }
  return { width, height, data: out };
}
function norm(v) { const l = Math.hypot(...v); return v.map(x => x / l); }

/** Lay equally sized images out in rows. */
export function sheet(images, columns) {
  const w = images[0].width, h = images[0].height, rows = Math.ceil(images.length / columns);
  const data = new Uint8Array(w * columns * h * rows * 4).fill(236);
  images.forEach((image, i) => {
    const ox = (i % columns) * w, oy = Math.floor(i / columns) * h;
    for (let y = 0; y < h; y++) data.set(image.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * w * columns + ox) * 4);
  });
  return { width: w * columns, height: h * rows, data };
}

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0); out.write(type, 4, "ascii"); body.copy(out, 8);
  let c = 0xffffffff;
  for (let i = 4; i < body.length + 8; i++) c = crcTable[(c ^ out[i]) & 255] ^ (c >>> 8);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, body.length + 8);
  return out;
}
export function writePng(path, { width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]));
}
