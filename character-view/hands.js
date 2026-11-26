import { closedDigitRows } from "./cylindrical-grip.js";
import { handSurface } from "./hand-surface.js";
const cache = new Map();

export function handGeometry({
  fingers = 4,
  curl = 0.15,
  spread = 0.2,
  side = 1,
  relaxed = false,
  cylindrical = false,
  pad = "hand",
} = {}, { game = false } = {}) {
  const w = 0.085,
    h = 0.18,
    d = 0.039,
    key = [fingers, curl, spread, side, relaxed, cylindrical, pad, game].join("/");
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
    if (!cylindrical && pad !== "hand") {
      for (const [i, p] of scaled.entries()) {
        const t = i / (scaled.length - 1);
        const toe = name && name !== "Thumb";
        const paw = pad === "paw";
        p[0] *= paw ? 1.12 : .95;
        if (paw) {
          p[1] *= toe ? 1 - .16*t : .97;
          p[2] += toe ? .012*t*t : 0;
          p[3] *= toe ? 1.35 : 1.05;
          p[4] *= toe ? 1.42 : 1.24;
        } else if (name) {
          p[2] += .021*t*t;
          p[1] += .009*t**3;
          const taper = i === scaled.length-1 ? .36 : 1.03;
          p[3] *= taper;
          p[4] *= taper;
        }
      }
    }
    if (name === "Thumb" && relaxed) {
      scaled.forEach((p, i) => {
        const extension = i / (scaled.length - 1);
        p[0] -= side * 0.009 * extension;
        p[2] += 0.004 * extension;
      });
    }
    if (name) digits.push({ name, rows: cylindrical ? closedDigitRows(scaled,name === "Thumb",side) : scaled });
    else palm = scaled;
  }
  loft(
    relaxed
      ? [
          [0, 0.024, -0.015, 0.27, 0.37],
          [0, -0.07, -0.008, 0.3, 0.36],
          [-0.022, -0.19, 0.012, 0.388, 0.455],
          [-0.006, -0.34, 0.018, 0.452, 0.455],
          [0.008, -0.435, 0.02, 0.458, 0.37],
          [-0.04, -0.508, 0.025, 0.38, 0.3],
        ]
      : [
          [0, 0, 0, 0.29, 0.33],
          [0, -0.12, 0.005, 0.35, 0.43],
          [0.012, -0.28, 0, 0.45, 0.5],
          [0.014, -0.42, 0.018, 0.47, 0.43],
          [0, -0.53, 0.03, 0.41, 0.34],
        ],
  );
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
    if (relaxed) {
      const bend = curl * (0.77 + 0.79 * u);
      let y = -0.485 - 0.025 * Math.sin(Math.PI * u) + 0.055 * u;
      let z = 0.015;
      const segments = [
        [0.36, 0.3],
        [0.33, 1.18],
        [0.27, 1.84],
        [0.04, 1.96],
      ];
      rows[0][1] = y;
      for (const [index, [fraction, angle]] of segments.entries()) {
        y -= length * fraction * Math.cos(angle * bend);
        z += (length * fraction * Math.sin(angle * bend) * h) / d;
        rows[index + 1][1] = y;
        rows[index + 1][2] = z;
      }
    }
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
  const source = handSurface(palm, digits, [w, h, d], game);
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
