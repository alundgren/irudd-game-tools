import * as T from "three";
import { decodeWith, finishes, type CharacterDocument, type Finish } from "@irudd/document";
import { isMesh } from "../mesh.js";
import { buildView, type BuildPart, type BuildView } from "../view.js";
import type { HumanBody } from "./body.js";
import { boneNames, type BoneName } from "./catalogue.js";
import {
  HumanAdultParams,
  humanAdultId,
  humanAdultVersion,
  humanMeasurements,
  humanSlotBone,
  humanWornCast,
} from "./generator.js";
import { complexionLook, type HumanPaintSources } from "./complexion.js";
import { browParting } from "./scars.js";
import { fittedBrow } from "./strands.js";
import { humanRegions, humanWeightsOf } from "./mesh.js";
import { readTailor } from "./dress/tailor-data.js";
import type { HumanBuild } from "./binding.js";
import { isPresetOutfit } from "./dress/outfit-names.js";
import { applyNativePortrait } from "./native-portrait.js";
import type { PortraitPlates } from "../paint/portrait.js";

export type { HumanBuild } from "./binding.js";

export interface HumanBuildOptions {
  readonly materials: (color: string, finish: Finish) => T.Material;
  readonly finish?: { readonly plates?: PortraitPlates | undefined } | undefined;
  readonly humanPaint?: HumanPaintSources | undefined;
  readonly game?: boolean | undefined;
}

export interface BuiltHuman {
  readonly view: BuildView;
  readonly group: T.Group;
  readonly parts: ReadonlyMap<
    string,
    { readonly part: BuildPart; readonly object: T.Object3D; readonly mount: T.Object3D }
  >;
  readonly warp: undefined;
  readonly blendOwners: ReadonlyMap<T.Mesh, never>;
  readonly hands: ReadonlyMap<T.Mesh, never>;
  readonly faces: ReadonlyMap<T.Mesh, never>;
  readonly human: HumanBuild;
  dispose(): void;
}

export function isHumanDocument(doc: CharacterDocument): boolean {
  return doc.generation?.generator === humanAdultId;
}

const roles: Readonly<Record<string, BuildPart["motion"]>> = {
  upperarm: "upper arm",
  lowerarm: "forearm",
  hand: "hand",
  thigh: "thigh",
  calf: "shin",
  foot: "foot",
  head: "head",
  spine_03: "torso",
};
export const humanRole = (bone: BoneName): NonNullable<BuildPart["motion"]> =>
  roles[bone.replace(/_[lr]$/, "")] ?? "rigid";

export function buildHuman(
  doc: CharacterDocument,
  body: HumanBody,
  options: HumanBuildOptions,
): BuiltHuman {
  const generation = doc.generation;
  if (!generation || generation.generator !== humanAdultId)
    throw new Error("This document was not generated as an adult human.");
  if (generation.version !== humanAdultVersion)
    throw new Error(`This build has no adult human builder version ${generation.version}.`);
  const decoded = decodeWith(HumanAdultParams, generation.params, ["generation", "params"]);
  if (!decoded.ok) throw new Error(decoded.diagnostics.map((d) => d.message).join(" "));
  const params = decoded.value;
  const view = buildView(doc);
  const bones = new Map<string, BoneName>();
  const colors = new Map<BoneName, string>();
  const regionParts: BuildPart[] = [];
  for (const part of view.parts) {
    const slot = doc.parts.find((p) => p.id === part.id)?.slot;
    const bone = slot === undefined ? undefined : humanSlotBone(slot);
    if (!bone || colors.has(bone)) continue;
    bones.set(part.id, bone);
    colors.set(bone, part.color);
    regionParts.push({ ...part, motion: humanRole(bone) });
  }
  const order = (p: BuildPart) => boneNames.indexOf(bones.get(p.id) ?? "head");
  regionParts.sort((a, b) => order(a) - order(b));
  const measurements = humanMeasurements(params);
  const brow = fittedBrow(params.style.browStyle, measurements["brow"] ?? 0);
  const plain = !options.finish;
  if (!plain && !options.humanPaint)
    throw new Error("The textured presets need the adult's prepared paint.");
  const paint =
    plain || !options.humanPaint
      ? null
      : {
          sources: options.humanPaint,
          look: complexionLook(params, brow),
          seed: params.seed >>> 0,
          eyeColor: params.eyeColor,
          complexion: params.complexion,
          browStyle: params.style.browStyle,
          marks: params.faceMarks ?? [],
          armInk: params.style.armInk,
        };
  const finishNames: ReadonlyArray<string> = finishes;
  const isFinish = (type: string): type is Finish => finishNames.includes(type);
  const typed = new Map<string, T.Material>();
  const dressMaterial = (color: string, type: string): T.Material => {
    if (plain || type === "plain") return options.materials(color, "plain");
    if (isFinish(type)) return options.materials(color, type);
    const key = color + type;
    let found = typed.get(key);
    if (!found) typed.set(key, (found = options.materials(color, "plain").clone()));
    return found;
  };
  const work = params.outfit === "Work clothes";
  const portrait = regionParts.find((p) => p.nativePortrait);
  if (portrait && bones.get(portrait.id) !== "head")
    throw new Error(`A native portrait layer belongs on the adult's head, not ${portrait.label}.`);
  const unregioned = view.parts.find((p) => p.nativePortrait && !bones.has(p.id));
  if (unregioned)
    throw new Error(
      `A native portrait layer belongs on the adult's head, not ${unregioned.label}.`,
    );
  const member = portrait ? null : humanWornCast(params, regionParts.length);
  const presetName = params.style.outfit;
  const preset =
    work && !member && params.style.tailor === undefined && presetName && isPresetOutfit(presetName)
      ? presetName
      : undefined;
  if (work && !member && params.style.tailor === undefined && !preset)
    throw new Error(
      "Work clothes need a tailored or preset outfit or a worn cast member; the default field jacket and denim is not built yet.",
    );
  const cast = member
    ? {
        name: member,
        skin: params.style.castSkin,
        eyeColor: params.eyeColor,
        style: params.style,
      }
    : undefined;
  const regions = humanRegions(body, measurements, (bone) => colors.get(bone) ?? params.skin, {
    material: (color) => options.materials(color, "plain"),
    dressMaterial,
    plain,
    game: options.game === true,
    face: {
      skin: params.skin,
      age: measurements["age"] ?? 0,
      frame: measurements["frame"] ?? 0,
      brow,
      parted: browParting(body, params.faceMarks ?? [], brow),
    },
    height: measurements["height"] ?? 1.72,
    paint,
    cast,
    dress:
      params.outfit === "Anatomy"
        ? undefined
        : {
            tailor:
              !work || params.style.tailor === undefined
                ? undefined
                : readTailor(params.style.tailor),
            outfit: preset ? { name: preset, tones: params.style } : undefined,
            hair: {
              hair: params.style.hair,
              fringe: params.style.fringe,
              hairColor: params.style.hairColor,
            },
            skin: params.skin,
            eyewear: params.style.eyewear,
            necklace: params.style.necklace,
            clothAccent: params.style.clothAccent,
            clothDesign: params.style.clothDesign,
            secondDesign: params.style.secondDesign,
            metalColor: params.style.metalColor,
          },
  });
  const group = new T.Group();
  const built = new Map<
    string,
    { readonly part: BuildPart; readonly object: T.Object3D; readonly mount: T.Object3D }
  >();
  for (const part of regionParts) {
    const bone = bones.get(part.id);
    if (!bone) continue;
    const object = regions.region(bone);
    if (part.nativePortrait && paint) {
      const layer = options.finish?.plates?.image(part.nativePortrait);
      if (!layer) throw new Error(`The native portrait layer ${part.nativePortrait} did not load.`);
      const face = object.children.find((c) => c.userData["faceSurface"] === true);
      if (!face || !isMesh(face)) throw new Error("The adult's head has no painted face.");
      applyNativePortrait(face, layer, paint.sources.raster);
    }
    object.name = part.label;
    object.position.fromArray(part.position);
    object.scale.fromArray(part.size);
    object.quaternion.fromArray(part.rotation);
    object.userData["partId"] = part.id;
    built.set(part.id, { part, object, mount: object });
  }
  for (const { part, object } of built.values())
    ((part.parent === null ? undefined : built.get(part.parent)?.mount) ?? group).add(object);
  group.traverse((node) => {
    if (isMesh(node)) node.receiveShadow = true;
  });
  const byId = new Map(regionParts.map((p) => [p.id, p]));
  return {
    view: { ...view, parts: regionParts, byId },
    group,
    parts: built,
    warp: undefined,
    blendOwners: new Map<T.Mesh, never>(),
    hands: new Map<T.Mesh, never>(),
    faces: new Map<T.Mesh, never>(),
    human: { bones, weights: (mesh) => humanWeightsOf.get(mesh), params },
    dispose() {
      const materials = new Set<T.Material>();
      group.traverse((node) => {
        if (!isMesh(node)) return;
        node.geometry.dispose();
        const material: T.Material | T.Material[] = node.material;
        for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
      });
      for (const m of materials) m.dispose();
    },
  };
}
