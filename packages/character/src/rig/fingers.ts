import * as T from "three";
import type { Digit } from "../surfaces/hand.js";
import type { Finger, Region } from "./region.js";

export function bindFingers(
  region: Region,
  digitsOf: (mesh: T.Mesh) => ReadonlyArray<Digit> | undefined,
  bones: T.Bone[],
  index: Map<T.Bone, number>,
): Map<T.Mesh, Finger[]> {
  const sources = new Map<T.Mesh, Finger[]>();
  const wrist = region.bones[0];
  const start = region.points[0];
  if (!wrist || !start) return sources;
  for (const mesh of region.meshes) {
    const digits = digitsOf(mesh);
    if (!digits) continue;
    const fingers: Finger[] = [];
    for (const digit of digits) {
      const chain: T.Bone[] = [];
      let parent = wrist;
      let previous = start;
      for (const local of digit.anchors) {
        const point = new T.Vector3(...local).applyMatrix4(mesh.matrixWorld);
        const bone = new T.Bone();
        bone.name = wrist.name + "_" + digit.name + "_" + (chain.length + 1);
        bone.userData = { region: region.part.id, digit: digit.name, segment: chain.length + 1 };
        bone.position.copy(point).sub(previous);
        parent.add(bone);
        index.set(bone, bones.length);
        bones.push(bone);
        chain.push(bone);
        previous = point;
        parent = bone;
      }
      const axis = new T.Vector3(
        1,
        0,
        digit.name === "Thumb" ? (region.part.hand?.side ?? 1) * 0.57 : 0,
      ).transformDirection(mesh.matrixWorld);
      fingers.push({ ...digit, chain, axis });
    }
    sources.set(mesh, fingers);
  }
  return sources;
}

export function weightFingers(
  chains: ReadonlyArray<Finger>,
  ids: Uint16Array,
  weights: Float32Array,
  index: ReadonlyMap<T.Bone, number>,
  wrist: T.Bone | undefined,
): void {
  const id = (bone: T.Bone | undefined) => (bone && index.get(bone)) ?? 0;
  for (const digit of chains)
    for (let v = 0; v < digit.vertices.length; v++) {
      const parameter = digit.parameters[v] ?? 0;
      const first = parameter < 0.45 ? wrist : parameter < 1.45 ? digit.chain[0] : digit.chain[1];
      const next =
        parameter < 0.45 ? digit.chain[0] : parameter < 1.45 ? digit.chain[1] : digit.chain[2];
      const joint = parameter < 0.45 ? 0 : parameter < 1.45 ? 1 : 2;
      const blend = T.MathUtils.smoothstep(parameter, joint - 0.4, joint + 0.4);
      const i = (digit.vertices[v] ?? 0) * 4;
      weights[i] = 1 - blend;
      weights[i + 1] = blend;
      weights[i + 2] = weights[i + 3] = 0;
      ids[i] = weights[i] ? id(first) : 0;
      ids[i + 1] = weights[i + 1] ? id(next) : 0;
      ids[i + 2] = ids[i + 3] = 0;
    }
}
