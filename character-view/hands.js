import { handSurface } from "./hand-surface.js";
const cache = new Map();

// The wrist is the pivot. Digit chains bend toward the palm in its local
// frame, and the opposable thumb has its own plane of movement.
export function handGeometry({
  fingers = 4,
  curl = 0.15,
  spread = 0.2,
  side = 1,
} = {}) {
  const w = 0.085,
    h = 0.18,
    d = 0.039,
    key = [fingers, curl, spread, side].join("/");
  if (cache.has(key)) {
    const source = cache.get(key),
      copy = source.clone();
    copy.handRig = source.handRig;
    return copy;
  }
  let palm;
  const digits = [];
  function loft(rows, name) {
    const scaled = rows.map(([x, y, z, rx, rz]) => [
      x * w * side,
      y * h,
      z * d,
      rx * w,
      rz * d,
    ]);
    if (name) digits.push({ name, rows: scaled });
    else palm = scaled;
  }
  loft([
    [0, 0, 0, 0.29, 0.33],
    [0, -0.12, 0.005, 0.35, 0.43],
    [0.012, -0.28, 0, 0.45, 0.5],
    [0.014, -0.42, 0.018, 0.47, 0.43],
    [0, -0.53, 0.03, 0.41, 0.34],
  ]);
  for (let i = 0; i < fingers; i++) {
    const u = fingers === 1 ? 0.5 : i / (fingers - 1),
      x = -0.33 + u * 0.69,
      fan = (u - 0.5) * spread;
    const length = 0.429 + 0.055 * Math.sin(u * Math.PI) - 0.083 * u,
      thick = Math.min(0.118, 0.435 / fingers);
    const rows = [
      [x, -0.49, 0.015, thick, 0.25],
      [
        x + fan * 0.3,
        -0.49 - length * 0.35,
        -0.045 + curl * 0.17,
        thick * 0.91,
        0.234,
      ],
      [
        x + fan * 0.62,
        -0.49 - length * 0.68 + curl * 0.035,
        0.025 + curl * 0.43,
        thick * 0.84,
        0.192,
      ],
      [
        x + fan * 0.94,
        -0.49 - length * 0.98 + curl * 0.14,
        0.12 + curl * 0.67,
        thick * 0.75,
        0.176,
      ],
      [
        x + fan,
        -0.49 - length + curl * 0.145,
        0.132 + curl * 0.68,
        thick * 0.46,
        0.12,
      ],
    ];
    loft(rows, ["Index", "Middle", "Ring", "Little"][i] ?? "Digit" + (i + 1));
  }
  loft(
    [
      [-0.25, -0.17, 0.19, 0.163, 0.32],
      [-0.406, -0.28, 0.33, 0.153, 0.29],
      [-0.56 - spread * 0.1, -0.395, 0.46, 0.13, 0.25],
      [
        -0.59 - spread * 0.14,
        -0.51 + curl * 0.08,
        0.57 + curl * 0.19,
        0.115,
        0.2,
      ],
      [
        -0.58 - spread * 0.14,
        -0.57 + curl * 0.13,
        0.65 + curl * 0.35,
        0.069,
        0.14,
      ],
    ],
    "Thumb",
  );
  const source = handSurface(palm, digits, [w, h, d]);
  if (cache.size >= 8) {
    const old = cache.keys().next().value;
    cache.get(old).dispose();
    cache.delete(old);
  }
  cache.set(key, source);
  const copy = source.clone();
  copy.handRig = source.handRig;
  return copy;
}
