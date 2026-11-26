import { LoadingManager, Mesh, Texture, Vector3, type Object3D, type Material } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function isMesh(node: Object3D): node is Mesh {
  return node instanceof Mesh;
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture;
}

export async function referenceGlb(bytes: ArrayBuffer) {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    throw new Error("Use a GLB with its model and textures embedded.");
  });
  const model = await new GLTFLoader(manager).parseAsync(bytes, "");
  const meshes: Mesh[] = [],
    materials = new Set<Material>(),
    textures = new Set<Texture>();
  model.scene.updateMatrixWorld(true);
  model.scene.traverseVisible((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  try {
    const count = meshes.reduce((n, m) => n + m.geometry.getAttribute("position").count, 0);
    if (!count || count > 4_000_000)
      throw new Error("Choose a reference with up to four million vertices.");
    const positions = new Float32Array(count * 3),
      v = new Vector3();
    let offset = 0;
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) {
        mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray(positions, offset);
        offset += 3;
      }
    }
    return positions;
  } finally {
    for (const scene of model.scenes)
      scene.traverse((node) => {
        if (!isMesh(node)) return;
        node.geometry.dispose();
        const list: Material[] = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of list) materials.add(material);
      });
    for (const material of materials) {
      for (const key of Object.keys(material)) {
        const v: unknown = Reflect.get(material, key);
        if (isTexture(v)) textures.add(v);
      }
      material.dispose();
    }
    for (const t of textures) {
      const source: unknown = t.image;
      if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
      t.dispose();
    }
  }
}
