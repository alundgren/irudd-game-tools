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
      let flat = flats.get(meshes);
      if (!flat) flats.set(meshes, (flat = meshes.map((m) => ({ positions: m.positions, indices: m.indices, color: [0, 0, 0] }))));
      const image = await draw.render(flat, { yaw, center, span, width, height, background: [1, 1, 1], supersample: 1 });
      const mask = new Uint8Array(width * height);
      for (let i = 0; i < mask.length; i++) mask[i] = image.data[i * 4 + 1] < 128 ? 1 : 0;
      return mask;
    },
  };
}
