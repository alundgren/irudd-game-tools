import data from "./human-data.json" with { type: "json" };
import faceSculpt from "./human-face-sculpt-data.json" with { type: "json" };
import portraits from "./human-portrait-bases.json" with { type: "json" };
import { capturedAxes, applyCapturedShape } from "./human-captured-portraits.js";
import identity from "./human-identity-data.json" with { type: "json" };
import castShapes from "./human-cast-shapes-data.json" with { type: "json" };
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import { randomStream } from "./random.js";
import { poseFingers } from "./human-hands.js";
import { shapeNeck } from "./human-neck.js";
import { drawIdentity } from "./human-identity.js";

const { meta, packet } = data;
export const portraitAxes = Object.keys(portraits.credits);
// Face foundations measured on artist-modelled heads of the Microsoft Rocketbox library (MIT).
// Each is a displacement field of the face alone; a saved adult without them keeps its shape.
export const castShapeAxes = Object.keys(castShapes.credits);
const castShapeShare = .45, castShapeFrame = .2;
export const castShapeTitles = Object.fromEntries(castShapeAxes.map(key => [key, castShapes.credits[key].title]));
/** True when this adult's face wears a cast foundation: its export owes the Rocketbox MIT notice. */
export function wearsCastShape(human) {
  return !!human && castShapeAxes.some(key => human[key] > 0);
}
export const humanBoneNames = meta.names;
const arrays = new Map();
function unpack(key, Type) {
  if (!arrays.has(key)) {
    const raw = Uint8Array.from(atob(packet[key] ?? identity.packet[key] ?? portraits.packet[key] ?? castShapes.packet[key]), (c) => c.charCodeAt(0));
    const bytes = unzlibSync(raw);
    arrays.set(
      key,
      new Type(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Type.BYTES_PER_ELEMENT,
      ),
    );
  }
  return arrays.get(key);
}
export const humanAxes = [
  "height",
  "frame",
  "age",
  "weight",
  "muscle",
  "stance",
  "armForward",
  "elbowBend",
  "legSpread",
  "handTwist",
  "wristFlex",
  "fingerCurl",
  "armLead",
  "footLead",
  "leftArmLift",
  "rightArmLift",
  "smileOpenness",
  "smileBias",
  "faceA",
  "faceB",
  ...meta.axes,
  // Shaped by human-neck.js on any build, beside what body mass does there.
  "shoulderLine",
  "upperBack",
  "abdominalApron",
  // Face outline, soft tissue and one-sided controls packed by pack-human-identity.py.
  // A saved adult without them keeps its shape.
  ...identity.meta.axes,
  ...Object.keys(faceSculpt.controls),
  ...portraitAxes,
  "orbitalRim", "zygomaticArch",
  ...castShapeAxes,
  ...capturedAxes,
];
export const humanIdentityAxes = identity.meta.axes;
// What a reference fit or a proportion solver may move. The identity controls stay out, so
// a fit made before they existed solves the same way and saved heads keep their contracts.
export const humanFitAxes = humanAxes.filter((key) => !identity.meta.axes.includes(key) && !Object.hasOwn(faceSculpt.controls, key) && !portraitAxes.includes(key) && !castShapeAxes.includes(key) && !capturedAxes.includes(key) && !["orbitalRim","zygomaticArch","footLead","armLead","leftArmLift","rightArmLift","smileOpenness","smileBias"].includes(key));
export function humanRange(key) {
  if (key === "height") return [1.43, 2.08, 1.72];
  if (Object.hasOwn(faceSculpt.controls, key) || portraitAxes.includes(key) || castShapeAxes.includes(key) || capturedAxes.includes(key)) return [0, 1, 0];
  if (["age", "abdominalApron", "leftArmLift", "rightArmLift", "orbitalRim", "zygomaticArch"].includes(key)) return [0, 1, 0];
  return [-1, 1, 0];
}
export function validHuman(p) {
  return (
    p &&
    typeof p === "object" &&
    !Array.isArray(p) &&
    Object.entries(p).every(([key, value]) => {
      const [lo, hi] = humanRange(key);
      return (
        humanAxes.includes(key) &&
        Number.isFinite(value) &&
        value >= lo &&
        value <= hi
      );
    })
  );
}
export function randomHuman(seed, archetype = "any", { relaxed = true, fitRestingLips = true } = {}) {
  // Give each measurement its own seeded draw so adding an axis preserves the others.
  function draw(key) {
    let hash = seed >>> 0;
    for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return randomStream(hash)();
  }
  const between = (key, lo, hi) => +(lo + (hi - lo) * draw(key)).toFixed(3);
  const spec = Object.fromEntries(
    humanAxes.map((key) => [key, between(key, -0.79, 0.79)]),
  );
  spec.height = between("height", 1.52, 1.99);
  spec.age = +(draw("age") ** 1.4 * 0.92).toFixed(2);
  spec.frame =
    { male: 0.9, female: -0.9, neutral: 0 }[archetype] ??
    between("frame", -1, 1);
  spec.earTip *= 0.28;
  // The line from neck to shoulder and the upper back follow body mass; the artist sets the rest.
  spec.shoulderLine = spec.upperBack = spec.armLead = spec.footLead = spec.leftArmLift = spec.rightArmLift = 0;
  for (const key of ["earLevel","earSetback","earLength","craniumDepth","faceHeight","noseTipAngle","noseTipWidth","nostrilWidth"])
    spec[key] *= 0.45;
  // On a resting face, sample mouth depth together with the jaw that supports
  // it. Independent extremes can push the whole mouth forward over a receding
  // chin. The lip fullness draw and all artist-adjustable ranges remain independent.
  spec.mouthCorners *= 0.55;
  spec.mouthProjection *= 0.65;
  spec.lipParting *= 0.18;
  spec.mouthLevel *= 0.35;
  if (relaxed) {
    spec.mouthProjection = 0.42 * spec.mouthProjection + Math.min(0, 0.32 * spec.chin) - 0.2;
    spec.chin = 0.8 * spec.chin + Math.max(0, 0.26 * spec.jawProjection);
    spec.lipBalance *= .55;
  }
  // A coherent build carries into connected regions; retain independent variation
  // so prominent shoulders, a full abdomen and long limbs can occur on any frame.
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const spread = (x) => Math.sign(x) * Math.pow(Math.abs(x), 0.59);
  spec.weight = spread(between("mass", -1, 1));
  spec.muscle = spread(between("definition", -1, 1));
  const taper = between("torso taper", -1, 1);
  spec.shoulders = clamp(
    0.63 * spec.shoulders + 0.43 * taper + 0.25 * spec.muscle,
  );
  spec.hips = clamp(0.64 * spec.hips - 0.46 * taper + 0.19 * spec.weight);
  spec.waist = clamp(0.64 * spec.waist + 0.55 * spec.weight);
  spec.belly = clamp(
    0.58 * spec.belly + 0.67 * spec.weight - 0.15 * spec.muscle,
  );
  // Lower abdominal tissue can hang on any frame. Most draws leave it at rest.
  const lowerMass = .75 * spec.weight + .45 * spec.belly - .22 * spec.muscle;
  spec.abdominalApron = Math.max(0, Math.min(1, (lowerMass-.36) * (.45 + .7*draw("lower abdomen"))));
  if (relaxed) {
    const fullness = 0.72 * spec.weight + 0.12 * spec.belly - 0.20 * spec.muscle;
    spec.cheekFullness = clamp(0.74 * spec.cheekFullness + 0.32 * fullness);
    spec.malarHeight = clamp(
      0.72 * spec.malarHeight + 0.12 * spec.muscle - 0.19 * spec.age,
    );
    spec.jowlFullness = clamp(
      0.52 * spec.jowlFullness + 0.69 * fullness + 0.26 * spec.age,
    );
    spec.submentalFullness = clamp(
      0.42 * spec.submentalFullness + 0.87 * fullness + 0.17 * spec.age,
    );
  }
  // The face as one person: ancestry, outline, feature types, soft tissue and resting expression.
  drawIdentity(spec, draw, { relaxed });
  // Start with one artist's related feature decisions. Other measurements
  // remain editable, including the subject's own age, mass and ancestry.
  for (const key of portraitAxes) spec[key] = 0;
  for (const key of castShapeAxes) spec[key] = 0;
  for (const key of capturedAxes) spec[key] = 0;
  const foundation = portraitAxes[Math.floor(draw("portrait foundation") * portraitAxes.length)];
  spec[foundation] = between("portrait strength", .62, .98);
  // Nearly half of the men start from a face an artist modelled as one person instead. Its
  // draws are its own, so every other adult keeps the face it had. The library's women did not
  // carry over as distinct faces, so a female or middling frame keeps the earlier foundations.
  if (spec.frame > castShapeFrame && draw("cast foundation") < castShapeShare) {
    spec[foundation] = 0;
    spec[castShapeAxes[Math.floor(draw("cast pick") * castShapeAxes.length)]] = between("cast strength", .7, 1);
  }
  spec.orbitalRim = Math.min(1, Math.max(0, between("orbital relief", .12, .80) + .18*spec.browRidge));
  spec.zygomaticArch = Math.min(1, Math.max(0, between("zygomatic arch", .16, .83) + .22*spec.cheekHollow));
  spec.lidDefinition = between("lid relief", .28, .83);
  spec.earDefinition = between("ear relief", .28, .89);
  spec.alarCrease = between("alar relief", .26, .87);
  for (const name of ["orbitCreases", "foreheadCreases", "mouthCreases"])
    spec[name] = +(spec.age**1.22 * between(name, .38, 1)).toFixed(3);
  spec.arms = clamp(0.59 * spec.arms + 0.41 * spec.muscle + 0.19 * spec.weight);
  spec.calves = clamp(
    0.65 * spec.calves + 0.29 * spec.muscle + 0.16 * spec.weight,
  );
  spec.stance = relaxed ? 0.98 : between("stance", 0.36, 1);
  for (const key of ["armForward", "elbowBend", "legSpread", "handTwist"])
    spec[key] = relaxed
      ? { armForward: -0.12, elbowBend: -0.49, legSpread: 0, handTwist: 0.05 }[
          key
        ]
      : between(key, -0.5, 0.4);
  spec.wristFlex = relaxed ? 0.44 : between("wristFlex", -0.28, 0.52);
  // Smile has its own range of motion, independent of the resting mouth.
  spec.smileOpenness = relaxed ? between("smile opening", -.88, .78) : 0;
  spec.smileBias = relaxed ? between("smile bias", -.78, .78) : 0;
  spec.fingerCurl = relaxed ? 0.3 : between("fingerCurl", 0.02, 0.7);
  for (const key of [
    "upperArmLength",
    "forearmLength",
    "shinLength",
    "torsoLength",
    "neckLength",
  ])
    spec[key] *= 0.5;
  if (relaxed && fitRestingLips) {
    const surface = evaluateHuman(spec);
    balanceCheekDraw(spec, surface);
    const profile = restLipProfile(surface);
    // Balance the neighbouring structures when several independent draws
    // push the lips out together. Keep the artist's full individual ranges.
    const forward = Math.max(0, Math.max(profile.upper, profile.lower) - 1.4);
    spec.mouthProjection = clamp(spec.mouthProjection - .10 * forward);
    spec.chin = clamp(spec.chin + .072 * forward);
    spec.lipBalance = clamp(spec.lipBalance + .18 * Math.max(0, profile.lower - profile.upper - 2.2));
  }
  return spec;
}

// Three points on each lateral cheek, spaced 10 mm apart on the neutral head.
// Read the change of slope below the cheekbone in an oblique view. A prominent
// cheek on a hollow jaw can form a sharp shelf when several source shapes add.
const cheekSections = [
  [[11929,5325,.145],[11791,5179,.324],[11930,5326,.531]],
  [[11766,5152,.032],[11789,5177,.241],[11788,5176,.727]],
  [[11789,5177,.167],[11768,5154,.669],[11817,5206,.164]],
];

export function malarBend(surface) {
  const p = surface.positions;
  return Math.max(...[0,1].map(side => {
    const sign = side ? -1 : 1;
    const points = cheekSections.map(section => {
      let outward=0, y=0;
      for (const marker of section) {
        const i=3*marker[side], w=marker[2];
        outward+=w*(sign*.66913*p[i]+.74314*p[i+2]);
        y+=w*p[i+1];
      }
      return [outward,y];
    });
    const slope = (a,b) => Math.atan2(b[0]-a[0],a[1]-b[1]);
    return (slope(points[0],points[1])-slope(points[1],points[2]))*180/Math.PI;
  }));
}

function balanceCheekDraw(spec, surface) {
  const excess = Math.max(0,Math.min(1,(malarBend(surface)-15)/13));
  if (!excess) return;
  // Reduce only the contributions that pull the lower cheek in or push the
  // crest out. The underlying skull, eye shape, mouth and jaw stay distinctive.
  for (const [key, direction, share] of [
    ["cheeks",1,.83], ["cheekHollow",1,.5], ["faceFlesh",-1,.52], ["jowlFullness",-1,.52],
  ]) if (direction*spec[key]>0) spec[key]*=1-share*excess;
}

// Forward distances from the nose-tip/chin line, in mm at 1.72 m stature.
// Sample the centre of each prominence on the neutral topology; use the
// frontmost vertex in each small group as the shape changes.
export function restLipProfile(surface) {
  const p = surface.positions;
  function front(ids) {
    return ids.reduce((a,b) => p[a*3+2] > p[b*3+2] ? a : b);
  }
  const nose = 3 * front([294, 297, 5054]);
  const chin = 3 * front([5162, 5211, 5171, 5225]);
  function distance(ids) {
    const i = 3 * front(ids);
    const t = (p[i+1] - p[chin+1]) / (p[nose+1] - p[chin+1]);
    return (p[i+2] - p[chin+2] - t * (p[nose+2] - p[chin+2])) * 1720 / surface.height;
  }
  return {upper: distance([455, 466, 467]), lower: distance([495, 496, 513])};
}
function ramp(value) {
  return value < 0
    ? [
        ["min", -value],
        ["average", 1 + value],
      ]
    : [
        ["average", 1 - value],
        ["max", value],
      ];
}
export function smoothHumanSurface(source) {
  const offsets = unpack("subOffsets", Uint32Array),
    refs = unpack("subRefs", Uint16Array),
    coeff = unpack("subFactors", Float32Array);
  const positions = new Float32Array((offsets.length - 1) * 3);
  for (let i = 0; i < positions.length / 3; i++) {
    let x = 0,
      y = 0,
      z = 0;
    for (let j = offsets[i]; j < offsets[i + 1]; j++) {
      const base = refs[j] * 3,
        w = coeff[j];
      x += source.positions[base] * w;
      y += source.positions[base + 1] * w;
      z += source.positions[base + 2] * w;
    }
    positions.set([x, y, z], i * 3);
  }
  const indices = unpack("subIndices", Uint32Array);
  if (!arrays.has("subFloatWeights"))
    arrays.set(
      "subFloatWeights",
      Float32Array.from(unpack("subWeights", Uint16Array), (w) => w / 65535),
    );
  return {
    ...source,
    positions,
    indices,
    bodyTriangles: indices.length / 3,
    parentFaces: unpack("subParent", Uint16Array),
    quadIds: unpack("quadIds", Uint16Array),
    boneIndices: unpack("subBones", Uint8Array),
    weights: arrays.get("subFloatWeights"),
    uv: unpack("subUV", Uint16Array),
    uvFaces: unpack("subFaceUV", Uint32Array),
    pigments: unpack("subPigments", Uint8Array),
  };
}
/* Which cage vertices each vertex of the smoothed surface is blended from:
   vertex i uses refs[offsets[i] .. offsets[i + 1]] with the matching factors. */
export function humanSmoothSources() {
  return { offsets: unpack("subOffsets", Uint32Array), refs: unpack("subRefs", Uint16Array), factors: unpack("subFactors", Float32Array) };
}
function rotateBranches(
  positions,
  joints,
  indices,
  weights,
  root,
  axis,
  angleForSide,
) {
  for (const [suffix, side] of [
    ["_l", 1],
    ["_r", -1],
  ]) {
    const angle = angleForSide(side);
    if (!angle) continue;
    const shoulder = meta.names.indexOf(root + suffix);
    const origin = joints.slice(shoulder * 3, shoulder * 3 + 3);
    const active = meta.names.map((name) => {
      while (name && name !== "Root") {
        if (name === meta.names[shoulder]) return true;
        name = meta.parents[meta.names.indexOf(name)];
      }
      return false;
    });
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const i0 = (axis + 1) % 3,
      i1 = (axis + 2) % 3;
    function rotate(array, i, influence) {
      const x = array[i + i0] - origin[i0],
        y = array[i + i1] - origin[i1];
      array[i + i0] += ((cos - 1) * x - sin * y) * influence;
      array[i + i1] += (sin * x + (cos - 1) * y) * influence;
    }
    for (let i = 0; i < positions.length / 3; i++) {
      let w = 0;
      for (let k = i * 4; k < i * 4 + 4; k++)
        if (active[indices[k]]) w += weights[k];
      if (w) rotate(positions, i * 3, w);
    }
    active.forEach((enabled, i) => {
      if (enabled) rotate(joints, i * 3, 1);
    });
  }
}
// Advance one foot while the other supports the figure. The thigh and shin
// take the shift gradually. Every point below the ankle shares one translation,
// keeping each sole planted and its original pitch on the floor.
function staggerFeet(positions, joints, indices, weights, lead) {
  for (const [suffix, sign] of [["_l", 1], ["_r", -1]]) {
    const branch = meta.names.map(name => /^(thigh|calf|foot|ball|toe)/.test(name) && name.endsWith(suffix));
    const hip = joints[meta.names.indexOf("thigh"+suffix)*3+1];
    const ankle = joints[meta.names.indexOf("foot"+suffix)*3+1];
    const reach = (hip-ankle)*lead*sign*.135;
    const offset = y => reach*Math.max(0,Math.min(1,(hip-y)/(hip-ankle)));
    for (let v=0; v<positions.length/3; v++) {
      let influence=0;
      for (let j=v*4; j<v*4+4; j++) if (branch[indices[j]]) influence+=weights[j];
      positions[v*3+2] += influence*offset(positions[v*3+1]);
    }
    branch.forEach((on,i)=>{ if (on) joints[i*3+2]+=offset(joints[i*3+1]); });
  }
}

export function humanRestPositions() {
  return unpack("base", Float32Array);
}
function offsetRestSmile(values, identity, gain, smooth) {
  for (const side of ["smileLeft", "smileRight"]) {
    const amount = identity[side] ?? 0;
    if (!amount) continue;
    const shape = expressionDisplacements(side + (amount > 0 ? "1" : "0"), smooth);
    const weight = Math.abs(amount) * .82 * gain;
    for (let i=0; i<values.length; i++) values[i] += weight * shape[i];
  }
}

export function expressionDisplacements(name, smooth = false, identity = {}) {
  const key = (smooth ? "smooth/" : "expr/") + name;
  if (!arrays.has(key)) {
    const raw = Float32Array.from(unpack("m:" + name, Int16Array), v => v * 0.0001);
    if (smooth) {
      const offsets = unpack("subOffsets", Uint32Array),
        refs = unpack("subRefs", Uint16Array),
        weights = unpack("subFactors", Float32Array);
      const coords = new Float32Array((offsets.length - 1) * 3);
      for (let i = 0; i < coords.length / 3; i++)
        for (let j = offsets[i]; j < offsets[i + 1]; j++)
          for (let d = 0; d < 3; d++)
            coords[i * 3 + d] += raw[refs[j] * 3 + d] * weights[j];
      arrays.set(key, coords);
    } else arrays.set(key, raw);
  }
  const expression = arrays.get(key);
  if (name === "Smile" && (identity.smileLeft || identity.smileRight || identity.smileOpenness || identity.smileBias)) {
    const remaining = expression.slice();
    const openness = identity.smileOpenness ?? 0, bias = identity.smileBias ?? 0;
    if (openness || bias) {
      const left = expressionDisplacements("smileLeft1",smooth);
      const right = expressionDisplacements("smileRight1",smooth);
      const endpoint = expressionDisplacements(openness < 0 ? "ReservedSmile" : "BroadSmile", smooth);
      const mix = Math.abs(openness) ** .7;
      const side = .32 * bias * (.28 + .72 * Math.abs(bias));
      for (let i = 0; i < remaining.length; i++)
        remaining[i] += mix * (endpoint[i] - expression[i]) + side * (left[i] - right[i]);
    }
    offsetRestSmile(remaining, identity, -1, smooth);
    return remaining;
  }
  return expression;
}
export function humanControls() {
  return {
    ids: unpack("controlIds", Uint16Array),
    refs: unpack("controlRefs", Uint16Array),
    weights: unpack("controlWeights", Uint16Array),
  };
}
export function validHumanFit(fit) {
  if (
    !fit ||
    fit.version !== 1 ||
    !Number.isFinite(fit.strength) ||
    fit.strength < 0 ||
    fit.strength > 1 ||
    !Array.isArray(fit.controls)
  )
    return false;
  const n = humanControls().ids.length;
  const seen = new Set();
  return (
    fit.controls.length <= n &&
    fit.controls.every((row) => {
      if (
        !Array.isArray(row) ||
        row.length !== 4 ||
        !row.every(Number.isInteger) ||
        row[0] < 0 ||
        row[0] >= n ||
        seen.has(row[0])
      )
        return false;
      seen.add(row[0]);
      return Math.hypot(...row.slice(1)) <= 651;
    })
  );
}
export function controlVectors(fit) {
  const values = new Float32Array(humanControls().ids.length * 3);
  if (fit) {
    if (!validHumanFit(fit))
      throw new Error("Invalid human surface correction.");
    for (const [i, x, y, z] of fit.controls)
      values.set(
        [
          x * 0.0001 * fit.strength,
          y * 0.0001 * fit.strength,
          z * 0.0001 * fit.strength,
        ],
        i * 3,
      );
  }
  return values;
}
export function applyHumanControls(source, vectors) {
  const { refs, weights } = humanControls();
  const positions = source.positions.slice(),
    scale = (source.height ?? 1.72) / 1.72;
  for (let i = 0; i < source.ids.length; i++) {
    const w0 =
      weights[i * 4] +
      weights[i * 4 + 1] +
      weights[i * 4 + 2] +
      weights[i * 4 + 3];
    for (let dim = 0; dim < 3; dim++) {
      let sum = 0;
      for (let j = i * 4; j < i * 4 + 4; j++)
        sum += vectors[refs[j] * 3 + dim] * weights[j];
      const v = i * 3 + dim;
      positions[v] += (sum / w0) * scale;
    }
  }
  // A fit can raise the whole crown or lower a sole. Correct that common
  // displacement over the region, preserving the curvature at the endpoint.
  // Clipping individual vertices here cuts a flat plane across the skull.
  let top = -Infinity, floor = Infinity, originalTop = -Infinity, originalFloor = Infinity;
  for (let i = 1; i < source.bodyVertices * 3; i += 3) {
    top = Math.max(top, positions[i]);
    floor = Math.min(floor, positions[i]);
    originalTop = Math.max(originalTop, source.positions[i]);
    originalFloor = Math.min(originalFloor, source.positions[i]);
  }
  const excess = top-originalTop, soleShift = floor-originalFloor;
  if (Math.abs(excess) > 1e-6 || Math.abs(soleShift) > 1e-6) {
    const upper = top - .12*source.height, lower = floor + .09*source.height;
    for (let i = 1; i < source.ids.length * 3; i += 3) {
      const y = positions[i];
      if (y > upper) {
        const t = Math.min(1,(y-upper)/(top-upper));
        positions[i] -= excess*t*t*(3-2*t);
      } else if (y < lower) {
        const t = Math.min(1,(lower-y)/(lower-floor));
        positions[i] -= soleShift*t*t*(3-2*t);
      }
    }
  }
  return { ...source, positions };
}
/* The fine layer: a small movement stored for single vertices of the head.

   The control anchors stand about 22 mm apart on the head and blend by
   distance, which cannot follow a shape that varies between them. This layer
   holds what they leave over. It is {version: 1, region: "head", vertices,
   offsets}: `vertices` in rising order, `offsets` three whole numbers per
   vertex in units of 0.01 mm on a 1.72 m adult, each movement at most
   `humanDetailLimit` long.

   The rebase rule: a movement of the skin is written in that vertex's own skin
   frame, its normal and the direction to one fixed neighbour, on the surface
   the measurements and control anchors give. Every evaluation rebuilds it on
   the current surface. A layer therefore turns with the skin under it and
   keeps its size in millimetres per 1.72 m of stature when the measurements
   or the anchors change later. Vertices that are not skin, such as the
   eyeballs, are written along the figure's own axes so they stay rigid. */
export const humanDetailLimit = 1200;
let detailTopology;
function headDetailTopology() {
  if (detailTopology) return detailTopology;
  const bones = unpack("bones", Uint8Array), indices = unpack("indices", Uint16Array), rest = unpack("base", Float32Array);
  const count = unpack("ids", Uint16Array).length, allowed = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    const name = meta.names[bones[v * 4]];
    allowed[v] = name === "head" || name.startsWith("neck") ? 1 : 0;
  }
  // For each skin vertex: its triangles, and the neighbour farthest away at rest.
  const start = new Uint32Array(meta.bodyVertices + 1), partner = new Int32Array(meta.bodyVertices).fill(-1), far = new Float32Array(meta.bodyVertices);
  for (let i = 0; i < meta.bodyTriangles * 3; i++) start[indices[i] + 1]++;
  for (let v = 0; v < meta.bodyVertices; v++) start[v + 1] += start[v];
  const faces = new Uint32Array(meta.bodyTriangles * 3), filled = new Uint32Array(meta.bodyVertices);
  for (let t = 0; t < meta.bodyTriangles; t++)
    for (let k = 0; k < 3; k++) {
      const v = indices[t * 3 + k];
      faces[start[v] + filled[v]++] = t;
      for (const u of [indices[t * 3 + ((k + 1) % 3)], indices[t * 3 + ((k + 2) % 3)]]) {
        const d = Math.hypot(rest[u * 3] - rest[v * 3], rest[u * 3 + 1] - rest[v * 3 + 1], rest[u * 3 + 2] - rest[v * 3 + 2]);
        if (d > far[v] || (d === far[v] && u < partner[v])) { far[v] = d; partner[v] = u; }
      }
    }
  return (detailTopology = { allowed, start, faces, partner, indices });
}
// Rows of the frame of one vertex: tangent, bitangent, normal. False where the skin has no direction.
function skinFrame(positions, v, out) {
  const { start, faces, partner, indices } = headDetailTopology();
  if (v >= meta.bodyVertices || partner[v] < 0) return false;
  let nx = 0, ny = 0, nz = 0;
  for (let j = start[v]; j < start[v + 1]; j++) {
    const a = indices[faces[j] * 3] * 3, b = indices[faces[j] * 3 + 1] * 3, c = indices[faces[j] * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
  }
  const size = Math.hypot(nx, ny, nz);
  if (!(size > 1e-14)) return false;
  nx /= size; ny /= size; nz /= size;
  const u = partner[v] * 3;
  let tx = positions[u] - positions[v * 3], ty = positions[u + 1] - positions[v * 3 + 1], tz = positions[u + 2] - positions[v * 3 + 2];
  const along = tx * nx + ty * ny + tz * nz;
  tx -= along * nx; ty -= along * ny; tz -= along * nz;
  const length = Math.hypot(tx, ty, tz);
  if (!(length > 1e-9)) return false;
  tx /= length; ty /= length; tz /= length;
  out[0] = tx; out[1] = ty; out[2] = tz;
  out[3] = ny * tz - nz * ty; out[4] = nz * tx - nx * tz; out[5] = nx * ty - ny * tx;
  out[6] = nx; out[7] = ny; out[8] = nz;
  return true;
}
export function humanDetailVertex(v) {
  return headDetailTopology().allowed[v] === 1;
}
export function validHumanDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).length !== 4 ||
    detail.version !== 1 || detail.region !== "head" || !Array.isArray(detail.vertices) || !Array.isArray(detail.offsets))
    return false;
  const { allowed } = headDetailTopology(), n = detail.vertices.length;
  if (!n || n > allowed.length || detail.offsets.length !== n * 3) return false;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const v = detail.vertices[i], x = detail.offsets[i * 3], y = detail.offsets[i * 3 + 1], z = detail.offsets[i * 3 + 2];
    if (!Number.isInteger(v) || v <= last || v >= allowed.length || !allowed[v]) return false;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || x * x + y * y + z * z > humanDetailLimit * humanDetailLimit) return false;
    last = v;
  }
  return true;
}
/* Write movements of the surface `coarse`, in metres on that figure, as a fine
   layer. `offsets` has three numbers for every vertex of the figure. Movements
   outside the head are dropped, longer ones shortened to the limit. Returns
   undefined when nothing is left. */
export function humanDetailFrom(coarse, offsets) {
  const { allowed } = headDetailTopology(), unit = (0.00001 * (coarse.height ?? 1.72)) / 1.72;
  const vertices = [], saved = [], frame = new Float64Array(9);
  for (let v = 0; v < allowed.length; v++) {
    if (!allowed[v]) continue;
    let x = offsets[v * 3] / unit, y = offsets[v * 3 + 1] / unit, z = offsets[v * 3 + 2] / unit;
    if (!Number.isFinite(x + y + z)) throw new Error("Invalid fine correction.");
    if (skinFrame(coarse.positions, v, frame))
      [x, y, z] = [frame[0] * x + frame[1] * y + frame[2] * z, frame[3] * x + frame[4] * y + frame[5] * z, frame[6] * x + frame[7] * y + frame[8] * z];
    const length = Math.hypot(x, y, z), keep = length > humanDetailLimit ? humanDetailLimit / length : 1;
    let q = [Math.round(keep * x), Math.round(keep * y), Math.round(keep * z)];
    // Rounding may step just past the limit: round towards nothing instead.
    if (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] > humanDetailLimit * humanDetailLimit) q = [keep * x, keep * y, keep * z].map(Math.trunc);
    // No negative zero: a saved file reads it back as plain zero.
    if (q[0] || q[1] || q[2]) { vertices.push(v); saved.push(q[0] || 0, q[1] || 0, q[2] || 0); }
  }
  return vertices.length ? { version: 1, region: "head", vertices, offsets: saved } : undefined;
}
// The movement of each stored vertex on the surface `coarse`, in metres, three numbers per stored vertex.
export function humanDetailOffsets(coarse, detail, strength = 1) {
  if (!validHumanDetail(detail) || detail.vertices[detail.vertices.length - 1] >= coarse.positions.length / 3)
    throw new Error("Invalid fine correction.");
  const unit = (strength * 0.00001 * (coarse.height ?? 1.72)) / 1.72, frame = new Float64Array(9);
  const out = new Float32Array(detail.offsets.length);
  for (let i = 0; i < detail.vertices.length; i++) {
    const x = detail.offsets[i * 3] * unit, y = detail.offsets[i * 3 + 1] * unit, z = detail.offsets[i * 3 + 2] * unit;
    if (skinFrame(coarse.positions, detail.vertices[i], frame)) {
      out[i * 3] = frame[0] * x + frame[3] * y + frame[6] * z;
      out[i * 3 + 1] = frame[1] * x + frame[4] * y + frame[7] * z;
      out[i * 3 + 2] = frame[2] * x + frame[5] * y + frame[8] * z;
    } else out.set([x, y, z], i * 3);
  }
  return out;
}
/* Add a fine layer to the surface its measurements and control anchors give.
   Joints stay where they are: the layer reshapes skin, it does not repose. */
export function applyHumanDetail(coarse, detail, strength = 1) {
  if (!detail) return coarse;
  const moves = humanDetailOffsets(coarse, detail, strength), positions = coarse.positions.slice();
  for (let i = 0; i < detail.vertices.length; i++)
    for (let d = 0; d < 3; d++) positions[detail.vertices[i] * 3 + d] += moves[i * 3 + d];
  return { ...coarse, positions };
}
function applyPortraitFields(vertices, headJoint, fields, {origin, shape, pitch, anchor}) {
  const offset = origin.map((v, i) => v + vertices[3*headJoint+i] - anchor[i]);
  const [nx, ny, nz] = shape;
  for (let v = 0; v < vertices.length; v += 3) {
    const y = (vertices[v+1] - offset[1]) / pitch;
    if (y < 0 || y >= ny-1) continue;
    const x = (vertices[v] - offset[0]) / pitch;
    const z = (vertices[v+2] - offset[2]) / pitch;
    if (x < 0 || x >= nx-1 || z < 0 || z >= nz-1) continue;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x-ix, fy = y-iy, fz = z-iz;
    let dx = 0, dy = 0, dz = 0;
    for (const [field, strength] of fields) {
      for (let i=0; i<2; i++) for (let j=0; j<2; j++) for (let k=0; k<2; k++) {
        const cell = 3 * (((ix+i)*ny+iy+j)*nz+iz+k);
        const weight = strength * (i ? fx : 1-fx) * (j ? fy : 1-fy) * (k ? fz : 1-fz);
        dx += field[cell] * weight;
        dy += field[cell+1] * weight;
        dz += field[cell+2] * weight;
      }
    }
    vertices[v] += dx*.000002;
    vertices[v+1] += dy*.000002;
    vertices[v+2] += dz*.000002;
  }
}

// In the frontal bone the supraorbital ridge follows the upper edge of each
// socket. The zygoma sits below the outer corner and runs back to the temple.
// Read those two arches from this head's actual eye position and interocular
// distance. The same smooth warp carries adjacent skin and fitting helpers.
function shapeFacialBones(vertices, rim, cheek) {
  if (!rim && !cheek) return;
  for (const ids of meta.eyeGroups) {
    let ex=0, ey=0, ez=0;
    for (const id of ids) {
      ex+=vertices[3*id]; ey+=vertices[3*id+1]; ez+=vertices[3*id+2];
    }
    ex/=ids.length; ey/=ids.length; ez/=ids.length;
    const side=Math.sign(ex), k=Math.max(.83, Math.min(1.20, Math.abs(ex)/.031));
    for (let v=0; v<vertices.length; v+=3) {
      const x=side*vertices[v]/k, y=(vertices[v+1]-ey)/k, z=(vertices[v+2]-ez)/k;
      if (x<=0 || x>.088 || y<-.08 || y>.055 || z<-.078) continue;
      // Restrict the change to the outer face and taper across the midline.
      const depth=Math.max(0,Math.min(1,(z+.070)/.048));
      const mid=Math.min(1,x/.012);
      const front=depth*depth*(3-2*depth)*mid*mid*(3-2*mid);
      const X=x-Math.abs(ex)/k;
      const browY=.0185+.0045*Math.exp(-((X+.002)**2)/.00022)-.14*X;
      const arch=Math.exp(-(((X+.003)/.030)**2));
      const brow=rim * arch * Math.exp(-(((y-browY)/.009)**2));
      const cheekY=-.021+.28*(X-.010);
      const cheekX=(X-.014)/.029;
      const malar=cheek*Math.exp(-cheekX*cheekX-((y-cheekY)/.0115)**2);
      const hollow=cheek*Math.exp(-(((X-.012)/.023)**2)-((y-cheekY+.021)/.016)**2);
      vertices[v] += k*front*side*(.0015*brow+.0035*malar-.0018*hollow);
      vertices[v+2] += k*front*(.0068*brow+.0057*malar-.0038*hollow);
    }
  }
}

export function evaluateHuman(p = {}, fit, detail) {
  if (!validHuman(p))
    throw new Error("Choose supported adult human measurements.");
  const { frame = 0, age = 0, weight = 0, muscle = 0, height = 1.72 } = p;
  const vertices = unpack("base", Float32Array).slice();
  function add(key, amount) {
    if (Math.abs(amount) < 0.000001) return;
    const delta = unpack("m:" + key, Int16Array);
    const factor = amount * 0.0001;
    for (let i = 0; i < vertices.length; i++) vertices[i] += factor * delta[i];
  }
  for (const [sex, s] of [
    ["female", (1 - frame) / 2],
    ["male", (1 + frame) / 2],
  ]) {
    for (const [stage, a] of [
      ["young", 1 - age],
      ["old", age],
    ]) {
      if (!s || !a) continue;
      const blend = [
        Math.exp(2.6 * (p.faceA ?? 0)),
        Math.exp(2.6 * (p.faceB ?? 0)),
        1,
      ];
      const total = blend.reduce((x, y) => x + y);
      ["african", "asian", "caucasian"].forEach((family, i) =>
        add([family, sex, stage].join("-"), (s * a * blend[i]) / total),
      );
      for (const [m, mw] of ramp(muscle))
        for (const [w, ww] of ramp(weight))
          if (m !== "average" || w !== "average")
            add(
              [sex, stage, m + "muscle", w + "weight"].join("-"),
              s * a * mw * ww,
            );
    }
  }
  for (const k of meta.axes) {
    if (k === "smileLeft" || k === "smileRight") continue;
    let value = p[k] ?? 0;
    if (k === "belly") value = -value;
    const strength = k === "bust" ? 0.65 : 0.82;
    add(k + (value > 0 ? "1" : "0"), Math.abs(value) * strength);
  }
  for (const k of identity.meta.axes) {
    const value = p[k] ?? 0;
    add(k + (value > 0 ? "1" : "0"), Math.abs(value));
  }
  for (const [axis, changes] of Object.entries(faceSculpt.controls)) {
    const gain = (p[axis] ?? 0) * .0001;
    if (!gain) continue;
    for (let i=0; i<changes.length; i+=4) {
      const vertex = changes[i]*3;
      for (let d=0; d<3; d++) vertices[vertex+d] += gain*changes[i+1+d];
    }
  }
  if (p.abdominalApron) {
    const rest = humanRestPositions();
    // The fold sits above the groin. Move both skin and wardrobe guides by
    // their rest positions, leaving joints, groin, arms and legs in place.
    const rising = (low, high, x) => {
      const t = Math.max(0, Math.min(1, (x-low)/(high-low)));
      return t*t*(3-2*t);
    };
    const surfaceEnd = vertices.length - meta.names.length*3;
    for (let i = 0; i < surfaceEnd; i += 3) {
      const x = rest[i], y = rest[i+1], z = rest[i+2];
      if (y <= -.043 || y >= .19 || Math.abs(x) >= .235 || z <= -.022) continue;
      const front = rising(-.022, .12, z);
      const side = 1-rising(.11, .235, Math.abs(x));
      const belowNavel = rising(-.043, .028, y) * (1-rising(.04, .19, y));
      const fullness = p.abdominalApron * belowNavel * front * side;
      vertices[i] += .024 * fullness * Math.tanh(x/.08);
      vertices[i+1] -= .029 * fullness;
      vertices[i+2] += .044 * fullness;
    }
  }
  if (p.bust) {
    // Move the broad lower and outer chest with its clothing attachment points.
    // Use rest coordinates so this composes with a change in stature, mass or pose.
    const rest = humanRestPositions();
    for (let i = 0; i < vertices.length; i += 3) {
      const x = rest[i],
        y = rest[i + 1],
        z = rest[i + 2];
      if (z < 0.035 || y < 0.19 || y > 0.55 || Math.abs(x) > 0.23) continue;
      const radius =
        ((Math.abs(x) - 0.084) / 0.139) ** 2 + ((y - 0.367) / 0.161) ** 2;
      if (radius >= 1) continue;
      const front = Math.min(1, (z - 0.035) / 0.073);
      const weight =
        (1 - radius) ** 2 * front * front * (3 - 2 * front) * p.bust;
      vertices[i] += 0.009 * weight * Math.tanh(x / 0.042);
      vertices[i + 1] -= 0.009 * weight;
      vertices[i + 2] += 0.022 * weight;
    }
  }
  const soft = unpack("softIds", Uint16Array),
    offset = unpack("softOffsets", Uint32Array),
    near = unpack("softNeighbours", Uint16Array),
    weights = unpack("softWeights", Float32Array),
    mix = unpack("softMix", Float32Array);
  for (let step = 0; step < 3; step++) {
    const prev = vertices.slice();
    for (let i = 0; i < soft.length; i++) {
      const v = soft[i] * 3;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (let j = offset[i]; j < offset[i + 1]; j++)
          sum += prev[near[j] * 3 + axis] * weights[j];
        vertices[v + axis] += (sum - prev[v + axis]) * mix[i] * 0.76;
      }
    }
  }
  for (const { inner, ring, matrix } of meta.patches) {
    for (let i = 0; i < inner.length; i++) {
      for (let axis = 0; axis < 3; axis++) {
        let broad = 0;
        for (let j = 0; j < ring.length; j++)
          broad += vertices[ring[j] * 3 + axis] * matrix[i][j];
        vertices[inner[i] * 3 + axis] = broad;
      }
    }
  }
  const portraitWeights = portraitAxes.filter(axis => p[axis] > 0);
  if (portraitWeights.length) {
    const total = Math.max(1, portraitWeights.reduce((sum, axis) => sum + p[axis], 0));
    const fields = portraitWeights.map(axis => [unpack("m:" + axis, Int16Array), p[axis] / total]);
    const headJoint = vertices.length / 3 - meta.names.length + meta.names.indexOf("head");
    applyPortraitFields(vertices, headJoint, fields, portraits.layout);
  }
  const castWeights = castShapeAxes.filter(axis => p[axis] > 0);
  if (castWeights.length) {
    const total = Math.max(1, castWeights.reduce((sum, axis) => sum + p[axis], 0));
    const fields = castWeights.map(axis => [unpack("m:" + axis, Int16Array), p[axis] / total]);
    const headJoint = vertices.length / 3 - meta.names.length + meta.names.indexOf("head");
    // The field is one translation through each socket of the head it was measured on. On another
    // head the eye sits a little elsewhere, so give each eyeball the mean movement of its own points.
    const before = meta.eyeGroups.map(ids => ids.flatMap(id => [vertices[3*id], vertices[3*id+1], vertices[3*id+2]]));
    applyPortraitFields(vertices, headJoint, fields, castShapes.layout);
    meta.eyeGroups.forEach((ids, e) => {
      const mean = [0, 0, 0];
      ids.forEach((id, i) => { for (let d = 0; d < 3; d++) mean[d] += (vertices[3*id+d] - before[e][3*i+d]) / ids.length; });
      ids.forEach((id, i) => { for (let d = 0; d < 3; d++) vertices[3*id+d] = before[e][3*i+d] + mean[d]; });
    });
  }
  applyCapturedShape(vertices, p);
  shapeFacialBones(vertices, p.orbitalRim ?? 0, p.zygomaticArch ?? 0);
  let floor = Infinity,
    top = -Infinity;
  for (let v = 0; v < meta.bodyVertices; v++) {
    floor = Math.min(floor, vertices[v * 3 + 1]);
    top = Math.max(top, vertices[v * 3 + 1]);
  }
  const scale = height / (top - floor);
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i] *= scale;
    vertices[i + 1] = (vertices[i + 1] - floor) * scale;
    vertices[i + 2] *= scale;
  }
  if (p.smileLeft || p.smileRight) offsetRestSmile(vertices, p, height / 1.72, false);
  const ids = unpack("ids", Uint16Array);
  // Collarbones, the pit of the neck and the trapezius slope, before the limbs are posed.
  shapeNeck(vertices, p, height, {
    rest: unpack("base", Float32Array),
    names: meta.names,
    bodyVertices: meta.bodyVertices,
    bodyTriangles: meta.bodyTriangles,
    indices: unpack("indices", Uint16Array),
    joints: ids.length,
    bones: unpack("bones", Uint8Array),
    weights: unpack("weights", Uint16Array),
  });
  if (!arrays.has("floatWeights"))
    arrays.set(
      "floatWeights",
      Float32Array.from(unpack("weights", Uint16Array), (w) => w / 65535),
    );
  const positions = vertices.subarray(0, ids.length * 3),
    joints = vertices.subarray(ids.length * 3);
  const bind = [
    positions,
    joints,
    unpack("bones", Uint8Array),
    arrays.get("floatWeights"),
  ];
  if (p.fingerCurl) poseFingers(...bind, meta.names, p.fingerCurl);
  if (p.wristFlex) rotateBranches(...bind, "hand", 0, () => p.wristFlex * 0.68);
  if (p.stance)
    rotateBranches(...bind, "upperarm", 2, (side) => -side * p.stance * 0.53);
  if (p.armForward)
    rotateBranches(...bind, "upperarm", 0, () => -p.armForward * 0.59);
  if (p.elbowBend)
    rotateBranches(...bind, "lowerarm", 0, () => -p.elbowBend * 0.74);
  if (p.armLead) {
    rotateBranches(...bind, "upperarm", 0, side => -side*p.armLead*.31);
    rotateBranches(...bind, "lowerarm", 0, side => -.24*Math.max(0,side*p.armLead));
  }
  // Flex one elbow into a resting gesture. A little shoulder abduction keeps
  // the elbow outside the ribs, then the forearm comes back across the body.
  if (p.leftArmLift || p.rightArmLift) {
    const lift = side => (side > 0 ? p.leftArmLift : p.rightArmLift) || 0;
    rotateBranches(...bind, "upperarm", 2, side => side * .13 * lift(side));
    rotateBranches(...bind, "upperarm", 0, side => -.28 * lift(side));
    rotateBranches(...bind, "lowerarm", 0, side => -1.23 * lift(side));
    rotateBranches(...bind, "lowerarm", 1, side => -side * .58 * lift(side));
  }
  if (p.footLead) staggerFeet(...bind,p.footLead);
  if (p.handTwist)
    rotateBranches(...bind, "hand", 1, (side) => side * p.handTwist * 0.65);
  if (p.legSpread) {
    rotateBranches(...bind, "thigh", 2, (side) => side * p.legSpread * 0.14);
    let bottom = Infinity;
    for (let v = 0; v < meta.bodyVertices; v++)
      bottom = Math.min(bottom, positions[v * 3 + 1]);
    for (let j = 1; j < vertices.length; j += 3) vertices[j] -= bottom;
  }
  const surface = {
    positions,
    joints,
    height,
    indices: unpack("indices", Uint16Array),
    names: meta.names,
    parents: meta.parents,
    boneIndices: unpack("bones", Uint8Array),
    weights: arrays.get("floatWeights"),
    ids,
    uv: unpack("uv", Uint16Array),
    uvFaces: unpack("uvFaces", Uint16Array),
    bodyVertices: meta.bodyVertices,
    bodyTriangles: meta.bodyTriangles,
    eyeGroups: meta.eyeGroups,
    smileLeft: p.smileLeft ?? 0,
    smileRight: p.smileRight ?? 0,
    smileOpenness: p.smileOpenness ?? 0,
    smileBias: p.smileBias ?? 0,
  };
  const coarse = fit ? applyHumanControls(surface, controlVectors(fit)) : surface;
  return detail ? applyHumanDetail(coarse, detail) : coarse;
}
