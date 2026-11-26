import * as T from "three";

export function isMesh(object: T.Object3D): object is T.Mesh {
  return object instanceof T.Mesh;
}

export function isSkinnedMesh(object: T.Object3D): object is T.SkinnedMesh {
  return object instanceof T.SkinnedMesh;
}

export function isTexture(value: unknown): value is T.Texture {
  return value instanceof T.Texture;
}
