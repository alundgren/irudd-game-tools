import * as T from "three";
import type { CreaturePlan } from "@irudd/document";
import { context2d, type Raster } from "../raster.js";
import type { BuildPart } from "../view.js";

const { smoothstep } = T.MathUtils;

export interface BillChart {
  readonly uv: ReadonlyArray<readonly [number, number]>;
  readonly lower: boolean;
  readonly broad: boolean;
  readonly nostrils: boolean;
}

export function billChart(part: BuildPart, head: CreaturePlan["head"]): BillChart | undefined {
  const half = part.organ.bill;
  const cage = part.cage;
  if ((head.snout !== "bill" && head.snout !== "beak") || !cage || !half) return undefined;
  const lower = half === "lower";
  const sides = lower ? 8 : 10;
  if (cage.vertices.length !== 7 * sides + 2) return undefined;
  const length = [0, 0.14, 0.35, 0.62, 0.83, 0.95, 1];
  const uv = cage.vertices.map((_, index): readonly [number, number] => {
    if (index >= 7 * sides) return [index === 7 * sides ? 0.01 : 0.99, 0.5];
    const section = index % sides;
    return [
      0.01 + 0.98 * (length[Math.floor(index / sides)] ?? 0),
      0.01 + 0.98 * (1 - (2 * Math.min(section, sides - section)) / sides),
    ];
  });
  return { uv, lower, broad: head.snout === "bill", nostrils: !lower && head.nostrils };
}

interface BillFinish {
  readonly map: T.CanvasTexture;
  readonly surface: T.CanvasTexture;
}

function paintBill(
  raster: Raster,
  { lower, broad, nostrils }: BillChart,
  textures: T.Texture[],
): BillFinish {
  const width = 192;
  const height = 128;
  const paint = context2d(raster.canvas(width, height));
  const relief = context2d(raster.canvas(width, height));
  const rgb = paint.createImageData(width, height);
  const pbr = relief.createImageData(width, height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const u = (col + 0.5) / width;
      const flank = (row + 0.5) / height;
      const cere = lower ? 0 : 1 - smoothstep(u + 0.06 * Math.cos(flank * 5), 0.25, 0.39);
      const tip = smoothstep(u, broad ? 0.81 : 0.66, 0.98);
      const seamAt = lower ? 0.32 : 0.66;
      const edge = Math.exp(-(((flank - seamAt) / 0.048) ** 2));
      const growth = Math.sin(295 * (u + 0.22 * (flank - 0.36) ** 2) + 0.8 * Math.sin(57 * u));
      const fibre = Math.sin(154 * flank + 4 * Math.sin(11 * u + 2 * flank));
      const dx = (u - (broad ? 0.36 : 0.29)) / 0.07;
      const dy = (flank - (broad ? 0.23 : 0.33) + 0.018 * dx) / 0.065;
      const aperture = Math.hypot(dx, dy);
      const hole = nostrils ? 1 - smoothstep(aperture, 0.46, 0.96) : 0;
      const lip = nostrils ? Math.exp(-(((aperture - 1.05) / 0.24) ** 2)) : 0;
      const sheen = 0.88 + 0.055 * Math.cos(flank * Math.PI) + 0.034 * growth + 0.018 * fibre;
      const tone = sheen * (1 - 0.32 * tip + 0.095 * edge - 0.72 * hole + 0.085 * lip);
      const i = 4 * (row * width + col);
      rgb.data.set(
        [
          255 * tone,
          255 * tone * (1 - 0.065 * cere),
          255 * tone * (1 - 0.13 * cere + 0.08 * tip),
          255,
        ],
        i,
      );
      pbr.data.set(
        [
          124 + 7 * growth + 3 * fibre - 63 * hole + 24 * lip,
          108 + 68 * cere - 36 * tip + 18 * hole + 5 * fibre,
          0,
          255,
        ],
        i,
      );
    }
  paint.putImageData(rgb, 0, 0);
  relief.putImageData(pbr, 0, 0);
  const map = new T.CanvasTexture(paint.canvas);
  const surface = new T.CanvasTexture(relief.canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = surface.anisotropy = 4;
  textures.push(map, surface);
  return { map, surface };
}

export type BillFinishes = Map<string, BillFinish>;

export function finishBill(
  mesh: T.Mesh,
  chart: BillChart,
  finishes: BillFinishes,
  raster: Raster,
  textures: T.Texture[],
): void {
  const source: T.Material | T.Material[] = mesh.material;
  if (!(source instanceof T.MeshStandardMaterial))
    throw new Error("A bill has one standard material.");
  const material = source.clone();
  const key = [chart.lower, chart.broad, chart.nostrils].join("/");
  let finish = finishes.get(key);
  if (!finish) {
    finish = paintBill(raster, chart, textures);
    finishes.set(key, finish);
  }
  material.map = finish.map;
  material.bumpMap = finish.surface;
  material.roughnessMap = finish.surface;
  material.name = chart.broad ? "Bill sheath" : "Horn beak";
  material.metalness = 0;
  material.roughness = 1;
  material.bumpScale = 0.0014;
  mesh.material = material;
}
