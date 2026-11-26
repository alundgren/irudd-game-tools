import { MathUtils } from "three";

const width = 144,
  height = 160,
  cache = new Map();
export function acceptsDepth(part) {
  if (
    part?.anatomy !== "face" ||
    !part.paint?.portrait ||
    !part.paint.rest?.length
  )
    return false;
  const rows = part.paint.rest;
  return (rows.at(-1)[1] - rows[0][1]) / part.paint.height > 0.72;
}
export function validDepth(field) {
  return (
    field &&
    Number.isFinite(field.mix) &&
    field.mix >= 0 &&
    field.mix <= 1 &&
    typeof field.values === "string" &&
    field.values.length === (width * height * 4) / 3 &&
    /^[A-Za-z0-9+/]+$/.test(field.values)
  );
}
function bytes(s) {
  if (!cache.has(s)) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(
      s,
      Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
    );
  }
  return cache.get(s);
}
export function depthFromPixels(rgba, w, h) {
  const spans = [];
  for (let y = 0; y < h; y++) {
    let lo = w,
      hi = -1;
    for (let x = 0; x < w; x++) {
      const at = 4 * (y * w + x);
      if (
        rgba[at + 3] > 128 &&
        rgba[at] > 16 &&
        Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) -
          Math.min(rgba[at], rgba[at + 1], rgba[at + 2]) <
          30
      ) {
        lo = Math.min(lo, x);
        hi = x;
      }
    }
    spans.push(hi - lo > 3 ? [lo, hi] : null);
  }
  const top = spans.findIndex(Boolean),
    bottom = spans.findLastIndex(Boolean);
  if (top < 0 || bottom - top < h * 0.35)
    throw new Error("Use one front-facing grayscale depth pass on black.");
  const values = new Uint8Array(width * height);
  const left = Math.min(...spans.filter(Boolean).map((s) => s[0])),
    right = Math.max(...spans.filter(Boolean).map((s) => s[1]));
  for (let j = 0; j < height; j++) {
    const y = Math.round(MathUtils.lerp(bottom, top, j / (height - 1)));
    const span = spans[y];
    if (!span) continue;
    for (let i = 0; i < width; i++) {
      const x = MathUtils.clamp(
        MathUtils.lerp(left, right, i / (width - 1)),
        span[0],
        span[1],
      );
      const k = Math.floor(x);
      values[j * width + i] = Math.round(
        MathUtils.lerp(
          rgba[(y * w + k) * 4],
          rgba[(y * w + Math.min(k + 1, span[1])) * 4],
          x - k,
        ),
      );
    }
  }
  return { mix: 0.88, values: btoa(String.fromCharCode(...values)) };
}
export function applyPortraitDepth(geometry, paint) {
  const field = paint?.depthField;
  if (!field?.mix) return geometry;
  const values = bytes(field.values),
    pos = geometry.attributes.position,
    uv = geometry.attributes.uv;
  const bounds = paint.rest.reduce(
    (b, [x, y, z, w, r]) => [
      Math.min(b[0], x - w),
      Math.max(b[1], x + w),
      Math.min(b[2], z - r),
      Math.max(b[3], z + r),
    ],
    [Infinity, -Infinity, Infinity, -Infinity],
  );
  const [left, right, back, front] = bounds;
  const fieldAt = (x, y) => {
    const xf =
      MathUtils.clamp((x - left) / (right - left || 1), 0, 1) * (width - 1);
    const yf =
      MathUtils.clamp((y + paint.offset[1]) / paint.height, 0, 1) *
      (height - 1);
    const xi = Math.floor(xf),
      yi = Math.floor(yf),
      xn = Math.min(xi + 1, width - 1),
      yn = Math.min(yi + 1, height - 1);
    const sample = (row) =>
      MathUtils.lerp(
        values[row * width + xi],
        values[row * width + xn],
        xf - xi,
      );
    return MathUtils.lerp(sample(yi), sample(yn), yf - yi) / 255;
  };
  let count = 0,
    sum = 0,
    zSum = 0,
    sum2 = 0,
    cross = 0;
  for (let i = 0; i < pos.count; i++) {
    const facing = -Math.sin(uv.getX(i) * 2 * Math.PI),
      y = (pos.getY(i) + paint.offset[1]) / paint.height;
    if (facing < 0.42 || y < 0.19 || y > 0.86) continue;
    const gray = fieldAt(pos.getX(i), pos.getY(i)),
      z = pos.getZ(i);
    count++;
    sum += gray;
    sum2 += gray * gray;
    zSum += z;
    cross += gray * z;
  }
  if (!count) return geometry;
  const depth = front - back,
    variance = sum2 - (sum * sum) / count;
  if (variance < 1e-5) return geometry;
  const gain = MathUtils.clamp(
    (cross - (sum * zSum) / count) / variance,
    depth * 0.25,
    depth * 1.3,
  );
  const offset = (zSum - gain * sum) / count;
  for (let i = 0; i < pos.count; i++) {
    const facing = -Math.sin(uv.getX(i) * 2 * Math.PI),
      y = (pos.getY(i) + paint.offset[1]) / paint.height;
    const blend =
      field.mix *
      MathUtils.smoothstep(facing, 0.15, 0.65) *
      MathUtils.smoothstep(y, 0.09, 0.24) *
      (1 - MathUtils.smoothstep(y, 0.81, 0.97));
    if (!blend) continue;
    const old = pos.getZ(i),
      desired = offset + gain * fieldAt(pos.getX(i), pos.getY(i));
    pos.setZ(
      i,
      old +
        blend *
          MathUtils.clamp(
            desired - old,
            -paint.height * 0.13,
            paint.height * 0.13,
          ),
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
