import * as T from "three";
import type { BuiltCharacter } from "../build.js";
import { skinCharacter } from "./skin.js";
import { isMesh } from "../mesh.js";

export function fanDisplay(character: BuiltCharacter) {
  const human = character.human;
  if (
    !human?.params.posture ||
    human.params.style.handProp !== "Painted folding fan" ||
    human.params.style.cast ||
    character.view.outfit === "Anatomy" ||
    character.view.outfit === "Pressure suit" ||
    human.params.style.outfit === "Pressure suit"
  )
    return;
  const rig = skinCharacter(character, true);
  const changes: Array<(active: boolean) => void> = [];
  const geometries: T.BufferGeometry[] = [];
  try {
    rig.actor.updateMatrixWorld(true);
    character.group.updateMatrixWorld(true);
    const transforms = new Map<string, T.Matrix4>();
    for (const [id, region] of rig.regions) {
      const name = human.bones.get(id),
        joint = region.bones[0];
      if (
        !name ||
        !/^(upperarm|lowerarm|hand|thumb_.+|index_.+|middle_.+|ring_.+|pinky_.+)_r$/.test(name) ||
        !joint
      )
        continue;
      const inverse = rig.skeleton.boneInverses[rig.skeleton.bones.indexOf(joint)];
      if (inverse) transforms.set(name, joint.matrixWorld.clone().multiply(inverse));
    }
    const original = new Map<T.Object3D, T.Matrix4>();
    character.group.traverse((o) => original.set(o, o.matrixWorld.clone()));
    character.group.traverse((object) => {
      const id: unknown = object.userData["partId"];
      const name = typeof id === "string" ? human.bones.get(id) : undefined;
      const turn = name && transforms.get(name),
        bind = original.get(object);
      if (!turn || !bind || !object.parent) return;
      const position = object.position.clone(),
        rotation = object.quaternion.clone(),
        scale = object.scale.clone();
      object.parent.updateWorldMatrix(true, false);
      const posed = object.parent.matrixWorld.clone().invert().multiply(turn).multiply(bind);
      const at = new T.Vector3(),
        q = new T.Quaternion(),
        size = new T.Vector3();
      posed.decompose(at, q, size);
      const apply = (active: boolean) => {
        object.position.copy(active ? at : position);
        object.quaternion.copy(active ? q : rotation);
        object.scale.copy(active ? size : scale);
      };
      apply(true);
      changes.push(apply);
    });
    character.group.updateMatrixWorld(true);
    character.group.traverse((mesh) => {
      if (!isMesh(mesh)) return;
      const weights = human.weights(mesh),
        bind = original.get(mesh);
      if (!weights || !bind) return;
      const local = mesh.matrixWorld.clone().invert(),
        unchanged = local.clone().multiply(bind);
      const palette = weights.names.map((name) => {
        const transform = transforms.get(name);
        return transform && local.clone().multiply(transform).multiply(bind);
      });
      if (!weights.boneIndices.some((bone, i) => palette[bone] && weights.weights[i])) return;
      const source = mesh.geometry,
        posed = source.clone(),
        position = posed.getAttribute("position");
      const p = new T.Vector3(),
        sum = new T.Vector3(),
        temp = new T.Vector3();
      for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i);
        sum.set(0, 0, 0);
        for (let j = 4 * i; j < 4 * i + 4; j++) {
          const w = weights.weights[j] ?? 0;
          if (w)
            sum.addScaledVector(
              temp.copy(p).applyMatrix4(palette[weights.boneIndices[j] ?? 0] ?? unchanged),
              w,
            );
        }
        position.setXYZ(i, sum.x, sum.y, sum.z);
      }
      posed.computeVertexNormals();
      posed.computeBoundingBox();
      posed.computeBoundingSphere();
      geometries.push(posed);
      mesh.geometry = posed;
      changes.push((active) => {
        mesh.geometry = active ? posed : source;
      });
    });
  } finally {
    rig.dispose();
  }
  const show = (active: boolean) => {
    for (const apply of changes) apply(active);
    character.group.updateMatrixWorld(true);
  };
  return {
    show,
    dispose() {
      show(false);
      for (const geometry of geometries) geometry.dispose();
    },
  };
}
