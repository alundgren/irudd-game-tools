// The adult's textured-preset paint for hosts that render: decoding the paint
// pack's images through a raster. A subpath of its own keeps the generator's
// subpath (./index.ts) free of three, so a Node-only main process can load it.

export { prepareHumanPaint, type HumanPaintSources } from "./complexion.js";
export { humanPaintFile, loadHumanPaint } from "./index.js";
