import * as T from "three";

export function isMesh(object: T.Object3D): object is T.Mesh {
  return object instanceof T.Mesh;
}
