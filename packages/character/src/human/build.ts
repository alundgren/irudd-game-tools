import * as T from "three";
import {
  humanCorrections,
  humanRegionCopy,
  decodeWith,
  finishes,
  canonicalJson,
  type AdultRegionSource,
  type CharacterDocument,
  type Finish,
} from "@irudd/document";
import { isMesh } from "../mesh.js";
import { visibleIn, buildView, type BuildPart, type BuildView } from "../view.js";
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
import { surfaceRegions } from "./draw.js";
import { humanRegions, humanWeightsOf } from "./mesh.js";
import { pullSurface } from "../surfaces/pull.js";
import { familyHolds } from "./wardrobe.js";
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
  donor?: AdultRegionSource,
): BuiltHuman {
  const generation = doc.generation;
  if (!donor && generation?.generator !== humanAdultId)
    throw new Error("This document was not generated as an adult human.");
  if ((donor?.version ?? generation?.version) !== humanAdultVersion)
    throw new Error(
      `This build has no adult human builder version ${donor?.version ?? generation?.version}.`,
    );
  const decoded = decodeWith(HumanAdultParams, donor?.params ?? generation?.params, [
    "generation",
    "params",
  ]);
  if (!decoded.ok) throw new Error(decoded.diagnostics.map((d) => d.message).join(" "));
  const params = decoded.value;
  const view = buildView(doc);
  const bones = new Map<string, BoneName>();
  const colors = new Map<BoneName, string>();
  const regionParts: BuildPart[] = [];
  const sourceKey = donor && canonicalJson(donor);
  for (const part of view.parts) {
    const source = doc.parts.find((p) => p.id === part.id);
    const copied = source && humanRegionCopy.read(source.features);
    if ((copied?.source && canonicalJson(copied.source)) !== sourceKey) continue;
    const slot = copied?.slot ?? source?.slot;
    const bone = slot === undefined ? undefined : humanSlotBone(slot);
    if (!bone && copied) throw new Error("Unknown copied adult region " + copied.slot + ".");
    if (!bone) continue;
    bones.set(part.id, bone);
    if (donor || !copied) colors.set(bone, part.color);
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
  const unregioned = view.parts.find(
    (p) =>
      p.nativePortrait &&
      !doc.parts.some(
        (q) => q.id === p.id && (humanRegionCopy.read(q.features) || humanSlotBone(q.slot ?? "")),
      ),
  );
  if (unregioned)
    throw new Error(
      `A native portrait layer belongs on the adult's head, not ${unregioned.label}.`,
    );
  const grafted = doc.parts.some((p) => humanRegionCopy.read(p.features));
  const member = portrait || donor || grafted ? null : humanWornCast(params, colors.size);
  const uniform =
    params.outfit === "Base layer"
      ? "Running kit"
      : params.outfit === "Pressure suit"
        ? "Pressure suit"
        : undefined;
  const presetName = params.style.outfit;
  const preset =
    uniform ??
    (work &&
    !member &&
    params.style.tailor === undefined &&
    presetName &&
    (isPresetOutfit(presetName) || presetName === "Pressure suit")
      ? presetName
      : undefined);
  const fieldClothes =
    work && !member && params.style.tailor === undefined && !preset ? params.style : undefined;
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
    planes: params.style.facePlanes,
    corrections: donor ? donor.corrections : humanCorrections.read(doc.features),
    studio:
      params.style.faceFamily === "Studio Rain"
        ? {
            hair: params.style.hairColor ?? "#533b30",
            familyHair: params.style.faceFamilyHair !== "Chosen",
          }
        : undefined,
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
    dress: {
      fieldClothes,
      accessories:
        preset === "Pressure suit"
          ? undefined
          : {
              ...params.style,
              hat: familyHolds(params.style, "hat") ? "None" : (params.style.hat ?? "None"),
              earrings: familyHolds(params.style, "earrings")
                ? "None"
                : (params.style.earrings ?? "None"),
              facialHair: familyHolds(params.style, "facialHair")
                ? "None"
                : (params.style.facialHair ?? "None"),
              handProp: params.outfit === "Anatomy" ? "None" : (params.style.handProp ?? "None"),
              waistBag: params.outfit === "Anatomy" ? "None" : (params.style.waistBag ?? "None"),
            },
      tailor:
        !work || params.style.tailor === undefined ? undefined : readTailor(params.style.tailor),
      outfit: preset ? { name: preset, tones: params.style } : undefined,
      hair:
        params.style.faceFamily === "Studio Rain" && params.style.faceFamilyHair !== "Chosen"
          ? undefined
          : {
              hair:
                preset === "Pressure suit" &&
                [
                  "Crown braid",
                  "Rounded bob",
                  "Blunt bob",
                  "Low ponytail",
                  "Long centre part",
                ].includes(params.style.hair ?? "")
                  ? "Crop"
                  : params.style.faceFamily &&
                      params.style.faceFamily !== "None" &&
                      params.style.faceFamilyHair !== "Chosen"
                    ? params.style.faceFamily === "Angular"
                      ? "Layered short"
                      : "Tied bun"
                    : params.style.hair,
              fringe: params.style.fringe,
              hairColor: params.style.hairColor,
            },
      skin: params.skin,
      eyewear: familyHolds(params.style, "eyewear") ? undefined : params.style.eyewear,
      necklace: preset === "Pressure suit" ? "None" : params.style.necklace,
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
    if (part.nativePortrait && paint && !member && params.style.faceFamily !== "Studio Rain") {
      const layer = options.finish?.plates?.image(part.nativePortrait);
      if (!layer) throw new Error(`The native portrait layer ${part.nativePortrait} did not load.`);
      const face = object.children.find((c) => c.userData["faceSurface"] === true);
      if (!face || !isMesh(face)) throw new Error("The adult's head has no painted face.");
      applyNativePortrait(face, layer, paint.sources.raster);
    }
    pullSurface(object, part.pulls, (original) => original.dispose());
    object.visible = visibleIn(view, part);
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
    human: {
      bones,
      regionBounds: new Map(surfaceRegions(regions.cage).map((r) => [r.bone, r.bounds])),
      weights: (mesh) => humanWeightsOf.get(mesh),
      params,
    },
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
