import { startingForm, validateForm } from "./recipe.js";
import { bindParts } from "./rig.js";

function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hueColor(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (
    "#" +
    [0, 8, 4]
      .map((n) =>
        Math.round(f(n) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function generateForm(
  kind = "human",
  seed = crypto.getRandomValues(new Uint32Array(1))[0],
) {
  const rnd = randomStream(seed),
    between = (a, b) => a + (b - a) * rnd(),
    integer = (a, b) => Math.floor(between(a, b + 1));
  const form = startingForm(rnd);
  form.origin = { generator: 1, seed, kind };
  if (kind === "human") {
    form.appearance.sculpt = Object.fromEntries(
      ["jaw", "nose", "brow", "cheek"].map((k) => [k, between(0.76, 1.25)]),
    );
    form.appearance.sleeves = ["long", "short", "none"][integer(0, 2)];
    return form;
  }
  const parts = [],
    links = {};
  const add = (part, parent) => {
    parts.push(part);
    if (parent) links[part.id] = parent;
    return part.id;
  };
  function sweep(id, rows, color, surface, parent) {
    const pivot = rows[0].slice(0, 3);
    return add(
      {
        id,
        shape: "sweep",
        position: pivot,
        size: [1, 1, 1],
        rotation: [0, 0, 0],
        color,
        surface,
        knots: rows.map((row) => row.map((v, i) => (i < 3 ? v - pivot[i] : v))),
      },
      parent,
    );
  }
  const oval = (
    id,
    position,
    size,
    color,
    surface,
    parent,
    angle = [0, 0, 0],
  ) =>
    add(
      {
        id,
        shape: "ellipsoid",
        position,
        size,
        rotation: angle,
        color,
        surface,
      },
      parent,
    );
  const hue = between(0, 360),
    base = hueColor(hue, 0.24, 0.38),
    highlight = hueColor((hue + 34) % 360, 0.3, 0.58);
  const accent = hueColor((hue + 145) % 360, 0.4, 0.53),
    dark = hueColor(hue, 0.22, 0.2);
  const pairs = integer(1, 4),
    length = between(0.65, 1.65),
    width = between(0.12, 0.35);
  const hip = between(0.3, 0.95),
    arch = between(0.02, 0.24),
    neck = between(0.18, 0.77),
    eyePairs = integer(1, 2);
  const bodyY = (t) => hip + 0.1 + arch * Math.sin(t * Math.PI);
  const bodyZ = (t) => (t - 0.5) * length;
  sweep(
    "spine",
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8,
        full = 0.31 + 0.69 * Math.sin(t * Math.PI) ** 0.62;
      return [0, bodyY(t), bodyZ(t), width * full, width * full * 0.84];
    }),
    base,
    "scales",
  );
  const tail = between(0.2, 0.93);
  sweep(
    "tail",
    [
      [0, bodyY(0), bodyZ(0) + 0.05, width * 0.37, width * 0.35],
      [0, hip + 0.1, -length * 0.5 - tail * 0.33, width * 0.29, width * 0.25],
      [
        tail * 0.13,
        hip + 0.07,
        -length * 0.5 - tail * 0.72,
        width * 0.17,
        width * 0.12,
      ],
      [tail * 0.23, hip + tail * 0.24, -length * 0.5 - tail, 0.003, 0.004],
    ],
    base,
    "scales",
    "spine",
  );
  for (let pair = 0; pair < pairs; pair++) {
    const t = pairs === 1 ? 0.52 : 0.14 + (pair / (pairs - 1)) * 0.72;
    const z = bodyZ(t),
      y = bodyY(t),
      spread = between(0.06, 0.17),
      stride = between(-0.085, 0.085);
    for (const side of [-1, 1]) {
      const tag = (side > 0 ? "Left" : "Right") + " " + (pair + 1),
        rootX = side * width * 0.65,
        kneeX = side * (width + spread);
      const root = sweep(
        tag + " thigh",
        [
          [rootX, y, z, width * 0.35, width * 0.32],
          [kneeX, y * 0.67, z + 0.09, width * 0.27, width * 0.26],
          [kneeX * 0.97, y * 0.51, z + 0.025, width * 0.2, width * 0.2],
        ],
        base,
        "scales",
        "spine",
      );
      const ankle = side * (width + spread * 0.88);
      const shin = sweep(
        tag + " shin",
        [
          [kneeX * 0.97, y * 0.51, z + 0.025, width * 0.2, width * 0.2],
          [ankle, y * 0.27, z - 0.055, width * 0.16, width * 0.14],
          [ankle, 0.065, z + stride, width * 0.12, width * 0.14],
        ],
        base,
        "scales",
        root,
      );
      oval(
        tag + " foot",
        [ankle, 0.045, z + stride + 0.035],
        [width * 0.69, 0.09, width * 0.84],
        dark,
        "leather",
        shin,
      );
      for (let f = 0; f < 3; f++) {
        const toe = (f - 1) * 0.035;
        sweep(
          tag + " toe " + (f + 1),
          [
            [ankle + toe, 0.044, z + stride + 0.05, 0.014, 0.013],
            [ankle + toe * 1.5, 0.024, z + stride + 0.1, 0.012, 0.01],
            [ankle + toe * 1.7, 0.018, z + stride + 0.135, 0.002, 0.003],
          ],
          highlight,
          "plain",
          shin,
        );
      }
    }
  }
  const faceY = hip + 0.19 + neck * 0.68,
    faceZ = length * 0.5 + neck * 0.56;
  sweep(
    "neck",
    [
      [0, bodyY(0.87), bodyZ(0.87), width * 0.57, width * 0.52],
      [
        0,
        hip + 0.19 + neck * 0.31,
        length * 0.45 + neck * 0.18,
        width * 0.39,
        width * 0.35,
      ],
      [0, faceY, faceZ, width * 0.31, width * 0.35],
    ],
    base,
    "scales",
    "spine",
  );
  const head = oval(
    "head",
    [0, faceY, faceZ],
    [width * 1.14, width * 0.93, width * 1.4],
    highlight,
    "scales",
    "neck",
  );
  oval(
    "muzzle",
    [0, faceY - width * 0.14, faceZ + width * 0.53],
    [width * 0.7, width * 0.51, width * 0.94],
    base,
    "scales",
    head,
  );
  for (let i = 0; i < eyePairs; i++) {
    for (const side of [-1, 1]) {
      const x = side * width * (0.46 - i * 0.12),
        y = faceY + width * (0.19 + i * 0.19),
        z = faceZ + width * (0.27 - i * 0.3);
      oval(
        "eye " + side + "/" + i,
        [x, y, z],
        [width * 0.28, width * 0.28, width * 0.29],
        accent,
        "plain",
        head,
      );
      oval(
        "pupil " + side + "/" + i,
        [x + side * 0.009, y, z + width * 0.12],
        [width * 0.1, width * 0.17, width * 0.07],
        "#182c2a",
        "plain",
        head,
      );
    }
  }
  const crests = integer(3, 9);
  for (let i = 0; i < crests; i++) {
    const t = 0.08 + (i / crests) * 0.8,
      y = bodyY(t) + width * (0.32 + 0.51 * Math.sin(t * Math.PI)),
      z = bodyZ(t);
    const h = between(0.08, 0.27);
    sweep(
      "dorsal fin " + (i + 1),
      [
        [0, y - 0.035, z, 0.026, 0.059],
        [0, y + 0.035, z - 0.009, 0.02, 0.05],
        [0, y + h, z - 0.045, 0.003, 0.009],
      ],
      i % 2 ? highlight : accent,
      "scales",
      "spine",
    );
  }
  for (const p of parts) {
    const region =
      p.id === "spine"
        ? "torso"
        : p.id === "head"
          ? "head"
          : p.id.includes("thigh")
            ? "thigh"
            : p.id.includes("shin")
              ? "shin"
              : p.id.includes("foot")
                ? "foot"
                : null;
    if (region) p.outfitRole = region;
  }
  form.parts = parts;
  const result = bindParts(form, links);
  validateForm(result);
  return result;
}
