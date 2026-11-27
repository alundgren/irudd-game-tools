import { applyRadialFit, finishEar, suctionCups } from "./surfaces/study-details.js";
import * as T from "three";
import { generatedCreature } from "./creature/generator.js";
import {
  armAccess,
  canonicalJson,
  humanRegionCopy,
  type AdultRegionSource,
  type Appearance,
  type CharacterDocument,
  type Digest,
  type Finish,
  type FigureGroom,
  type HairCap,
  type Knot,
  type PieceName,
  type SeamGroup,
} from "@irudd/document";
import { joinSurfaces, type BlendEntry, type BlendOwners } from "./surfaces/blend.js";
import { warpBuild } from "./surfaces/build-warp.js";
import { cageSurface } from "./surfaces/cage.js";
import { fitSurfaceJoins } from "./surfaces/join.js";
import { pullSurface } from "./surfaces/pull.js";
import { growGuideFibres } from "./surfaces/guide-fibres.js";
import { gameTriangleTarget } from "./game/optimize.js";
import { headSpace, portraitSurface, type HeadSpace } from "./surfaces/face.js";
import { shadeNape } from "./surfaces/head.js";
import { deformFace } from "./surfaces/sculpt.js";
import { fitDepth } from "./surfaces/portrait-depth.js";
import { scalpMaterial, seatHair, separateHair } from "./surfaces/portrait-hair.js";
import { finishPlateSurface, hasPlatedAxis } from "./surfaces/plate-growth.js";
import { applyFrontFit, carryFaceEdits, headFrame } from "./surfaces/front-fit.js";
import { fitHeadProfile } from "./surfaces/profile-fit.js";
import { clearFaceHardware } from "./surfaces/face-hardware.js";
import { attachEyes } from "./surfaces/eyes.js";
import { bodyPieces, builtinFace } from "./library/pieces.js";
import type { FacePaint } from "./paint/faces.js";
import type { RasterImage } from "./raster.js";
import { applyPortraitPlates, paintSidePortrait, type PortraitPlates } from "./paint/portrait.js";
import { fitGarment } from "./surfaces/garment.js";
import { mantleGeometry } from "./surfaces/mantle.js";
import { skirtGeometry } from "./surfaces/skirt.js";
import { groomGeometry } from "./surfaces/groom.js";
import { scuteGeometry } from "./surfaces/scute.js";
import { pleat, splitHem } from "./surfaces/drapery.js";
import { sweepGeometry } from "./surfaces/sweep.js";
import { wingGeometry } from "./surfaces/wing.js";
import { markingField, paintJoinedCoat, paintMarkings } from "./surfaces/markings.js";
import { billChart, finishBill, type BillChart, type BillFinishes } from "./creature/bill.js";
import { finishCreatureEye, type EyeFinish } from "./creature/eye.js";
import { bakeCreatureHide } from "./creature/hide.js";
import { applyCreatureCoat, creatureCoatField } from "./creature/coat.js";
import { limbPigments, paintLimbPigment, type LimbTint } from "./creature/limb-colour.js";
import { paintFaceCoatVertices } from "./creature/face-coat.js";
import { buildView, paintSources, visibleIn, type BuildPart, type BuildView } from "./view.js";
import { expeditionRoles, regionFit, type RegionFit } from "./dress.js";
import { addEquipment, easedKnots } from "./refit.js";
import { expeditionKit } from "./paint/expedition.js";
import { volumeGeometry } from "./surfaces/volume.js";
import { handGeometry, type Digit } from "./surfaces/hand.js";
import {
  bakePaint,
  paintedMaterial,
  paintRegions,
  sheetTexture,
  volumeMaterial,
  type Binding,
  type PaintAtlases,
  type RegionViews,
} from "./paint/turnaround.js";
import { isMesh } from "./mesh.js";
import type { HumanBody } from "./human/body.js";
import { buildHuman, isHumanDocument, type HumanBuild } from "./human/build.js";
import type { HumanPaintSources } from "./human/complexion.js";

export const presets = ["clay", "full", "game", "portrait"] as const;
export type Preset = (typeof presets)[number];

export type MaterialSource = (color: string, finish: Finish, cutGarment?: boolean) => T.Material;

export type GroomMaterialSource = (color: string, finish: "scalp" | "strands") => T.Material;

export type WingMaterialSource = (color: string, finish: "wing" | "feathered wing") => T.Material;

export interface BuiltPart {
  readonly part: BuildPart;
  readonly object: T.Object3D;
  readonly mount: T.Object3D;
}

export interface BuiltCharacter {
  readonly view: BuildView;
  readonly group: T.Group;
  readonly parts: ReadonlyMap<string, BuiltPart>;
  readonly warp: ((v: T.Vector3) => T.Vector3) | undefined;
  readonly blendOwners: ReadonlyMap<T.Mesh, BlendOwners>;
  readonly hands: ReadonlyMap<T.Mesh, ReadonlyArray<Digit>>;
  readonly faces: ReadonlyMap<T.Mesh, HeadSpace | undefined>;
  readonly human?: HumanBuild;
  readonly regionRig?: HumanBuild;
  readonly regionSources?: ReadonlyMap<string, HumanBuild>;
  dispose(): void;
}

export interface BuildOptions {
  readonly materials: MaterialSource;
  readonly groomMaterials?: GroomMaterialSource | undefined;
  readonly wingMaterials?: WingMaterialSource | undefined;
  readonly finish?: {
    readonly paint?: PaintAtlases | undefined;
    readonly faces?: FacePaint | undefined;
    readonly plates?: PortraitPlates | undefined;
  };
  readonly game?: boolean;
  readonly human?: HumanBody | undefined;
  readonly humanPaint?: HumanPaintSources | undefined;
}

export function clayMaterials(): MaterialSource {
  const clay = new T.MeshStandardMaterial({ color: "#adb4ad", roughness: 0.86 });
  return () => clay;
}

function sweepSides(part: BuildPart): number {
  return part.anatomy === "face" || part.sourceHair
    ? 176
    : part.wear.role === "skirt" || part.seam
      ? 64
      : 28;
}

function levelSections(part: BuildPart, knots: ReadonlyArray<Knot>): boolean {
  const first = knots[0];
  const last = knots.at(-1);
  return (
    (Boolean(part.paint) && part.paint?.trace.frame !== "path") ||
    (part.seam !== undefined &&
      first !== undefined &&
      last !== undefined &&
      knots.every((k) => k[0] === first[0]) &&
      last[1] > first[1])
  );
}

function sweepKnots(
  part: BuildPart,
  knots: ReadonlyArray<Knot>,
  fit: RegionFit | undefined,
  toes: boolean,
): ReadonlyArray<Knot> {
  if (fit) return easedKnots(knots, fit.amount);
  const ball = knots.at(-3);
  const next = knots.at(-2);
  if (part.foot !== "bare" || !toes || !ball || !next) return knots;
  const end: Knot = [
    T.MathUtils.lerp(ball[0], next[0], 0.33),
    T.MathUtils.lerp(ball[1], next[1], 0.33),
    T.MathUtils.lerp(ball[2], next[2], 0.33),
    ball[3] * 0.51,
    ball[4] * 0.51,
  ];
  return [...knots.slice(0, -2), end];
}

function capsuleGeometry([x, y, z]: BuildPart["size"]): T.BufferGeometry {
  const length = Math.max(x, y, z);
  const diameter = Math.min(x, y, z);
  if (length === diameter) return new T.SphereGeometry(0.5, 32, 24);
  const capsule = new T.CapsuleGeometry(diameter / 2, length - diameter, 8, 32);
  capsule.scale(1 / diameter, 1 / length, 1 / diameter);
  if (length === x) capsule.rotateZ(Math.PI / 2);
  else if (length === z) capsule.rotateX(Math.PI / 2);
  return capsule;
}

interface SurfaceNotes {
  readonly carrier: BuildPart | undefined;
  readonly cageFaces: WeakMap<T.BufferGeometry, ReadonlyArray<number>>;
  readonly reliefs: WeakMap<T.BufferGeometry, Float32Array>;
  readonly game: boolean;
  readonly planned: boolean;
  readonly chart: BillChart["uv"] | undefined;
  readonly toes: boolean;
}

function partGeometry(
  part: BuildPart,
  fit: RegionFit | undefined,
  hand: (digits: ReadonlyArray<Digit>) => void,
  surfaces: SurfaceNotes,
): T.BufferGeometry {
  const geometry = authoredGeometry(part, fit, hand, surfaces);
  if (fit && !part.sweep && !fit.preserve) geometry.scale(fit.amount, 1, fit.amount);
  return geometry;
}

function authoredGeometry(
  part: BuildPart,
  fit: RegionFit | undefined,
  hand: (digits: ReadonlyArray<Digit>) => void,
  surfaces: SurfaceNotes,
): T.BufferGeometry {
  if (part.hand) {
    const surface = handGeometry(part.hand, { game: surfaces.game && surfaces.planned });
    hand(surface.digits);
    return surface.geometry;
  }
  if (part.sweep) {
    const geometry = sweepGeometry(
      sweepKnots(part, part.sweep.knots, fit, surfaces.toes),
      levelSections(part, part.sweep.knots),
      sweepSides(part),
      part.foot,
    );
    if (part.sweep.radialFit) applyRadialFit(geometry, part.sweep.radialFit);
    const traced = part.anatomy === "face" || part.sourceHair;
    if (traced && part.paint) portraitSurface(geometry, part.paint.trace, part.paint.depth?.field);
    if (part.paint) fitDepth(geometry, part.paint.depth?.pins, part.paint.trace.height);
    if (traced && part.sculpt)
      deformFace(geometry, part.sculpt, part.paint?.trace.portrait?.chin ?? 0.24);
    return part.drape
      ? splitHem(pleat(geometry, part.sweep.knots, part.drape), part.sweep.knots, part.drape)
      : geometry;
  }
  if (part.cage) {
    const surface = cageSurface(part.cage, surfaces.chart);
    surfaces.cageFaces.set(surface.geometry, surface.faces);
    return surface.geometry;
  }
  if (part.wing) return wingGeometry(part.wing, part.color, { game: surfaces.game });
  if (part.scute) return scuteGeometry(part.scute.mount, surfaces.carrier?.sweep?.knots);
  if (part.volume) return volumeGeometry(part.volume.hull);
  if (part.mantle?.kind === "Skirt") {
    const skirt = skirtGeometry(part.mantle);
    surfaces.reliefs.set(skirt.geometry, skirt.relief);
    return skirt.geometry;
  }
  if (part.mantle) return mantleGeometry(part.mantle);
  switch (part.shape) {
    case "box":
      return new T.BoxGeometry(1, 1, 1, 7, 7, 7);
    case "ellipsoid":
      return new T.SphereGeometry(0.5, 32, 24);
    case "cone":
      return new T.ConeGeometry(0.5, 1, 28, 10);
    case "cylinder":
      return new T.CylinderGeometry(0.5, 0.5, 1, 28, 10);
    case "capsule":
      return capsuleGeometry(part.size);
  }
}

function tagAttachmentDetail(view: BuildView, parts: ReadonlyMap<string, BuiltPart>): void {
  const carriers = new Set(
    view.parts
      .filter(
        (p) =>
          p.join?.end === "along" &&
          p.parent !== null &&
          view.byId.get(p.parent)?.cage !== undefined,
      )
      .map((p) => p.parent),
  );
  for (const p of view.parts) {
    const role = carriers.has(p.id)
      ? "carrier"
      : p.parent !== null && carriers.has(p.parent)
        ? "trim"
        : null;
    const node = parts.get(p.id)?.object;
    if (!role || !node || !isMesh(node) || p.fibres) continue;
    const material: T.Material | T.Material[] = node.material;
    if (Array.isArray(material)) continue;
    node.material = material.clone();
    node.material.userData["attachmentDetail"] = role;
  }
}

function fitGarments(
  view: BuildView,
  parts: ReadonlyMap<string, BuiltPart>,
  reliefs: WeakMap<T.BufferGeometry, Float32Array>,
): void {
  const inner = new Map<string, T.Object3D[]>();
  const order = (p: BuildPart) => view.layers.get(p.id)?.order ?? 0;
  for (const p of [...view.parts].sort((a, b) => order(a) - order(b))) {
    const mesh = parts.get(p.id)?.object;
    const host = p.parent === null ? undefined : parts.get(p.parent)?.object;
    if (!p.fitted || p.parent === null || !mesh || !host || !mesh.visible || !isMesh(mesh))
      continue;
    const layers = inner.get(p.parent) ?? [];
    const limbs: T.Object3D[] = [];
    const cut = p.mantle;
    if (cut) {
      const covered = new Set(
        cut.kind === "Skirt" ? ["thigh", "shin", "foot"] : ["thigh", "shin", "upper arm"],
      );
      if (cut.kind !== "Skirt" && armAccess(cut) !== "Open sides")
        covered.add("forearm").add("hand");
      host.traverseVisible((node) => {
        const id: unknown = node.userData["partId"];
        const role = typeof id === "string" ? roleOf(view.byId.get(id)) : undefined;
        if (role && covered.has(role)) limbs.push(node);
      });
    }
    const relief = reliefs.get(mesh.geometry);
    fitGarment(host, mesh, {
      inner: layers,
      limbs,
      pairedPanel: Boolean(cut),
      ...(relief ? { relief } : {}),
      ...(cut?.kind === "Skirt" && cut.waistClearance !== undefined
        ? { waistClearance: cut.waistClearance }
        : {}),
    });
    layers.push(mesh);
    inner.set(p.parent, layers);
  }
}

function dyeLayer(object: T.Object3D, dye: T.Color): void {
  object.traverse((node) => {
    if (!isMesh(node)) return;
    const material: T.Material | T.Material[] = node.material;
    if (Array.isArray(material)) return;
    const dyed = material.clone();
    if (dyed instanceof T.MeshStandardMaterial) {
      dyed.color.multiply(dye);
      dyed.emissive.multiply(dye);
    }
    node.material = dyed;
  });
}

const groomShades = [0.75, 0.92, 1.05, 1.17];

function growGroom(object: T.Object3D, groom: FigureGroom, options: BuildOptions): void {
  const scalp = isMesh(object)
    ? object
    : object.children.find((c): c is T.Mesh => isMesh(c) && c.userData["faceSurface"] === true);
  if (!scalp) return;
  for (const child of object.children.slice()) if (child.userData["baseHair"]) object.remove(child);
  scalp.geometry.computeBoundingBox();
  const bounds = scalp.geometry.boundingBox?.clone();
  if (!bounds) return;
  let transform: T.Matrix4 | undefined;
  if (scalp !== object) {
    scalp.updateMatrix();
    bounds.applyMatrix4(scalp.matrix);
    transform = scalp.matrix;
  }
  groomGeometry(bounds, groom, scalp.geometry, transform).forEach((g, i) => {
    const color = "#" + new T.Color(groom.color).multiplyScalar(groomShades[i] ?? 1).getHexString();
    const finish = i === 0 ? "scalp" : "strands";
    const strands = new T.Mesh(
      g,
      options.groomMaterials?.(color, finish) ?? options.materials(color, "plain"),
    );
    strands.name = "Hair " + i;
    strands.castShadow = true;
    object.add(strands);
  });
}

function canBlend(part: BuildPart): boolean {
  return (
    (Boolean(part.sweep) || part.shape === "ellipsoid") &&
    !part.paint &&
    !part.fibres &&
    !part.fitted
  );
}

const jointedRoles = new Set(["upper arm", "forearm"]);
const roleOf = (part: BuildPart | undefined) => part?.motion ?? part?.wear.role;

function retainSections(view: BuildView, part: BuildPart, geometry: T.BufferGeometry): void {
  if (!part.sweep || part.blend) return;
  const parent = part.parent === null ? undefined : view.byId.get(part.parent);
  const jointed = jointedRoles.has(roleOf(part) ?? "");
  const cuff = roleOf(part) === "rigid" && jointedRoles.has(roleOf(parent) ?? "");
  const plated = hasPlatedAxis(part);
  if (!(part.sweep.retainSections ?? (jointed || cuff)) && !plated) return;
  const bands = (part.sweep.knots.length - 1) * 5;
  const count = geometry.getAttribute("position").count;
  const sides = count / (bands + 1) - 1;
  const pins = new Uint8Array(count);
  const rings = plated
    ? Array.from({ length: bands + 1 }, (_, i) => i)
    : [0, 0.1, 0.24, 0.42, 0.61, 0.79, 0.93, 1].map((t) => Math.round(t * bands));
  const around = plated ? 6 : 12;
  for (const ring of rings) {
    const start = ring * (sides + 1);
    for (let i = 0; i <= around; i++) pins[start + Math.round((i * sides) / around)] = 1;
  }
  geometry.setAttribute("lodAnchor", new T.BufferAttribute(pins, 1));
}

function blendSkin(
  view: BuildView,
  parts: ReadonlyMap<string, BuiltPart>,
  material: MaterialSource,
): Map<T.Mesh, BlendOwners> {
  const owners = new Map<T.Mesh, BlendOwners>();
  const groups = new Map<SeamGroup, BlendEntry[]>();
  for (const { part, object } of parts.values()) {
    const group = part.seam;
    if (!group || part.blend || part.join || !canBlend(part) || !object.visible) continue;
    if (group === "figure" && view.outfit === "Pressure suit") continue;
    if (!isMesh(object)) continue;
    const pieces = groups.get(group) ?? [];
    pieces.push({ id: part.id, knots: part.sweep?.knots, mesh: object });
    groups.set(group, pieces);
  }
  for (const [group, pieces] of groups) {
    const toes = group === "left foot" || group === "right foot";
    const detail = view.outfit === "Anatomy" && group === "figure" ? 88 : 72;
    const joined = joinSurfaces(pieces, toes ? 0.004 : 0.011, null, toes ? 0.009 : 0.035, detail);
    for (const [mesh, o] of joined) owners.set(mesh, o);
  }
  const entries: BlendEntry[] = [];
  for (const { part, object } of parts.values()) {
    if (
      !part.blend ||
      part.join ||
      !canBlend(part) ||
      (part.wear.role && view.outfit !== "Work clothes" && view.outfit !== "Anatomy")
    )
      continue;
    if (isMesh(object) && object.visible)
      entries.push({ id: part.id, knots: part.sweep?.knots, mesh: object });
  }
  const first = entries[0] ? parts.get(entries[0].id)?.part : undefined;
  const common = first
    ? material(view.skin.tint ?? first.color, view.skin.surface ?? "plain")
    : null;
  for (const [mesh, o] of joinSurfaces(entries, view.skin.softness ?? 0.015, common, null))
    owners.set(mesh, o);
  return owners;
}

function withHandMadeParts(
  doc: CharacterDocument,
  human: BuiltCharacter,
  options: BuildOptions,
): BuiltCharacter {
  const handMade = doc.parts.filter((p) => !human.parts.has(p.id));
  if (!handMade.length) return human;
  const ids = new Set<string>(handMade.map((p) => p.id));
  const full = buildView(doc);
  const byId = new Map([...full.byId, ...human.view.byId]);
  const added = buildFigure(
    { ...full, byId, parts: full.parts.filter((p) => ids.has(p.id)) },
    options,
    human,
    generatedCreature(doc),
  );
  const parts = new Map([...human.parts, ...added.parts]);
  for (const { part, object } of human.parts.values()) {
    const parent = part.parent && added.parts.get(part.parent);
    if (parent) parent.mount.add(object);
  }
  const viewParts = [...human.view.parts, ...handMade.flatMap((p) => full.byId.get(p.id) ?? [])];
  return {
    ...human,
    view: { ...human.view, parts: viewParts, byId: new Map(viewParts.map((p) => [p.id, p])) },
    parts,
    warp: added.warp,
    blendOwners: added.blendOwners,
    hands: added.hands,
    faces: added.faces,
    dispose() {
      human.dispose();
      added.dispose();
    },
  };
}

export function buildCharacter(doc: CharacterDocument, options: BuildOptions): BuiltCharacter {
  const donors = new Map<string, AdultRegionSource>();
  for (const p of doc.parts) {
    const source = humanRegionCopy.read(p.features)?.source;
    if (source) donors.set(canonicalJson(source), source);
  }
  if (isHumanDocument(doc) || donors.size) {
    const body = options.human;
    if (!body) throw new Error("Building adult regions needs the loaded body pack.");
    const native = isHumanDocument(doc) ? buildHuman(doc, body, options) : undefined;
    if (native && !donors.size) return withHandMadeParts(doc, native, options);
    const regions = [
      ...(native ? [native] : []),
      ...Array.from(donors.values(), (source) => buildHuman(doc, body, options, source)),
    ];
    const view = buildView(doc),
      group = new T.Group();
    const parts = new Map(regions.flatMap((r) => Array.from(r.parts)));
    const sources = new Map(
      regions.flatMap((r) =>
        r.human ? Array.from(r.parts.keys(), (id) => [id, r.human] as const) : [],
      ),
    );
    const first = regions[0]?.human;
    const regionRig = first && {
      ...first,
      bones: new Map(regions.flatMap((r) => Array.from(r.human?.bones ?? []))),
    };

    for (const { part, object } of parts.values())
      ((part.parent && parts.get(part.parent)?.mount) || group).add(object);
    const entries = Array.from(parts.values(), (item) => item.part);
    return withHandMadeParts(
      doc,
      {
        group,
        parts,
        view: { ...view, parts: entries, byId: new Map(entries.map((p) => [p.id, p])) },
        ...(native ? { human: native.human } : {}),
        ...(regionRig ? { regionRig } : {}),
        regionSources: sources,
        warp: undefined,
        blendOwners: new Map(),
        hands: new Map(),
        faces: new Map(),
        dispose() {
          for (const region of regions) {
            for (const { object } of region.parts.values()) region.group.add(object);
            region.dispose();
          }
        },
      },
      options,
    );
  }
  return buildFigure(buildView(doc), options, undefined, generatedCreature(doc));
}

function buildFigure(
  view: BuildView,
  options: BuildOptions,
  host?: BuiltCharacter,
  generatedDress = false,
): BuiltCharacter {
  const portrait = view.parts.find((p) => p.nativePortrait);
  if (portrait)
    throw new Error(
      `A native portrait layer belongs on an adult's own head, not ${portrait.label}.`,
    );
  const plan = view.plan;
  if (plan?.dress && !generatedDress)
    throw new Error("This build does not support creature livery (creature.plan.dress).");
  const creatureRaster = plan && options.finish ? options.finish.paint?.raster : undefined;
  if (plan && options.finish && !creatureRaster)
    throw new Error("Finishing a creature plan's hide needs a raster.");
  const eyeFinish: EyeFinish = { materials: new Map(), artwork: new Map() };
  const billFinishes: BillFinishes = new Map();
  const group = new T.Group();
  const built = new Map<string, BuiltPart>();
  const atlases = options.finish?.paint;
  const regions = atlases && paintRegions(atlases, paintSources(view));
  const textures: T.Texture[] = [];
  const hands = new Map<T.Mesh, ReadonlyArray<Digit>>();
  const cageFaces = new WeakMap<T.BufferGeometry, ReadonlyArray<number>>();
  const reliefs = new WeakMap<T.BufferGeometry, Float32Array>();
  const faces = new Map<T.Mesh, HeadSpace | undefined>();
  const sheets = new Map<string, T.Texture | undefined>();
  const baked = new Map<string, T.Texture | undefined>();
  const sheetOf = (atlas: Digest): T.Texture | undefined => {
    if (!atlases) return undefined;
    if (!sheets.has(atlas)) {
      const texture = sheetTexture(atlases, atlas);
      if (texture) textures.push(texture);
      sheets.set(atlas, texture);
    }
    return sheets.get(atlas);
  };
  const bakedMaterial = (
    binding: Binding,
    region: RegionViews | undefined,
    color: string,
  ): T.Material => {
    const key = canonicalJson({ ...binding });
    if (!baked.has(key)) {
      const texture = atlases && bakePaint(atlases, binding, region);
      if (texture) textures.push(texture);
      baked.set(key, texture);
    }
    const texture = baked.get(key);
    return texture ? paintedMaterial(texture, color) : new T.MeshStandardMaterial({ color });
  };
  const kit = atlases && view.outfit === "Pressure suit" ? expeditionKit(atlases) : undefined;
  const suitMaterial = (fit: RegionFit): T.Material | undefined => {
    const binding = expeditionRoles.has(fit.role) ? kit?.get(fit.role) : undefined;
    return binding && bakedMaterial(binding, undefined, "#ffffff");
  };
  const materialOf = (part: BuildPart, fit: RegionFit | undefined): T.Material => {
    if (fit && !fit.preserve) return options.materials(fit.color, fit.bare ? "plain" : "canvas");
    if (part.volume && options.finish) {
      const texture = sheetOf(part.volume.atlas);
      return texture
        ? volumeMaterial(texture, part.color)
        : new T.MeshStandardMaterial({ color: part.color });
    }
    if (!part.paint || !options.finish)
      return options.materials(part.color, part.finish, part.mantle !== undefined);
    const depth = part.paint.depth;
    const binding = { ...part.paint.trace, atlas: part.paint.atlas, ...(depth ? { depth } : {}) };
    return bakedMaterial(
      binding,
      binding.region === undefined ? undefined : regions?.get(binding.atlas)?.get(binding.region),
      part.color,
    );
  };
  const libraries = new Map<string, Record<PieceName, T.Group>>();
  const facePaint = options.finish?.faces;
  const plateSource = (digest: Digest | undefined): PortraitPlates => {
    const plates = options.finish?.plates;
    if (!plates) throw new Error(`The portrait plate ${digest ?? ""} did not load.`);
    return plates;
  };
  const plate = (plates: PortraitPlates, digest: Digest): RasterImage => {
    const image = plates.image(digest);
    if (!image) throw new Error(`The portrait plate ${digest} did not load.`);
    return image;
  };
  const pieceOf = (part: BuildPart): T.Group | undefined => {
    if (!part.piece) return undefined;
    const look = part.piece.look ?? view.appearance;
    if (!look)
      throw new Error(`Part ${part.id} is a built-in piece but the document has no appearance.`);
    const key = canonicalJson({ ...look });
    let library = libraries.get(key);
    if (!library) {
      library = bodyPieces(look, view.outfit, options.materials, facePaint);
      libraries.set(key, library);
    }
    const object = library[part.piece.piece].clone();
    if (part.piece.piece === "head") fitHead(object, part, look);
    return object;
  };
  const fitHead = (object: T.Group, part: BuildPart, look: Appearance): void => {
    const parent = part.parent === null ? undefined : view.byId.get(part.parent);
    if (parent?.anatomy === "neck")
      object.remove(...object.children.filter((c) => c.userData["neckSurface"]));
    const adult = part.piece?.cranialProfile === "adult";
    if (adult)
      for (const child of object.children) {
        if (child.userData["earSurface"]) child.position.z -= 0.013;
        if (child.userData["baseHair"]) child.position.z -= 0.009;
      }
    if (part.sculpt || adult) {
      const original = object.children.find((c) => c.userData["faceSurface"]);
      const next = builtinFace(
        { ...look, sculpt: { ...look.sculpt, ...part.sculpt } },
        options.materials,
        facePaint,
        adult,
      );
      if (original) {
        next.position.copy(original.position);
        object.remove(original);
      }
      object.add(next);
    }
    for (const child of object.children)
      if (isMesh(child) && child.userData["faceSurface"]) faces.set(child, undefined);
  };
  const partMesh = (part: BuildPart, fit: RegionFit | undefined): T.Mesh => {
    let digits: ReadonlyArray<Digit> | undefined;
    const bill = plan && creatureRaster ? billChart(part, plan.head) : undefined;
    const parent = part.parent === null ? undefined : view.byId.get(part.parent);
    const carrier = part.scute?.mount && parent?.paint ? parent : undefined;
    const geometry = partGeometry(part, fit, (d) => (digits = d), {
      carrier,
      cageFaces,
      reliefs,
      game: Boolean(options.game),
      planned: plan !== undefined,
      chart: bill?.uv,
      toes: view.parts.some(
        (p) =>
          p.parent === part.id &&
          p.wear.visibleIn?.includes(view.outfit) === true &&
          p.seam === part.seam,
      ),
    });
    if (options.game && options.finish) retainSections(view, part, geometry);
    const material =
      carrier && options.finish
        ? materialOf({ ...carrier, color: part.color }, undefined).clone()
        : materialOf(part, fit);
    if (options.finish && carrier && material instanceof T.MeshStandardMaterial)
      material.emissiveIntensity = 0.24;
    const object = new T.Mesh(geometry, material);
    if (digits) hands.set(object, digits);
    if (part.mantle) {
      if (options.finish) {
        const material: T.Material | T.Material[] = object.material;
        if (!Array.isArray(material)) {
          object.material = material.clone();
          object.material.vertexColors = true;
          if (part.mantle.kind === "Skirt") object.material.userData["foldedCloth"] = true;
        }
      } else geometry.deleteAttribute("color");
    }
    if (part.wing) {
      if (options.finish) {
        const feathered = part.wing.structure === "feather" && options.game;
        const source = options.wingMaterials;
        let material = source
          ? source("#ffffff", feathered ? "feathered wing" : "wing")
          : options.materials("#ffffff", "plain");
        if (feathered || !source) material = material.clone();
        material.vertexColors = true;
        if (feathered) material.userData["wingLOD"] = true;
        object.material = material;
      } else geometry.deleteAttribute("color");
    }
    if (part.cage?.pinna && options.finish)
      finishEar(object, part.cage, cageFaces.get(geometry), part.color);
    if (part.sweep?.suckerRows) {
      const cups = suctionCups(
        part.sweep.knots,
        part.sweep.suckerRows,
        part.color,
        plan?.skin?.pale ?? "#e4c3a3",
        !!options.game,
      );
      const material = options.materials(options.finish ? "#ffffff" : part.color, "plain").clone();
      material.vertexColors = !!options.finish;
      if (options.finish && material instanceof T.MeshStandardMaterial) material.roughness = 0.43;
      const mesh = new T.Mesh(cups, material);
      mesh.name = part.label + " suction cups";
      mesh.castShadow = true;
      object.add(mesh);
    }
    if (part.cage && part.finish === "horn" && options.finish)
      finishPlateSurface(object, part, cageFaces.get(geometry), options.materials);
    if (bill && creatureRaster) finishBill(object, bill, billFinishes, creatureRaster, textures);
    if (part.eyeSurface && options.finish) {
      if (!creatureRaster) throw new Error(`Finishing the eye ${part.id} needs a creature plan.`);
      finishCreatureEye(object, part, eyeFinish, creatureRaster, textures);
    }
    if (part.anatomy === "face") {
      object.userData["faceSurface"] = true;
      faces.set(object, part.paint && headSpace(part.paint.trace));
    }
    if (fit?.suit && !fit.preserve && options.finish) {
      const textile = suitMaterial(fit);
      if (textile) object.material = textile;
    }
    if (fit && !fit.hide) addEquipment(object, fit, options.materials);
    if (part.hairCap) separateCap(object, part, part.hairCap);
    return object;
  };
  const linings = new Map<T.Mesh, ReadonlyArray<number>>();
  const separateCap = (object: T.Mesh, part: BuildPart, cap: HairCap): void => {
    const outer: T.Material | T.Material[] = object.material;
    const hair = separateHair(object.geometry, cap, !part.groom);
    if (part.sourceHair && hair) {
      object.geometry.dispose();
      object.geometry = hair.geometry;
      linings.set(object, hair.lining);
      return;
    }
    if (Array.isArray(outer))
      throw new Error(`Part ${part.id} has a hair cap over several materials.`);
    const raster = options.finish?.paint?.raster;
    if (raster) object.material = scalpMaterial(raster, outer, cap, textures);
    if (!hair) return;
    const shell = new T.Mesh(hair.geometry, outer);
    shell.name = "Source hairstyle";
    shell.castShadow = true;
    shell.userData["baseHair"] = true;
    object.add(shell);
  };
  for (const part of view.parts) {
    const piece = pieceOf(part);
    const fit = piece ? undefined : regionFit(view, part);
    const object: T.Object3D = piece ?? partMesh(part, fit);
    if (part.groom) growGroom(object, part.groom, options);
    pullSurface(object, part.pulls, (original, copy) => {
      const faces = cageFaces.get(original);
      if (faces) cageFaces.set(copy, faces);
      const relief = reliefs.get(original);
      if (relief) reliefs.set(copy, relief);
    });
    const dye = options.finish && view.outfit !== "Anatomy" && view.layers.get(part.id)?.dye;
    if (dye) dyeLayer(object, new T.Color(dye));
    object.castShadow = true;
    object.name = part.label;
    object.position.fromArray(part.position);
    object.scale.fromArray(part.size);
    object.quaternion.fromArray(part.rotation);
    const groomed = part.parent !== null && Boolean(view.byId.get(part.parent)?.groom);
    object.visible = !fit?.hide && visibleIn(view, part) && !(part.hairLayer && groomed);
    object.userData["partId"] = part.id;
    if (part.faceAnchor) object.userData["rigidFaceAnchor"] = [...part.faceAnchor.anchor];
    let mount: T.Object3D = object;
    const frameSize = part.attach.kind === "scaled" ? part.attach.frameSize : part.size;
    if (frameSize) {
      mount = new T.Group();
      const [x, y, z] = frameSize;
      mount.scale.set(1 / x, 1 / y, 1 / z);
      mount.name = part.label + " attachment frame";
      mount.userData["attachmentFrame"] = true;
      object.add(mount);
    }
    built.set(part.id, { part, object, mount });
  }
  for (const { part, object } of built.values())
    (
      (part.parent === null
        ? undefined
        : (built.get(part.parent) ?? host?.parts.get(part.parent))?.mount) ?? group
    ).add(object);
  if (host) host.group.add(group);
  for (const { part, object } of built.values()) {
    const lining = isMesh(object) ? linings.get(object) : undefined;
    const head = part.parent === null ? undefined : built.get(part.parent);
    if (lining && part.hairCap && isMesh(object) && head?.part.sweep)
      seatHair(object, lining, head.object, head.part.sweep.knots, part.hairCap);
  }
  fitGarments(view, host ? new Map([...host.parts, ...built]) : built, reliefs);
  const blendOwners = blendSkin(view, built, options.materials);
  const warp = view.build && warpBuild(group, view.build, built, blendOwners);
  for (const { part, object } of built.values()) {
    if (part.piece?.cranialProfile !== "adult" || part.frontFits.length || part.profileFit)
      continue;
    const neck = part.parent === null ? undefined : built.get(part.parent)?.object;
    const face = object.children.find((c) => isMesh(c) && c.userData["faceSurface"]);
    if (neck && isMesh(neck) && blendOwners.has(neck) && face && isMesh(face))
      shadeNape(face, neck);
  }
  const faceOf = (object: T.Object3D): T.Mesh | undefined => {
    if (isMesh(object) && object.userData["faceSurface"]) return object;
    const child = object.children.find((c) => c.userData["faceSurface"]);
    return child && isMesh(child) ? child : undefined;
  };
  for (const { part, object } of built.values()) {
    if (!part.profileFit && !part.frontFits.length) continue;
    const face = faceOf(object);
    if (!face) continue;
    if (part.piece) {
      const binding = faces.get(face);
      faces.delete(face);
      face.geometry = face.geometry.clone();
      faces.set(face, binding);
    }
    if (part.profileFit && !part.profileFit.stage)
      fitHeadProfile(face, part.profileFit, faces.get(face));
  }
  fitSurfaceJoins(
    view.parts,
    new Map([...built].map(([id, b]) => [id, b.object])),
    { owners: blendOwners, cageFaces },
    Boolean(options.game),
  );
  const eyeMaterial = options.finish ? null : options.materials("#adb4ad", "plain");
  const fitEyes = (finish: boolean): void => {
    for (const { part, object } of built.values()) {
      if (!part.eyes || (part.eyes.stage === "finish") !== finish) continue;
      const face = faceOf(object);
      if (face) attachEyes(face, part.eyes, faces.get(face), eyeMaterial);
    }
  };
  fitEyes(false);
  for (const { part, object } of built.values()) {
    const face = part.frontFits.length ? faceOf(object) : undefined;
    if (!face) continue;
    const early = Boolean(part.profileFit) && !part.profileFit?.stage;
    for (const pass of part.frontFits) applyFrontFit(face, pass, early, object);
  }
  for (const { part, object } of built.values()) {
    if (part.profileFit?.stage !== "finish") continue;
    const face = faceOf(object);
    if (!face) continue;
    const frame = headFrame(face);
    const result = fitHeadProfile(face, part.profileFit, faces.get(face));
    if (!result) continue;
    carryFaceEdits(face, object, frame, result.move);
    const side = part.profileFit.side;
    if (side && options.finish && visibleIn(view, part)) {
      const plates = plateSource(side.plate);
      paintSidePortrait(
        plates.raster,
        face,
        object,
        result,
        side,
        plate(plates, side.plate),
        textures,
      );
    }
  }
  if (options.finish)
    for (const { part, object } of built.values()) {
      const front = part.frontFits.flatMap((pass) => (pass.plate ? [pass.plate] : []));
      const face = front.length && visibleIn(view, part) ? faceOf(object) : undefined;
      if (!face) continue;
      const plates = plateSource(front[0]);
      applyPortraitPlates(
        plates.raster,
        face,
        front.map((digest) => plate(plates, digest)),
        textures,
      );
    }
  fitEyes(true);
  fitSurfaceJoins(
    view.parts,
    new Map([...built].map(([id, b]) => [id, b.object])),
    { owners: blendOwners, cageFaces },
    Boolean(options.game),
    true,
  );
  const cleared = new Set<string>();
  for (const part of view.parts) {
    const parent = part.parent;
    if (part.faceAnchor?.clearance === undefined || parent === null || cleared.has(parent))
      continue;
    const owner = built.get(parent)?.object;
    const face = owner && faceOf(owner);
    if (!face) continue;
    clearFaceHardware(
      face,
      view.parts.flatMap((p) => {
        const object = built.get(p.id)?.object;
        return p.parent === parent && p.faceAnchor && object
          ? [{ object, anchor: p.faceAnchor.anchor, clearance: p.faceAnchor.clearance }]
          : [];
      }),
    );
    cleared.add(parent);
  }
  if (options.game && options.finish) tagAttachmentDetail(view, built);
  let fibreMaterial: T.Material | undefined;
  growGuideFibres(view, new Map([...built].map(([id, b]) => [id, b.object])), blendOwners, {
    finish: Boolean(options.finish),
    gameBudget: options.game ? Math.floor(0.4 * gameTriangleTarget) : 0,
    material: () => {
      if (fibreMaterial) return fibreMaterial;
      fibreMaterial = options.materials("#ffffff", "plain");
      if (options.finish) {
        fibreMaterial = fibreMaterial.clone();
        fibreMaterial.vertexColors = true;
        if (options.game) fibreMaterial.userData["fibreLOD"] = true;
      }
      return fibreMaterial;
    },
  });
  if (options.finish) {
    const objectOf = (id: string): T.Object3D | undefined => built.get(id)?.object;
    const skinShows = (part: BuildPart): boolean => {
      const fit = regionFit(view, part);
      return !fit || fit.preserve || fit.bare;
    };
    const limbTints: ReadonlyMap<string, LimbTint> = plan
      ? limbPigments(plan, view.parts, objectOf)
      : new Map();
    const hidden =
      plan && creatureRaster
        ? bakeCreatureHide(
            {
              plan,
              parts: view.parts,
              objectOf,
              owners: (mesh) => blendOwners.get(mesh),
              hands,
              skinShows,
              raster: creatureRaster,
            },
            limbTints,
            textures,
          )
        : new Set<string>();
    const coat = plan && creatureCoatField(plan, view.parts, objectOf);
    for (const { part, object } of built.values()) {
      if (hidden.has(part.id) || !isMesh(object) || !object.visible || !skinShows(part)) continue;
      const tint = limbTints.get(part.id);
      if (
        coat &&
        applyCreatureCoat(
          object,
          part,
          coat,
          part.markings && markingField(part.markings),
          part.undercoat && markingField(part.undercoat),
          tint,
        )
      )
        continue;
      const owners = blendOwners.get(object);
      if (owners && part.blend) {
        paintJoinedCoat(object, owners, (id) => {
          const owner = view.byId.get(id);
          return { under: owner?.undercoat, tint: limbTints.get(id), mark: owner?.markings };
        });
        continue;
      }
      const joined = Boolean(owners) || hands.has(object) || faces.has(object);
      if (part.undercoat) paintMarkings(object, part.undercoat, joined);
      paintLimbPigment(object, tint);
      if (part.markings) paintMarkings(object, part.markings, joined);
    }
    if (plan?.skin.faceMarking)
      for (const { part, object } of built.values())
        if (!hidden.has(part.id) && part.organ.rank === "head" && object.visible && isMesh(object))
          paintFaceCoatVertices(object, part, plan);
  }
  group.traverse((node) => {
    if (isMesh(node)) node.receiveShadow = true;
  });
  return {
    view,
    group,
    parts: built,
    warp: warp || undefined,
    blendOwners,
    hands,
    faces,
    dispose() {
      const materials = new Set<T.Material>();
      group.traverse((node) => {
        if (!isMesh(node)) return;
        node.geometry.dispose();
        const material: T.Material | T.Material[] = node.material;
        for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
      });
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
