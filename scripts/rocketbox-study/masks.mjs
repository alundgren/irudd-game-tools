// Silhouette masks for outline measurements, drawn on the graphics card when the machine has one.
//   const masks = await openMasks();              masks.name says what drew them; quote it with results
//   const mask = await masks.mask(meshes, view);  Uint8Array, 1 where the figure covers the pixel
//   await masks.close();
// It uses the shared Three.js renderer in scripts/human-style-render.mjs, which starts a headless
// browser with the platform's own hardware renderer. Without one, the masks come
// from the CPU rasterizer in raster.mjs, and the name says so.
// One difference: the hardware path draws alpha cut-out cards (hair, lashes) as solid; the CPU path
// cuts them by their texture when the mesh carries one.
import { openRenderer } from "../human-style-render.mjs";
import { render } from "./raster.mjs";

export async function openMasks() {
  const onCpu = (reason) => ({
    name: "CPU rasterizer (" + reason + ")", hardware: false,
    mask: async (meshes, view) => render(meshes, { ...view, mode: "silhouette", supersample: 1 }).mask,
    close: async () => {},
  });
  const draw = await openRenderer();
  if (!draw.hardware) { await draw.close(); return onCpu(draw.name); }
  const flats = new WeakMap();
  return {
    name: draw.name, hardware: true, close: () => draw.close(),
    async mask(meshes, { yaw, center, span, width, height }) {
      // One flat list per figure, so the renderer uploads it once and reuses it for every view.
      let flat = flats.get(meshes);
      if (!flat) flats.set(meshes, (flat = meshes.map((m) => ({ positions: m.positions, indices: m.indices, color: [0, 0, 0] }))));
      const image = await draw.render(flat, { yaw, center, span, width, height, background: [1, 1, 1], supersample: 1 });
      const mask = new Uint8Array(width * height);
      // The figure is black, its inside faces red, the background white: green tells figure from background.
      for (let i = 0; i < mask.length; i++) mask[i] = image.data[i * 4 + 1] < 128 ? 1 : 0;
      return mask;
    },
  };
}
