import { paintSources, retainPaintSources } from "./paint-sources.js";
import { placeComponent } from "./graft.js";
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

const measuredShapes = new Set([
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
  "grip",
  "visibleIn",
  "outfitRole",
  "pulls",
  "motionRole",
  "look",
  "frameSize",
]);
const allowedFormKeys = new Set(["outfit", "appearance", "build"]);
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
export function applyOperations(preview, ops, library = {}, metric = false) {
  if (!Array.isArray(ops) || ops.length > 256)
    throw new Error("Use an array of up to 256 edit operations.");
  let form = { ...preview, parts: [...preview.parts] };
  for (const action of ops) {
    const { op, id, set, part } = action ?? {};
    const index = form.parts.findIndex((p) => p.id === id);
    switch (op) {
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
        form.parts.push(withMetricFrame(part, metric));
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
      const { paint, mount, ...out } = p;
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
export function agentDesign(brief) {
  const { views, current, preview, library = {}, ...fields } = brief;
  return {
    ...fields,
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
