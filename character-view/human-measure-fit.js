import { headDepthSamples, matchHeadDepth } from "./head-depth-fit.js";
import { fitLipContact, lipCreaseSamples } from "./lip-fit.js";
import { Box3, BufferAttribute, Vector3 } from "three";
import { humanRange, evaluateHuman, humanControls } from "./human-surface.js";
import { changeHuman } from "./human-form.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import { eyeOpenings } from "./human-fit-eyes.js";

const axes = {
  head: [
    "headWidth",
    "craniumDepth", "faceHeight", "noseTipAngle", "noseTipWidth", "nostrilWidth",
    "earLevel", "earSetback", "earLength", "earFlare",
    "jaw",
    "chin",
    "cheeks",
    "nose",
    "noseBridge",
    "ears",
    "neckLength",
    "neck",
    "brow",
    "eyeSize",
    "lips",
    "jawProjection",
    "chinHeight",
    "forehead",
    "temples",
    "noseLength",
    "noseHump",
    "lipFullness",
    "lipBalance",
    "upperLipHeight",
    "cupidsBow",
    "mouthCorners",
    "mouthProjection",
    "lipParting",
    "mouthLevel",
    "underEye",
    "eyeSpacing",
    "cheekFullness",
    "malarHeight",
    "jowlFullness",
    "submentalFullness",
    "eyeFold",
  ],
  trunk: [
    "bust",
    "shoulders",
    "waist",
    "chest",
    "belly",
    "abdominalApron",
    "hips",
    "seat",
    "torsoLength",
    "neckLength",
    "shoulderLine",
    "upperBack",
  ],
  arms: [
    "stance",
    "armForward",
    "elbowBend",
    "handTwist",
    "wristFlex",
    "hands",
    "upperArmLength",
    "forearmLength",
    "arms",
  ],
  legs: ["legSpread", "legs", "shinLength", "calves", "feet"],
};
function solve(a, b) {
  const rows = a.map((row, i) => [...row, b[i]]),
    n = b.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let j = k + 1; j < n; j++)
      if (Math.abs(rows[j][k]) > Math.abs(rows[pivot][k])) pivot = j;
    [rows[pivot], rows[k]] = [rows[k], rows[pivot]];
    if (Math.abs(rows[k][k]) < 1e-12) continue;
    const value = rows[k][k];
    for (let j = k; j <= n; j++) rows[k][j] /= value;
    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const scale = rows[i][k];
      for (let j = k; j <= n; j++) rows[i][j] -= rows[k][j] * scale;
    }
  }
  return rows.map((row) => row[n]);
}
function subset(v, indices) {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = v[indices[i] * 3 + k];
  return out;
}
// Nearest triangles give weak evidence along a limb's length. A separated hand
// also gives a support plane at its outline. Restrict these observations to
// spread arms so a sleeve, hip or torso cannot masquerade as a fingertip.
function armExtremes(positions, count, height) {
  const directions = [];
  for (const side of [-1, 1])
    for (const [x, y, z] of [
      [0.94, -0.34, 0],
      [0.8, -0.6, 0],
      [0.82, -0.32, 0.47],
      [0.82, -0.32, -0.47],
    ]) {
      const normal = new Vector3(side * x, y, z).normalize();
      let outer = -Infinity,
        index = -1;
      for (let i = 0; i < count; i++) {
        const j = i * 3,
          px = positions[j],
          py = positions[j + 1],
          pz = positions[j + 2];
        if (
          side * px < 0.145 * height ||
          py < 0.28 * height ||
          py > 0.84 * height
        )
          continue;
        const support = px * normal.x + py * normal.y + pz * normal.z;
        if (support > outer) {
          outer = support;
          index = i;
        }
      }
      directions.push({
        normal,
        outer,
        index,
        spread: index >= 0 && Math.abs(positions[index * 3]) > 0.205 * height,
      });
    }
  return directions;
}
// A standing foot offers a toe-to-heel length independent of its translation.
// Use only plausible, separable footprints in the floor band. A partial scan,
// trailing garment, or foot viewed edge-on can otherwise dominate this term.
function footExtents(positions, count, height) {
  const feet = [null, null];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    if (
      y < -0.01 * height ||
      y > 0.055 * height ||
      Math.abs(x) < 0.012 * height
    )
      continue;
    const side = Number(x > 0);
    const foot = (feet[side] ??= { back: z, front: z, minX: x, maxX: x });
    foot.back = Math.min(foot.back, z);
    foot.front = Math.max(foot.front, z);
    foot.minX = Math.min(foot.minX, x);
    foot.maxX = Math.max(foot.maxX, x);
  }
  return feet.map((f) => {
    if (!f) return null;
    const length = f.front - f.back,
      width = f.maxX - f.minX;
    return length > 0.085 * height &&
      length < 0.205 * height &&
      width > 0.025 * height &&
      width < 0.1 * height
      ? { ...f, length }
      : null;
  });
}
// A partial scan may keep the complete vertex buffer and index only the observed
// triangles. An orphaned toe or scalp vertex is not a measurement of the scan.
function referencedPositions(geometry) {
  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!index && !positions.isInterleavedBufferAttribute) return positions;
  const indices = index ? Array.from(new Set(index.array)) : Array.from({ length: positions.count }, (_, i) => i);
  if (indices.length === positions.count && !positions.isInterleavedBufferAttribute) return positions;
  const values = new Float32Array(indices.length * 3);
  const p = new Vector3();
  indices.forEach((id, i) => p.fromBufferAttribute(positions, id).toArray(values, i * 3));
  return new BufferAttribute(values, 3);
}

function fitFootLength(target, params, surface, evaluate) {
  const targetFeet = footExtents(target.array, target.count, surface.height);
  const lengths = (s) => footExtents(s.positions, s.bodyVertices, s.height);
  const error = (feet) => {
    if (!feet.every(Boolean) || !targetFeet.every(Boolean)) return null;
    const gaps = feet.map((foot, i) => targetFeet[i].length - foot.length);
    // A single size parameter controls both feet. Reject inconsistent pairs.
    if (
      Math.abs(gaps[0] - gaps[1]) > 0.015 * surface.height ||
      gaps.some((g) => Math.abs(g) > 0.06 * surface.height)
    )
      return null;
    return (gaps[0] + gaps[1]) / 2;
  };
  for (let i = 0; i < 3; i++) {
    const gap = error(lengths(surface));
    if (gap === null || Math.abs(gap) < 0.002) break;
    const size = params.feet ?? 0,
      step = size > 0.93 ? -0.07 : 0.07;
    const probe = error(lengths(evaluate({ ...params, feet: size + step })));
    if (probe === null) break;
    const slope = (gap - probe) / step;
    if (slope < 0.005) break;
    const nextSize = Math.max(-1, Math.min(1, size + gap / slope));
    const next = evaluate({ ...params, feet: nextSize }),
      nextGap = error(lengths(next));
    if (nextGap === null || Math.abs(nextGap) >= Math.abs(gap)) break;
    params.feet = nextSize;
    surface = next;
  }
  return surface;
}
// Robust normal correspondences and bounded least squares over ordinary editor dimensions.
// The target stays fixed in one physical coordinate system for every trial step.
export function fitMeasurements(
  form,
  targetGeometry,
  region,
  { targetTree, vertexNormals, partRegion, summary, isolatedHead, hold = null, keepEyeOpenings = false },
) {
  let keys =
    region === "whole"
      ? [
          ...new Set([
            "frame",
            "weight",
            "muscle",
            "age",
            "faceA",
            "faceB",
            ...axes.trunk,
            ...axes.arms,
            ...axes.legs,
            ...axes.head,
          ]),
        ]
      : isolatedHead && region === "head" ? axes.head.filter(k => k !== "neck" && k !== "neckLength") : axes[region];
  if (!keys || !form.human) throw new Error("Choose a supported human region.");
  const tree = targetTree(targetGeometry, isolatedHead);
  const original = evaluateHuman(form.human, form.humanFit, form.humanDetail);
  const controls = humanControls(),
    params = { ...form.human };
  const target = referencedPositions(targetGeometry);
  if (region === "whole") {
    const bbox = new Box3().setFromBufferAttribute(target);
    const targetHeight = bbox.max.y - bbox.min.y;
    if (targetHeight >= 1.43 && targetHeight <= 2.08)
      params.height = targetHeight;
  }
  const exterior = exteriorSkin(original);
  const eligible = (v) => exterior[v] && (
    region === "whole" ||
    (partRegion(original.names[original.boneIndices[v * 4]]) === region &&
      (!isolatedHead || original.names[original.boneIndices[v * 4]] === "head")));
  const anchors = Array.from(controls.ids).filter(eligible);
  const check = [];
  const ctl = new Set(controls.ids);
  const p = new Vector3(),
    n = new Vector3();
  // Skin the artist excluded gives no correspondence, no depth or lip constraint
  // and no sample in the summaries. The sliders are shared, so a measurement fitted
  // on the remaining skin still moves the excluded skin with it.
  // Kept eye openings are excluded by name, and the sliders that mostly reshape them
  // are left where the artist set them: with the openings out of the measurement
  // they would only be bent to explain the brow and cheek beside them.
  const eyes = keepEyeOpenings ? eyeOpenings(original) : null;
  if (eyes) {
    const start = evaluateHuman(params, form.humanFit, form.humanDetail).positions;
    keys = keys.filter((key) => {
      const [lo, hi, def] = humanRange(key),
        v = params[key] ?? def,
        moved = evaluateHuman({ ...params, [key]: v + (v + 0.065 > hi ? -0.065 : 0.065) }, form.humanFit, form.humanDetail).positions;
      let within = 0,
        all = 0;
      for (let i = 0; i < original.bodyVertices; i++) {
        let d = 0;
        for (let k = i * 3; k < i * 3 + 3; k++) d += (moved[k] - start[k]) ** 2;
        all += d;
        if (eyes.skin[i]) within += d;
      }
      return within <= 0.5 * all;
    });
  }
  const held = (surface, v) =>
    Boolean(eyes?.skin[v] || hold?.(p.fromArray(surface.positions, v * 3)));
  for (let v = 5; v < original.bodyVertices; v += 9)
    if (!ctl.has(v) && eligible(v) && !held(original, v)) check.push(v);
  let surface = evaluateHuman(params, form.humanFit, form.humanDetail);
  const evaluate = (p) => evaluateHuman(p, form.humanFit, form.humanDetail);
  const useArms = !tree.observedDirection && (region === "whole" || region === "arms");
  const ref = useArms
    ? armExtremes(target.array, target.count, surface.height)
    : [];
  const useFeet = !tree.observedDirection && (region === "whole" || region === "legs");
  const heads = region === "whole" || region === "head" ? headDepthSamples(surface,tree.observedDirection) : [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const edges = useArms
      ? armExtremes(
          surface.positions,
          surface.bodyVertices,
          surface.height,
        ).flatMap((edge, i) =>
          edge.spread &&
          ref[i].spread &&
          Math.abs(ref[i].outer - edge.outer) < 0.23
            ? [{ ...edge, error: ref[i].outer - edge.outer }]
            : [],
        )
      : [];
    const surfaceNormals = vertexNormals(surface);
    const depth = matchHeadDepth(heads,surface,surfaceNormals,tree);
    const lips = heads.length ? lipCreaseSamples(surface,tree) : [];
    const constraints = [...edges,...depth,...lips].filter((e) => !held(surface, e.index));
    const pins = [...anchors, ...constraints.map(e => e.index)];
    const flat = subset(surface.positions, pins),
      normals = subset(surfaceNormals, pins);
    const residual = new Float32Array(pins.length),
      confidence = new Float32Array(pins.length);
    for (let i = 0; i < constraints.length; i++) {
      const row = anchors.length + i;
      constraints[i].normal.toArray(normals, row * 3);
      residual[row] = constraints[i].error;
      confidence[row] = constraints[i].weight ?? 12;
    }
    let count = 0;
    for (let i = 0; i < anchors.length; i++) {
      p.fromArray(flat, i * 3);
      n.fromArray(normals, i * 3);
      if (tree.observedDirection && n.dot(tree.observedDirection) < 0.15) continue;
      if (eyes?.skin[anchors[i]] || hold?.(p)) continue;
      const near = tree.query(p, n, 0.24);
      if (!near) continue;
      residual[i] = n.dot(near.clone().sub(p));
      confidence[i] = Math.min(
        1,
        0.032 / Math.max(0.0001, Math.abs(residual[i])),
      );
      count++;
    }
    if (count < 12)
      throw new Error(
        "Too few surface correspondences. Align the reference first.",
      );
    const cols = keys.map((key) => {
      const [lo, hi, def] = humanRange(key),
        v = params[key] ?? def,
        step = v + 0.065 > hi ? -0.065 : 0.065;
      const other = evaluate({ ...params, [key]: v + step }).positions,
        column = new Float32Array(pins.length);
      for (let i = 0; i < pins.length; i++)
        for (let k = 0; k < 3; k++)
          column[i] +=
            ((other[pins[i] * 3 + k] - flat[i * 3 + k]) * normals[i * 3 + k]) /
            step;
      return column;
    });
    const a = keys.map(() => new Float64Array(keys.length)),
      b = new Float64Array(keys.length);
    for (let j = 0; j < keys.length; j++) {
      for (let i = 0; i < pins.length; i++) {
        const w = confidence[i] * cols[j][i];
        b[j] += w * residual[i];
        for (let k = 0; k <= j; k++) a[j][k] += w * cols[k][i];
      }
      for (let k = 0; k < j; k++) a[k][j] = a[j][k];
      // A lip or an eyelid moves few control points. Shrinking that step by
      // the number of samples on the entire body made those features nearly
      // immovable even when there was good local evidence.
      if (axes.head.includes(keys[j]) && !["neck","neckLength"].includes(keys[j])) {
        let peak = 0;
        for (const response of cols[j]) peak = Math.max(peak, Math.abs(response));
        const support = peak > 1e-8 ? a[j][j] / (peak * peak) : 0;
        // Constrain the accumulated edit as well as the next numerical step.
        // Without this prior a wide nose, narrow tip, long ear and small ear
        // can all saturate together to explain the same few millimetres.
        const prior = Math.max(1, support) * 0.000020;
        const initial = form.human[keys[j]] ?? humanRange(keys[j])[2];
        a[j][j] += prior + Math.max(1, support) * 0.000003;
        b[j] -= prior * ((params[keys[j]] ?? initial) - initial);
      } else {
        a[j][j] += count * 0.000012;
      }
    }
    const step = solve(a, b);
    const loss = (v) => v.reduce((acc, x, i) => acc + confidence[i] * x * x, 0);
    const before = loss(residual);
    let accepted = false;
    for (const alpha of [1, 0.45, 0.2]) {
      const trial = { ...params };
      keys.forEach((key, j) => {
        const [lo, hi, def] = humanRange(key),
          delta = Math.max(-0.48, Math.min(0.48, step[j]));
        trial[key] = Math.min(
          hi,
          Math.max(lo, (params[key] ?? def) + alpha * delta),
        );
      });
      const next = evaluate(trial),
        test = new Float32Array(residual);
      for (let i = 0; i < pins.length; i++)
        for (let k = 0; k < 3; k++)
          test[i] -=
            (next.positions[pins[i] * 3 + k] - flat[i * 3 + k]) *
            normals[i * 3 + k];
      if (loss(test) < before * 0.999) {
        Object.assign(params, trial);
        surface = next;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  // The lip contact is read from the mouth alone, so a hidden mouth leaves it as it is.
  if (heads.length && !lipCreaseSamples(surface, tree).some((e) => held(surface, e.index)))
    surface = fitLipContact(params, surface, tree, evaluate);
  if (useFeet) surface = fitFootLength(target, params, surface, evaluate);
  return {
    form: changeHuman(form, params),
    metrics: {
      before: summary(original, tree, check),
      after: summary(surface, tree, check),
    },
  };
}
