import { boneNames } from "./catalogue.js";
import type { HumanBody } from "./body.js";
import type { HumanSurface } from "./surface.js";

export interface SmoothSurface {
  readonly cage: HumanSurface;
  readonly positions: Float32Array;
  readonly joints: Float32Array;
  readonly height: number;
  readonly indices: Uint32Array;
  readonly bodyTriangles: number;
  readonly parentFaces: Uint16Array;
  readonly quadIds: Uint16Array;
  readonly boneIndices: Uint8Array;
  readonly weights: Float32Array;
  readonly uv: Uint16Array;
  readonly uvFaces: Uint32Array;
  readonly pigments: Uint8Array;
}

export function skinBoneCorners(s: SmoothSurface, skip?: ReadonlySet<number>) {
  const bins = boneNames.map((): number[] => []);
  const totals = new Float32Array(boneNames.length);
  for (let c = 0; c < s.bodyTriangles * 3; c += 3) {
    if (skip?.has(s.parentFaces[c / 3] ?? -1)) continue;
    totals.fill(0);
    for (let i = 0; i < 3; i++) {
      const v = s.indices[c + i] ?? 0;
      for (let j = v * 4; j < v * 4 + 4; j++) {
        const b = s.boneIndices[j] ?? 0;
        totals[b] = (totals[b] ?? 0) + (s.weights[j] ?? 0);
      }
    }
    let best = 0;
    for (let i = 1; i < totals.length; i++) if ((totals[i] ?? 0) > (totals[best] ?? 0)) best = i;
    bins[best]?.push(c, c + 1, c + 2);
  }
  return bins;
}

export function smoothHumanSurface(body: HumanBody, cage: HumanSurface): SmoothSurface {
  const a = body.arrays;
  const offsets = a.u32("subOffsets"),
    refs = a.u16("subRefs"),
    coeff = a.f32("subFactors");
  const source = cage.positions;
  const positions = new Float32Array((offsets.length - 1) * 3);
  for (let i = 0; i < positions.length / 3; i++) {
    let x = 0,
      y = 0,
      z = 0;
    const end = offsets[i + 1] ?? 0;
    for (let j = offsets[i] ?? 0; j < end; j++) {
      const base = (refs[j] ?? 0) * 3,
        w = coeff[j] ?? 0;
      x += (source[base] ?? 0) * w;
      y += (source[base + 1] ?? 0) * w;
      z += (source[base + 2] ?? 0) * w;
    }
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  const indices = a.u32("subIndices");
  return {
    cage,
    positions,
    joints: cage.joints,
    height: cage.height,
    indices,
    bodyTriangles: indices.length / 3,
    parentFaces: a.u16("subParent"),
    quadIds: a.u16("quadIds"),
    boneIndices: a.u8("subBones"),
    weights: body.subFloatWeights,
    uv: a.u16("subUV"),
    uvFaces: a.u32("subFaceUV"),
    pigments: a.u8("subPigments"),
  };
}
