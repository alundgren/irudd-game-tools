import * as T from "three";

/** Narrows to a mesh with Three's default geometry and material types, not `any`. */
export function isMesh(object: T.Object3D): object is T.Mesh {
  return object instanceof T.Mesh;
}
