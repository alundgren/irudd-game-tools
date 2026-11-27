import { context2d, type Raster } from "../../raster.js";
import type { TailorLayer } from "./tailor-data.js";
import {
  MeshStandardMaterial,
  type Mesh,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  MathUtils,
  SRGBColorSpace,
} from "three";

const tau = 2 * Math.PI;
const { smoothstep } = MathUtils;

export function finishMantle(
  mesh: Mesh,
  coordinates: number[],
  layer: TailorLayer,
  raster: Raster,
) {
  if (!(mesh.material instanceof MeshStandardMaterial)) return;
  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(coordinates, 2));
  const width = 512,
    height = 384;
  const canvas = raster.canvas(width, height),
    relief = raster.canvas(width, height);
  const paint = context2d(canvas),
    bump = context2d(relief);
  const pixels = paint.createImageData(width, height),
    heights = bump.createImageData(width, height);
  const body = new Color(String(layer["color"]));
  const braid = new Color(String(layer["trim"]));
  const thread = braid.clone().lerp(new Color(String(layer["clasp"])), 0.35);
  const wool = new Color();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      const twill = Math.cos(tau * (x * 0.21 + y * 0.32));
      const nap =
        0.53 * Math.sin(1.42 * x + Math.sin(0.21 * y)) + 0.47 * Math.cos(1.17 * y + 0.33 * x);
      const edge = Math.min(u, 1 - u);
      const hem = 1 - v;
      const guard = smoothstep(hem, 0.02, 0.028) * (1 - smoothstep(hem, 0.124, 0.132));
      const rail = Math.max(
        1 - smoothstep(Math.abs(hem - 0.031), 0.002, 0.006),
        1 - smoothstep(Math.abs(hem - 0.12), 0.002, 0.006),
      );
      const along = Math.abs(((u * 32) % 1) - 0.5) * 2;
      const across = Math.abs(hem - 0.075) / 0.034;
      const lozenge = 1 - smoothstep(Math.abs(along + across - 1), 0.045, 0.16);
      const facing = 1 - smoothstep(Math.abs(edge - 0.013), 0.0015, 0.004);
      const brocade = Math.max(guard * lozenge, rail, 0.7 * facing);
      wool.copy(body).multiplyScalar(1 + 0.055 * twill + 0.028 * nap);
      wool.lerp(braid, guard * 0.25);
      wool.lerp(thread, brocade * (0.72 + 0.16 * twill));
      wool.convertLinearToSRGB();
      const i = 4 * (y * width + x);
      pixels.data[i] = 255 * wool.r;
      pixels.data[i + 1] = 255 * wool.g;
      pixels.data[i + 2] = 255 * wool.b;
      pixels.data[i + 3] = 255;
      heights.data[i] = 120 + 32 * twill + 11 * nap + 52 * brocade;
      heights.data[i + 1] = 235 - 28 * brocade + 8 * twill;
      heights.data[i + 2] = 0;
      heights.data[i + 3] = 255;
    }
  paint.putImageData(pixels, 0, 0);
  bump.putImageData(heights, 0, 0);
  const mat = mesh.material.clone();
  mat.color.set(0xffffff);
  mat.map = new CanvasTexture(canvas);
  mat.map.colorSpace = SRGBColorSpace;
  mat.bumpMap = mat.roughnessMap = new CanvasTexture(relief);
  mat.map.anisotropy = mat.bumpMap.anisotropy = 4;
  mat.bumpScale = 0.0017;
  mat.roughness = 1;
  mat.metalness = 0;
  mat.userData["foldedCloth"] = true;
  mat.name = "Mantle wool and woven guard";
  const tint = mat.map,
    raised = mat.bumpMap;
  mat.addEventListener("dispose", () => {
    tint.dispose();
    raised.dispose();
  });
  mesh.material = mat;
}
