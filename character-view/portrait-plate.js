import { MathUtils, Vector3 } from "three";

// Shared triangle rasterizer for UV textures and visibility buffers.
// Coordinates are pixel edges and each sample is taken at a pixel centre.
export function rasterTriangles(geometry, xy, width, height, visit) {
  const indices = geometry.index;
  for (
    let f = 0, total = indices?.count ?? geometry.attributes.position.count;
    f < total;
    f += 3
  ) {
    const a = indices ? indices.getX(f) : f,
      b = indices ? indices.getX(f + 1) : f + 1,
      c = indices ? indices.getX(f + 2) : f + 2;
    const ax = xy[2 * a],
      ay = xy[2 * a + 1],
      bx = xy[2 * b],
      by = xy[2 * b + 1],
      cx = xy[2 * c],
      cy = xy[2 * c + 1];
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

// A similarity sets scale and roll. Interpolate the residual displacements
// so that each photographed feature lands on the selected surface texel.
export function photoRegistration(pairs, aspect) {
  const a = pairs[0],
    b = pairs[1],
    dx = b.at[0] - a.at[0],
    dy = b.at[1] - a.at[1],
    den = dx * dx + dy * dy;
  const sx = b.uv[0] - a.uv[0],
    sy = -(b.uv[1] - a.uv[1]) * aspect;
  const scale = (dx * sx + dy * sy) / den,
    turn = (dx * sy - dy * sx) / den;
  const baseX = (x, y) =>
    a.uv[0] + scale * (x - a.at[0]) - turn * (y - a.at[1]);
  const baseY = (x, y) =>
    a.uv[1] - (turn * (x - a.at[0]) + scale * (y - a.at[1])) / aspect;
  const pins = pairs.map((p) => [
    p.at[0],
    p.at[1],
    p.uv[0] - baseX(...p.at),
    p.uv[1] - baseY(...p.at),
  ]);
  return (x, y, out) => {
    let total = 0,
      u = 0,
      v = 0;
    for (const [px, py, du, dv] of pins) {
      const d = (x - px) ** 2 + (y - py) ** 2,
        w = 1 / Math.max(d * d, 1e-14);
      total += w;
      u += du * w;
      v += dv * w;
    }
    out[0] = baseX(x, y) + u / total;
    out[1] = baseY(x, y) + v / total;
  };
}

// Preserve plain or transparent backdrops at the boundary. On a chroma-key
// background, suppress its dominant colour even in mixed hair/skin edge pixels.
export function backdropOpacity(rgb, j, first, last) {
  const delta = (a, b) =>
    Math.max(
      Math.abs(rgb[a] - rgb[b]),
      Math.abs(rgb[a + 1] - rgb[b + 1]),
      Math.abs(rgb[a + 2] - rgb[b + 2]),
    );
  if (delta(first, last) > 38) return 1;
  const distance = Math.min(delta(j, first), delta(j, last));
  let channel = 0;
  for (let k = 1; k < 3; k++)
    if (rgb[first + k] > rgb[first + channel]) channel = k;
  const other1 = (channel + 1) % 3,
    other2 = (channel + 2) % 3;
  const chroma = (i) =>
    rgb[i + channel] - Math.max(rgb[i + other1], rgb[i + other2]);
  const key = chroma(first);
  const spill = key > 18 ? MathUtils.smoothstep(chroma(j) / key, 0.1, 0.57) : 0;
  return MathUtils.smoothstep(distance, 28, 66) * (1 - spill);
}
export async function capturePortraitPlate(probe, camera, photo, pairs, half) {
  const geometry = probe.geometry,
    pos = geometry.attributes.position,
    uv = geometry.attributes.uv;
  const width = 1280,
    height = 800,
    depthSize = 400;
  const tex = new Float32Array(pos.count * 2),
    screen = new Float32Array(pos.count * 2),
    projected = new Float32Array(pos.count * 3);
  const angular = new Float32Array(pos.count);
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
    up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
    out = new Vector3().setFromMatrixColumn(camera.matrixWorld, 2);
  probe.updateWorldMatrix(true, false);
  const pt = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    pt.fromBufferAttribute(pos, i).applyMatrix4(probe.matrixWorld);
    const u = pt.dot(right),
      v = pt.dot(up),
      z = pt.dot(out);
    projected.set([u, v, z], i * 3);
    tex.set([width * uv.getX(i), height * (1 - uv.getY(i))], i * 2);
    screen.set(
      [depthSize * (0.5 + u / (2 * half)), depthSize * (0.5 - v / (2 * half))],
      i * 2,
    );
    // The mask fades at grazing angles. Use a head-centred radial direction
    // to avoid cutting holes under the lips or on a sharply sculpted brow.
    pt.y *= 0.15;
    pt.normalize();
    angular[i] = MathUtils.smoothstep(pt.dot(out), 0.07, 0.59);
  }
  const depth = new Float32Array(depthSize ** 2).fill(-Infinity);
  rasterTriangles(
    geometry,
    screen,
    depthSize,
    depthSize,
    (pixel, a, b, c, l, s, t) => {
      const z =
        l * projected[3 * a + 2] +
        s * projected[3 * b + 2] +
        t * projected[3 * c + 2];
      depth[pixel] = Math.max(depth[pixel], z);
    },
  );
  const source = document.createElement("canvas"),
    scale = Math.min(
      1,
      1800 / Math.max(photo.naturalWidth, photo.naturalHeight),
    );
  source.width = Math.max(1, Math.round(photo.naturalWidth * scale));
  source.height = Math.max(1, Math.round(photo.naturalHeight * scale));
  const sc = source.getContext("2d", { willReadFrequently: true });
  sc.drawImage(photo, 0, 0, source.width, source.height);
  const rgb = sc.getImageData(0, 0, source.width, source.height).data;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d"),
    image = ctx.createImageData(width, height);
  const map = photoRegistration(pairs, source.height / source.width),
    coord = [0, 0];
  rasterTriangles(geometry, tex, width, height, (pixel, a, b, c, l, s, t) => {
    const alpha = l * angular[a] + s * angular[b] + t * angular[c];
    if (alpha < 0.001) return;
    const x =
        l * projected[3 * a] + s * projected[3 * b] + t * projected[3 * c],
      y =
        l * projected[3 * a + 1] +
        s * projected[3 * b + 1] +
        t * projected[3 * c + 1],
      z =
        l * projected[3 * a + 2] +
        s * projected[3 * b + 2] +
        t * projected[3 * c + 2];
    const col = MathUtils.clamp(
        Math.floor(depthSize * (0.5 + x / (2 * half))),
        0,
        depthSize - 1,
      ),
      row = MathUtils.clamp(
        Math.floor(depthSize * (0.5 - y / (2 * half))),
        0,
        depthSize - 1,
      );
    if (z < depth[row * depthSize + col] - 0.018) return;
    map(x, y, coord);
    if (coord.some((v) => v <= 0 || v >= 1)) return;
    const px = Math.round(coord[0] * (source.width - 1)),
      py = Math.round(coord[1] * (source.height - 1)),
      j = 4 * (py * source.width + px),
      k = 4 * pixel;
    const first = 4 * py * source.width,
      last = first + 4 * (source.width - 1);
    const matte = backdropOpacity(rgb, j, first, last);
    image.data[k] = rgb[j];
    image.data[k + 1] = rgb[j + 1];
    image.data[k + 2] = rgb[j + 2];
    image.data[k + 3] = Math.round(rgb[j + 3] * alpha * matte);
  });
  ctx.putImageData(image, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not save the projected portrait.")),
      "image/webp",
      0.94,
    ),
  );
}
