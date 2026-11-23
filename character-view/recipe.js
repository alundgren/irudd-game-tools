import { buildAxes } from "./body-sculpt.js";
import { outfitRoles } from "./wardrobe.js";
import { facialAxes, isFace } from "./facial-sculpt.js";
import { bindHumanoid } from "./rig.js";
export const outfits = ["Base layer", "Work clothes", "Pressure suit"];
export const anchors = {
  torso: [0, 0.86, 0],
  head: [0, 1.42, 0],
  "left arm": [0.2, 1.32, 0],
  "right arm": [-0.2, 1.32, 0],
  "left leg": [0.104, 0.85, 0],
  "right leg": [-0.104, 0.85, 0],
};
export const shapes = [
  ...Object.keys(anchors),
  "ellipsoid",
  "box",
  "cone",
  "cylinder",
  "sweep",
  "scute",
];
const choose = (items, draw) => items[Math.floor(draw() * items.length)];
export const entropy = () =>
  crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
export function startingForm(draw = entropy, bind = true) {
  const face = Math.floor(draw() * 4);
  const width = 0.87 + draw() * 0.26,
    height = 0.91 + draw() * 0.16;
  const form = {
    outfit: "Work clothes",
    appearance: {
      palette: choose(["Tide", "Ochre", "Clay", "Polar"], draw),
      face,
      skin: ["#ac785a", "#ae7f5d", "#956449", "#c9997c"][face],
      hairColor: choose(["#372e2a", "#292624", "#786353", "#42342a"], draw),
      hair: choose(["Crop", "Sweep", "Coils"], draw),
    },
    parts: Object.entries(anchors).map(([shape, pivot]) => ({
      id: shape,
      shape,
      position: pivot.map((n, i) => n * [width, height, 1][i]),
      size: [width, height, 1],
      rotation: [0, 0, 0],
    })),
  };
  return bind ? bindHumanoid(form) : form;
}

const axes = ["width", "height", "depth"];
export const neutral = () => ({ width: 0, height: 0, depth: 0 });
export const modes = {
  shape: ["width", "height", "depth"],
  move: ["across", "lift", "forward"],
  turn: ["pitch", "yaw", "roll"],
  build: buildAxes,
  face: facialAxes,
};
export function nudge(form, target, amounts) {
  if (!Object.values(amounts).some(Boolean)) return form;
  const factors = axes.map((key) => 1 + (amounts[key] ?? 0) / 100);
  const move = ["across", "lift", "forward"].map(
    (k) => (amounts[k] ?? 0) * 0.01,
  );
  const turn = ["pitch", "yaw", "roll"].map((k) => amounts[k] ?? 0);
  const faceChange = modes.face.some((k) => Boolean(amounts[k]));
  const build = { ...form.build };
  if (target === null)
    for (const k of buildAxes)
      if (amounts[k])
        build[k] = Math.min(
          2.4,
          Math.max(0.4, (build[k] ?? 1) * (1 + amounts[k] / 100)),
        );
  return {
    ...form,
    ...(Object.keys(build).length ? { build } : {}),
    parts: form.parts.map((part) => {
      if (
        faceChange &&
        isFace(part) &&
        (target === null || part.id === target)
      ) {
        const original = {
            ...(part.shape === "head" ? form.appearance.sculpt : {}),
            ...part.sculpt,
          },
          sculpt = { ...part.sculpt };
        for (const k of modes.face)
          if (amounts[k])
            sculpt[k] = Math.min(
              2,
              Math.max(0.35, (original[k] ?? 1) * (1 + amounts[k] / 100)),
            );
        part = { ...part, sculpt };
      }
      if (
        (target !== null && part.id !== target) ||
        (target === null && part.parent)
      )
        return part;
      return {
        ...part,
        size: part.size.map((x, i) => x * factors[i]),
        rotation: part.rotation.map((x, i) =>
          turn[i] ? ((x + turn[i] + 540) % 360) - 180 : x,
        ),
        position: part.position.map(
          (x, i) => (target === null ? x * factors[i] : x) + move[i],
        ),
      };
    }),
  };
}

function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}
const hex = (value) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const vec = (v, min, max) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && n >= min && n <= max);
const simpleObject = (v) =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
function checkKnots(knots) {
  return (
    Array.isArray(knots) &&
    knots.length >= 2 &&
    knots.length <= 48 &&
    knots.every(
      (k, i) =>
        Array.isArray(k) &&
        k.length === 5 &&
        vec(k.slice(0, 3), -8, 8) &&
        k.slice(3).every((n) => Number.isFinite(n) && n >= 0.0005 && n <= 4) &&
        (i === 0 ||
          k
            .slice(0, 3)
            .some((n, j) => Math.abs(n - knots[i - 1][j]) > 0.00001)),
    )
  );
}
export function validateForm(form) {
  requireThat(
    form && outfits.includes(form.outfit),
    "Choose a supported wardrobe.",
  );
  requireThat(
    form.build === undefined ||
      (simpleObject(form.build) &&
        Object.entries(form.build).every(
          ([k, v]) =>
            buildAxes.includes(k) && Number.isFinite(v) && v >= 0.4 && v <= 2.4,
        )),
    "Invalid body build.",
  );
  const look = form.appearance;
  requireThat(
    look &&
      ["Tide", "Ochre", "Clay", "Polar"].includes(look.palette) &&
      ["Crop", "Sweep", "Coils", "Bald"].includes(look.hair) &&
      hex(look.skin) &&
      hex(look.hairColor),
    "The starting appearance is incomplete.",
  );
  requireThat(
    look.face === undefined ||
      (Number.isInteger(look.face) && look.face >= 0 && look.face < 4),
    "Unknown face texture.",
  );
  requireThat(
    look.tones === undefined || simpleObject(look.tones),
    "Invalid clothing colours.",
  );
  requireThat(
    look.sculpt === undefined || simpleObject(look.sculpt),
    "Invalid face sculpt.",
  );
  requireThat(
    look.belly === undefined ||
      (Number.isFinite(look.belly) && look.belly >= 0.5 && look.belly <= 2),
    "Belly scale must be between 0.5 and 2.",
  );
  requireThat(
    look.sleeves === undefined ||
      ["long", "short", "none"].includes(look.sleeves),
    "Invalid sleeve style.",
  );
  for (const flag of ["pockets", "collar"])
    requireThat(
      look[flag] === undefined || typeof look[flag] === "boolean",
      "Invalid clothing detail.",
    );
  if (form.artwork !== undefined) {
    requireThat(
      simpleObject(form.artwork) && Object.keys(form.artwork).length <= 8,
      "A form supports up to eight imported turnarounds.",
    );
    let bytes = 0;
    for (const [key, value] of Object.entries(form.artwork)) {
      requireThat(
        /^art-[a-f0-9]{64}$/.test(key) &&
          typeof value === "string" &&
          value.startsWith("data:image/webp;base64,") &&
          value.length <= 3_250_000,
        "Invalid embedded turnaround.",
      );
      bytes += value.length;
    }
    requireThat(bytes <= 7_000_000, "The embedded artwork exceeds 7 MB.");
  }
  for (const [key, value] of Object.entries(look.tones ?? {}))
    requireThat(
      ["cloth", "trim", "panel", "pants", "boots"].includes(key) && hex(value),
      "Invalid clothing colour.",
    );
  for (const [key, value] of Object.entries(look.sculpt ?? {}))
    requireThat(
      facialAxes.includes(key) &&
        Number.isFinite(value) &&
        value >= 0.35 &&
        value <= 2,
      "Invalid face sculpt.",
    );
  requireThat(
    Array.isArray(form.parts) &&
      form.parts.length >= 1 &&
      form.parts.length <= 128,
    "A form must have between 1 and 128 parts.",
  );
  const ids = new Set();
  for (const part of form.parts) {
    requireThat(
      part &&
        typeof part.id === "string" &&
        part.id.trim() &&
        part.id.length <= 64 &&
        !ids.has(part.id),
      "Each part needs a unique name of up to 64 characters.",
    );
    requireThat(
      shapes.includes(part.shape) &&
        vec(part.position, -12, 12) &&
        vec(part.size, 0.005, 12) &&
        vec(part.rotation, -360, 360),
      "Invalid geometry for " + part.id + ".",
    );
    requireThat(
      Object.hasOwn(anchors, part.shape) || hex(part.color),
      "Choose a hex color for " + part.id + ".",
    );
    if (part.shape === "sweep") {
      requireThat(
        checkKnots(part.knots),
        "A sweep needs distinct centres and positive cross sections.",
      );
    }
    if (part.paint?.portrait !== undefined) {
      const f = part.paint.portrait;
      requireThat(
        part.anatomy === "face" &&
          simpleObject(f) &&
          ["center", "width", "eyes", "nose", "mouth", "chin"].every((k) =>
            Number.isFinite(f[k]),
          ) &&
          Math.abs(f.center) <= 0.4 &&
          f.width >= 0.08 &&
          f.width <= 0.8 &&
          f.chin >= 0 &&
          f.eyes < 1 &&
          f.chin < f.mouth &&
          f.mouth < f.nose &&
          f.nose < f.eyes,
        "Invalid facial landmarks.",
      );
    }
    if (part.mount !== undefined)
      requireThat(
        part.shape === "scute" &&
          simpleObject(part.mount) &&
          vec(part.mount.position, -12, 12) &&
          vec(part.mount.size, 0.005, 12) &&
          vec(part.mount.rotation, -360, 360),
        "Invalid scute mounting pose.",
      );
    if (part.outfitRole !== undefined)
      requireThat(
        outfitRoles.includes(part.outfitRole),
        "Unknown clothing region.",
      );
    if (part.anatomy !== undefined)
      requireThat(
        part.anatomy === "face" && part.shape === "sweep",
        "Invalid facial region.",
      );
    if (part.sculpt !== undefined)
      requireThat(
        isFace(part) &&
          simpleObject(part.sculpt) &&
          Object.entries(part.sculpt).every(
            ([k, v]) =>
              facialAxes.includes(k) &&
              Number.isFinite(v) &&
              v >= 0.35 &&
              v <= 2,
          ),
        "Invalid regional face sculpt.",
      );
    if (part.paint !== undefined) {
      const p = part.paint;
      requireThat(
        part.shape === "sweep" &&
          simpleObject(p) &&
          typeof p.atlas === "string" &&
          /^[a-zA-Z0-9_-]{1,80}$/.test(p.atlas) &&
          Number.isFinite(p.height) &&
          p.height >= 0.15 &&
          p.height <= 6 &&
          vec(p.offset, -12, 12) &&
          checkKnots(p.rest) &&
          p.rest.every((r, i) => i === 0 || r[1] > p.rest[i - 1][1]) &&
          (p.region === undefined ||
            (typeof p.region === "string" && p.region.length <= 64)) &&
          (p.profile === undefined ||
            (Number.isFinite(p.profile) && p.profile >= 0 && p.profile <= 8)),
        "Invalid turnaround binding for " + part.id + ".",
      );
    }
    if (part.surface !== undefined)
      requireThat(
        ["plain", "canvas", "leather", "metal", "scales", "jacket"].includes(
          part.surface,
        ),
        "Unknown surface.",
      );
    if (part.visibleIn)
      requireThat(
        Array.isArray(part.visibleIn) &&
          part.visibleIn.length > 0 &&
          part.visibleIn.every((name) => outfits.includes(name)),
        "Invalid wardrobe visibility.",
      );
    ids.add(part.id);
  }
  for (const p of form.parts) {
    const seen = new Set([p.id]);
    let parent = p.parent;
    while (parent !== undefined) {
      requireThat(
        ids.has(parent) && !seen.has(parent),
        "Missing parent or attachment cycle at " + p.id + ".",
      );
      seen.add(parent);
      parent = form.parts.find((other) => other.id === parent).parent;
    }
  }
  return form;
}
function withoutArtwork(form) {
  const { artwork, ...recipe } = form;
  return recipe;
}
export function makeBrief(form, revision, target, amounts, instructions) {
  const preview = nudge(form, target, amounts);
  validateForm(preview);
  return {
    format: "irudd.form-request.v1",
    requestId: crypto.randomUUID(),
    revision,
    instructions: instructions.trim(),
    nudge: {
      target,
      amounts: { ...amounts },
      units:
        "size and face in percent; translation in cm; local rotation in degrees",
    },
    current: withoutArtwork(form),
    preview: withoutArtwork(preview),
    replyFormat: {
      format: "irudd.form-proposal.v1",
      requestId: "copy requestId",
      revision: "copy revision",
      summary: "one short description",
      form: "complete replacement in the same structure as preview",
    },
    modeling:
      "Design a genuinely different 3D variation following the instructions and using the nudge as direction. Global build has optional mass, shoulders, waist, belly and hips multipliers (.4 to 2.4). Units are metres; +Y up, +Z forward and +X character left. The floor is y=0. Preserve appearance and wardrobe unless steered otherwise. You can add, remove, duplicate or replace any parts. Built-in shapes: torso, head, left arm, right arm, left leg, right leg. Their position is an anatomical pivot; size is a local XYZ scale. Custom shapes: box, ellipsoid, cylinder, cone (tip +Y), scute (a shield-shaped convex armor plate, tip -Y, outer ridge +Z). Their position is their center; size is full local XYZ dimensions in metres. The organic sweep shape uses knots, each [x,y,z,radiusWidth,radiusDepth] in local metres, two to 48 distinct centreline points, smoothly joined. For sweeps size is local scale. Use this for organic limbs, spines, horns, hair or garment shapes. Appearance.face (0 to 3) selects original face paint and head parts can hold independent sculpt multipliers (.35 to 2) for jaw, nose, brow, cheek, eyes (spacing), eye size, mouth (width), lips (fullness), chin and smile. For a human face made of a sweep, anatomy may be face. Preserve original paint bindings for retained surface artwork. All rotations are Euler XYZ degrees. Custom shapes require color as #rrggbb. Optional parent is a part ID. A child uses local position/size/rotation and follows parent edits; avoid cycles. Optional surface: canvas, leather, metal, scales, plain. Set outfitRole to torso, upper arm, forearm, hand, thigh, shin, foot, head, skirt, accessory or tail when a custom region should accept clothing. Use optional visibleIn (wardrobe names) for outfit-specific additions. appearance.tones accepts cloth, trim, panel, pants, boots as hex colours. Use unique readable IDs. Use at most 128 parts, each size .005 to 12 and position -12 to 12. Return only proposal JSON. Keep adult humanoid clothing practical and nonsexualized.",
  };
}
export function readProposal(raw, request, revision) {
  requireThat(
    request &&
      request.revision === revision &&
      raw?.revision === revision &&
      raw.requestId === request.requestId,
    "This proposal belongs to a different request or an earlier edit.",
  );
  requireThat(
    raw.format === "irudd.form-proposal.v1" &&
      typeof raw.summary === "string" &&
      raw.summary.trim() &&
      raw.summary.length <= 500,
    "The proposal needs a short description.",
  );
  validateForm(raw.form);
  return raw;
}
