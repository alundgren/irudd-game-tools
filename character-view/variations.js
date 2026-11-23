import { buildFigure } from "./figure.js";
import { equipPlateRows } from "./scutes.js";
import { cubeCage, editCage } from "./control-cage.js";
import { validWorldMarks } from "./spatial-guide.js";
import { reshapeSpine } from "./spine-edit.js";
import { drawDecks, encodeDecks, decodeDecks } from "./choice-decks.js";
import {
  paintSources,
  retainPaintSources,
  repaintRegions,
} from "./paint-sources.js";
import {
  bendElbow,
  recutArmSleeves,
  placeBranch,
  placeComponent,
} from "./graft.js";
const ideas = {
  subtle: [
    [
      "Round a contour",
      "Sharpen one transition",
      "Taper the extremities",
      "Soften one joint",
      "Exaggerate a single landmark",
    ],
    [
      "Shift weight forward",
      "Echo an existing curve",
      "Move one accent off-center",
      "Make the silhouette more compact",
      "Lengthen an exposed edge",
    ],
  ],
  exploratory: [
    [
      "Repeat a feature in graduated sizes",
      "Change the carrying posture",
      "Move the center of mass",
      "Branch one attachment",
      "Introduce a contrasting silhouette",
    ],
    [
      "Low and wide",
      "Tall and narrow",
      "Swept backward",
      "Offset asymmetry",
      "Long arcs with short terminals",
      "Heavy core and delicate extremities",
    ],
  ],
  radical: [
    [
      "Change the locomotor plan",
      "Redistribute sensory organs",
      "Branch the spine or tail",
      "Transform a limb into another functional structure",
      "Split a major body region",
      "Move from upright to horizontal",
    ],
    [
      "Bilateral repeating segments",
      "Radial fan",
      "Unequal limbs that balance the body",
      "Concentric shells",
      "Tapered suspended volumes",
      "Overlapping interlocking outer plates",
    ],
  ],
};
export function drawVariation(
  strength = "exploratory",
  seed = crypto.getRandomValues(new Uint32Array(1))[0],
) {
  if (!Object.hasOwn(ideas, strength))
    throw new Error("Unknown variation range.");
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    strength,
    seed: seed >>> 0,
    cues: ideas[strength].map((deck) => deck[Math.floor(next() * deck.length)]),
    magnitude: Math.round(20 + next() * 65),
  };
}

export function redrawDirection(previous, strength, seed) {
  const fresh = drawVariation(strength, seed);
  const pins = fresh.cues.map((_, i) =>
    previous?.strength === strength ? (previous.pins?.[i] ?? null) : null,
  );
  return {
    ...fresh,
    ...(previous?.decks?.length
      ? { decks: drawDecks(previous.decks, fresh.seed, previous.decks) }
      : {}),
    pins,
    cues: fresh.cues.map((cue, i) =>
      pins[i] === null ? cue : drawVariation(strength, pins[i]).cues[i],
    ),
  };
}
export function directionCode(variation) {
  const pins = variation.pins ?? [];
  return (
    [
      variation.strength,
      variation.seed.toString(36),
      ...(pins.some((v) => v !== null)
        ? pins.map((v) => (v === null ? "_" : v.toString(36)))
        : []),
    ].join("/") +
    (variation.decks?.length ? "~" + encodeDecks(variation.decks) : "")
  );
}
export function replayDirection(code) {
  const [base, decksToken, ...excess] = String(code).trim().split("~");
  if (excess.length) throw new Error("Enter a saved direction code.");
  const decks = decksToken === undefined ? [] : decodeDecks(decksToken);
  const [strength, draw, ...locked] = base.toLowerCase().split("/");
  function seed(s) {
    if (!/^[0-9a-z]{1,7}$/.test(s) || parseInt(s, 36) > 0xffffffff)
      throw new Error("Enter a saved direction code.");
    return parseInt(s, 36);
  }
  if (
    !Object.hasOwn(ideas, strength) ||
    !draw ||
    (locked.length && locked.length !== ideas[strength].length)
  )
    throw new Error("Enter a saved direction code.");
  return redrawDirection(
    { strength, decks, pins: locked.map((s) => (s === "_" ? null : seed(s))) },
    strength,
    seed(draw),
  );
}

const measuredShapes = new Set([
  "cage",
  "box",
  "cone",
  "cylinder",
  "ellipsoid",
  "scute",
  "hand",
]);
function withMetricFrame(part, enabled) {
  return enabled && measuredShapes.has(part.shape) && !part.frameSize
    ? { ...part, frameSize: [...part.size] }
    : part;
}
const allowedPartKeys = new Set([
  "frontFits",
  "profileFit",
  "surfaceJoin",
  "eyesRig",
  "cage",
  "shape",
  "anatomy",
  "position",
  "rotation",
  "size",
  "parent",
  "color",
  "surface",
  "knots",
  "paint",
  "mount",
  "sculpt",
  "drape",
  "cut",
  "blendSkin",
  "grip",
  "groom",
  "fibres",
  "hideSourceHair",
  "markings",
  "headLayer",
  "rigidFaceAnchor",
  "faceClearance",
  "visibleIn",
  "outfitRole",
  "pulls",
  "motionRole",
  "look",
  "frameSize",
  "bare",
]);
const allowedFormKeys = new Set([
  "poses",
  "outfit",
  "appearance",
  "build",
  "skinTint",
  "skinSoftness",
]);
function updateRecord(record, values, permitted) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("A change needs named fields.");
  const result = { ...record };
  for (const [key, value] of Object.entries(values)) {
    if (!permitted.has(key))
      throw new Error("Unsupported edit field: " + key + ".");
    if (value === null) delete result[key];
    else result[key] = value;
  }
  return result;
}
export function applyOperations(
  preview,
  ops,
  library = {},
  metric = false,
  marks = [],
) {
  if (!Array.isArray(ops) || ops.length > 256)
    throw new Error("Use an array of up to 256 edit operations.");
  let form = { ...preview, parts: [...preview.parts] };
  for (const action of ops) {
    const { op, id, set, part } = action ?? {};
    const index = form.parts.findIndex((p) => p.id === id);
    switch (op) {
      case "editCage": {
        const p = form.parts[index];
        if (p?.shape !== "cage")
          throw new Error("Choose a control cage for this edit.");
        form.parts[index] = { ...p, cage: editCage(p.cage, action) };
        break;
      }
      case "reshapeSpine":
        form = reshapeSpine(form, id, action.knots);
        break;
      case "placeAtMark": {
        if (!validWorldMarks(marks))
          throw new Error("Invalid surface marks in this request.");
        const mark = marks.find((m) => m.name === action.mark);
        if (!mark)
          throw new Error("Unknown marked socket: " + action.mark + ".");
        const depth = action.depth ?? 0.008;
        if (!Number.isFinite(depth) || depth < 0 || depth > 0.1)
          throw new Error("Seat the branch 0 to 0.1 metres inside the mark.");
        const toWorld = mark.world.map((v, i) => v - depth * mark.normal[i]);
        form = placeBranch(form, id, {
          parent: mark.region,
          fromWorld: action.fromWorld,
          toWorld,
          copy: action.copy,
          scale: action.scale,
          turn: action.turn,
        }).form;
        break;
      }
      case "recutArmSleeves":
        form = recutArmSleeves(form, id, action.color);
        break;
      case "bendElbow":
        form = bendElbow(form, id, action.degrees);
        break;
      case "equipPlates":
        form = equipPlateRows(form, id, action).form;
        break;
      case "reuseTurnaround": {
        const source = form.parts[index];
        form = repaintRegions(
          form,
          action.regions,
          (source?.paint ?? source?.hull)?.atlas,
        );
        break;
      }
      case "placeBranch":
        form = placeBranch(form, id, action).form;
        break;
      case "placeComponent": {
        if (!Object.hasOwn(library, action.asset))
          throw new Error("Unknown component: " + action.asset + ".");
        form = placeComponent(form, library[action.asset], {
          target: id,
          mode: action.mode ?? "replace",
          fit: action.fit ?? true,
          socket: action.socket ?? "above",
        }).form;
        break;
      }
      case "buildFigure": {
        // Replace the anatomy with a measured, jointed two-arm figure. Later
        // operations in the same proposal can dress or reshape its parts.
        const built = buildFigure(action.figure);
        form = {
          ...form,
          parts: built.parts,
          origin: built.origin,
          appearance: { ...form.appearance, ...built.appearance },
          outfit: built.outfit,
        };
        delete form.build;
        break;
      }
      case "setPart":
        if (index < 0) throw new Error("Unknown part: " + id + ".");
        {
          const old = form.parts[index],
            next = updateRecord(old, set, allowedPartKeys);
          form.parts[index] = withMetricFrame(
            next,
            metric && old.shape !== next.shape,
          );
        }
        break;
      case "addPart":
        if (!part || form.parts.some((p) => p.id === part.id))
          throw new Error("A new part needs a unique ID.");
        form.parts.push(
          withMetricFrame(
            {
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              size: [1, 1, 1],
              ...(part.shape === "cage" ? { cage: cubeCage() } : {}),
              ...part,
            },
            metric,
          ),
        );
        break;
      case "removePart":
        if (index < 0) throw new Error("Unknown part: " + id + ".");
        // Defer graph validation until the whole transaction is applied so
        // limbs may be reattached after the original trunk is removed.
        form.parts.splice(index, 1);
        break;
      case "setForm":
        {
          const previous = form;
          form = updateRecord(previous, set, allowedFormKeys);
          if (set.appearance)
            form.appearance = { ...previous.appearance, ...set.appearance };
        }
        break;
      default:
        throw new Error("Unknown edit operation.");
    }
  }
  return retainPaintSources(form, paintSources(preview));
}
export function compactForm(form) {
  const { artwork, occluders, ...compact } = form;
  return {
    ...compact,
    parts: form.parts.map((p) => {
      const { paint, mount, hairCap, ...out } = p;
      if (hairCap) out.hasRemovableSourceHair = true;
      if (paint) out.paintSource = paint.atlas;
      if (mount) out.fittedTo = p.parent;
      if (paint && p.knots.length > 8) {
        out.knotCount = p.knots.length;
        out.knots = [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) =>
          p.knots[Math.round(t * (p.knots.length - 1))].map((x) =>
            Number(x.toFixed(4)),
          ),
        );
      }
      return out;
    }),
  };
}
export function designDirection(variation) {
  if (!variation?.decks?.length) return variation;
  const { decks, ...draw } = variation;
  return {
    ...draw,
    drawnChoices: decks.map(({ label, value }) => ({ category: label, value })),
  };
}
export function agentDesign(brief) {
  const {
    views,
    references = [],
    current,
    preview,
    library = {},
    ...fields
  } = brief;
  return {
    ...fields,
    variation: designDirection(brief.variation),
    ...(references.length
      ? {
          visualReferences: references.map(({ role, label }, i) => ({
            role,
            label,
            attachment: i + 3,
          })),
        }
      : {}),
    library: Object.values(library).map(({ key, title, parts, bounds }) => ({
      key,
      title,
      partCount: parts.length,
      bounds,
    })),
    preview: compactForm(preview),
    currentSummary: { outfit: current.outfit, parts: current.parts.length },
    geometryNote:
      "Long painted sweeps show six sampled knots. Omit unchanged parts from operations to retain all detail. paintSource and fittedTo describe retained assets. Return operations against this exact request and revision.",
  };
}
function geometryFingerprint(part) {
  const { position, rotation, parent, ...shape } = part;
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, canonical(v[k])]),
      );
    return v;
  }
  return JSON.stringify(canonical(shape));
}
export function checkPreserved(preview, proposed, ids = []) {
  for (const id of ids) {
    const old = preview.parts.find((p) => p.id === id),
      next = proposed.parts.find((p) => p.id === id);
    if (!old || !next || geometryFingerprint(old) !== geometryFingerprint(next))
      throw new Error("The proposal changed protected geometry: " + id + ".");
  }
}
