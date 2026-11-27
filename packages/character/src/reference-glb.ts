import { LoadingManager, Mesh, Texture, Vector3, type Object3D, type Material } from "three";
import { MeshoptDecoder } from "meshoptimizer";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

function isMesh(node: Object3D): node is Mesh {
  return node instanceof Mesh;
}

function isTexture(value: unknown): value is Texture {
  return value instanceof Texture;
}

export function bakeReference(root: Object3D) {
  const positions: number[] = [],
    indices: number[] = [],
    v = new Vector3();
  let meshes = 0;
  root.updateMatrixWorld(true);
  root.traverseVisible((mesh) => {
    if (!isMesh(mesh)) return;
    const p = mesh.geometry.getAttribute("position");
    if (!p) return;
    const base = positions.length / 3,
      index = mesh.geometry.index;
    const n = index?.count ?? p.count;
    if (indices.length + n > 2250000)
      throw new Error("Choose a reference with at most 750,000 triangles.");
    if (base + p.count > 4000000)
      throw new Error("Choose a reference with up to four million vertices.");
    for (let i = 0; i < p.count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }
    const order = mesh.matrixWorld.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    for (let i = 0; i + 2 < n; i += 3)
      for (const k of order) indices.push(base + (index ? index.getX(i + k) : i + k));
    meshes++;
  });
  if (!indices.length) throw new Error("This file has no triangle surface.");
  if (!positions.every(Number.isFinite))
    throw new Error("The reference contains invalid coordinates.");
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), meshes };
}

export async function referenceGlb(bytes: ArrayBuffer) {
  return withReference(bytes, (root) => {
    const meshes: Mesh[] = [];
    root.updateMatrixWorld(true);
    root.traverseVisible((node) => {
      if (isMesh(node) && node.geometry.hasAttribute("position")) meshes.push(node);
    });
    const count = meshes.reduce((sum, m) => sum + m.geometry.getAttribute("position").count, 0);
    if (!count || count > 4_000_000)
      throw new Error("Choose a reference with up to four million vertices.");
    const positions = new Float32Array(count * 3),
      p = new Vector3();
    let offset = 0;
    for (const mesh of meshes)
      for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) {
        mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld).toArray(positions, offset);
        offset += 3;
      }
    if (!positions.every(Number.isFinite))
      throw new Error("The reference contains invalid coordinates.");
    return positions;
  });
}

export function readReferenceMesh(bytes: ArrayBuffer) {
  return withReference(bytes, (root, credit) => ({ ...bakeReference(root), credit }));
}

async function withReference<T>(bytes: ArrayBuffer, read: (root: Object3D, credit: string) => T) {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith("blob:") || url.startsWith("data:")) return url;
    throw new Error("Use a GLB with its model and textures embedded.");
  });
  const model = await new GLTFLoader(manager)
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes, "");
  const materials = new Set<Material>(),
    textures = new Set<Texture>();
  try {
    return read(
      model.scene,
      typeof model.asset.copyright === "string" ? model.asset.copyright : "",
    );
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
