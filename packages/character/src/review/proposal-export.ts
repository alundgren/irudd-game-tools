import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  decodeWith,
  motionRole,
  outfitWear,
  outfitWardrobe,
  type CharacterDocument,
} from "@irudd/document";
import { buildCharacter, clayMaterials } from "../build.js";
import { exportCharacter, type ExportOptions } from "../export.js";
import { HumanAdultParams } from "../human/generator.js";
import { inspectGlb } from "../inspect.js";
import { isMesh } from "../mesh.js";
import { skinCharacter } from "../rig/skin.js";
import { coverageMask } from "./coverage.js";
import { renderGameExport, type GameInspection } from "./exports.js";

const isTexture = (value: unknown): value is T.Texture => value instanceof T.Texture;
export { compareExportViews, type GameInspection } from "./exports.js";

export async function inspectProposalExport(
  document: CharacterDocument,
  options: ExportOptions,
  previous?: GameInspection,
) {
  const native = document.generation?.generator === "irudd.human-adult";
  const params = native && decodeWith(HumanAdultParams, document.generation?.params);
  const attire =
    (params && params.ok ? params.value.outfit : outfitWardrobe.read(document.features)?.outfit) ??
    "Anatomy";
  const parts = document.parts.map((p) => ({ label: p.label, wear: outfitWear.read(p.features) }));
  const garments =
    native || (parts.some((p) => p.wear?.bare) && parts.some((p) => p.wear?.visibleIn));
  const { bytes } = await exportCharacter(document, {
    ...options,
    preset: "game",
    coverage: native,
  });
  const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer, "");
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(512, 512, false);
  let full, rig;
  try {
    if (native && attire !== "Anatomy") {
      full = buildCharacter(document, { materials: clayMaterials(), human: options.human });
      rig = skinCharacter(full, false, true);
    }
    const mask = (model: T.Object3D) => {
      if (!garments) return null;
      const attr = native ? "_coverage" : "_region";
      let names: string[] | undefined;
      model.traverse((node) => {
        if (!isMesh(node) || names || !node.geometry.getAttribute(attr)) return;
        const value: unknown = node.userData[native ? "coverageNames" : "regionNames"];
        if (Array.isArray(value) && value.every((v: unknown): v is string => typeof v === "string"))
          names = value;
      });
      if (!names) return null;
      return coverageMask(
        attr,
        names.map((name, index) => {
          if (native) return { name, bare: index === 1, outer: index >= 2 };
          const wear = parts.find((p) => p.label === name)?.wear;
          return {
            name,
            bare: !!wear?.bare,
            outer: !wear?.bare && !!wear?.visibleIn?.includes(attire),
          };
        }),
      );
    };
    return renderGameExport(
      gltf,
      inspectGlb(bytes).triangles,
      document.parts.some((p) =>
        (motionRole.read(p.features)?.role ?? outfitWear.read(p.features)?.role ?? "").includes(
          "arm",
        ),
      ),
      renderer,
      mask,
      rig,
      previous,
    );
  } finally {
    rig?.dispose();
    full?.dispose();
    const textures = new Set<T.Texture>();
    for (const scene of gltf.scenes)
      scene.traverse((node) => {
        if (!isMesh(node)) return;
        node.geometry.dispose();
        if (node instanceof T.SkinnedMesh) node.skeleton.dispose();
        const materialList: unknown = node.material;
        const materials: readonly unknown[] = Array.isArray(materialList)
          ? materialList
          : [materialList];
        for (const material of materials) {
          if (!(material instanceof T.Material)) continue;
          for (const value of Object.values(material)) if (isTexture(value)) textures.add(value);
          material.dispose();
        }
      });
    for (const tex of textures) {
      tex.dispose();
      if (tex.source.data instanceof ImageBitmap) tex.source.data.close();
    }
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
