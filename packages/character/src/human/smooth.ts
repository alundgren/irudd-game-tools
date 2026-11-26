// The smoothed adult surface (smoothHumanSurface in character-view/human-surface.js
// at 2761eb1). Each smoothed vertex is a fixed blend of evaluated cage vertices,
// so one surface topology serves every adult; the triangles, texture
// coordinates, pigment masks and skin weights come with it from the pack.

import type { HumanBody } from "./body.js";
import type { HumanSurface } from "./surface.js";

export interface SmoothSurface {
  /** The cage it was smoothed from. */
  readonly cage: HumanSurface;
  /** Smoothed vertex positions. The face anatomy refinement moves them in place. */
  readonly positions: Float32Array;
  readonly joints: Float32Array;
  readonly height: number;
  readonly indices: Uint32Array;
  readonly bodyTriangles: number;
  /** The cage quad each smoothed triangle came from. */
  readonly parentFaces: Uint16Array;
  readonly quadIds: Uint16Array;
  readonly boneIndices: Uint8Array;
  readonly weights: Float32Array;
  /** Texture coordinates, whole numbers of 1/65535. */
  readonly uv: Uint16Array;
  readonly uvFaces: Uint32Array;
  /** Per texture vertex: lip zone, lid, mouth and nail masks, 0 to 255. */
  readonly pigments: Uint8Array;
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
