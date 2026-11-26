import {
  bodyAxes,
  bodyVertices,
  bodyTriangles,
  boneNames,
  boneParents,
  capturedAxes,
  castShapeAxes,
  castShapeLayout,
  identityAxes,
  portraitAxes,
  portraitLayout,
  sculptAxes,
  type FieldLayout,
} from "./catalogue.js";
import type { HumanBody } from "./body.js";
import { poseFingers } from "./hands.js";
import { shapeNeck } from "./neck.js";
import { applyCapturedShape } from "./captured.js";

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
  ...bodyAxes,
  "shoulderLine",
  "upperBack",
  "abdominalApron",
  ...identityAxes,
  ...sculptAxes,
  ...portraitAxes,
  "orbitalRim",
  "zygomaticArch",
  ...castShapeAxes,
  ...capturedAxes,
] as const;
export type HumanAxis = (typeof humanAxes)[number];
export type HumanMeasurements = Partial<Record<HumanAxis, number>>;

const axisSet = new Set<string>(humanAxes);
export const isHumanAxis = (key: string): key is HumanAxis => axisSet.has(key);

const unitAxes = new Set<string>([
  ...sculptAxes,
  ...portraitAxes,
  ...castShapeAxes,
  ...capturedAxes,
  "age",
  "abdominalApron",
  "leftArmLift",
  "rightArmLift",
  "orbitalRim",
  "zygomaticArch",
]);
export function humanRange(key: HumanAxis): readonly [number, number, number] {
  if (key === "height") return [1.43, 2.08, 1.72];
  if (unitAxes.has(key)) return [0, 1, 0];
  return [-1, 1, 0];
}

export function validHuman(p: Readonly<Record<string, number>>): boolean {
  return Object.entries(p).every(([key, value]) => {
    if (!isHumanAxis(key)) return false;
    const [lo, hi] = humanRange(key);
    return Number.isFinite(value) && value >= lo && value <= hi;
  });
}

export interface HumanSurface {
  readonly positions: Float32Array;
  readonly joints: Float32Array;
  readonly height: number;
  readonly indices: Uint16Array;
  readonly boneIndices: Uint8Array;
  readonly weights: Float32Array;
  readonly ids: Uint16Array;
  readonly uv: Uint16Array;
  readonly uvFaces: Uint16Array;
  readonly bodyVertices: number;
  readonly bodyTriangles: number;
  readonly eyeGroups: readonly [Uint16Array, Uint16Array];
  readonly smileLeft: number;
  readonly smileRight: number;
  readonly smileOpenness: number;
  readonly smileBias: number;
}

export function bodyArrays(body: HumanBody) {
  const a = body.arrays;
  return {
    u8: (n: string) => a.u8(n),
    u16: (n: string) => a.u16(n),
    u32: (n: string) => a.u32(n),
    f32: (n: string) => a.f32(n),
  };
}

function ramp(value: number): ReadonlyArray<readonly [string, number]> {
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

const names: ReadonlyArray<string> = boneNames;
const boneIndex = (name: string) => names.indexOf(name);

function rotateBranches(
  positions: Float32Array,
  joints: Float32Array,
  indices: Uint8Array,
  weights: Float32Array,
  root: string,
  axis: number,
  angleForSide: (side: number) => number,
): void {
  for (const [suffix, side] of [
    ["_l", 1],
    ["_r", -1],
  ] as const) {
    const angle = angleForSide(side);
    if (!angle) continue;
    const shoulder = boneIndex(root + suffix);
    const origin = joints.slice(shoulder * 3, shoulder * 3 + 3);
    const active = boneNames.map((start) => {
      let name: string | undefined = start;
      while (name && name !== "Root") {
        if (name === boneNames[shoulder]) return true;
        name = boneParents[boneIndex(name)];
      }
      return false;
    });
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const i0 = (axis + 1) % 3,
      i1 = (axis + 2) % 3;
    const o0 = origin[i0] ?? 0,
      o1 = origin[i1] ?? 0;
    const turn = (array: Float32Array, i: number, influence: number) => {
      const x = (array[i + i0] ?? 0) - o0,
        y = (array[i + i1] ?? 0) - o1;
      array[i + i0] = (array[i + i0] ?? 0) + ((cos - 1) * x - sin * y) * influence;
      array[i + i1] = (array[i + i1] ?? 0) + (sin * x + (cos - 1) * y) * influence;
    };
    for (let i = 0; i < positions.length / 3; i++) {
      let w = 0;
      for (let k = i * 4; k < i * 4 + 4; k++) if (active[indices[k] ?? 0]) w += weights[k] ?? 0;
      if (w) turn(positions, i * 3, w);
    }
    active.forEach((enabled, i) => {
      if (enabled) turn(joints, i * 3, 1);
    });
  }
}

function staggerFeet(
  positions: Float32Array,
  joints: Float32Array,
  indices: Uint8Array,
  weights: Float32Array,
  lead: number,
): void {
  for (const [suffix, sign] of [
    ["_l", 1],
    ["_r", -1],
  ] as const) {
    const branch = boneNames.map(
      (name) => /^(thigh|calf|foot|ball|toe)/.test(name) && name.endsWith(suffix),
    );
    const hip = joints[boneIndex("thigh" + suffix) * 3 + 1] ?? 0;
    const ankle = joints[boneIndex("foot" + suffix) * 3 + 1] ?? 0;
    const reach = (hip - ankle) * lead * sign * 0.135;
    const offset = (y: number) => reach * Math.max(0, Math.min(1, (hip - y) / (hip - ankle)));
    for (let v = 0; v < positions.length / 3; v++) {
      let influence = 0;
      for (let j = v * 4; j < v * 4 + 4; j++)
        if (branch[indices[j] ?? 0]) influence += weights[j] ?? 0;
      positions[v * 3 + 2] =
        (positions[v * 3 + 2] ?? 0) + influence * offset(positions[v * 3 + 1] ?? 0);
    }
    branch.forEach((on, i) => {
      if (on) joints[i * 3 + 2] = (joints[i * 3 + 2] ?? 0) + offset(joints[i * 3 + 1] ?? 0);
    });
  }
}

function applyPortraitFields(
  vertices: Float32Array,
  headJoint: number,
  fields: ReadonlyArray<readonly [Int16Array, number]>,
  { origin, shape, pitch, anchor }: FieldLayout,
): void {
  const offset = origin.map((v, i) => v + (vertices[3 * headJoint + i] ?? 0) - (anchor[i] ?? 0));
  const [nx, ny, nz] = shape;
  const [ox, oy, oz] = [offset[0] ?? 0, offset[1] ?? 0, offset[2] ?? 0];
  for (let v = 0; v < vertices.length; v += 3) {
    const y = ((vertices[v + 1] ?? 0) - oy) / pitch;
    if (y < 0 || y >= ny - 1) continue;
    const x = ((vertices[v] ?? 0) - ox) / pitch;
    const z = ((vertices[v + 2] ?? 0) - oz) / pitch;
    if (x < 0 || x >= nx - 1 || z < 0 || z >= nz - 1) continue;
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    const fx = x - ix,
      fy = y - iy,
      fz = z - iz;
    let dx = 0,
      dy = 0,
      dz = 0;
    for (const [field, strength] of fields) {
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++)
          for (let k = 0; k < 2; k++) {
            const cell = 3 * (((ix + i) * ny + iy + j) * nz + iz + k);
            const weight = strength * (i ? fx : 1 - fx) * (j ? fy : 1 - fy) * (k ? fz : 1 - fz);
            dx += (field[cell] ?? 0) * weight;
            dy += (field[cell + 1] ?? 0) * weight;
            dz += (field[cell + 2] ?? 0) * weight;
          }
    }
    vertices[v] = (vertices[v] ?? 0) + dx * 0.000002;
    vertices[v + 1] = (vertices[v + 1] ?? 0) + dy * 0.000002;
    vertices[v + 2] = (vertices[v + 2] ?? 0) + dz * 0.000002;
  }
}

function shapeFacialBones(
  vertices: Float32Array,
  eyeGroups: readonly [Uint16Array, Uint16Array],
  rim: number,
  cheek: number,
): void {
  if (!rim && !cheek) return;
  for (const ids of eyeGroups) {
    let ex = 0,
      ey = 0,
      ez = 0;
    for (const id of ids) {
      ex += vertices[3 * id] ?? 0;
      ey += vertices[3 * id + 1] ?? 0;
      ez += vertices[3 * id + 2] ?? 0;
    }
    ex /= ids.length;
    ey /= ids.length;
    ez /= ids.length;
    const side = Math.sign(ex),
      k = Math.max(0.83, Math.min(1.2, Math.abs(ex) / 0.031));
    for (let v = 0; v < vertices.length; v += 3) {
      const x = (side * (vertices[v] ?? 0)) / k,
        y = ((vertices[v + 1] ?? 0) - ey) / k,
        z = ((vertices[v + 2] ?? 0) - ez) / k;
      if (x <= 0 || x > 0.088 || y < -0.08 || y > 0.055 || z < -0.078) continue;
      const depth = Math.max(0, Math.min(1, (z + 0.07) / 0.048));
      const mid = Math.min(1, x / 0.012);
      const front = depth * depth * (3 - 2 * depth) * mid * mid * (3 - 2 * mid);
      const X = x - Math.abs(ex) / k;
      const browY = 0.0185 + 0.0045 * Math.exp(-((X + 0.002) ** 2) / 0.00022) - 0.14 * X;
      const arch = Math.exp(-(((X + 0.003) / 0.03) ** 2));
      const brow = rim * arch * Math.exp(-(((y - browY) / 0.009) ** 2));
      const cheekY = -0.021 + 0.28 * (X - 0.01);
      const cheekX = (X - 0.014) / 0.029;
      const malar = cheek * Math.exp(-cheekX * cheekX - ((y - cheekY) / 0.0115) ** 2);
      const hollow =
        cheek * Math.exp(-(((X - 0.012) / 0.023) ** 2) - ((y - cheekY + 0.021) / 0.016) ** 2);
      vertices[v] =
        (vertices[v] ?? 0) + k * front * side * (0.0015 * brow + 0.0035 * malar - 0.0018 * hollow);
      vertices[v + 2] =
        (vertices[v + 2] ?? 0) + k * front * (0.0068 * brow + 0.0057 * malar - 0.0038 * hollow);
    }
  }
}

const expressionCache = new WeakMap<HumanBody, Map<string, Float32Array>>();

export function expressionDisplacements(
  body: HumanBody,
  name: string,
  smooth = false,
  identity: HumanMeasurements = {},
): Float32Array {
  let cache = expressionCache.get(body);
  if (!cache) expressionCache.set(body, (cache = new Map<string, Float32Array>()));
  const key = (smooth ? "smooth/" : "expr/") + name;
  let expression = cache.get(key);
  if (!expression) {
    const raw = Float32Array.from(body.morph(name), (v) => v * 0.0001);
    if (smooth) {
      const { u16, u32, f32 } = bodyArrays(body);
      const offsets = u32("subOffsets"),
        refs = u16("subRefs"),
        weights = f32("subFactors");
      const coords = new Float32Array((offsets.length - 1) * 3);
      for (let i = 0; i < coords.length / 3; i++)
        for (let j = offsets[i] ?? 0; j < (offsets[i + 1] ?? 0); j++)
          for (let d = 0; d < 3; d++)
            coords[i * 3 + d] =
              (coords[i * 3 + d] ?? 0) + (raw[(refs[j] ?? 0) * 3 + d] ?? 0) * (weights[j] ?? 0);
      expression = coords;
    } else expression = raw;
    cache.set(key, expression);
  }
  if (
    name === "Smile" &&
    (identity.smileLeft || identity.smileRight || identity.smileOpenness || identity.smileBias)
  ) {
    const remaining = expression.slice();
    const openness = identity.smileOpenness ?? 0,
      bias = identity.smileBias ?? 0;
    if (openness || bias) {
      const left = expressionDisplacements(body, "smileLeft1", smooth);
      const right = expressionDisplacements(body, "smileRight1", smooth);
      const endpoint = expressionDisplacements(
        body,
        openness < 0 ? "ReservedSmile" : "BroadSmile",
        smooth,
      );
      const mix = Math.abs(openness) ** 0.7;
      const side = 0.32 * bias * (0.28 + 0.72 * Math.abs(bias));
      for (let i = 0; i < remaining.length; i++)
        remaining[i] =
          (remaining[i] ?? 0) +
          mix * ((endpoint[i] ?? 0) - (expression[i] ?? 0)) +
          side * ((left[i] ?? 0) - (right[i] ?? 0));
    }
    offsetRestSmile(body, remaining, identity, -1, smooth);
    return remaining;
  }
  return expression;
}

function offsetRestSmile(
  body: HumanBody,
  values: Float32Array,
  identity: HumanMeasurements,
  gain: number,
  smooth: boolean,
): void {
  for (const side of ["smileLeft", "smileRight"] as const) {
    const amount = identity[side] ?? 0;
    if (!amount) continue;
    const shape = expressionDisplacements(body, side + (amount > 0 ? "1" : "0"), smooth);
    const weight = Math.abs(amount) * 0.82 * gain;
    for (let i = 0; i < values.length; i++) values[i] = (values[i] ?? 0) + weight * (shape[i] ?? 0);
  }
}

export function evaluateHuman(body: HumanBody, p: HumanMeasurements = {}): HumanSurface {
  if (!validHuman(p)) throw new Error("Choose supported adult human measurements.");
  const { u8, u16, u32, f32 } = bodyArrays(body);
  const { frame = 0, age = 0, weight = 0, muscle = 0, height = 1.72 } = p;
  const base = f32("base");
  const vertices = base.slice();
  const add = (key: string, amount: number) => {
    if (Math.abs(amount) < 0.000001) return;
    const delta = body.morph(key);
    const factor = amount * 0.0001;
    for (let i = 0; i < vertices.length; i++)
      vertices[i] = (vertices[i] ?? 0) + factor * (delta[i] ?? 0);
  };
  for (const [sex, s] of [
    ["female", (1 - frame) / 2],
    ["male", (1 + frame) / 2],
  ] as const) {
    for (const [stage, a] of [
      ["young", 1 - age],
      ["old", age],
    ] as const) {
      if (!s || !a) continue;
      const blend = [Math.exp(2.6 * (p.faceA ?? 0)), Math.exp(2.6 * (p.faceB ?? 0)), 1] as const;
      const total = blend.reduce((x, y) => x + y);
      (["african", "asian", "caucasian"] as const).forEach((family, i) =>
        add([family, sex, stage].join("-"), (s * a * (blend[i] ?? 0)) / total),
      );
      for (const [m, mw] of ramp(muscle))
        for (const [w, ww] of ramp(weight))
          if (m !== "average" || w !== "average")
            add([sex, stage, m + "muscle", w + "weight"].join("-"), s * a * mw * ww);
    }
  }
  for (const k of bodyAxes) {
    if (k === "smileLeft" || k === "smileRight") continue;
    let value = p[k] ?? 0;
    if (k === "belly") value = -value;
    const strength = k === "bust" ? 0.65 : 0.82;
    add(k + (value > 0 ? "1" : "0"), Math.abs(value) * strength);
  }
  for (const k of identityAxes) {
    const value = p[k] ?? 0;
    add(k + (value > 0 ? "1" : "0"), Math.abs(value));
  }
  for (const axis of sculptAxes) {
    const gain = (p[axis] ?? 0) * 0.0001;
    if (!gain) continue;
    const changes = body.sculpt(axis);
    for (let i = 0; i < changes.length; i += 4) {
      const vertex = (changes[i] ?? 0) * 3;
      for (let d = 0; d < 3; d++)
        vertices[vertex + d] = (vertices[vertex + d] ?? 0) + gain * (changes[i + 1 + d] ?? 0);
    }
  }
  const joints = boneNames.length;
  if (p.abdominalApron) {
    const rest = base;
    const rising = (low: number, high: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - low) / (high - low)));
      return t * t * (3 - 2 * t);
    };
    const surfaceEnd = vertices.length - joints * 3;
    for (let i = 0; i < surfaceEnd; i += 3) {
      const x = rest[i] ?? 0,
        y = rest[i + 1] ?? 0,
        z = rest[i + 2] ?? 0;
      if (y <= -0.043 || y >= 0.19 || Math.abs(x) >= 0.235 || z <= -0.022) continue;
      const front = rising(-0.022, 0.12, z);
      const side = 1 - rising(0.11, 0.235, Math.abs(x));
      const belowNavel = rising(-0.043, 0.028, y) * (1 - rising(0.04, 0.19, y));
      const fullness = p.abdominalApron * belowNavel * front * side;
      vertices[i] = (vertices[i] ?? 0) + 0.024 * fullness * Math.tanh(x / 0.08);
      vertices[i + 1] = (vertices[i + 1] ?? 0) - 0.029 * fullness;
      vertices[i + 2] = (vertices[i + 2] ?? 0) + 0.044 * fullness;
    }
  }
  if (p.bust) {
    const rest = base;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = rest[i] ?? 0,
        y = rest[i + 1] ?? 0,
        z = rest[i + 2] ?? 0;
      if (z < 0.035 || y < 0.19 || y > 0.55 || Math.abs(x) > 0.23) continue;
      const radius = ((Math.abs(x) - 0.084) / 0.139) ** 2 + ((y - 0.367) / 0.161) ** 2;
      if (radius >= 1) continue;
      const front = Math.min(1, (z - 0.035) / 0.073);
      const w = (1 - radius) ** 2 * front * front * (3 - 2 * front) * p.bust;
      vertices[i] = (vertices[i] ?? 0) + 0.009 * w * Math.tanh(x / 0.042);
      vertices[i + 1] = (vertices[i + 1] ?? 0) - 0.009 * w;
      vertices[i + 2] = (vertices[i + 2] ?? 0) + 0.022 * w;
    }
  }
  const soft = u16("softIds"),
    offset = u32("softOffsets"),
    near = u16("softNeighbours"),
    softWeights = f32("softWeights"),
    mix = f32("softMix");
  for (let step = 0; step < 3; step++) {
    const prev = vertices.slice();
    for (let i = 0; i < soft.length; i++) {
      const v = (soft[i] ?? 0) * 3;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (let j = offset[i] ?? 0; j < (offset[i + 1] ?? 0); j++)
          sum += (prev[(near[j] ?? 0) * 3 + axis] ?? 0) * (softWeights[j] ?? 0);
        vertices[v + axis] =
          (vertices[v + axis] ?? 0) + (sum - (prev[v + axis] ?? 0)) * (mix[i] ?? 0) * 0.76;
      }
    }
  }
  {
    const { inner, ring, matrix } = body.patch;
    for (let i = 0; i < inner.length; i++) {
      for (let axis = 0; axis < 3; axis++) {
        let broad = 0;
        for (let j = 0; j < ring.length; j++)
          broad += (vertices[(ring[j] ?? 0) * 3 + axis] ?? 0) * (matrix[i * ring.length + j] ?? 0);
        vertices[(inner[i] ?? 0) * 3 + axis] = broad;
      }
    }
  }
  const headJoint = vertices.length / 3 - joints + boneIndex("head");
  const portraitWeights = portraitAxes.filter((axis) => (p[axis] ?? 0) > 0);
  if (portraitWeights.length) {
    const total = Math.max(
      1,
      portraitWeights.reduce((sum, axis) => sum + (p[axis] ?? 0), 0),
    );
    const fields = portraitWeights.map(
      (axis) => [body.morph(axis), (p[axis] ?? 0) / total] as const,
    );
    applyPortraitFields(vertices, headJoint, fields, portraitLayout);
  }
  const castWeights = castShapeAxes.filter((axis) => (p[axis] ?? 0) > 0);
  if (castWeights.length) {
    const total = Math.max(
      1,
      castWeights.reduce((sum, axis) => sum + (p[axis] ?? 0), 0),
    );
    const fields = castWeights.map((axis) => [body.morph(axis), (p[axis] ?? 0) / total] as const);
    const before = body.eyeGroups.map((ids) =>
      Array.from(ids).flatMap((id) => [
        vertices[3 * id] ?? 0,
        vertices[3 * id + 1] ?? 0,
        vertices[3 * id + 2] ?? 0,
      ]),
    );
    applyPortraitFields(vertices, headJoint, fields, castShapeLayout);
    body.eyeGroups.forEach((ids, e) => {
      const was = before[e] ?? [];
      const mean = [0, 0, 0];
      ids.forEach((id, i) => {
        for (let d = 0; d < 3; d++)
          mean[d] =
            (mean[d] ?? 0) + ((vertices[3 * id + d] ?? 0) - (was[3 * i + d] ?? 0)) / ids.length;
      });
      ids.forEach((id, i) => {
        for (let d = 0; d < 3; d++) vertices[3 * id + d] = (was[3 * i + d] ?? 0) + (mean[d] ?? 0);
      });
    });
  }
  applyCapturedShape(body, vertices, p);
  shapeFacialBones(vertices, body.eyeGroups, p.orbitalRim ?? 0, p.zygomaticArch ?? 0);
  let floor = Infinity,
    top = -Infinity;
  for (let v = 0; v < bodyVertices; v++) {
    floor = Math.min(floor, vertices[v * 3 + 1] ?? 0);
    top = Math.max(top, vertices[v * 3 + 1] ?? 0);
  }
  const scale = height / (top - floor);
  for (let i = 0; i < vertices.length; i += 3) {
    vertices[i] = (vertices[i] ?? 0) * scale;
    vertices[i + 1] = ((vertices[i + 1] ?? 0) - floor) * scale;
    vertices[i + 2] = (vertices[i + 2] ?? 0) * scale;
  }
  if (p.smileLeft || p.smileRight) offsetRestSmile(body, vertices, p, height / 1.72, false);
  const ids = u16("ids");
  const indices = u16("indices");
  const bones = u8("bones");
  shapeNeck(vertices, p, height, {
    rest: base,
    bodyVertices,
    bodyTriangles,
    indices,
    joints: ids.length,
    bones,
    weights: u16("weights"),
  });
  const positions = vertices.subarray(0, ids.length * 3),
    jointPositions = vertices.subarray(ids.length * 3);
  const w = body.floatWeights;
  if (p.fingerCurl) poseFingers(positions, jointPositions, bones, w, p.fingerCurl);
  const turn = (root: string, axis: number, angle: (side: number) => number) =>
    rotateBranches(positions, jointPositions, bones, w, root, axis, angle);
  const q = (k: HumanAxis) => p[k] ?? 0;
  if (p.wristFlex) turn("hand", 0, () => q("wristFlex") * 0.68);
  if (p.stance) turn("upperarm", 2, (side) => -side * q("stance") * 0.53);
  if (p.armForward) turn("upperarm", 0, () => -q("armForward") * 0.59);
  if (p.elbowBend) turn("lowerarm", 0, () => -q("elbowBend") * 0.74);
  if (p.armLead) {
    turn("upperarm", 0, (side) => -side * q("armLead") * 0.31);
    turn("lowerarm", 0, (side) => -0.24 * Math.max(0, side * q("armLead")));
  }
  if (p.leftArmLift || p.rightArmLift) {
    const lift = (side: number) => (side > 0 ? p.leftArmLift : p.rightArmLift) || 0;
    turn("upperarm", 2, (side) => side * 0.13 * lift(side));
    turn("upperarm", 0, (side) => -0.28 * lift(side));
    turn("lowerarm", 0, (side) => -1.23 * lift(side));
    turn("lowerarm", 1, (side) => -side * 0.58 * lift(side));
  }
  if (p.footLead) staggerFeet(positions, jointPositions, bones, w, p.footLead);
  if (p.handTwist) turn("hand", 1, (side) => side * q("handTwist") * 0.65);
  if (p.legSpread) {
    turn("thigh", 2, (side) => side * q("legSpread") * 0.14);
    let bottom = Infinity;
    for (let v = 0; v < bodyVertices; v++) bottom = Math.min(bottom, positions[v * 3 + 1] ?? 0);
    for (let j = 1; j < vertices.length; j += 3) vertices[j] = (vertices[j] ?? 0) - bottom;
  }
  return {
    positions,
    joints: jointPositions,
    height,
    indices,
    boneIndices: bones,
    weights: w,
    ids,
    uv: u16("uv"),
    uvFaces: u16("uvFaces"),
    bodyVertices,
    bodyTriangles,
    eyeGroups: body.eyeGroups,
    smileLeft: p.smileLeft ?? 0,
    smileRight: p.smileRight ?? 0,
    smileOpenness: p.smileOpenness ?? 0,
    smileBias: p.smileBias ?? 0,
  };
}

const cheekSections = [
  [
    [11929, 5325, 0.145],
    [11791, 5179, 0.324],
    [11930, 5326, 0.531],
  ],
  [
    [11766, 5152, 0.032],
    [11789, 5177, 0.241],
    [11788, 5176, 0.727],
  ],
  [
    [11789, 5177, 0.167],
    [11768, 5154, 0.669],
    [11817, 5206, 0.164],
  ],
] as const;

export function malarBend(surface: HumanSurface): number {
  const p = surface.positions;
  return Math.max(
    ...[0, 1].map((side) => {
      const sign = side ? -1 : 1;
      const points = cheekSections.map((section) => {
        let outward = 0,
          y = 0;
        for (const marker of section) {
          const i = 3 * (side ? marker[1] : marker[0]),
            w = marker[2];
          outward += w * (sign * 0.66913 * (p[i] ?? 0) + 0.74314 * (p[i + 2] ?? 0));
          y += w * (p[i + 1] ?? 0);
        }
        return [outward, y] as const;
      });
      const slope = (a: readonly [number, number], b: readonly [number, number]) =>
        Math.atan2(b[0] - a[0], a[1] - b[1]);
      const [a, b, c] = points;
      if (!a || !b || !c) return Number.NaN;
      return ((slope(a, b) - slope(b, c)) * 180) / Math.PI;
    }),
  );
}

export function restLipProfile(surface: HumanSurface): { upper: number; lower: number } {
  const p = surface.positions;
  const front = (ids: ReadonlyArray<number>) =>
    ids.reduce((a, b) => ((p[a * 3 + 2] ?? 0) > (p[b * 3 + 2] ?? 0) ? a : b));
  const nose = 3 * front([294, 297, 5054]);
  const chin = 3 * front([5162, 5211, 5171, 5225]);
  const at = (i: number) => p[i] ?? 0;
  const distance = (ids: ReadonlyArray<number>) => {
    const i = 3 * front(ids);
    const t = (at(i + 1) - at(chin + 1)) / (at(nose + 1) - at(chin + 1));
    return ((at(i + 2) - at(chin + 2) - t * (at(nose + 2) - at(chin + 2))) * 1720) / surface.height;
  };
  return { upper: distance([455, 466, 467]), lower: distance([495, 496, 513]) };
}
