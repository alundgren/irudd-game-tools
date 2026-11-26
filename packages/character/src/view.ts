import {
  characterAppearance,
  motionOffer,
  figureAnatomy,
  figureMantle,
  figureGroom,
  figurePiece,
  figureSculpt,
  figureFrontFit,
  figureProfileFit,
  figureHeadLayer,
  figureFaceAnchor,
  figureEyes,
  figureFibres,
  figureHairCap,
  figurePortraitDepth,
  figurePlateField,
  figurePlateSite,
  figureHornSwatch,
  motionHold,
  outfitFit,
  outfitLayers,
  creatureBlend,
  creatureSkin,
  creaturePlan,
  creatureCoatZone,
  creatureEyeSurface,
  creatureLimbChain,
  creatureOrgan,
  figureUndercoat,
  figureWing,
  figureNativePortrait,
  figureAssembly,
  figureCage,
  figureBuild,
  figureFinish,
  figureMarkings,
  figureOccluders,
  figurePaint,
  figureHull,
  figureHand,
  figureJoin,
  figureSeam,
  figurePulls,
  figureFoot,
  seamGroupLimit,
  figureScute,
  figureSweep,
  motionPoses,
  motionRole,
  outfitWardrobe,
  outfitWear,
  type Appearance,
  type CharacterDocument,
  type CreatureSkin,
  type CreaturePlan,
  type CoatZone,
  type EyeSurface,
  type CreatureLimbChain,
  type CreatureOrgan,
  type FigureWing,
  type Digest,
  type FigureAnatomy,
  type MantleCut,
  type LayerStyle,
  type FigureGroom,
  type FigurePiece,
  type FaceSculpt,
  type FrontFitPass,
  type FigureProfileFit,
  type FigureFaceAnchor,
  type FigureEyes,
  type FigureFibres,
  type HairCap,
  type PlateField,
  type PlateSite,
  type PortraitDepth,
  type FigureHand,
  type FigureHull,
  type FigureJoin,
  type FootSectionName,
  type SeamGroup,
  type SurfacePull,
  type FigurePaint,
  type PaintSource,
  type Finish,
  type JointPose,
  type FigureBuild,
  type FigureCage,
  type FigureMarkings,
  type FigureSweep,
  type MotionRoleName,
  type OutfitName,
  type OutfitWear,
  type Part,
  type Shape,
} from "@irudd/document";
import { expeditionAtlas, wearsExpedition } from "./dress.js";

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface BuildPart {
  readonly id: string;
  readonly label: string;
  readonly parent: string | null;
  readonly shape: Shape;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly size: Vec3;
  readonly color: string;
  readonly order: number | undefined;
  readonly attach:
    | { readonly kind: "scaled"; readonly frameSize: Vec3 | undefined }
    | { readonly kind: "rigid" };
  readonly sweep: FigureSweep | undefined;
  readonly cage: FigureCage | undefined;
  readonly scute: boolean;
  readonly markings: FigureMarkings | undefined;
  readonly undercoat: FigureMarkings | undefined;
  readonly coatZone: CoatZone["zone"] | undefined;
  readonly eyeSurface: EyeSurface["surface"] | undefined;
  readonly wing: FigureWing | undefined;
  readonly organ: CreatureOrgan;
  readonly limbChain: CreatureLimbChain | undefined;
  readonly paint:
    | {
        readonly atlas: Digest;
        readonly trace: FigurePaint;
        readonly depth: PortraitDepth | undefined;
      }
    | undefined;
  readonly volume: { readonly atlas: Digest; readonly hull: FigureHull } | undefined;
  readonly hand: FigureHand | undefined;
  readonly join: FigureJoin | undefined;
  readonly seam: SeamGroup | undefined;
  readonly pulls: ReadonlyArray<SurfacePull>;
  readonly foot: FootSectionName | undefined;
  readonly anatomy: FigureAnatomy["region"] | undefined;
  readonly fitted: boolean;
  readonly mantle: MantleCut | undefined;
  readonly groom: FigureGroom | undefined;
  readonly piece: FigurePiece | undefined;
  readonly sculpt: FaceSculpt | undefined;
  readonly frontFits: ReadonlyArray<FrontFitPass>;
  readonly nativePortrait: Digest | undefined;
  readonly profileFit: FigureProfileFit | undefined;
  readonly hairLayer: boolean;
  readonly faceAnchor: FigureFaceAnchor | undefined;
  readonly eyes: FigureEyes | undefined;
  readonly fibres: FigureFibres | undefined;
  readonly hairCap: HairCap | undefined;
  readonly sourceHair: boolean;
  readonly plateField: PlateField | undefined;
  readonly plateSite: PlateSite | undefined;
  readonly hornSwatch: number;
  readonly hold: boolean;
  readonly finish: Finish;
  readonly motion: MotionRoleName | undefined;
  readonly wear: OutfitWear;
  readonly blend: boolean;
}

export interface BuildView {
  readonly label: string;
  readonly parts: ReadonlyArray<BuildPart>;
  readonly byId: ReadonlyMap<string, BuildPart>;
  readonly outfit: OutfitName;
  readonly appearance: Appearance | undefined;
  readonly skin: CreatureSkin;
  readonly plan: CreaturePlan | undefined;
  readonly build: FigureBuild | undefined;
  readonly poses: ReadonlyArray<JointPose>;
  readonly offer: { readonly pose: JointPose; readonly held: string } | undefined;
  readonly occluders: ReadonlyArray<PaintSource>;
  readonly layers: ReadonlyMap<string, LayerStyle>;
}

function viewPart(part: Part): BuildPart {
  const assembly = figureAssembly.read(part.features);
  const binding = figurePaint.read(part.features);
  const hull = figureHull.read(part.features);
  if (binding && hull)
    throw new Error(`Part ${part.id} has both a figure.paint binding and a figure.hull.`);
  if (part.paint && !binding && !hull)
    throw new Error(`Part ${part.id} is painted but has no figure.paint binding or figure.hull.`);
  if ((binding || hull) && !part.paint)
    throw new Error(`Part ${part.id} has a traced sheet binding but names no atlas.`);
  const anatomy = figureAnatomy.read(part.features)?.region;
  if (anatomy && !figureSweep.read(part.features))
    throw new Error(`Part ${part.id} names an anatomical region but is not a sweep.`);
  const hairCap = figureHairCap.read(part.features);
  const hairLayer = figureHeadLayer.read(part.features)?.layer === "hair";
  const sourceHair = hairCap?.sourceOnly === true;
  if (sourceHair && (!hairLayer || anatomy === "face" || !figureSweep.read(part.features)))
    throw new Error(`Part ${part.id} keeps only a source hair cap but is not a swept hair layer.`);
  if (binding?.portrait && anatomy !== "face" && !sourceHair)
    throw new Error(`Part ${part.id} has facial landmarks but is not a face.`);
  if (hairCap && ((anatomy !== "face" && !sourceHair) || !binding?.portrait))
    throw new Error(`Part ${part.id} has a hair cap but is not a traced face or its source hair.`);
  const depth = figurePortraitDepth.read(part.features);
  if (depth && !binding)
    throw new Error(`Part ${part.id} has a portrait depth but no figure.paint binding.`);
  if (depth?.pins && !figureSweep.read(part.features))
    throw new Error(`Part ${part.id} has depth landmarks but is not a sweep.`);
  if (depth?.field && binding && !sourceHair && !(anatomy === "face" && acceptsDepth(binding)))
    throw new Error(`Part ${part.id} has a fitted depth but is not a full traced face.`);
  const fitted = outfitFit.read(part.features) !== undefined;
  const piece = figurePiece.read(part.features);
  if (piece?.cranialProfile && piece.piece !== "head")
    throw new Error(`Part ${part.id} has a cranial profile but is not a head.`);
  if (figureSculpt.read(part.features) && piece?.piece !== "head" && anatomy !== "face")
    throw new Error(`Part ${part.id} has a face sculpt but is not a head or a face.`);
  const frontFits = figureFrontFit.read(part.features)?.passes ?? [];
  const profileFit = figureProfileFit.read(part.features);
  const eyes = figureEyes.read(part.features);
  if ((frontFits.length || profileFit || eyes) && piece?.piece !== "head" && anatomy !== "face")
    throw new Error(`Part ${part.id} has a face fit but is not a head or a face.`);
  const fibres = figureFibres.read(part.features);
  if (
    fibres &&
    (!figureSweep.read(part.features) ||
      part.paint ||
      anatomy === "face" ||
      fitted ||
      piece ||
      hairCap ||
      figureHand.read(part.features) ||
      figureMantle.read(part.features) ||
      creatureBlend.read(part.features)?.blend === true)
  )
    throw new Error(
      `Part ${part.id} has fibres but is not an unpainted sweep outside a joined skin, garment, hand or face.`,
    );
  const sweep = figureSweep.read(part.features);
  const seam = figureSeam.read(part.features)?.group;
  if (seam && !sweep) throw new Error(`Part ${part.id} has a seam group but is not a sweep.`);
  const foot = figureFoot.read(part.features)?.section;
  if (foot && (!sweep || (foot === "bare" && sweep.knots.length < 4)))
    throw new Error(
      `Part ${part.id} has a foot section but is not a sweep, or a bare foot of fewer than four knots.`,
    );
  const plateField = figurePlateField.read(part.features);
  if (plateField && !figureSweep.read(part.features))
    throw new Error(`Part ${part.id} has a plate field but is not a sweep.`);
  const plateSite = figurePlateSite.read(part.features);
  if (plateSite && (!figureCage.read(part.features) || part.parent === null))
    throw new Error(`Part ${part.id} has a plate site but is not a cage on a carrier.`);
  if (fitted && part.parent === null)
    throw new Error(`Part ${part.id} is a fitted garment without a parent region.`);
  const eyeSurface = creatureEyeSurface.read(part.features)?.surface;
  const cage = figureCage.read(part.features);
  if (eyeSurface && (!cage || cage.vertices.length < 16))
    throw new Error(`Part ${part.id} has an eye surface but is not a cage of 16 or more points.`);
  const wing = figureWing.read(part.features);
  if (
    wing &&
    (figureSweep.read(part.features) ||
      cage ||
      figureHand.read(part.features) ||
      figureMantle.read(part.features) ||
      figureScute.read(part.features) ||
      piece ||
      hull)
  )
    throw new Error(`Part ${part.id} has a wing surface and another surface.`);
  return {
    id: part.id,
    label: part.label,
    parent: part.parent,
    shape: part.shape,
    position: part.position,
    rotation: part.rotation,
    size: part.size,
    color: part.color,
    order: assembly?.order,
    attach: assembly ? { kind: "scaled", frameSize: assembly.frameSize } : { kind: "rigid" },
    sweep,
    cage: figureCage.read(part.features),
    scute: figureScute.read(part.features) !== undefined,
    markings: figureMarkings.read(part.features),
    undercoat: figureUndercoat.read(part.features),
    coatZone: creatureCoatZone.read(part.features)?.zone,
    eyeSurface,
    wing,
    organ: creatureOrgan.read(part.features) ?? {},
    limbChain: creatureLimbChain.read(part.features),
    paint: part.paint && binding ? { atlas: part.paint.atlas, trace: binding, depth } : undefined,
    volume: part.paint && hull ? { atlas: part.paint.atlas, hull } : undefined,
    hand: figureHand.read(part.features),
    join: checkedJoin(part),
    seam,
    pulls: figurePulls.read(part.features)?.pulls ?? [],
    foot,
    anatomy,
    fitted,
    mantle: figureMantle.read(part.features)?.cut,
    groom: figureGroom.read(part.features),
    piece,
    sculpt: figureSculpt.read(part.features)?.sculpt,
    frontFits,
    nativePortrait: figureNativePortrait.read(part.features)?.layer,
    profileFit,
    hairLayer,
    faceAnchor: figureFaceAnchor.read(part.features),
    eyes,
    fibres,
    hairCap,
    sourceHair,
    plateField,
    plateSite,
    hornSwatch: figureHornSwatch.read(part.features)?.swatch ?? 0,
    hold: motionHold.read(part.features) !== undefined,
    finish: figureFinish.read(part.features)?.surface ?? "plain",
    motion: motionRole.read(part.features)?.role,
    wear: outfitWear.read(part.features) ?? {},
    blend: creatureBlend.read(part.features)?.blend === true,
  };
}

function acceptsDepth(binding: FigurePaint): boolean {
  const first = binding.rest[0];
  const last = binding.rest.at(-1);
  if (!binding.portrait || !first || !last) return false;
  return (last[1] - first[1]) / binding.height > 0.72;
}

function checkedJoin(part: Part): FigureJoin | undefined {
  const join = figureJoin.read(part.features);
  if (!join) return undefined;
  const cage = figureCage.read(part.features);
  const fits = cage
    ? join.faces !== undefined && join.faces.every((i) => i < cage.faces.length)
    : figureSweep.read(part.features)
      ? join.end !== undefined && join.end !== "base"
      : figureScute.read(part.features) !== undefined && join.end === "base";
  if (part.parent === null || !fits)
    throw new Error(
      `Part ${part.id} has an invalid surface attachment. Select an existing parent and cage face or sweep end.`,
    );
  return join;
}

function checkPlateSites(parts: ReadonlyArray<BuildPart>): void {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const occupied = new Set<string>();
  for (const part of parts) {
    const site = part.plateSite;
    if (!site) continue;
    const field = part.parent === null ? undefined : byId.get(part.parent)?.plateField;
    const key = JSON.stringify([part.parent, site.row, site.column]);
    if (!field || site.row >= field.rows || site.column >= field.columns || occupied.has(key))
      throw new Error(`Part ${part.id} needs its own site on its carrier's plate field.`);
    occupied.add(key);
  }
}

function assemblyOrder(a: BuildPart, b: BuildPart): number {
  if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
  if (a.order !== undefined) return -1;
  if (b.order !== undefined) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function offerOf(
  offer: { readonly pose: string; readonly held: string } | undefined,
  poses: ReadonlyArray<JointPose>,
  byId: ReadonlyMap<string, BuildPart>,
): BuildView["offer"] {
  if (!offer) return undefined;
  const pose = poses.find((p) => p.name === offer.pose);
  if (!pose?.joints.length)
    throw new Error(`The offer clip reaches pose ${offer.pose}, which has no joints.`);
  const carrier = byId.get(offer.held)?.parent;
  if (carrier === null || carrier === undefined || byId.get(carrier)?.motion !== "hand")
    throw new Error(`The offer clip presents part ${offer.held}, which no hand holds.`);
  return { pose, held: offer.held };
}

export function buildView(doc: CharacterDocument): BuildView {
  const unsupported = doc.parts.filter((p) => p.sculpt.length || p.component);
  if (unsupported.length)
    throw new Error(
      "This build does not yet render sculpted or catalog parts: " +
        unsupported.map((p) => p.id).join(", "),
    );
  const parts = doc.parts.map(viewPart).sort(assemblyOrder);
  checkPlateSites(parts);
  for (const group of new Set(parts.flatMap((p) => (p.seam ? [p.seam] : []))))
    if (parts.filter((p) => p.seam === group).length > seamGroupLimit)
      throw new Error(`Join at most ${seamGroupLimit} figure regions in the ${group} seam group.`);
  if (parts.filter((p) => p.organ.rank === "spine").length > 1)
    throw new Error("A creature has one spine organ.");
  const outfit = outfitWardrobe.read(doc.features)?.outfit ?? "Work clothes";
  const poses = motionPoses.read(doc.features)?.poses ?? [];
  const offer = offerOf(
    motionOffer.read(doc.features),
    poses,
    new Map(parts.map((p) => [p.id, p])),
  );
  return {
    label: doc.label,
    parts,
    byId: new Map(parts.map((p) => [p.id, p])),
    outfit,
    appearance: characterAppearance.read(doc.features),
    skin: creatureSkin.read(doc.features) ?? {},
    plan: creaturePlan.read(doc.features),
    build: figureBuild.read(doc.features),
    poses,
    offer,
    occluders: figureOccluders.read(doc.features)?.sources ?? [],
    layers: garmentLayers(doc, parts),
  };
}

function garmentLayers(
  doc: CharacterDocument,
  parts: ReadonlyArray<BuildPart>,
): ReadonlyMap<string, LayerStyle> {
  const styles = outfitLayers.read(doc.features)?.layers ?? {};
  const byId = new Map(parts.map((p) => [p.id, p]));
  const layers = new Map<string, LayerStyle>();
  for (const part of parts) {
    let owner: BuildPart | undefined = part;
    while (owner && !owner.fitted)
      owner = owner.parent === null ? undefined : byId.get(owner.parent);
    const style = owner && Object.entries(styles).find(([id]) => id === owner.id)?.[1];
    if (style) layers.set(part.id, style);
  }
  return layers;
}

export function visibleIn(view: BuildView, part: BuildPart): boolean {
  const shown = part.wear.visibleIn;
  if (view.outfit === "Anatomy")
    return (
      (!shown || shown.includes("Anatomy")) &&
      part.wear.role !== "accessory" &&
      part.wear.role !== "skirt"
    );
  return view.layers.get(part.id)?.show ?? (!shown || shown.includes(view.outfit));
}

export function paintSources(
  view: BuildView,
): ReadonlyArray<FigurePaint & { readonly atlas: Digest }> {
  return [
    ...view.occluders,
    ...view.parts.flatMap((p) => (p.paint ? [{ ...p.paint.trace, atlas: p.paint.atlas }] : [])),
  ];
}

export function drawsBuiltinFace(view: BuildView): boolean {
  return view.parts.some((p) => p.piece?.piece === "head" && visibleIn(view, p));
}

export function partPlates(view: BuildView, part: BuildPart): Digest[] {
  if (!visibleIn(view, part)) return [];
  const side = part.profileFit?.stage === "finish" ? part.profileFit.side?.plate : undefined;
  return [
    ...part.frontFits.flatMap((pass) => (pass.plate ? [pass.plate] : [])),
    ...(side ? [side] : []),
    ...(part.nativePortrait ? [part.nativePortrait] : []),
  ];
}

export function portraitPlates(view: BuildView): Digest[] {
  return [...new Set(view.parts.flatMap((p) => partPlates(view, p)))].sort();
}

export function paintSheets(view: BuildView): Digest[] {
  return [
    ...new Set([
      ...paintSources(view).map((s) => s.atlas),
      ...view.parts.flatMap((p) => (p.volume ? [p.volume.atlas] : [])),
      ...(wearsExpedition(view) ? [expeditionAtlas] : []),
    ]),
  ].sort();
}
