import { acceptsFibres, validFibres } from "./guide-fibres.js";
import { validFrontFit } from "./front-fit.js";
import { validProfile } from "./profile-fit.js";
import { validSurfaceJoin } from "./surface-join.js";
import { validPoses } from "./poses.js";
import { validEyes } from "./ocular.js";
import { checkCage } from "./control-cage.js";
import { validDepth, acceptsDepth } from "./portrait-depth.js";
import { validPins } from "./depth-pins.js";
import { spineAxes, bendKnots, reshapeSpine } from "./spine-edit.js";
import { validHairCap } from "./portrait-hair.js";
import { validCut } from "./mantle.js";
import { validLayerStyles, validOutfitSets } from "./outfit-sets.js";
import { validMarkings, acceptsMarkings } from "./markings.js";
import {
  validPlateGrowth,
  validPlateGrowthRest,
  validPlateSite,
} from "./plate-growth.js";
import { validGroom } from "./groom.js";
import {
  applyOperations,
  drawVariation,
  checkPreserved,
} from "./variations.js";
import { buildAxes } from "./body-sculpt.js";
export const motionRoles = [
  "rigid",
  "torso",
  "head",
  "upper arm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
  "tail",
  "wing",
  "fin",
  "axial spine",
  "skirt",
];
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
  "hand",
  "volume",
  "mantle",
  "cage",
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
  spine: spineAxes,
  cloth: ["hem opening", "slit height", "fold depth", "fold count"],
  face: facialAxes,
};
export function nudge(form, target, amounts) {
  if (!Object.values(amounts).some(Boolean)) return form;
  if (target && spineAxes.some((k) => amounts[k])) {
    const part = form.parts.find((p) => p.id === target);
    if (part?.shape === "sweep")
      form = reshapeSpine(form, target, bendKnots(part.knots, amounts));
  }
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
        part.id === target &&
        part.shape === "sweep" &&
        modes.cloth.some((k) => amounts[k])
      ) {
        const d = {
          folds: 10,
          depth: 0,
          twist: 0,
          slit: 0,
          slitHeight: 0.6,
          ...part.drape,
        };
        const clamp = (v, l, h) => Math.min(h, Math.max(l, v));
        d.slit = clamp(d.slit + (amounts["hem opening"] ?? 0) / 100, 0, 0.35);
        d.slitHeight = clamp(
          d.slitHeight + (amounts["slit height"] ?? 0) / 100,
          0.05,
          1,
        );
        d.depth = clamp(d.depth + (amounts["fold depth"] ?? 0) / 100, 0, 0.3);
        d.folds = clamp(d.folds + (amounts["fold count"] ?? 0), 2, 32);
        part = { ...part, drape: d };
      }
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
function validateAppearance(look) {
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
}
function validHull(h) {
  const intervals = (r) =>
    Array.isArray(r) &&
    r.length <= 36 &&
    r.every(
      (s, i) =>
        Array.isArray(s) &&
        s.length === 2 &&
        s.every((v) => Number.isFinite(v) && Math.abs(v) <= 12) &&
        s[1] > s[0] &&
        (!i || s[0] >= r[i - 1][1]),
    );
  return (
    simpleObject(h) &&
    (h.membrane === undefined ||
      (simpleObject(h.membrane) &&
        [-1, 1].includes(h.membrane.slope) &&
        Number.isFinite(h.membrane.thickness) &&
        h.membrane.thickness >= 0.003 &&
        h.membrane.thickness <= 0.12)) &&
    (h.mirrored === undefined || typeof h.mirrored === "boolean") &&
    typeof h.atlas === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(h.atlas) &&
    Number.isFinite(h.height) &&
    h.height >= 0.15 &&
    h.height <= 6 &&
    vec(h.pivot, -12, 12) &&
    Number.isInteger(h.resolution) &&
    h.resolution >= 24 &&
    h.resolution <= 80 &&
    Array.isArray(h.frames) &&
    h.frames.length === 4 &&
    h.frames.every((f) => vec(f, 0, 1.01) && f[2] > 0.05) &&
    Array.isArray(h.rows) &&
    h.rows.length >= 3 &&
    h.rows.length <= 96 &&
    h.rows.every(
      (r, i) =>
        Array.isArray(r) &&
        r.length === 3 &&
        Number.isFinite(r[0]) &&
        r[0] >= 0 &&
        r[0] <= 1 &&
        (!i || r[0] > h.rows[i - 1][0]) &&
        intervals(r[1]) &&
        intervals(r[2]) &&
        Boolean(r[1].length) === Boolean(r[2].length),
    ) &&
    h.rows[0][1].length > 0 &&
    h.rows.at(-1)[1].length > 0 &&
    h.rows.filter((r) => r[1].length).length >= 3
  );
}
function validBinding(p) {
  return (
    simpleObject(p) &&
    typeof p.atlas === "string" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(p.atlas) &&
    Number.isFinite(p.height) &&
    p.height >= 0.15 &&
    p.height <= 6 &&
    vec(p.offset, -12, 12) &&
    checkKnots(p.rest) &&
    (p.frame === undefined || (p.frame === "path" && p.region === undefined)) &&
    (p.frame === "path" ||
      p.rest.every((r, i) => i === 0 || r[1] > p.rest[i - 1][1])) &&
    (p.region === undefined ||
      (typeof p.region === "string" && p.region.length <= 64)) &&
    (p.profile === undefined ||
      (Number.isFinite(p.profile) && p.profile >= 0 && p.profile <= 8))
  );
}
export function validateForm(form) {
  requireThat(simpleObject(form), "Choose a character form.");
  if (form.poses !== undefined)
    requireThat(validPoses(form.poses), "Invalid saved joint poses.");
  if (form.layerStyles !== undefined)
    requireThat(validLayerStyles(form.layerStyles), "Invalid garment layers.");
  if (form.outfitSets !== undefined)
    requireThat(
      validOutfitSets(form.outfitSets, outfits),
      "Invalid saved outfits.",
    );
  if (form.skinSoftness !== undefined)
    requireThat(
      Number.isFinite(form.skinSoftness) &&
        form.skinSoftness >= 0.005 &&
        form.skinSoftness <= 0.045,
      "Invalid seam softness.",
    );
  if (form.skinTint !== undefined)
    requireThat(hex(form.skinTint), "Invalid shared skin color.");
  if (Array.isArray(form.parts))
    requireThat(
      form.parts.filter((p) => p?.blendSkin).length <= 48,
      "Join at most 48 regions at once.",
    );
  if (form.occluders !== undefined)
    requireThat(
      Array.isArray(form.occluders) &&
        form.occluders.length <= 256 &&
        form.occluders.every(validBinding),
      "Invalid original paint regions.",
    );
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
  validateAppearance(form.appearance);
  if (form.artwork !== undefined) {
    requireThat(
      simpleObject(form.artwork) && Object.keys(form.artwork).length <= 8,
      "A form supports up to eight imported images.",
    );
    let bytes = 0;
    for (const [key, value] of Object.entries(form.artwork)) {
      requireThat(
        /^(art|side|face)-[a-f0-9]{64}$/.test(key) &&
          typeof value === "string" &&
          value.startsWith("data:image/webp;base64,") &&
          value.length <= 3_250_000,
        "Invalid embedded artwork.",
      );
      bytes += value.length;
    }
    requireThat(bytes <= 7_000_000, "The embedded artwork exceeds 7 MB.");
  }
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
    if (part.shape === "cage" || part.cage !== undefined) {
      requireThat(
        part.shape === "cage",
        "A control cage needs the cage shape.",
      );
      checkCage(part.cage);
    }
    if (part.frontFits !== undefined)
      requireThat(
        (part.shape === "head" ||
          (part.shape === "sweep" &&
            part.anatomy === "face" &&
            part.paint?.portrait)) &&
          Array.isArray(part.frontFits) &&
          part.frontFits.length <= 6 &&
          part.frontFits.every(validFrontFit),
        "A face accepts up to six frontal landmark passes.",
      );
    if (part.profileFit !== undefined)
      requireThat(
        (part.shape === "head" ||
          (part.shape === "sweep" &&
            part.anatomy === "face" &&
            part.paint?.portrait)) &&
          validProfile(part.profileFit),
        "Invalid side-profile fit. A face needs 4–96 descending points from brow to chin.",
      );
    if (part.surfaceJoin !== undefined)
      requireThat(
        validSurfaceJoin(part),
        "Invalid surface attachment. Select an existing parent and cage face or sweep end.",
      );
    if (part.shape === "mantle" || part.cut !== undefined)
      requireThat(
        part.shape === "mantle" && validCut(part.cut),
        "Invalid cut garment.",
      );
    if (part.shape === "volume" || part.hull !== undefined)
      requireThat(
        part.shape === "volume" && validHull(part.hull),
        "Invalid silhouette volume.",
      );
    if (part.shape === "sweep") {
      requireThat(
        checkKnots(part.knots),
        "A sweep needs distinct centres and positive cross sections.",
      );
    }
    if (part.fibres !== undefined)
      requireThat(
        acceptsFibres(part) && validFibres(part.fibres),
        "Fibre guides need an unpainted, unjoined sweep, 4–96 strands and a valid draw.",
      );
    if (part.faceClearance !== undefined)
      requireThat(
        part.rigidFaceAnchor &&
          Number.isFinite(part.faceClearance) &&
          part.faceClearance >= 0.001 &&
          part.faceClearance <= 0.025,
        "Invalid face hardware clearance.",
      );
    if (part.rigidFaceAnchor !== undefined)
      requireThat(
        Array.isArray(part.rigidFaceAnchor) &&
          part.rigidFaceAnchor.length === 3 &&
          part.rigidFaceAnchor.every(
            (n) => Number.isFinite(n) && Math.abs(n) <= 6,
          ),
        "Invalid rigid face attachment.",
      );
    if (part.headLayer !== undefined)
      requireThat(part.headLayer === "hair", "Unknown head layer.");
    if (part.markings !== undefined)
      requireThat(
        acceptsMarkings(part) && validMarkings(part.markings),
        "Invalid surface markings.",
      );
    if (part.hairCap !== undefined)
      requireThat(
        (part.anatomy === "face" ||
          (part.sourceHairOnly === true && part.headLayer === "hair")) &&
          !!part.paint?.portrait &&
          validHairCap(part.hairCap),
        "Invalid fitted hair surface.",
      );
    if (part.hideSourceHair !== undefined)
      requireThat(
        typeof part.hideSourceHair === "boolean",
        "Invalid source hair setting.",
      );
    if (part.eyesRig !== undefined)
      requireThat(
        (part.shape === "head" ||
          (part.anatomy === "face" && part.paint?.portrait)) &&
          validEyes(part.eyesRig),
        "Invalid articulated eye fit.",
      );
    if (part.plateGrowth !== undefined)
      requireThat(
        part.shape === "sweep" && validPlateGrowth(part.plateGrowth),
        "Invalid plate growth settings.",
      );
    if (part.plateGrowthRest !== undefined)
      requireThat(
        part.plateGrowth && validPlateGrowthRest(part.plateGrowthRest),
        "Invalid plate carrier rest shape.",
      );
    if (part.hornSwatch !== undefined)
      requireThat(
        Number.isInteger(part.hornSwatch) &&
          part.hornSwatch >= 0 &&
          part.hornSwatch <= 3,
        "Invalid horn material swatch.",
      );
    if (part.plateSite !== undefined)
      requireThat(
        part.shape === "cage" && part.parent && validPlateSite(part.plateSite),
        "Invalid plate site.",
      );
    if (part.groom !== undefined)
      requireThat(
        validGroom(part.groom) &&
          (part.shape === "head" ||
            part.anatomy === "face" ||
            part.outfitRole === "head"),
        "A hair groom needs a head and bounded strand controls.",
      );
    if (part.paint?.depthField !== undefined)
      requireThat(
        (acceptsDepth(part) || part.sourceHairOnly === true) &&
          validDepth(part.paint.depthField),
        "Invalid fitted portrait depth.",
      );
    if (part.paint?.depthPins !== undefined)
      requireThat(
        part.shape === "sweep" && validPins(part.paint.depthPins),
        "Invalid paired depth landmarks.",
      );
    if (part.paint?.portrait !== undefined) {
      const f = part.paint.portrait;
      requireThat(
        (part.anatomy === "face" ||
          (part.sourceHairOnly === true && part.headLayer === "hair")) &&
          simpleObject(f) &&
          ["center", "width", "eyes", "nose", "mouth", "chin"].every((k) =>
            Number.isFinite(f[k]),
          ) &&
          (f.frame === undefined ||
            (simpleObject(f.frame) &&
              Number.isFinite(f.frame.base) &&
              f.frame.base >= -0.05 &&
              f.frame.base <= 1 &&
              Number.isFinite(f.frame.span) &&
              f.frame.span >= 0.018 &&
              f.frame.span <= 1.1 &&
              Number.isFinite(f.frame.centerX) &&
              Math.abs(f.frame.centerX) <= 4)) &&
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
    if (part.pulls !== undefined)
      requireThat(
        Array.isArray(part.pulls) &&
          part.pulls.length <= 64 &&
          part.pulls.every(
            (s) =>
              simpleObject(s) &&
              vec(s.at, -24, 24) &&
              vec(s.reach, 0.001, 20) &&
              vec(s.offset, -4, 4) &&
              (s.mirrorX === undefined ||
                (Number.isFinite(s.mirrorX) && Math.abs(s.mirrorX) <= 24)),
          ),
        "A region accepts up to 64 bounded surface pulls.",
      );
    if (part.motionRole !== undefined)
      requireThat(
        motionRoles.includes(part.motionRole),
        "Unknown movement role.",
      );
    if (part.frameSize !== undefined)
      requireThat(
        vec(part.frameSize, 0.005, 12),
        "Invalid metric attachment frame.",
      );
    if (part.look !== undefined) {
      requireThat(
        Object.hasOwn(anchors, part.shape),
        "Appearance overrides apply to anatomical regions.",
      );
      validateAppearance(part.look);
    }
    if (part.grip !== undefined) {
      const g = part.grip;
      requireThat(
        part.shape === "hand" &&
          simpleObject(g) &&
          Number.isInteger(g.fingers) &&
          g.fingers >= 1 &&
          g.fingers <= 7 &&
          Number.isFinite(g.spread) &&
          g.spread >= 0 &&
          g.spread <= 1 &&
          Number.isFinite(g.curl) &&
          g.curl >= 0 &&
          g.curl <= 1 &&
          [1, -1].includes(g.side),
        "Invalid hand articulation.",
      );
    }
    if (part.drape !== undefined) {
      const d = part.drape;
      requireThat(
        part.shape === "sweep" &&
          simpleObject(d) &&
          Number.isInteger(d.folds) &&
          d.folds >= 2 &&
          d.folds <= 32 &&
          Number.isFinite(d.depth) &&
          d.depth >= 0 &&
          d.depth <= 0.3 &&
          Number.isFinite(d.twist) &&
          Math.abs(d.twist) <= 2 &&
          (d.slit === undefined ||
            (Number.isFinite(d.slit) && d.slit >= 0 && d.slit <= 0.35)) &&
          (d.slitHeight === undefined ||
            (Number.isFinite(d.slitHeight) &&
              d.slitHeight >= 0.05 &&
              d.slitHeight <= 1)),
        "Invalid draped surface.",
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
    if (part.blendSkin !== undefined)
      requireThat(
        typeof part.blendSkin === "boolean",
        "Invalid joined-skin setting.",
      );
    if (part.wearFit !== undefined)
      requireThat(
        part.wearFit === true && typeof part.parent === "string",
        "A fitted garment needs a parent region.",
      );
    if (part.outfitRole !== undefined)
      requireThat(
        outfitRoles.includes(part.outfitRole),
        "Unknown clothing region.",
      );
    if (part.bare !== undefined)
      requireThat(
        part.bare === true && outfitRoles.includes(part.outfitRole),
        "Only a clothing region can be marked as bare skin.",
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
        part.shape === "sweep" && validBinding(p),
        "Invalid turnaround binding for " + part.id + ".",
      );
    }
    if (part.surface !== undefined)
      requireThat(
        [
          "plain",
          "canvas",
          "satin",
          "leather",
          "metal",
          "scales",
          "horn",
          "jacket",
        ].includes(part.surface),
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
  const occupiedSites = new Set();
  for (const p of form.parts) {
    if (p.plateSite) {
      const field = form.parts.find(
        (part) => part.id === p.parent,
      )?.plateGrowth;
      const { row, column } = p.plateSite;
      const key = JSON.stringify([p.parent, row, column]);
      requireThat(
        field &&
          row < field.rows &&
          column < field.columns &&
          !occupiedSites.has(key),
        "Each grown plate needs its own site on its carrier.",
      );
      occupiedSites.add(key);
    }
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
export function makeBrief(
  form,
  revision,
  target,
  amounts,
  instructions,
  draw = drawVariation(),
  preserve = [],
  library = {},
) {
  const preview = nudge(form, target, amounts);
  validateForm(preview);
  return {
    attachmentFrames: "metres",
    format: "irudd.form-request.v1",
    requestId: crypto.randomUUID(),
    revision,
    instructions: instructions.trim(),
    variation: draw,
    preserve: [...preserve],
    library,
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
      plateGrowth:
        "Use {op:growPlateField,id,seed,tipSeed,face:Back,rows:6,columns:3} on a sweep. Seeds are unsigned 32-bit integers. Use the request variation seed for a new layout. Face may be Back, Front, Left, Right or Top. Rows 2-12, columns 1/3/5/7. Optional direction first or last points tips along the carrier. Start/end are fractions, wrap 20-165 degrees, overlap 0-.8, crest 0-1, color #rrggbb. On an existing field send only changed settings. Change tipSeed to reshape tips while retaining anchors, or seed to reroll the layout. Each plate is an editable cage. On a single plate ID send only tipSeed to pin its tip through field rerolls. A null tipSeed on that plate releases the pin. Optional rise 0.5-3 multiplies outward plate relief. For a tall sawtooth crest use one column, high crest and rise above 1. Its roots stay fixed. A carrier-only operation refits the field to edited knots. A horn surface accepts hornSwatch 0-3.",
      operations:
        "ordered edits against preview. Omit unchanged fields and parts. setPart: {op,id,set}, addPart: {op,part}, removePart: {op,id}, setForm: {op,set}. placeBranch: {op,id,parent,fromWorld:[point on source branch, optional; defaults to its pivot],toWorld:[destination point on parent],copy:true|false,scale:1,turn:[world X,Y,Z degrees]}. Match the chosen point on an existing branch to a point on the new parent, carrying attached regions and paint. Copies get the suffix ‘ copy’. For artist-marked locations use {op:placeAtMark,id,mark:exact mark name,copy:true|false,scale:1,turn:[x,y,z],depth:.008}. The mark supplies the destination parent and position. Omit fromWorld to seat the source pivot. Carry every attached part with it. placeComponent: {op,asset,id:target,mode:replace|replaceBranch|attach,fit:true|false,socket:above|below|front|back|left|right}. Use the library for high-detail painted features; replace preserves children. Use null to remove an optional field in setPart.",
    },
    modeling:
      'Follow the written instructions first. The variation seed and cues were drawn by the editor from a real random source. The operator authored any drawnChoices as groups of alternatives. Honor the single drawn value in each group where consistent with their instructions. Use the cues to resolve freedom left by the user. Preserve listed part geometry. Return compact operations against the nudged preview and omit unchanged geometry. Global build has optional mass, shoulders, waist, belly and hips multipliers (.4 to 2.4). Units are metres; +Y up, +Z forward and +X character left. The floor is y=0. Preserve appearance and wardrobe unless steered otherwise. You can add, remove, duplicate or replace any parts. Built-in shapes: torso, head, left arm, right arm, left leg, right leg. Their position is an anatomical pivot; size is a local XYZ scale. Custom shapes: box, ellipsoid, cylinder, cone (tip +Y), scute (a shield-shaped convex armor plate, tip -Y, outer ridge +Z). For freeform topology use shape cage, with cage:{vertices:[[x,y,z],...],faces:[[vertexIndex,...],...],levels:0|1|2,creases?:[[a,b],...]}. For an ordinary two-armed person, start with {op:"buildFigure",figure:{height:1.72,heads:7.4,shoulders:1,chest:1,waist:1,hips:1,belly:0,limbs:1,legs:1,arms:1,neck:1,skin:"#b98566",face:0,hair:"Crop",hairColor:"#3a2e28",groom:{pattern:"Locks|Side part|Coils|Braids|Locs",length:.3,curl:.4,volume:.4,sweep:.2,nape:0,seed:1},stance:{arms:13,elbows:14,feet:1,curl:.34},top:{kind:"shirt|tee|jacket|hoodie|none",sleeves:"long|rolled|short|none",color:"#5d7d86",trim:"#e8e2d2",ease:.35,length:.45},bottom:{kind:"trousers|shorts|none",color:"#3c4656",ease:.4,belt:"#4a3a2c",rise:.45,cuffs:false,pockets:"none|cargo"},shoes:{kind:"sneakers|boots|none",color:"#d8d4c8",sole:"#f2efe6"}}}. Height is metres, heads is stature in head heights, widths are multipliers of an average adult, belly is 0 to 1, ease, length and waistband rise are 0 to 1, groom is optional rooted hair with length in head heights and nape (0 to 1) carrying a short cut down the back of the head, the four built-in faces are 0 a middle-aged man, 1 an older man, 2 an older weathered face and 3 a younger woman, stance angles are degrees from a hanging arm. It replaces every part with a body that has shoulder, elbow, wrist, hip and knee joints, fingered hands and separate clothes. The regions are named body, head, left/right upper arm, forearm, hand, thigh, shin and foot. Garments are children named shirt body, collar, left/right sleeve, cuff sleeve, cuff, trouser seat, trouser thigh, trouser shin, belt, cargo pocket, shoe, shoe tongue, lace 1 to 4 and sole. Follow it with setPart or addPart for hair, face sculpt and anything the figure does not cover. Do not model human arms from freehand sweeps. Replace stretched sleeve paint with solid cloth and recut a segmented swept arm from shoulder to wrist with {op:"recutArmSleeves",id:"upper arm",color:"#214d47"}. Bend or straighten one segmented arm relative to its current pose with {op:"bendElbow",id:"forearm",degrees:15}. The wrist and carried objects follow the elbow. A negative angle opens the joint. To equip rows of overlapping plates on a sweep in the current outfit, use {op:"equipPlates",id:"body",name:"chest scale",face:"Front",count:3,columns:3,width:.12,length:.16,depth:.038,start:.3,end:.85,color:"#d2c0a0"}. Width, length and depth are metres in the carrier frame. Rows follow the path from start to end (0–1), columns wrap around its face (Front, Back, Left, Right, Top). Each plate gets its own shape and its upper inside patch seats on the carrier. To reuse an existing turnaround on other regions with matching image framing, use {op:"reuseTurnaround",id:"source part",regions:["first sleeve","second sleeve"]}. The receiving regions must share their old sheet. Use consistently outward winding, 3–8 corners per face. For easy construction, add a cage part without cage data to start from a cube: front/back/left/right/top/bottom face indices are 0,1,2,3,4,5. Apply {op:"editCage",id,kind:"tunnel",face:0,to:1,inset:.34} to make a real opening, "extrude" or "inset" with face and amount, or "crease" on a face. Smaller tunnel inset gives a larger opening. Shape and tilt individual vertices by setting the complete updated cage. A hand shape has a wrist pivot and extends down local Y. Its optional grip has fingers (1-7, plus thumb), curl and spread (0-1), and side (1 or -1). Other primitive positions are their centers; size is full local XYZ dimensions in metres. The organic sweep shape uses knots, each [x,y,z,radiusWidth,radiusDepth] in local metres, two to 48 distinct centreline points, smoothly joined. For sweeps size is local scale. Use this for organic limbs, spines, horns, hair or garment shapes. To bend an existing sweep and carry all of its attached regions use {op:"reshapeSpine",id,knots:[...]}. Appearance.face (0 to 3) selects original face paint and head parts can hold independent sculpt multipliers (.35 to 2) for jaw, nose, brow, cheek, eyes (spacing), eye size, mouth (width), lips (fullness), chin and smile. For a human face made of a sweep, anatomy may be face. Preserve original paint bindings for retained surface artwork. All rotations are Euler XYZ degrees. Custom shapes require color as #rrggbb. Optional parent is a part ID. A child uses local position/size/rotation and follows parent edits. Newly added or replaced primitives receive a metre-based attachment frame automatically: author a child using metre offsets from its parent centre, independent of primitive dimensions. Previously retained primitives without frameSize use scaled local coordinates. Avoid cycles. Optional surface: canvas, leather, metal, scales, plain. Leave outfitRole unassigned for permanent anatomy such as bony sails, ears and horns. The accessory and skirt roles hide regions in Base layer and Pressure suit. Set outfitRole to torso, upper arm, forearm, hand, thigh, shin, foot, head, skirt, accessory or tail when a custom region should accept clothing. A custom mesh may carry markings {kind: Bands, Spots, Rosettes or Countershade, color:#rrggbb, spacing:.06..0.8 metres, coverage:.1..0.9, angle:-180..180 degrees, seed:unsigned integer}. Share one set on organic regions for continuous body markings. Unpainted sweep and ellipsoid regions may set blendSkin:true to join them into one smooth skin with shared joint weights. A sweep can carry drape {folds:2..32,depth:0..0.3,twist:-2..2,slit:0..0.35,slitHeight:0.05..1}. Slits open front and rear panels upwards from the hem. A region also accepts up to 64 local surface pulls: {at:[x,y,z],reach:[rx,ry,rz],offset:[dx,dy,dz],mirrorX?:number}. A smooth radial displacement permits local asymmetry, bulges, dimples and folds in the 3D surface. Keep existing pulls when modifying other fields. For a reusable posed stance, setForm.poses is an array of {name,joints:[{part,station,turn?,shift?}]}. Preserve other named poses when adding one. Each joint is identified by part ID and zero-based station from its attachment toward its tip. A rigid region has station 0. A turn is a unit local XYZW quaternion relative to bind. A shift is a local XYZ translation in metres relative to bind. The whole skeleton uses part "" and station 0. Poses export as named clips and preserve the editable rest shape. Optional motionRole (rigid, torso, head, upper arm, forearm, hand, thigh, shin, foot, wing, fin, axial spine, tail, skirt) controls skinning and animation independently of clothing. Use axial spine for a flexible sweeping trunk, ordering its points from head to tail. This supports swimming and slithering. Frontal geometry edits use frontFits, up to six successive passes {pins:[{at:[x,y,z],shift:[dx,dy]},...],radius:.10.. .65,amount:0..1}. Coordinates use head-height units centered on the current face bounds, +X towards character left, +Y up, +Z forward. Each pass interpolates 3–32 paired surface landmarks including fixed points. Optional view:{yaw,pitch,mode:"plane" or "depth"} uses a head-centred orthographic orbit in degrees: positive yaw towards +X, positive pitch upwards. For an angled pass at and shift use camera right, up and toward-camera coordinates. Depth mode adjusts only anatomical Z and requires at least a 20 degree angle away from the frontal axis. In depth mode symmetric:true inside view mirrors the scalar correction across anatomical X. An optional frontFits overlay holds a content-hashed UV paint layer. Preserve these on unrelated edits. Head accessories can share rigidFaceAnchor:[x,y,z] in normalized anatomical head coordinates; they follow that point rigidly through each face fit. Set faceClearance in metres (.001 to .025) on the rigid front pieces; supporting pieces sharing the same anchor can extend from their rear attachment. A head or registered portrait may use profileFit:{curve:[[t,forward],...],amount:0..1}. Trace 4–96 rows from the brow at [0,0] to the lower chin at t=1, using forward depth relative to the brow in units of brow-to-chin height. Increasing t descends the face. Preserve the curve unless directed to change its side contour. Optional profileFit.stage=\"finish\" makes the side contour the final depth constraint and optional relief from 0 to 1 rebuilds nose and cheek depth against that contour. Preserve a profileFit.paint registration and its side portrait ID on unrelated edits. A head or registered portrait may carry eyesRig {color:#rrggbb,opening:.42..1.8,width:.62..1.6,spacing:.7..1.3,lift:-.10.. .10,iris:.55..1.45}. Preserve measured offsets when revising a fit. The iris supports four independent gaze morphs. An unpainted, unjoined sweep can grow individually rooted fibres along its knots using fibres:{count:4..96,wave:0..1,fall:0..1,grey:0..1,rooted:true|false,seed:unsigned integer}. Use fall for trailing length relative to guide length. Preserve seeds and root attachment on unrelated edits. A head may carry a procedural hair groom with optional pattern (Locks, Side part, Coils, Braids or Locs), part position (-1 to 1), length (0-2 head heights), curl, gather, volume (0-1), sweep (-1 to 1), color (#rrggbb) and an unsigned integer seed. Existing separate hair meshes can have headLayer:"hair" and a head as parent so applying a groom replaces them visually. Attach a cage root to the actual parent surface using surfaceJoin:{faces:[cageFaceIndices],depth:.008} or a sweep end with surfaceJoin:{end:"first", "last" or "along",depth:.008}. The selected patch sits inside the carrier and shares its joint weights. A waist-fitted skirt uses shape mantle, wearFit:true, motionRole skirt, cut:{kind:"Skirt",width,depth,drop,flare,folds,outline:[[0,1],...,[1,hemWidth]],bias:-1..1,gather:0..0.3,tiers:0..6,train:0..2}. Width, depth, drop and rear train use metres. Outline points descend from waist to hem with radius relative to the waist. Bias slopes raised folds across the front. Use surface "satin" for smooth cloth or "canvas" for coarse weave. A mantle is a fitted cut fabric panel. Its cut.armAccess can be Covered, Open sides or Armholes independently of the garment cut. Arm areas follow the nearest arm while the neckline stays attached. Keep the other cut fields on changes. Use optional visibleIn (wardrobe names) for outfit-specific additions. appearance.tones accepts cloth, trim, panel, pants, boots as hex colours. Use unique readable IDs. Use at most 128 parts, each size .005 to 12 and position -12 to 12. Return only proposal JSON. Keep adult humanoid clothing practical and nonsexualized.',
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
  const form =
    raw.form ??
    applyOperations(
      request.preview,
      raw.operations,
      request.library,
      request.attachmentFrames === "metres",
      request.surfaceMarks,
    );
  validateForm(form);
  checkPreserved(request.preview, form, request.preserve);
  return raw.form ? raw : { ...raw, form };
}
