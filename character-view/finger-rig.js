import { Bone, MathUtils, Vector3 } from "three";
export function bindFingers(region, bones, index) {
  const sources = new Map();
  for (const mesh of region.meshes) {
    if (!mesh.handRig) continue;
    const fingers = [];
    for (const digit of mesh.handRig) {
      const chain = [];
      let parent = region.bones[0],
        previous = region.points[0];
      for (const local of digit.anchors) {
        const point = new Vector3(...local).applyMatrix4(mesh.matrixWorld),
          bone = new Bone();
        bone.name =
          region.bones[0].name + "_" + digit.name + "_" + (chain.length + 1);
        bone.userData = {
          region: region.part.id,
          digit: digit.name,
          segment: chain.length + 1,
        };
        bone.position.copy(point).sub(previous);
        parent.add(bone);
        index.set(bone, bones.length);
        bones.push(bone);
        chain.push(bone);
        previous = point;
        parent = bone;
      }
      const axis = new Vector3(
        1,
        0,
        digit.name === "Thumb" ? (region.part.grip?.side ?? 1) * 0.57 : 0,
      ).transformDirection(mesh.matrixWorld);
      fingers.push({ ...digit, chain, axis });
    }
    sources.set(mesh, fingers);
  }
  return sources;
}
export function weightFingers(chains, ids, weights, index, wrist) {
  for (const digit of chains) {
    for (let v = 0; v < digit.vertices.length; v++) {
      const parameter = digit.parameters[v];
      const first =
        parameter < 0.45
          ? wrist
          : parameter < 1.45
            ? digit.chain[0]
            : digit.chain[1];
      const next =
        parameter < 0.45
          ? digit.chain[0]
          : parameter < 1.45
            ? digit.chain[1]
            : digit.chain[2];
      const joint = parameter < 0.45 ? 0 : parameter < 1.45 ? 1 : 2;
      const blend = MathUtils.smoothstep(parameter, joint - 0.4, joint + 0.4);
      const i = digit.vertices[v] * 4;
      weights[i] = 1 - blend;
      weights[i + 1] = blend;
      weights[i + 2] = weights[i + 3] = 0;
      ids[i] = weights[i] ? index.get(first) : 0;
      ids[i + 1] = weights[i + 1] ? index.get(next) : 0;
      ids[i + 2] = ids[i + 3] = 0;
    }
  }
}
