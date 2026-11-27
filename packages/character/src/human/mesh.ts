import { applyFacePlanes } from "./face-planes.js";
import { fittedHeadwear } from "./dress/headwear.js";
import { correctedSurface } from "./brush.js";
import { applyHeadLayer } from "./fine-head.js";
import type { FineHeadLayer, SkinCorrections } from "@irudd/document";
import { skinMeshData } from "./brush-preview.js";
import { finishStudioSkin } from "./studio-skin.js";
import { studioFit, studioAccessoryFit } from "./studio-fit.js";
import { studioMeshes, studioCollar } from "./studio.js";
import * as T from "three";
import {
  faceAnatomyFields,
  facialMorphNormals,
  refineExpressions,
  refineFaceForm,
} from "./anatomy.js";
import type { HumanBody } from "./body.js";
import { capturedSkinNames } from "./captured.js";
import { boneNames, capturedAxes, type BoneName } from "./catalogue.js";
import {
  faceMaterial,
  fitFaceLayout,
  skinMaterial,
  type ComplexionLook,
  type HumanPaintSources,
} from "./complexion.js";
import { irisSwatch, defaultEyeColor, eyeRoughnessTexture, eyeTexture } from "./eye-paint.js";
import { eyeBalls, humanEyes } from "./eyes.js";
import { followGaze } from "./gaze.js";
import { armInkBones, armInkChart, inkedSkin, type ArmInkChart } from "./arm-ink.js";
import { markFace } from "./mark-paint.js";
import type { FaceMark } from "./marks.js";
import { mouthInterior, mouthLining } from "./mouth.js";
import { skinShade } from "./skin-tone.js";
import { browsAndLashes, strandColours } from "./strands.js";
import { finishCloth } from "./dress/cloth-finish.js";
import { fitHairUnderHat } from "./dress/hat-fit.js";
import { fittedAccessories, type AccessoryStyle } from "./dress/accessories.js";
import { fittedEyewear } from "./dress/eyewear.js";
import { bakeGameFolds } from "./dress/fold-bake.js";
import { fittedHair, type HairStyle } from "./dress/hair.js";
import { fittedNecklace } from "./dress/necklace.js";
import { tailorHuman, type Tailor } from "./dress/tailor.js";
import type { OutfitPattern } from "./dress/outfit-names.js";
import { fieldClothes } from "./dress/field-clothes.js";
import { dressPreset, type OutfitTones } from "./dress/outfits.js";
import { isGrownHairStyle, strandGroom } from "./dress/strand-groom.js";
import { gameTriangleTarget } from "../game/optimize.js";
import type { BrowName } from "./body.js";
import type { CastFigureName } from "./cast-data.js";
import { castMeshes, type CastStyle } from "./cast-figure.js";
import type { ClothJoints } from "./cloth-joints.js";
import { smoothHumanSurface, skinBoneCorners, type SmoothSurface } from "./smooth.js";
import {
  evaluateHuman,
  expressionDisplacements,
  type HumanMeasurements,
  type HumanSurface,
} from "./surface.js";

export interface HumanWeights {
  readonly boneIndices: ReadonlyArray<number>;
  readonly weights: ReadonlyArray<number>;
  readonly names: ReadonlyArray<string>;
  readonly clothJoints?: ClothJoints | undefined;
}

export const humanWeightsOf = new WeakMap<T.Object3D, HumanWeights>();
const skinVertices = new WeakMap<T.Object3D, ReadonlyArray<number>>();

interface Piece {
  readonly geometry: T.BufferGeometry;
  readonly vertexIds: number[];
  readonly humanWeights: HumanWeights;
}

function geometry(
  surface: SmoothSurface,
  corners: ReadonlyArray<number>,
  normals: ArrayLike<number>,
  origin: readonly [number, number, number],
  joined: Uint8Array | null,
  tint: { readonly shade: Float32Array; readonly paintedLips: boolean } | null,
  chart: ArmInkChart | null,
): Piece {
  const here = new Map<number, number>(),
    positions: number[] = [],
    normal: number[] = [],
    uv: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    boneIndices: number[] = [],
    weights: number[] = [],
    vertexIds: number[] = [],
    anchors: number[] = [];
  let seam = false;
  const coordinates = new Map<number, readonly [number, number]>();
  const inkUV = (v: number, at: ArmInkChart) => {
    let found = coordinates.get(v);
    if (!found) coordinates.set(v, (found = at(v)));
    return found;
  };
  for (let c = 0; c < corners.length; c++) {
    const corner = corners[c] ?? 0;
    if (chart && c % 3 === 0) {
      const a = inkUV(surface.indices[corner] ?? 0, chart)[0];
      const b = inkUV(surface.indices[corners[c + 1] ?? 0] ?? 0, chart)[0];
      const d = inkUV(surface.indices[corners[c + 2] ?? 0] ?? 0, chart)[0];
      seam = Math.max(a, b, d) - Math.min(a, b, d) > 0.5;
    }
    const v = surface.indices[corner] ?? 0,
      tex = surface.uvFaces[corner] ?? 0,
      key = seam ? -1 - v * 65536 - tex : v * 65536 + tex;
    let at = here.get(key);
    if (at === undefined) {
      at = positions.length / 3;
      here.set(key, at);
      vertexIds.push(v);
      anchors.push(joined?.[v] ?? 0);
      positions.push(
        (surface.positions[v * 3] ?? 0) - origin[0],
        (surface.positions[v * 3 + 1] ?? 0) - origin[1],
        (surface.positions[v * 3 + 2] ?? 0) - origin[2],
      );
      normal.push(normals[v * 3] ?? 0, normals[v * 3 + 1] ?? 0, normals[v * 3 + 2] ?? 0);
      if (chart) {
        const [u, h] = inkUV(v, chart);
        uv.push(seam ? 0 : u, h);
      } else uv.push((surface.uv[tex * 2] ?? 0) / 65535, (surface.uv[tex * 2 + 1] ?? 0) / 65535);
      if (tint) {
        const p = surface.pigments,
          lipZone = p[tex * 4] ?? 0,
          lid = p[tex * 4 + 1] ?? 0,
          mouth = p[tex * 4 + 2] ?? 0,
          nail = p[tex * 4 + 3] ?? 0;
        const lip = lipZone * (tint.paintedLips ? 0.22 : 1);
        const r = tint.shade[v * 3] ?? 1,
          g = tint.shade[v * 3 + 1] ?? 1,
          b = tint.shade[v * 3 + 2] ?? 1;
        colors.push(
          r * (1 - (0.48 * mouth) / 255) * (1 - (0.05 * lip) / 255),
          g * (1 - (0.32 * lip) / 255) * (1 - (0.68 * mouth) / 255) * (1 - (0.08 * lid) / 255),
          b * ((1 - (0.23 * lip) / 255) * (1 - (0.63 * mouth) / 255) + (0.06 * nail) / 255),
        );
      }
      for (let j = 0; j < 4; j++) {
        boneIndices.push(surface.boneIndices[v * 4 + j] ?? 0);
        weights.push(surface.weights[v * 4 + j] ?? 0);
      }
    }
    indices.push(at);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(normal, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  if (tint) g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  if (joined) g.setAttribute("lodAnchor", new T.Uint8BufferAttribute(anchors, 1));
  g.setIndex(indices);
  return { geometry: g, vertexIds, humanWeights: { boneIndices, weights, names: boneNames } };
}

export interface HumanRegions {
  readonly cage: HumanSurface;
  readonly surface: SmoothSurface;
  region(bone: BoneName): T.Group;
}

export interface HumanRegionOptions {
  readonly planes?: string | undefined;
  readonly fineHead?: FineHeadLayer | undefined;
  readonly corrections?: SkinCorrections | undefined;
  readonly studio?: { hair: string; familyHair: boolean } | undefined;
  readonly material: (color: string) => T.Material;
  readonly dressMaterial?: (color: string, type: string) => T.Material;
  readonly plain: boolean;
  readonly game?: boolean | undefined;
  readonly face: {
    readonly skin: string;
    readonly age: number;
    readonly frame: number;
    readonly brow: BrowName;
    readonly parted: Uint8Array | null;
  };
  readonly height: number;
  readonly paint: TexturedAdult | null;
  readonly dress?: HumanDress | undefined;
  readonly cast?: WornCast | undefined;
}

export interface WornCast {
  readonly name: CastFigureName;
  readonly skin: string | undefined;
  readonly eyeColor: string | undefined;
  readonly style: CastStyle;
}

export interface HumanDress {
  readonly fieldClothes?: OutfitTones | undefined;
  readonly accessories?: AccessoryStyle | undefined;
  readonly tailor?: Tailor | undefined;
  readonly outfit?: { readonly name: OutfitPattern; readonly tones: OutfitTones } | undefined;
  readonly hair?: HairStyle | undefined;
  readonly skin?: string | undefined;
  readonly eyewear?: string | undefined;
  readonly necklace?: string | undefined;
  readonly clothAccent?: string | undefined;
  readonly metalColor?: string | undefined;
  readonly clothDesign?: string | undefined;
  readonly secondDesign?: string | undefined;
}

interface Worn {
  readonly mesh: T.Mesh;
  readonly region: string;
  readonly skin?: {
    readonly boneIndices: ArrayLike<number>;
    readonly weights: ArrayLike<number>;
    readonly clothJoints?: ClothJoints | undefined;
  };
}

function dressed(
  body: HumanBody,
  cage: HumanSurface,
  dress: HumanDress | undefined,
  options: HumanRegionOptions,
): { readonly worn: ReadonlyArray<Worn>; readonly hidden: ReadonlySet<number> } {
  if (!dress) return { worn: [], hidden: new Set() };
  const material = (tone: string, type = "plain") =>
    options.dressMaterial?.(tone, type) ?? options.material(tone);
  const finish =
    options.plain || !options.paint
      ? undefined
      : {
          raster: options.paint.sources.raster,
          style: { ...dress, brocade: body.brocade },
          devices: body.devices,
        };
  const tailored = dress.tailor ? tailorHuman(cage, dress.tailor, material, finish) : null;
  const preset =
    !tailored && dress.outfit
      ? dressPreset(
          cage,
          dress.outfit.name,
          dress.outfit.tones,
          (tone, type) => material(tone, type),
          finish
            ? {
                raster: finish.raster,
                cloth: (mesh, m) =>
                  finishCloth(
                    finish.raster,
                    mesh,
                    dress.outfit?.name ?? "",
                    { ...dress, ...dress.outfit?.tones, brocade: body.brocade },
                    m,
                  ),
              }
            : undefined,
        )
      : null;
  const field = dress.fieldClothes
    ? fieldClothes(body, cage, dress.fieldClothes, material, options.plain)
    : undefined;
  const packedHair = fittedHeadwear(
    body,
    cage,
    dress.hair?.hair === "Ribbon ponytail" ? undefined : dress.hair?.hair,
    dress.hair?.hairColor ?? "#51433b",
    "hair",
    material,
    options.plain,
    dress.hair?.fringe,
  );
  const hair =
    dress.hair && dress.hair.hair !== "Ribbon ponytail" && !packedHair.length
      ? fittedHair(
          cage,
          dress.hair,
          body.grooms,
          body.arrays.f32("base"),
          material,
          options.plain,
          options.game === true,
          options.paint
            ? { raster: options.paint.sources.raster, maps: options.paint.sources.grooms }
            : undefined,
        )
      : null;
  const grownName = dress.hair?.hair;
  const grown =
    dress.hair && isGrownHairStyle(grownName)
      ? strandGroom(
          body,
          cage,
          { ...dress.hair, hair: grownName },
          material,
          options.plain || !options.paint
            ? null
            : {
                raster: options.paint.sources.raster,
                buzz: options.paint.sources.paint.buzz,
                sweptTone: options.paint.sources.paint.sweptTone,
              },
          dress.skin ?? "#96735d",
          options.game ? Math.floor(0.4 * gameTriangleTarget) : 0,
        )
      : [];
  const raster = options.paint?.sources.raster;
  const garments =
    options.game && !options.plain && raster
      ? [...(tailored?.meshes ?? []), ...(preset?.meshes ?? [])].map((piece) =>
          bakeGameFolds(raster, piece),
        )
      : [...(tailored?.meshes ?? []), ...(preset?.meshes ?? [])];
  const clothes = [...garments.map((m) => m.mesh), ...(field?.meshes.map((m) => m.mesh) ?? [])];
  const skinned = (m: {
    readonly mesh: T.Mesh;
    readonly region: string;
    readonly boneIndices: ArrayLike<number>;
    readonly weights: ArrayLike<number>;
    readonly clothJoints?: ClothJoints | undefined;
  }): Worn => ({
    mesh: m.mesh,
    region: m.region,
    skin: { boneIndices: m.boneIndices, weights: m.weights, clothJoints: m.clothJoints },
  });
  fitHairUnderHat(cage, dress.accessories?.hat, dress.hair?.hair, [
    ...packedHair.map((p) => p.mesh),
    ...(hair ? [hair.cards, hair.roots.mesh] : []),
    ...grown.map((p) => p.mesh),
  ]);
  const worn: Worn[] = [
    ...packedHair,
    ...fittedAccessories(body, cage, dress.accessories, material, options.plain, clothes, raster),
    ...garments.map(skinned),
    ...(field?.meshes ?? []),
    ...(hair ? [{ mesh: hair.cards, region: "head" }, skinned(hair.roots)] : []),
    ...grown.map(skinned),
    ...fittedEyewear(cage, dress.eyewear, material, options.plain).map((mesh) => ({
      mesh,
      region: "head",
    })),
    ...fittedNecklace(cage, dress, clothes, material, options.plain).map(skinned),
  ];
  const hidden = new Set([
    ...(tailored?.hidden ?? []),
    ...(preset?.hidden ?? []),
    ...(field?.hidden ?? []),
  ]);
  for (const v of hair?.hide ?? []) hidden.add(v);
  return { worn, hidden };
}

export interface TexturedAdult {
  readonly sources: HumanPaintSources;
  readonly look: ComplexionLook;
  readonly seed: number;
  readonly eyeColor: string | undefined;
  readonly complexion: string | undefined;
  readonly browStyle: string | undefined;
  readonly marks: ReadonlyArray<FaceMark>;
  readonly armInk: string | undefined;
}

const triple = (a: ArrayLike<number>, k: number): readonly [number, number, number] => [
  a[k] ?? 0,
  a[k + 1] ?? 0,
  a[k + 2] ?? 0,
];

export function humanRegions(
  body: HumanBody,
  measurements: HumanMeasurements,
  color: (bone: BoneName) => string,
  options: HumanRegionOptions,
): HumanRegions {
  const bare = evaluateHuman(body, measurements);
  const cage = applyHeadLayer(
    body,
    correctedSurface(body, bare, options.corrections),
    options.fineHead,
  );
  const s = refineFaceForm(body, smoothHumanSurface(body, cage));
  const member = options.cast;
  if (member)
    return {
      cage,
      surface: s,
      region(bone) {
        const group = new T.Group();
        if (bone !== "head") return group;
        const origin = triple(s.joints, boneNames.indexOf(bone) * 3);
        const paint = options.paint;
        for (const piece of castMeshes(
          body.cast,
          member.name,
          s,
          origin,
          options.material,
          member.skin ?? color(bone),
          member.style,
          member.eyeColor,
          paint ? { raster: paint.sources.raster, paint: paint.sources.paint } : null,
        )) {
          humanWeightsOf.set(piece.mesh, {
            boneIndices: Array.from(piece.weights.boneIndices),
            weights: Array.from(piece.weights.weights),
            names: boneNames,
            clothJoints: piece.clothJoints,
          });
          group.add(piece.mesh);
        }
        return group;
      },
    };
  const full = new T.BufferGeometry();
  full.setAttribute("position", new T.BufferAttribute(s.positions, 3));
  full.setIndex(new T.BufferAttribute(s.indices, 1));
  full.computeVertexNormals();
  const normals = full.getAttribute("normal").array;
  const ribbon = options.dress?.hair?.hair === "Ribbon ponytail";
  const studio = options.studio || ribbon ? studioFit(body, s) : undefined;
  const adjustAccessory =
    studio && options.studio && !options.studio.familyHair ? studioAccessoryFit(studio) : undefined;
  const { worn, hidden } = dressed(body, cage, options.dress, options);
  const skip = new Set<number>();
  if (hidden.size)
    for (let j = 0; j < s.quadIds.length; j += 4)
      if ([0, 1, 2, 3].every((k) => hidden.has(cage.ids[s.quadIds[j + k] ?? 0] ?? -1)))
        skip.add(j / 4);
  const bins = skinBoneCorners(s, skip);
  const headBin = boneNames.indexOf("head"),
    joined = new Uint8Array(s.positions.length / 3),
    onHead = new Uint8Array(joined.length);
  for (const c of bins[headBin] ?? []) onHead[s.indices[c] ?? 0] = 1;
  bins.forEach((bin, k) => {
    if (k !== headBin)
      for (const c of bin) {
        const v = s.indices[c] ?? 0;
        if (onHead[v]) joined[v] = 1;
      }
  });
  const { lidAnchors, shade: faceShade } = faceAnatomyFields(body);
  for (let v = 0; v < joined.length; v++) if (lidAnchors[v]) joined[v] = 1;
  const paint = options.paint;
  const bodySkins = new Map<string, T.MeshStandardMaterial>(),
    inkedSkins = new Map<string, T.MeshStandardMaterial>(),
    shades = new Map<string, Float32Array>();
  const inkBones = paint ? armInkBones(paint.armInk) : [];
  const inkCharts = new Map<string, ArmInkChart>();
  const shadeOf = (colour: string, sources: HumanPaintSources) => {
    let found = shades.get(colour);
    if (!found)
      shades.set(colour, (found = skinShade(s, normals, new T.Color(colour), sources.paint)));
    return found;
  };
  const regions: HumanRegions = {
    cage,
    surface: s,
    region(bone) {
      const k = boneNames.indexOf(bone),
        group = new T.Group(),
        origin = triple(s.joints, k * 3);
      const corners = bins[k] ?? [];
      if (bone === "head" && options.studio && studio) {
        for (const mesh of studioMeshes(
          body,
          studio,
          origin,
          color(bone),
          options.studio.hair,
          options.studio.familyHair || ribbon,
          options.plain,
          paint &&
            irisSwatch(
              paint.sources.paint,
              paint.eyeColor ?? defaultEyeColor(color(bone), paint.seed),
            ),
        )) {
          const n = mesh.geometry.getAttribute("position").count;
          humanWeightsOf.set(mesh, {
            boneIndices: Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? k : 0)),
            weights: Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
            names: boneNames,
          });
          group.add(mesh);
          if (mesh.userData["faceSurface"]) {
            humanWeightsOf.set(
              mesh,
              finishStudioSkin(
                body,
                studio,
                s,
                mesh.geometry,
                normals,
                paint ? shadeOf(color(bone), paint.sources) : undefined,
              ),
            );
            mesh.updateMorphTargets();
            const collar = studioCollar(body, s, corners, origin, mesh, k, normals);
            if (collar) {
              humanWeightsOf.set(collar.mesh, {
                boneIndices: collar.bones,
                weights: collar.weights,
                names: boneNames,
              });
              group.add(collar.mesh);
            }
          }
        }
      } else if (corners.length) {
        const ink = paint !== null && inkBones.includes(bone);
        const chartKey = ink ? (bone.endsWith("_r") ? "r" : "l") : null;
        if (paint && chartKey && !inkCharts.has(chartKey))
          inkCharts.set(chartKey, armInkChart(s, bone, paint.armInk ?? ""));
        const base = options.material(color(bone));
        let skin = base;
        if (paint && base instanceof T.MeshStandardMaterial) {
          if (bone === "head")
            skin = markFace(
              faceMaterial(base, body, paint.sources, paint.look),
              paint.sources.raster,
              body,
              paint.marks,
              paint.look.brow,
            );
          else {
            let found = bodySkins.get(color(bone));
            if (!found)
              bodySkins.set(color(bone), (found = skinMaterial(base, paint.sources, paint.look)));
            skin = found;
            if (ink) {
              const inkKey = `${color(bone)}|${chartKey}`;
              let inked = inkedSkins.get(inkKey);
              if (!inked)
                inkedSkins.set(
                  inkKey,
                  (inked = inkedSkin(found, paint.sources.raster, paint.armInk, paint.seed)),
                );
              skin = inked;
            }
          }
        }
        const piece = geometry(
          s,
          corners,
          normals,
          origin,
          joined,
          paint
            ? {
                shade: shadeOf(color(bone), paint.sources),
                paintedLips: skin.userData["paintedLips"] === true,
              }
            : null,
          chartKey ? (inkCharts.get(chartKey) ?? null) : null,
        );
        if (bone === "head" && options.planes)
          applyFacePlanes(piece.geometry, cage, origin, options.planes, !options.plain);
        if (bone === "head" && paint) {
          const colour = piece.geometry.getAttribute("color");
          for (let i = 0; i < piece.vertexIds.length; i++) {
            const dark = faceShade[piece.vertexIds[i] ?? 0];
            if (!dark) continue;
            colour.setXYZ(
              i,
              colour.getX(i) * (1 - 0.86 * dark),
              colour.getY(i) * (1 - dark),
              colour.getZ(i) * (1 - dark),
            );
          }
        }
        const mesh = new T.Mesh(piece.geometry, skin);
        skinMeshData.set(mesh, {
          body,
          bare,
          fineHead: options.fineHead,
          cage,
          surface: s,
          origin,
          corners,
          vertices: piece.vertexIds,
        });
        if (paint) skin.vertexColors = true;
        humanWeightsOf.set(mesh, piece.humanWeights);
        if (bone === "head") {
          const g = piece.geometry;
          g.morphTargetsRelative = true;
          g.morphAttributes["position"] = (["Blink", "Smile", "BrowLift"] as const).map((name) => {
            const deltas = expressionDisplacements(body, name, true, cage),
              values = new Float32Array(piece.vertexIds.length * 3);
            for (const [i, v] of piece.vertexIds.entries())
              for (let d = 0; d < 3; d++)
                values[i * 3 + d] = ((deltas[v * 3 + d] ?? 0) * s.height) / 1.72;
            const attr = new T.BufferAttribute(values, 3);
            attr.name = name;
            return attr;
          });
          refineExpressions(body, g, piece.vertexIds, s.height / 1.72);
          facialMorphNormals(g, piece.vertexIds);
          mesh.updateMorphTargets();
          mesh.userData["faceSurface"] = true;
          mesh.userData["fittedEyes"] = true;
          skinVertices.set(mesh, piece.vertexIds);
        }
        mesh.castShadow = true;
        group.add(mesh);
      }
      if (bone === "head" && !options.studio) headPieces(body, group, s, origin, options);
      if (bone === "head" && studio && ribbon && !options.studio)
        for (const mesh of studioMeshes(
          body,
          studio,
          origin,
          color(bone),
          options.dress?.hair?.hairColor ?? "#51433b",
          true,
          options.plain,
          null,
          true,
        )) {
          group.add(mesh);
        }
      for (const piece of worn) {
        if (piece.region !== bone) continue;
        const mesh = piece.mesh.clone();
        mesh.geometry = piece.mesh.geometry.clone();
        if (bone === "head" && adjustAccessory) adjustAccessory(mesh.geometry);
        mesh.geometry.translate(-origin[0], -origin[1], -origin[2]);
        if (piece.skin)
          humanWeightsOf.set(mesh, {
            boneIndices: Array.from(piece.skin.boneIndices),
            weights: Array.from(piece.skin.weights),
            names: boneNames,
            clothJoints: piece.skin.clothJoints,
          });
        group.add(mesh);
      }
      return group;
    },
  };
  full.dispose();
  return regions;
}

function headPieces(
  body: HumanBody,
  group: T.Group,
  s: SmoothSurface,
  origin: readonly [number, number, number],
  options: HumanRegionOptions,
): void {
  const skin = group.children.find(
    (c): c is T.Mesh => c instanceof T.Mesh && c.userData["faceSurface"] === true,
  );
  const { face, plain, height, material, paint } = options;
  const captured = paint?.complexion
    ? capturedAxes[capturedSkinNames.indexOf(paint.complexion)]
    : undefined;
  const photoBrow =
    captured !== undefined &&
    paint?.sources.paint.capturedBrows(captured) === true &&
    (paint.browStyle ?? "As drawn") === "As drawn";
  const cage = s.cage,
    positions = cage.positions.slice();
  positions.set(s.positions.subarray(0, cage.bodyVertices * 3));
  const idMap = new Map<number, number>(Array.from(cage.ids, (v, i) => [v, i]));
  const fibres = browsAndLashes(
    { body, cage, positions, idMap, origin, height },
    {
      brow: face.brow,
      frame: face.frame,
      age: face.age,
      plain,
      brows: plain || !photoBrow,
      parted: face.parted,
      colours: paint
        ? strandColours(paint.look.hair, new T.Color(face.skin), face.age, paint.look.makeup)
        : null,
    },
    material,
  );
  const teeth = skin ? mouthInterior(skin, height, material, plain) : null;
  if (paint && skin?.material instanceof T.Material && skin.material.userData["faceLayout"])
    fitFaceLayout(skin.geometry, paint.sources, body, mouthLining(skin.geometry));
  const textures = paint
    ? {
        map: eyeTexture(
          paint.sources.raster,
          paint.sources.paint,
          paint.eyeColor ?? defaultEyeColor(face.skin, paint.seed),
          paint.seed % 64,
          paint.complexion,
        ),
        roughnessMap: eyeRoughnessTexture(paint.sources.raster, paint.sources.paint),
      }
    : undefined;
  group.add(
    humanEyes(skin, eyeBalls(positions, cage.eyeGroups, origin), material, {
      skin: face.skin,
      age: face.age,
      plain,
      scale: height / 1.72,
      textures,
    }),
  );
  group.add(fibres);
  if (teeth) group.add(teeth);
  const vertices = skin && skinVertices.get(skin);
  if (vertices) followGaze(group, s.height / 1.72, vertices);
}
