import * as T from "three";
import type { CreatureDress } from "@irudd/document";
import { context2d, type Raster } from "../raster.js";
import type { BuildPart } from "../view.js";

type Uv = readonly [number, number];
export interface LiveryChart {
  readonly band: boolean;
  readonly uv: ReadonlyArray<Uv>;
}

const skirtRows = [0, 0.15, 0.36, 0.58, 0.79, 0.94, 1, 1, 0.78, 0.52, 0.24, 0];
const tunics = new Set(["robe", "capelet", "surcoat", "poncho", "tassets", "kilt"]);
const bands = new Set(["collar", "sash", "cinch", "stole"]);

export function liveryChart(
  part: BuildPart,
  dress: CreatureDress | undefined,
): LiveryChart | undefined {
  if (!dress?.device || !part.cage || !part.label.startsWith("dress ")) return undefined;
  const name = part.label.slice(6),
    total = part.cage.vertices.length;
  if (name === "mantle" && total === 126)
    return {
      band: false,
      uv: Array.from({ length: total }, (_, i): Uv => [
        (i % 9) / 8,
        1 - Math.floor((i % 63) / 9) / 6,
      ]),
    };
  let rows: readonly number[], sides: number, band: boolean;
  if (tunics.has(name)) {
    rows = skirtRows;
    sides = 16;
    band = false;
  } else if (bands.has(name) && total % 4 === 0) {
    rows = [0, 0, 1, 1];
    sides = total / 4;
    band = true;
  } else return undefined;
  if (total !== rows.length * sides) return undefined;
  return {
    band,
    uv: Array.from({ length: total }, (_, i): Uv => {
      const angle = (2 * Math.PI * (i % sides)) / sides;
      return [0.5 + Math.asin(Math.sin(angle)) / Math.PI, 1 - (rows[Math.floor(i / sides)] ?? 0)];
    }),
  };
}

export function creaturePlateChart(part: BuildPart): ReadonlyArray<Uv> | undefined {
  if (!part.cage || part.finish !== "metal" || !part.label.startsWith("dress ")) return undefined;
  const count = part.cage.vertices.length;
  let rows: number, cols: number, tiers: number;
  if (part.label.endsWith(" pauldron") || part.label.endsWith(" guard")) {
    rows = 4;
    cols = 7;
    tiers = count / (2 * rows * cols);
    if (tiers !== 1 && tiers !== 2) return undefined;
  } else if (part.label.endsWith(" greave") && count === 70) {
    rows = 5;
    cols = 7;
    tiers = 1;
  } else if (part.label === "dress lamellar barding" && count === 180) {
    rows = 3;
    cols = 5;
    tiers = 6;
  } else if (part.label === "dress cuirass" && count === 96) {
    const levels = [1, 1, 0.7, 0.3, 0, 0];
    return Array.from({ length: count }, (_, i): Uv => {
      const angle = (2 * Math.PI * (i % 16)) / 16;
      return [0.5 + 0.488 * Math.sin(angle), 1 - (0.02 + 0.64 * (levels[Math.floor(i / 16)] ?? 0))];
    });
  } else return undefined;
  return Array.from({ length: count }, (_, i): Uv => {
    const tier = Math.floor(i / (2 * rows * cols));
    const plate = i % (rows * cols);
    const v = Math.floor(plate / cols) / (rows - 1);
    const u = (plate % cols) / (cols - 1);
    const lame = tiers === 6 || tier > 0;
    return [0.012 + 0.976 * u, 1 - (lame ? 0.69 + 0.29 * v : 0.02 + 0.64 * v)];
  });
}

type Point = readonly [number, number];

function insignia(
  ctx: CanvasRenderingContext2D,
  design: CreatureDress["device"],
  gold: string,
  light: string,
  shadow: string,
) {
  const fill = (paint: string, draw: () => void) => {
    ctx.fillStyle = paint;
    ctx.beginPath();
    draw();
    ctx.closePath();
    ctx.fill();
  };
  const poly = (paint: string, points: readonly Point[]) =>
    fill(paint, () => {
      const [first, ...rest] = points;
      if (first) ctx.moveTo(first[0], first[1]);
      for (const [x, y] of rest) ctx.lineTo(x, y);
    });
  const disc = (paint: string, x: number, y: number, r: number) =>
    fill(paint, () => ctx.arc(x, y, r, 0, 2 * Math.PI));
  ctx.lineJoin = "round";
  if (design === "swallow") {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      fill(gold, () => {
        ctx.moveTo(0, 12);
        ctx.quadraticCurveTo(12, -19, 55, -37);
        ctx.bezierCurveTo(50, -17, 45, -6, 34, 0);
        ctx.lineTo(43, -4);
        ctx.quadraticCurveTo(35, 13, 18, 13);
        ctx.lineTo(24, 14);
        ctx.quadraticCurveTo(15, 21, 3, 19);
      });
      poly(light, [
        [7, 11],
        [40, -21],
        [25, 0],
      ]);
      ctx.restore();
    }
    fill(light, () => {
      ctx.moveTo(-6, 2);
      ctx.quadraticCurveTo(-10, -21, 3, -28);
      ctx.quadraticCurveTo(12, -32, 16, -24);
      ctx.lineTo(25, -21);
      ctx.lineTo(13, -17);
      ctx.quadraticCurveTo(10, 5, 5, 18);
      ctx.lineTo(19, 42);
      ctx.lineTo(0, 28);
      ctx.lineTo(-22, 44);
      ctx.quadraticCurveTo(-5, 17, -6, 2);
    });
    disc(shadow, 9, -24, 1.5);
  } else if (design === "oak") {
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      fill(gold, () => {
        ctx.moveTo(0, 31);
        ctx.bezierCurveTo(7, 11, 24, 8, 38, -25);
        ctx.bezierCurveTo(22, -23, 22, -16, 20, -14);
        ctx.quadraticCurveTo(18, -25, 12, -20);
        ctx.quadraticCurveTo(7, -16, 9, -6);
        ctx.quadraticCurveTo(-3, -11, 1, 7);
      });
      poly(light, [
        [0, 35],
        [8, 13],
        [31, -18],
        [11, 13],
        [5, 34],
      ]);
      disc(gold, 28, 11, 5);
      disc(light, 24, 19, 3);
      ctx.restore();
    }
    poly(light, [
      [0, -38],
      [7, -24],
      [0, -11],
      [-7, -24],
    ]);
  } else if (design === "tide") {
    for (const dy of [-11, 9, 29])
      fill(dy === -11 ? light : gold, () => {
        ctx.moveTo(-43, dy + 7);
        ctx.bezierCurveTo(-20, dy + 12, -11, dy - 19, 13, dy - 17);
        ctx.quadraticCurveTo(29, dy - 18, 30, dy - 6);
        ctx.quadraticCurveTo(13, dy - 13, 11, dy - 1);
        ctx.quadraticCurveTo(16, dy + 8, 42, dy - 1);
        ctx.quadraticCurveTo(21, dy + 17, 3, dy + 5);
        ctx.quadraticCurveTo(-19, dy + 22, -43, dy + 7);
      });
  } else {
    const star = design === "sunburst" ? 12 : 8;
    for (let i = 0; i < star; i++) {
      ctx.save();
      ctx.rotate((i * 2 * Math.PI) / star);
      const tip = star === 12 ? 43 : i % 2 === 0 ? 45 : 29;
      poly(gold, [
        [-6, 0],
        [0, -tip],
        [7, 0],
        [0, 7],
      ]);
      poly(light, [
        [0, 0],
        [0, -tip],
        [7, 0],
      ]);
      ctx.restore();
    }
    disc(shadow, 0, 0, star === 12 ? 16 : 11);
    disc(gold, 0, 0, star === 12 ? 12 : 6);
  }
}

function picture(
  raster: Raster,
  cloth: string,
  trim: string,
  device: CreatureDress["device"],
  band: boolean,
) {
  const canvas = raster.canvas(384, band ? 64 : 256);
  const ctx = context2d(canvas);
  const width = canvas.width,
    height = canvas.height;
  const dye = new T.Color(cloth),
    thread = new T.Color(trim);
  const hsl = { h: 0, s: 0, l: 0 };
  const dyeLight = dye.getHSL(hsl).l;
  if (Math.abs(dyeLight - thread.getHSL(hsl).l) < 0.15)
    thread.lerp(new T.Color(dyeLight > 0.45 ? "#4e3832" : "#f7eaca"), 0.48);
  const hex = (value: T.Color) => "#" + value.getHexString();
  const gold = hex(thread),
    light = hex(thread.clone().lerp(new T.Color("#ffebc8"), 0.36)),
    shadow = hex(dye.clone().multiplyScalar(0.48)),
    field = hex(dye.clone().lerp(thread, 0.09));
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, width, height);
  const hem = (y: number, h: number) => {
    ctx.fillStyle = shadow;
    ctx.fillRect(0, y, width, h);
    ctx.fillStyle = gold;
    ctx.fillRect(0, y + 1, width, 2);
    ctx.fillRect(0, y + h - 3, width, 2);
    const n = band ? 14 : 16,
      step = width / n;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * step,
        cy = y + h / 2;
      ctx.fillStyle = i % 2 ? light : gold;
      ctx.beginPath();
      ctx.moveTo(x, cy - h * 0.28);
      ctx.lineTo(x + step * 0.33, cy);
      ctx.lineTo(x, cy + h * 0.28);
      ctx.lineTo(x - step * 0.33, cy);
      ctx.closePath();
      ctx.fill();
    }
  };
  if (band) hem(7, height - 14);
  else {
    ctx.fillStyle = field;
    ctx.beginPath();
    ctx.moveTo(width * 0.24, 0);
    ctx.lineTo(width * 0.76, 0);
    ctx.lineTo(width * 0.66, height * 0.65);
    ctx.lineTo(width * 0.5, height * 0.8);
    ctx.lineTo(width * 0.34, height * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(width * 0.5, height * 0.39);
    ctx.scale(1.66, 1.66);
    insignia(ctx, device, gold, light, shadow);
    ctx.restore();
    hem(height * 0.85, height * 0.1);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function finishLivery(
  mesh: T.Mesh,
  part: BuildPart,
  dress: CreatureDress,
  chart: LiveryChart,
  materials: Map<string, T.Material>,
  raster: Raster,
  textures: T.Texture[],
) {
  const base = mesh.material;
  if (!(base instanceof T.MeshStandardMaterial)) return;
  const key = [part.color, dress.trim, dress.device, chart.band, base.uuid].join("/");
  let material = materials.get(key);
  if (!material) {
    const map = picture(raster, part.color, dress.trim, dress.device, chart.band);
    textures.push(map);
    const livery = base.clone();
    livery.color.set(0xffffff);
    livery.map = map;
    livery.userData["ownedLivery"] = true;
    materials.set(key, livery);
    material = livery;
  }
  mesh.material = material;
}
