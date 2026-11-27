import { hash1 } from "../identity.js";
export const armourDraws = (seed: number) => (n: number) =>
  hash1(Math.round(seed) * 7919 + n * 104729 + 17);
import type { TailorLayer } from "./tailor-data.js";
export const armourLooks = ["Light fantasy", "Heavy fantasy", "Light sci-fi", "Heavy sci-fi"];

export function armourSet(seed = 0, look = "Light fantasy") {
  const draw = armourDraws(seed);
  const pick = <T>(n: number, list: readonly [T, ...T[]]): T =>
    list[Math.floor(draw(n) * list.length) % list.length] ?? list[0];
  const heavy = look.startsWith("Heavy"),
    scifi = /sci-fi/.test(look);
  seed = Math.abs(Math.round(seed)) % 1000;
  const lopsided = pick(1, ["left heavier", "right heavier"]),
    single = pick(1, ["left only", "right only"]),
    layers: TailorLayer[] = [];
  if (scifi) {
    const [shell, accent] = pick<readonly [string, string]>(2, [
        ["#d5d8d2", "#d9642c"],
        ["#59664f", "#d8c23a"],
        ["#3f4650", "#35a7c2"],
        ["#b9b3a2", "#a8322c"],
        ["#c8ccd0", "#2f6fb5"],
      ]),
      suit = pick(3, ["#23272c", "#2a2f38", "#2c2a28"]);
    const plates = { color: shell, trim: accent, material: "lacquer" };
    layers.push({
      piece: "trousers",
      color: suit,
      fit: 1,
      ease: 4,
      waistband: 0,
      hemBand: 0,
      pockets: "none",
    });
    layers.push({
      piece: "top",
      color: suit,
      sleeve: 1.95,
      length: 0.7,
      ease: 3,
      stiff: 0.1,
      neck: "high",
      collar: "stand",
      front: "plain",
      cuff: 0,
      hemBand: 0,
      pockets: "none",
    });
    layers.push({
      piece: "boots",
      color: pick(4, ["#2b2d30", "#3a3c40"]),
      sole: "#1c1d1f",
      height: heavy ? 1.45 : 1.6,
      ease: 7,
      straight: 0.3,
      cuff: 26,
      thick: heavy ? 24 : 16,
      heel: 4,
      toe: 6,
    });
    layers.push({ piece: "gloves", color: suit, from: 1.9, ease: 3, cuff: 0 });
    layers.push({
      piece: "cuirass",
      ...plates,
      build: "hardshell",
      length: heavy ? 0.5 : 0.2,
      room: heavy ? 22 : 11,
      relief: 0.4 + 0.5 * draw(5),
      lames: heavy ? 3 : 2,
      collar: heavy ? "ring" : "open",
      back: heavy || draw(6) > 0.5 ? "pack" : "plain",
      seed,
    });
    if (heavy)
      layers.push({
        piece: "tassets",
        ...plates,
        cut: "angular",
        plates: "front and sides",
        lames: 1,
        length: 0.2 + 0.2 * draw(7),
        room: 12,
        seed,
      });
    layers.push({
      piece: "armguards",
      ...plates,
      cut: "angular",
      cover: heavy ? "whole arm" : "forearm",
      balance: heavy ? "matched" : pick(8, ["matched", lopsided]),
      room: heavy ? 9 : 5,
      seed,
    });
    layers.push({
      piece: "legguards",
      ...plates,
      cut: "angular",
      cover: heavy ? "whole leg" : "shin and knee",
      room: heavy ? 11 : 6,
      seed,
    });
    layers.push({
      piece: "pauldrons",
      ...plates,
      cut: "angular",
      lames: heavy ? 2 : 1,
      size: heavy ? 0.75 + 0.25 * draw(9) : 0.2 + 0.25 * draw(9),
      flange: heavy ? 0.3 * draw(10) : 0,
      balance: heavy
        ? pick(11, ["matched", lopsided, lopsided])
        : pick(11, [single, lopsided, "matched"]),
      room: heavy ? 10 : 6,
      seed,
    });
    return { layers };
  }
  const [steel, edge] = pick<readonly [string, string]>(2, [
      ["#8d9197", "#b08d4a"],
      ["#70767d", "#8f9296"],
      ["#9a927f", "#6b4a2e"],
      ["#5d6066", "#b9772f"],
      ["#a2a6aa", "#59606b"],
    ]),
    cloth = pick(3, ["#5b3f3a", "#3e4a5a", "#4d5540", "#6a5a44", "#4a3d52"]),
    hide = pick(4, ["#5b4334", "#4a3a2c", "#6b4d36"]);
  const leatherLight = !heavy && draw(5) > 0.5,
    plates = {
      color: leatherLight ? hide : steel,
      trim: edge,
      material: leatherLight ? "leather" : "steel",
    },
    limb = { color: steel, trim: hide, material: "steel" };
  const cutName = pick(6, ["rounded", "pointed", "rounded"]);
  layers.push({
    piece: "trousers",
    color: pick(7, ["#3a3d44", "#44403a", "#33373a"]),
    fit: 0.7,
    ease: 7,
    pockets: "none",
    hemBand: 0,
  });
  layers.push({
    piece: "top",
    color: cloth,
    material: heavy && draw(19) < 0.58 ? "mail" : "cloth",
    sleeve: 1.9,
    length: 0.95,
    ease: heavy ? 9 : 7,
    stiff: 0.75,
    neck: "high",
    collar: "stand",
    front: "plain",
    cuff: 14,
    hemBand: 12,
    pockets: "none",
  });
  layers.push({
    piece: "boots",
    color: hide,
    fastening: "buckled",
    height: heavy ? 1.3 : 1.45,
    ease: 9,
    straight: 0.4,
    cuff: 30,
    thick: 12,
    heel: 10,
  });
  if (heavy || draw(8) > 0.4)
    layers.push({ piece: "gloves", color: hide, from: 1.7, ease: 4, cuff: 10 });
  layers.push({
    piece: "cuirass",
    ...plates,
    build: heavy ? pick(9, ["fitted", "segmented"]) : pick(9, ["fitted", "fitted", "segmented"]),
    length: heavy ? 0.55 : 0.3,
    room: heavy ? 18 : 10,
    relief: 0.45 + 0.5 * draw(10),
    lames: heavy ? 4 : 3,
    collar: heavy ? "gorget" : "open",
    seed,
  });
  if (heavy)
    layers.push({
      piece: "tassets",
      color: steel,
      trim: edge,
      material: "steel",
      cut: cutName,
      plates: pick(11, ["front and sides", "all round"]),
      lames: 3,
      length: 0.35 + 0.3 * draw(12),
      room: 12,
      seed,
    });
  layers.push({
    piece: "armguards",
    ...limb,
    cut: cutName,
    cover: heavy ? "whole arm" : "forearm",
    balance: heavy ? "matched" : pick(13, ["matched", single, lopsided]),
    room: heavy ? 10 : 5,
    seed,
  });
  if (heavy || draw(14) > 0.5)
    layers.push({
      piece: "legguards",
      ...limb,
      cut: cutName,
      cover: heavy ? "whole leg" : "shin",
      room: heavy ? 10 : 6,
      seed,
    });
  layers.push({
    piece: "pauldrons",
    color: steel,
    trim: edge,
    material: "steel",
    cut: cutName,
    lames: heavy ? 3 + Math.floor(draw(15) * 2) : 2,
    size: heavy ? 0.7 + 0.3 * draw(16) : 0.15 + 0.3 * draw(16),
    flange: heavy ? 0.4 + 0.6 * draw(17) : 0,
    balance: heavy
      ? pick(18, [lopsided, lopsided, "matched"])
      : pick(18, [single, lopsided, lopsided]),
    room: heavy ? 9 : 6,
    seed,
  });
  layers.push({ piece: "belt", color: hide, at: 0.75, height: heavy ? 44 : 34 });
  return { layers };
}
