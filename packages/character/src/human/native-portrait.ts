// A native portrait layer on the adult's painted face (applyNativePortrait in
// character-view/native-portrait.js at 2761eb1).
//
// The layer is G0's bake of a front and a profile photograph in the face
// paint's layout: colour variation around a neutral 128, masked by its alpha.
// Three multiplies the face map by the material colour in linear light, so the
// tinted face is kept everywhere and only the layer's relative detail is added
// inside its mask, scaled by the skin's own brightness. The layer follows a
// change of skin tone because the tint is the adult's current one.

import * as T from "three";
import { context2d, drawable, type Raster, type RasterImage } from "../raster.js";

/** Paint `layer` into the face `mesh` wears, as G0 does once the face and its eyes are built. */
export function applyNativePortrait(mesh: T.Mesh, layer: RasterImage, raster: Raster): void {
  const material: T.Material | T.Material[] = mesh.material;
  if (!(material instanceof T.MeshStandardMaterial) || !material.userData["faceLayout"])
    throw new Error("A native portrait layer paints the adult's painted face.");
  // G0 keeps a lower share on the open cheeks of a Weathered scars face, which is not ported.
  if (material.userData["quietCheeks"])
    throw new Error("A native portrait over quiet cheeks is not ported.");
  const source = drawable(material.map?.image);
  if (!source) throw new Error("The adult's face paint has no image to add the portrait to.");
  const { width, height } = source;
  const canvas = raster.canvas(width, height);
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const paint = ctx.getImageData(0, 0, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(layer, 0, 0, width, height);
  const overlay = ctx.getImageData(0, 0, width, height);
  const tint = new Float32Array(256 * 3),
    grey = new T.Color(),
    rgb = { r: 0, g: 0, b: 0 };
  for (let value = 0; value < 256; value++) {
    const s = value / 255;
    grey.setRGB(s, s, s, T.SRGBColorSpace).multiply(material.color).getRGB(rgb, T.SRGBColorSpace);
    tint.set([255 * rgb.r, 255 * rgb.g, 255 * rgb.b], value * 3);
  }
  const exposure = 0.56 + 0.36 * Math.sqrt((tint[255 * 3 + 1] ?? 0) / 255);
  const out = paint.data,
    over = overlay.data;
  for (let p = 0; p < out.length; p += 4) {
    const alpha = (over[p + 3] ?? 0) / 255;
    for (let c = 0; c < 3; c++) {
      const original = tint[(out[p + c] ?? 0) * 3 + c] ?? 0;
      out[p + c] = original + alpha * ((over[p + c] ?? 0) - 128) * exposure;
    }
  }
  ctx.putImageData(paint, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  material.map = map;
  material.color.set(0xffffff);
  material.userData["portraitPlate"] = true;
  mesh.userData["ownedPortraitTexture"] = true;
}
