export { referenceGlb } from "./reference-glb.js";
export * from "./paint/portrait-edit.js";
export { nativePortraitLayer } from "./human/project-portrait.js";
export { headFrame as portraitFrame } from "./surfaces/front-fit.js";
export * from "./view.js";
export * from "./build.js";
export * from "./export.js";
export * from "./wardrobe.js";
export * from "./garments.js";
export * from "./surface-edit.js";
export * from "./shape-tools.js";
export { mirrorCentre, previewPull } from "./surfaces/pull.js";
export * from "./place-branch.js";
export { fitSweptHand } from "./surfaces/fit-hand.js";
export { fitPaintedEyes } from "./surfaces/eyes.js";
export { expeditionAtlas, regionFit, type RegionFit } from "./dress.js";
export * from "./assets.js";
export { domRaster, type Raster, type RasterImage } from "./raster.js";
export {
  loadSurfaces,
  surfaceMaterial,
  surfaceMaterials,
  swatchSheet,
  type SurfaceKind,
  type SurfaceKit,
} from "./materials/surfaces.js";
export {
  loadPaintAtlases,
  preparePanels,
  type Binding,
  type PaintAtlases,
  type Panel,
  type Panels,
} from "./paint/turnaround.js";
export { loadPortraitPlates, type PortraitPlates } from "./paint/portrait.js";
export {
  gameTriangleTarget,
  optimizeForGame,
  type GameOptions,
  type GameResult,
} from "./game/optimize.js";
export { readGlb, writeGlb, type GlbParts } from "./glb.js";
export * from "./rig/preview.js";
export * from "./rig/arm-edit.js";
export { poseClipName } from "./rig/poses.js";
export { skinCharacter, type Region, type Rig } from "./rig/skin.js";
export { codeNotices, type CodeNotice } from "./notices.js";
export { repaintOperations, RepaintError } from "./paint/repaint.js";
export { inspectGlb, type GlbSummary, type ImageSummary, type MaterialSummary } from "./inspect.js";

export { startSkinStroke, skinMeshData } from "./human/brush-preview.js";
