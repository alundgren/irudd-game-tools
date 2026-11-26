import { armourLooks, armourSet } from "./human-armour.js";
import { faceMark } from "./human-face-marks.js";
import { randomStream } from "./random.js";
import { einarOutfit, einarShare } from "./human-einar-attire.js";
import { scannedClothes, scannedShare } from "./human-scanned-tops.js";

export const lookDirections = ["Any", "Everyday", "Smart", "Workwear", "Outdoors", "Festive", "Adventure"];
export const lookFields = ["outfit", "tailor", "armour", "clothColor", "clothSecond", "clothLight", "accentColor", "leatherColor", "soleColor", "metalColor", "clothDesign", "secondDesign", "clothAccent"];

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const rgb = hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
const hex = channels => "#" + channels.map(c => Math.round(clamp(c) * 255).toString(16).padStart(2, "0")).join("");
function hsl(colour) {
  const [r, g, b] = rgb(colour), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, d / (l < .5 ? max + min : 2 - max - min), l];
}
function fromHsl(h, s, l) {
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const channel = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return hex([channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]);
}
export const value = colour => { const [r, g, b] = rgb(colour); return .299 * r + .587 * g + .114 * b; };
const apart = (a, b) => Math.hypot(...rgb(a).map((c, i) => c - rgb(b)[i]));
const shade = (colour, k) => hex(rgb(colour).map(c => c * k));

const hues = [
  ["#e3b3ad", "#b8443c", "#6e2a2e"],
  ["#eebfa8", "#d2694c", "#8c3f2c"],
  ["#e8c3a0", "#b5622e", "#7a3f20"],
  ["#ead9a0", "#c8962e", "#8a6a22"],
  ["#cfd6a8", "#7d8a45", "#4a5630"],
  ["#b9d8c0", "#2f7a55", "#254a3a"],
  ["#aed6d0", "#2a7f80", "#1f4f55"],
  ["#b6cde3", "#3f6fb0", "#27407a"],
  ["#c3c4e6", "#5057a8", "#2f3166"],
  ["#d6bfdc", "#8a4a86", "#4f2a4e"],
  ["#ebbccb", "#a53c64", "#6c2445"],
];
const warmHues = new Set([0, 1, 2, 3, 4, 10]);
const neutrals = {
  pale: ["#efe8d8", "#e2d8c3", "#d5d3cc", "#f1eee6", "#cfc3ad"],
  mid: ["#b98f5f", "#8f8662", "#7d7166", "#5b677b", "#676b4a", "#8a8d90"],
  deep: ["#3a3d42", "#46362e", "#222733", "#27334d", "#2a2a2c", "#39402f"],
};
const denims = ["#47648c", "#2f4466", "#6f8db3", "#3a4a5e"];
const leathers = { warm: ["#a9794f", "#7a4e33", "#4a3528", "#8c5a3c", "#b99b78"], cool: ["#2a2725", "#4a3528", "#5c5a58", "#3b2d29", "#5e2b2b"] };
const metals = { warm: ["#b9965a", "#b0704a", "#8f7a52"], cool: ["#9a9da1", "#5c5f66", "#c2c5c8"] };

function tools(draw) {
  const pick = list => list[Math.floor(draw() * list.length)];
  const between = (a, b) => a + (b - a) * draw();
  return {
    draw, pick, between,
    chance: p => draw() < p,
    whole: (a, b) => Math.round(between(a, b)),
    part: (a, b) => Math.round(between(a, b) * 100) / 100,
    weighted(table) {
      let at = draw() * table.reduce((sum, [weight]) => sum + weight, 0);
      for (const [weight, item] of table) if ((at -= weight) < 0) return item;
      return table.at(-1)[1];
    },
    vary(colour) {
      const [h, s, l] = hsl(colour);
      return fromHsl((h + (draw() - .5) * .022 + 1) % 1, clamp(s * (1 + (draw() - .5) * .16)), clamp(l + (draw() - .5) * .045));
    },
  };
}

const schemes = {
  Any: [[30, "ground"], [16, "denim"], [20, "tonal"], [10, "analogous"], [14, "pop"], [4, "festive"], [6, "pastel"]],
  Smart: [[26, "ground"], [22, "tonal"], [10, "analogous"], [26, "pop"], [6, "festive"], [10, "pastel"]],
  Workwear: [[30, "ground"], [22, "denim"], [18, "tonal"], [12, "analogous"], [18, "pop"]],
  Festive: [[38, "festive"], [26, "analogous"], [18, "pastel"], [18, "ground"]],
};
function drawPalette(t, direction, lean = {}, skin = null) {
  const at = Math.floor(t.draw() * hues.length), step = t.chance(.5) ? 1 : -1;
  const strength = direction === "Festive" ? 1 : lean.strength ?? .7;
  const hue = (n, depth) => {
    const [h, s, l] = hsl(hues[((n % hues.length) + hues.length) % hues.length][depth - 1]);
    return fromHsl(h, s * strength, depth === 1 ? l - (1 - strength) * .12 : l);
  };
  const depth = t.weighted(lean.depth ?? [[2, 1], [5, 2], [4, 3]]);
  const scheme = t.weighted(schemes[direction] ?? schemes.Any);
  let feature, ground, accent, key = at;
  if (scheme === "ground") {
    feature = hue(at, depth);
    ground = t.pick(depth === 3 ? [...neutrals.pale, ...neutrals.mid] : depth === 1 ? [...neutrals.deep, ...neutrals.mid] : [...neutrals.deep, ...neutrals.deep, ...neutrals.mid, ...neutrals.pale]);
    accent = t.chance(.5) ? hue(at + step, depth === 1 ? 2 : 1) : hue(at + 5 + (step > 0 ? 1 : 0), 2);
  } else if (scheme === "denim") {
    key = t.pick([0, 1, 2, 3, 4, 5, 9, 10]);
    ground = t.pick(denims);
    feature = t.chance(.3) ? t.pick(neutrals.pale) : hue(key, t.weighted([[2, 1], [4, 2], [2, 3]]));
    accent = hue(t.pick([1, 2, 3]), 2);
  } else if (scheme === "tonal") {
    const [a, b] = t.pick([[1, 3], [3, 1], [2, 3], [2, 3], [1, 2]]);
    feature = hue(at, a);
    ground = hue(at + (t.chance(.4) ? step : 0), b);
    accent = t.pick(neutrals.pale);
  } else if (scheme === "analogous") {
    feature = hue(at, 2);
    ground = hue(at + step, 3);
    accent = hue(at - step, t.chance(.5) ? 1 : 2);
  } else if (scheme === "pop") {
    const [a, b] = t.pick([["pale", "deep"], ["deep", "mid"], ["mid", "deep"], ["deep", "pale"], ["pale", "mid"]]);
    feature = t.pick(neutrals[a]);
    ground = t.pick(neutrals[b]);
    accent = hue(at, 2);
  } else if (scheme === "festive") {
    feature = hue(at, 2);
    ground = hue(at + 4 + Math.floor(t.draw() * 3), t.chance(.6) ? 3 : 2);
    accent = t.chance(.5) ? hue(3, 2) : hue(at - 4, 2);
  } else {
    feature = hue(at, 1);
    ground = t.chance(.4) ? hue(at, 3) : t.pick([...neutrals.mid, ...neutrals.deep, ...neutrals.pale]);
    accent = hue(at + step, 2);
  }
  if (scheme === "festive" && direction !== "Festive") { const lift = colour => { const [h, s, l] = hsl(colour); return fromHsl(h, Math.min(1, s * 1.25), l); }; feature = lift(feature); accent = lift(accent); }
  if (lean.neutral && scheme !== "pop" && direction !== "Festive" && t.chance(lean.neutral)) {
    accent = hsl(feature)[2] > .62 ? hue(key, 2) : feature;
    feature = t.pick(value(ground) > .45 ? neutrals.deep : [...neutrals.pale, ...neutrals.mid]);
  }
  const warm = warmHues.has(key);
  if (Math.abs(value(feature) - value(ground)) < .15) ground = t.pick(value(feature) > .48 ? neutrals.deep : neutrals.pale);
  if (apart(accent, feature) < .2 || apart(accent, ground) < .2) accent = t.pick(value(feature) > .5 ? hues.map(h => h[1]) : hues.map(h => h[0]));
  if (skin && apart(feature, skin) < .17) feature = shade(feature, value(feature) > .4 ? .62 : 1.5);
  if (skin && apart(ground, skin) < .17) ground = shade(ground, value(ground) > .4 ? .62 : 1.5);
  if (lean.calm && direction !== "Festive") { const [h, s, l] = hsl(feature); if (s > .4 && l > .3 && l < .7) feature = fromHsl(h, s * .78, l * .9); }
  const swap = scheme !== "pop" && t.chance(lean.swap ?? .28);
  const pale = t.pick(warm ? ["#efe8d8", "#e2d8c3", "#f1eee6"] : ["#f1eee6", "#d5d3cc", "#e6e9ea"]);
  const deep = t.pick(warm ? ["#46362e", "#39402f", "#3a3d42"] : ["#3a3d42", "#222733", "#27334d", "#2a2a2c"]);
  const tones = {
    top: swap ? ground : feature, bottom: swap ? feature : ground, accent, pale, deep,
    leather: t.pick(leathers[warm ? "warm" : "cool"]),
    sole: t.pick(["#2c2a28", "#2c2a28", "#3a312b", "#b08a5c"]),
    metal: t.pick(metals[warm ? "warm" : "cool"]),
  };
  const strong = colour => { const [, s, l] = hsl(colour); return s > .42 && l > .3 && l < .7; };
  if (strong(tones.top) && strong(tones.bottom) && (scheme !== "festive" || t.chance(.5))) {
    const [h, s, l] = hsl(tones.bottom), deeper = fromHsl(h, s * .7, l * .52);
    tones.bottom = Math.abs(value(deeper) - value(tones.top)) > .13 ? deeper : deep;
  }
  for (const name of Object.keys(tones)) tones[name] = t.vary(tones[name]);
  return Object.assign(tones, { scheme, warm });
}

const usual = p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: p.pale, accentColor: p.accent });
const quiet = [6, "Quiet weave"];
const festiveDesigns = { "Quiet weave": 1 / 3, Pinstripe: .4, "Breton stripe": .6, "Hem border": 2, "Knit yoke": 2, Gingham: 1.5, Windowpane: 1.3, "Small dots": 1.5, "Chest band": 1.3 };
function suited(p) {
  const cloth = value(p.top) > .74 ? p.deep : p.top, shirt = value(cloth) < .62 && value(p.accent) > .6 ? p.accent : p.pale;
  const tie = [p.accent, p.bottom, echo(p.accent, shirt, p.deep), p.deep].find(colour => apart(colour, cloth) > .22 && apart(colour, shirt) > .3) ?? p.deep;
  return { clothColor: cloth, clothSecond: cloth, clothLight: shirt, accentColor: tie };
}
const drab = (colour, low, high, keep = .55) => { const [h, s, l] = hsl(colour); return fromHsl(h, s * keep, clamp(l, low, high)); };
const weathered = p => ({ clothColor: drab(p.top, .2, .36), clothSecond: drab(p.bottom, .16, .32, .5), clothLight: drab(p.deep, .1, .24, .6), accentColor: drab(p.accent, .2, .4, .6) });
const presets = {
  "T-shirt and jeans": { weight: 1, suits: ["Everyday"], denim: .65, designs: [quiet, [3, "Breton stripe"], [2, "Chest band"], [1, "Small dots"]] },
  "Hoodie and joggers": { weight: 1, suits: ["Everyday"], designs: [quiet, [3, "Colour block"], [2, "Chest band"]] },
  "Shirt and chinos": { weight: 1, suits: ["Everyday", "Smart"], designs: [[4, "Quiet weave"], [2, "Gingham"], [2, "Windowpane"], [2, "Pinstripe"], [1, "Small dots"]], second: [[8, null], [2, "Herringbone"]] },
  "Sweater and skirt": { trousers: false, weight: 1, suits: ["Everyday", "Smart", "Festive"], tones: p => ({ clothColor: p.top, accentColor: p.bottom, clothSecond: echo(p.top, p.bottom, p.deep), clothLight: p.pale }), designs: [[4, "Quiet weave"], [2, "Knit yoke"], [2, "Breton stripe"], [1, "Chest band"]], second: [[5, null], [2, "Windowpane"], [2, "Herringbone"], [2, "Hem border"], [1, "Gingham"]] },
  "Evening gown": { trousers: false, weight: .68, suits: ["Festive"], lean: { swap: 0 }, tones: p => ({ clothColor: p.deep, clothSecond: p.top, clothLight: p.pale, accentColor: p.metal }), designs: [[3, "Quiet weave"], [2, "Hem border"], [2, "Scallop brocade"]] },
  "Day dress": { trousers: false, weight: 1, suits: ["Everyday", "Smart", "Festive"], lean: { swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: Math.abs(value(p.accent) - value(p.top)) > .12 ? p.accent : p.deep, clothLight: p.pale, accentColor: p.accent }), designs: [[4, "Quiet weave"], [3, "Hem border"], [2, "Windowpane"], [1.4, "Gingham"]] },
  "Running kit": { trousers: false, weight: .5, suits: ["Outdoors"], lean: { depth: [[2, 1], [6, 2], [2, 3]] }, designs: [[4, "Colour block"], [3, "Chest band"], quiet] },
  "Coveralls": { weight: .7, suits: ["Workwear"], lean: { depth: [[1, 1], [5, 2], [5, 3]], swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: p.deep, clothLight: p.pale, accentColor: p.accent }), designs: [[5, "Outfit swatch"], [3, "Quiet weave"], [2, "Pinstripe"]] },
  "Chore jacket": { weight: 1, suits: ["Workwear", "Everyday"], denim: .35, designs: [quiet, [2, "Herringbone"], [2, "Pinstripe"], [2, "Colour block"]] },
  "Workshop apron": { weight: .6, suits: ["Workwear"], denim: .4, lean: { depth: [[1, 1], [5, 2], [5, 3]] }, tones: p => ({ clothColor: p.leather, clothLight: p.top, clothSecond: p.bottom, accentColor: p.accent }), designs: [[4, "Outfit swatch"], [4, "Quiet weave"], [2, "Pinstripe"]], second: [[5, null], [2, "Gingham"], [2, "Pinstripe"]] },
  "Overcoat": { weight: 1, suits: ["Smart", "Outdoors"], lean: { depth: [[1, 1], [4, 2], [6, 3]], neutral: .35 }, designs: [[4, "Herringbone"], [4, "Quiet weave"], [2, "Windowpane"]], second: [[4, null], [3, "Breton stripe"], [2, "Gingham"], [2, "Windowpane"]] },
  "Traveller": { trousers: false, hide: true, weight: .6, suits: ["Adventure", "Outdoors"], tones: p => ({ clothColor: p.top, accentColor: p.bottom, clothSecond: p.deep, clothLight: p.pale }), designs: [[5, "Outfit swatch"], [3, "Hem border"], [2, "Quiet weave"]], second: [[5, null], [3, "Hem border"]] },
  "Explorer": { weight: .6, suits: ["Outdoors", "Adventure"], lean: { depth: [[1, 1], [5, 2], [5, 3]] }, tones: p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: p.pale, accentColor: echo(p.bottom, p.top, p.deep) }), designs: [quiet, [3, "Colour block"]] },
  "Parka": { weight: .8, suits: ["Outdoors"], designs: [[5, "Colour block"], [4, "Quiet weave"], [2, "Chest band"]] },
  "Leather armour": { hide: true, weight: .35, suits: ["Adventure"], tones: p => ({ clothColor: p.top, clothSecond: p.deep, clothLight: p.pale, accentColor: p.accent }), designs: [[5, "Quiet weave"], [4, "Hem border"]] },
  "Pressure suit": { weight: .3, suits: ["Adventure"], tones: p => ({ clothColor: value(p.top) > .55 ? p.top : p.pale, clothSecond: p.deep, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Quiet weave"]] },
  "Overshirt and denim": { weight: 1.25, suits: ["Everyday", "Workwear"], denim: 1, lean: { swap: 0 }, designs: [[1, "Outfit swatch"]] },
  "Striped shirt and jeans": { weight: 1.1, suits: ["Everyday", "Smart"], denim: .85, designs: [[1, "Outfit swatch"]] },
  "Track top and leggings": { weight: .8, suits: ["Everyday", "Outdoors"], tones: p => ({ clothColor: p.top, clothSecond: p.deep, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Field jacket and denim": { weight: 1.2, suits: ["Everyday", "Outdoors"], denim: 1, lean: { swap: 0 }, designs: [[1, "Outfit swatch"]] },
  "Workshop overalls": { weight: .4, suits: ["Workwear"], lean: { swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: p.deep, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Tailored suit": { weight: 1.2, suits: ["Smart"], lean: { depth: [[.7, 1], [1.5, 2], [8, 3]], neutral: .45, swap: 0, calm: true }, tones: suited, designs: [[1, "Outfit swatch"]] },
  "Mail tunic and boots": { weight: 0, attire: 1.5, suits: ["Adventure"], hide: true, lean: { depth: [[.4, 1], [4, 2], [6, 3]], swap: 0 }, designs: [[1, "Outfit swatch"]] },
  "Rope-belted robe": { trousers: false, weight: 0, attire: 1, suits: ["Adventure"], hide: true, lean: { depth: [[.6, 1], [4, 2], [6, 3]], swap: 0, calm: true, neutral: .3 }, tones: p => ({ clothColor: p.top, clothSecond: echo(p.top, p.top, p.deep), clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  [einarOutfit]: { weight: 0, suits: ["Adventure", "Outdoors"], hide: true, lean: { depth: [[.5, 1], [4, 2], [5, 3]], swap: 0, calm: true, neutral: .4 }, tones: weathered, designs: [[1, "Outfit swatch"]] },
  "Survey vest": { weight: 0, suits: ["Workwear", "Outdoors"], hide: true, tones: weathered, designs: [[1, "Outfit swatch"]] },
  "Hoodie and denim shorts": { weight: 0, suits: ["Everyday"], hide: true, denim: .85, designs: [[1, "Outfit swatch"]] },
  "Crew sweatshirt and trousers": { weight: 0, suits: ["Everyday", "Outdoors"], lean: { swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Crew sweatshirt and cargo trousers": { weight: 0, suits: ["Everyday", "Outdoors", "Workwear"], lean: { swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Cable V-neck and trousers": { weight: 0, suits: ["Everyday", "Smart"], lean: { swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Cable V-neck and cargo trousers": { weight: 0, suits: ["Everyday", "Outdoors"], lean: { swap: 0 }, tones: p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Shift dress": { trousers: false, weight: 0, everyday: .6, suits: ["Smart", "Everyday", "Festive"], lean: { depth: [[1, 1], [4, 2], [5, 3]], swap: 0, calm: true }, tones: p => ({ clothColor: p.top, clothSecond: apart(p.accent, p.top) > .35 ? p.accent : value(p.top) > .45 ? p.deep : p.pale, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
  "Rib knit and full skirt": { trousers: false, weight: 0, everyday: 1, suits: ["Everyday", "Smart", "Festive"], lean: { swap: 0 }, tones: p => { const ground = value(p.bottom) < .36 ? p.bottom : echo(p.bottom, p.top, p.deep); const flowers = value(p.accent) - value(ground) > .3 ? p.accent : p.pale; return { clothColor: p.top, clothSecond: ground, clothLight: hex(rgb(ground).map((c, i) => c + (rgb(flowers)[i] - c) * .5)), accentColor: p.accent }; }, designs: [[1, "Outfit swatch"]] },
  "Striped blouse and skirt": { trousers: false, weight: .7, suits: ["Smart", "Everyday"], tones: p => ({ clothColor: echo(p.bottom, p.top, p.deep), clothSecond: p.top, clothLight: p.pale, accentColor: p.accent }), designs: [[1, "Outfit swatch"]] },
};
const far = (colour, beside, ...others) => [colour, ...others].find(c => apart(c, beside) > .3) ?? others.at(-1) ?? colour;
const mantled = p => { const cloak = [p.bottom, p.deep, shade(p.top, .45)].find(c => value(c) < .5 && apart(c, p.top) > .25) ?? p.deep; return { clothColor: p.top, accentColor: cloak, clothLight: far(p.accent, cloak, p.pale, p.deep), clothSecond: far(p.deep, p.top, p.pale) }; };
const ribbed = p => ({ clothColor: p.top, clothSecond: p.bottom, clothLight: far(p.pale, p.top, p.accent, p.deep), accentColor: value(p.top) > .3 ? shade(p.top, .55) : shade(p.top, 1.7) });
const gowned = p => ({ clothColor: p.top, clothSecond: echo(p.top, p.top, p.deep), accentColor: far(p.accent, p.top, p.bottom, p.pale), clothLight: far(p.metal, p.top, p.pale) });
Object.assign(presets, {
  "Split mantle": { trousers: false, hide: true, weight: 0, capsule: .8, suits: ["Adventure", "Outdoors"], lean: { depth: [[.6, 1], [5, 2], [5, 3]] }, tones: mantled, designs: [[4, "Quiet weave"], [3, "Herringbone"], [3, "Hem border"]], second: [[5, null], [3, "Hem border"]] },
  "Hooded shoulder cloak": { trousers: false, hide: true, weight: 0, capsule: .7, suits: ["Adventure", "Outdoors"], lean: { depth: [[1, 1], [5, 2], [4, 3]] }, tones: mantled, designs: [[4, "Quiet weave"], [4, "Herringbone"], [2, "Windowpane"]], second: [[5, null], [3, "Hem border"]] },
  "Bomber and wide trousers": { weight: 0, capsule: 1.3, suits: ["Everyday"], denim: .12, tones: ribbed, designs: [[6, "Quiet weave"], [3, "Colour block"]], second: [[5, null], [2, "Pinstripe"], [2, "Herringbone"], [1.5, "Windowpane"]] },
  "Rolled bomber and cuffed trousers": { weight: 0, capsule: 1.2, suits: ["Everyday", "Outdoors"], denim: .3, tones: ribbed, designs: [[5, "Quiet weave"], [2, "Colour block"], [2, "Herringbone"]], second: [[6, null], [2, "Windowpane"], [2, "Gingham"]] },
  "Bodice and gored skirt": { trousers: false, weight: 0, capsule: 1.1, suits: ["Festive", "Smart", "Everyday"], lean: { swap: 0, depth: [[.6, 1], [5, 2], [5, 3]] }, tones: gowned, designs: [[4, "Quiet weave"], [3, "Scallop brocade"], [2, "Hem border"], [1.5, "Small dots"]] },
  "Draped bodice gown": { trousers: false, weight: 0, capsule: .6, suits: ["Festive"], lean: { swap: 0, depth: [[.6, 1], [5, 2], [5, 3]] }, tones: gowned, designs: [[4, "Quiet weave"], [3, "Scallop brocade"], [3, "Hem border"]] },
});
const capsuleShare = { Any: .15, Everyday: .16, Smart: .1, Outdoors: .2, Festive: .24, Adventure: .28 };
const separatesShare = { Any: 4.5, Everyday: 4.5, Smart: 3, Workwear: 1.2, Outdoors: 2.4, Festive: 3.5, Adventure: .4 };
const armourShare = { Any: 1.5, Adventure: 5 };
const attireShare = { Any: .06, Adventure: .3 };
const everydayShare = { Any: .1, Everyday: .12, Smart: .1, Festive: .1 };

function echo(colour, beside, fallback) {
  const [h, s, l] = hsl(colour), deeper = fromHsl(h, s * .8, Math.min(l * .55, .3));
  return s > .12 && Math.abs(value(deeper) - value(beside)) > .14 ? deeper : fallback;
}
function settled(t, colour, beside) {
  const [h, s, l] = hsl(colour);
  if (s < .42 || l < .34 || l > .62 || !(t.chance(.65) || s > .55)) return colour;
  const quieter = fromHsl(h, s * .74, l * .7);
  return Math.abs(value(quieter) - value(beside)) > .13 ? quieter : colour;
}
function lower(t, p, denim) {
  const blues = denims.filter(colour => Math.abs(value(colour) - value(p.top)) > .16);
  if (blues.length && t.chance(denim)) p.bottom = t.vary(t.pick(blues));
  else p.bottom = settled(t, p.bottom, p.top);
  const darker = [...neutrals.mid, ...neutrals.deep].filter(colour => Math.abs(value(colour) - value(p.top)) > .16);
  if (value(p.bottom) > .72 && darker.length && t.chance(denim >= 1 ? 1 : .6)) p.bottom = t.vary(t.pick(darker));
  if (Math.abs(value(p.bottom) - value(p.top)) < .12) p.bottom = value(p.top) > .45 ? p.deep : p.pale;
}
function printColour(t, cloth, p) {
  const echoes = [p.bottom, p.top, p.accent, value(cloth) > .5 ? p.deep : p.pale].filter(colour => apart(colour, cloth) > .28);
  return echoes.length && t.chance(.78) ? t.pick(echoes) : null;
}
function presetLook(t, outfit, direction, skin) {
  const spec = presets[outfit], p = drawPalette(t, direction, spec.lean, skin);
  if (spec.trousers !== false) lower(t, p, spec.denim ?? 0);
  if (spec.hide) p.leather = t.vary(t.pick(leathers.warm.slice(0, 4)));
  const style = { outfit, ...(spec.tones ?? usual)(p), leatherColor: p.leather, soleColor: p.sole, metalColor: p.metal };
  const festive = direction === "Festive";
  style.clothDesign = t.weighted(spec.designs.map(([weight, name]) => [festive ? weight * (festiveDesigns[name] ?? 1) : weight, name]));
  const second = ["Quiet weave", "Herringbone"].includes(style.clothDesign) && spec.second ? t.weighted(spec.second) : null;
  if (second) style.secondDesign = second;
  if (!["Quiet weave", "Outfit swatch", "Herringbone"].includes(style.clothDesign)) {
    const print = printColour(t, style.clothColor, p);
    if (print) style.clothAccent = print;
  }
  return { style, outfit: outfit === "Pressure suit" ? "Pressure suit" : "Work clothes", palette: p };
}

const bottoms = {
  straight: t => ({ length: 2.03, fit: t.part(.06, .18), ease: t.whole(8, 11), rise: t.part(.45, .7), pockets: "back", hemBand: 14 }),
  relaxed: t => ({ length: 2.03, fit: t.part(0, .08), ease: t.whole(12, 17), rise: t.part(.6, .85), pockets: t.pick(["back", "none"]), hemBand: t.pick([14, 30]) }),
  slim: t => ({ length: 2.03, fit: t.part(.16, .22), ease: t.whole(8, 10), rise: .5, pockets: "back", hemBand: 10 }),
  cropped: t => ({ length: t.part(1.72, 1.86), fit: t.part(.05, .2), ease: t.whole(9, 13), rise: t.part(.6, .85), pockets: "back", hemBand: t.pick([14, 34]) }),
  shorts: t => ({ length: t.part(.72, 1.02), fit: t.part(0, .08), ease: t.whole(10, 14), rise: .55, pockets: t.pick(["back", "cargo", "back"]), hemBand: t.pick([12, 24]) }),
  cargo: t => ({ length: 2.03, fit: t.part(.04, .14), ease: t.whole(11, 14), rise: .55, pockets: "back and cargo", hemBand: 18 }),
};
const bases = {
  tee: t => ({ sleeve: t.part(.42, .62), length: t.part(.5, .7), ease: t.whole(7, 10), neck: t.pick(["crew", "crew", "v"]), depth: t.whole(45, 60), cuff: 14, hemBand: 14, pockets: t.pick(["none", "none", "chest"]) }),
  longTee: t => ({ sleeve: t.part(1.88, 1.95), length: t.part(.55, .7), ease: t.whole(7, 9), neck: "crew", cuff: 30, hemBand: 16 }),
  polo: t => ({ sleeve: t.part(.45, .58), length: t.part(.55, .65), ease: t.whole(8, 10), neck: "v", depth: t.whole(60, 80), collar: "shirt", cuff: 18, hemBand: 0 }),
  shirt: t => ({ sleeve: t.pick([1.42, 1.93, 1.93]), length: t.part(.7, .85), ease: t.whole(7, 10), neck: "v", depth: t.whole(45, 60), collar: "shirt", front: "buttons", buttons: t.whole(5, 7), cuff: 30, hemBand: 0, pockets: t.pick(["none", "chest"]) }),
  campShirt: t => ({ sleeve: t.part(.5, .62), length: t.part(.7, .8), ease: t.whole(10, 13), neck: "v", depth: t.whole(80, 110), collar: "shirt", front: "buttons", buttons: t.whole(4, 5), cuff: 0, hemBand: 0, pockets: "chest" }),
  tank: t => ({ sleeve: t.part(.08, .14), length: t.part(.55, .7), ease: t.whole(6, 8), neck: "scoop", depth: t.whole(70, 100), cuff: 10, hemBand: 10 }),
  rollneck: t => ({ sleeve: 1.93, length: t.part(.55, .7), ease: t.whole(8, 11), stiff: .15, neck: "high", collar: "stand", cuff: 44, hemBand: 44, gather: t.part(.3, .5) }),
};
const outers = {
  bomber: t => ({ sleeve: 1.93, length: t.part(.25, .45), ease: t.whole(13, 16), stiff: t.part(.55, .7), neck: "v", depth: t.whole(110, 150), collar: "stand", front: "zip", cuff: 40, hemBand: 44, gather: t.part(.5, .7), pockets: "none" }),
  leather: t => ({ material: "leather", sleeve: 1.93, length: t.part(.3, .5), ease: t.whole(12, 14), stiff: .7, neck: "v", depth: t.whole(140, 190), collar: "shirt", front: "zip", cuff: 26, hemBand: 30, gather: t.part(.3, .6), pockets: "none" }),
  waistcoat: t => ({ sleeve: t.part(.06, .1), length: t.part(.35, .5), ease: t.whole(9, 12), stiff: .6, neck: "v", depth: t.whole(190, 240), front: "buttons", buttons: t.whole(3, 5), cuff: 0, hemBand: 0, pockets: "none" }),
  overshirt: t => ({ sleeve: t.pick([1.25, 1.93, 1.93]), length: t.part(.8, .95), ease: t.whole(14, 17), stiff: t.part(.1, .3), neck: "v", depth: t.whole(220, 260), collar: "shirt", front: "plain", cuff: t.pick([0, 30]), hemBand: 0, pockets: "chest" }),
  cardigan: t => ({ sleeve: 1.93, length: t.part(.75, .95), ease: t.whole(12, 15), stiff: .15, neck: "v", depth: t.whole(180, 230), front: "buttons", buttons: t.whole(4, 5), cuff: 44, hemBand: 44, pockets: t.pick(["hip", "none"]) }),
  zipHoodie: t => ({ sleeve: 1.9, length: t.part(.7, .8), ease: t.whole(14, 17), stiff: .15, neck: "crew", collar: "hood", front: "zip", cuff: 40, hemBand: 46, gather: .5, pockets: "hip" }),
  tunicCoat: t => ({ sleeve: 1.93, length: 1, ease: t.whole(12, 14), stiff: .8, neck: "high", collar: "stand", front: "buttons", buttons: t.whole(6, 8), cuff: 34, hemBand: 20, pockets: "hip" }),
  gilet: t => ({ sleeve: t.part(.06, .1), length: t.part(.5, .65), ease: t.whole(14, 17), stiff: .7, neck: "high", collar: "stand", front: "zip", cuff: 0, hemBand: 20, pockets: "hip" }),
  blazer: t => ({ sleeve: 1.93, length: t.part(.85, .95), ease: t.whole(12, 14), stiff: .75, neck: "v", depth: t.whole(200, 250), collar: "shirt", front: "buttons", buttons: 2, cuff: 0, hemBand: 0, pockets: "chest and hip" }),
};
const footwear = {
  trainers: t => ["shoes", { material: "cloth", collar: t.whole(52, 64), thick: t.whole(14, 20), heel: 0, toe: t.whole(0, 4) }],
  loafers: t => ["shoes", { collar: t.whole(38, 46), thick: t.whole(8, 10), heel: t.whole(6, 14) }],
  hightops: t => ["shoes", { material: "cloth", collar: t.whole(105, 130), thick: t.whole(14, 18), heel: 0 }],
  ankle: t => ["boots", { height: t.part(1.74, 1.86), ease: t.whole(6, 8), straight: .4, cuff: 0, thick: t.whole(12, 18), heel: t.whole(8, 16) }],
  mid: t => ["boots", { height: t.part(1.42, 1.6), ease: t.whole(9, 12), straight: .5, cuff: t.pick([0, 30, 36]), thick: t.whole(14, 20), heel: t.whole(8, 12) }],
  tall: t => ["boots", { height: t.part(1.14, 1.3), ease: t.whole(8, 11), straight: .3, cuff: t.whole(30, 44), thick: t.whole(12, 15), heel: t.whole(10, 22) }],
};
const outerDesigns = {
  bomber: [quiet, [2, "Chest band"], [2, "Colour block"]], waistcoat: [[4, "Quiet weave"], [3, "Pinstripe"], [3, "Herringbone"], [2, "Windowpane"]],
  overshirt: [[4, "Quiet weave"], [4, "Gingham"], [3, "Windowpane"]], cardigan: [[4, "Quiet weave"], [2, "Knit yoke"], [2, "Breton stripe"], [2, "Herringbone"]],
  zipHoodie: [quiet, [2, "Colour block"], [2, "Chest band"]], tunicCoat: [[4, "Quiet weave"], [3, "Herringbone"], [3, "Hem border"]],
  gilet: [quiet, [2, "Colour block"]], blazer: [[4, "Quiet weave"], [3, "Herringbone"], [2, "Windowpane"]],
};
const baseDesigns = {
  tee: [quiet, [3, "Breton stripe"], [2, "Chest band"], [1, "Small dots"]], longTee: [quiet, [4, "Breton stripe"], [1, "Chest band"]], polo: [quiet, [3, "Chest band"], [2, "Breton stripe"]],
  shirt: [[4, "Quiet weave"], [2.4, "Gingham"], [2, "Windowpane"], [.6, "Small dots"]], campShirt: [[3, "Quiet weave"], [3, "Small dots"], [2, "Gingham"], [2, "Hem border"]],
  tank: [quiet, [2, "Breton stripe"]], rollneck: [quiet, [2, "Knit yoke"], [2, "Breton stripe"]],
};
function separatesLook(t, direction, skin) {
  const smart = direction === "Smart", outdoors = direction === "Outdoors" || direction === "Workwear" || direction === "Adventure";
  const cut = t.weighted(smart ? [[4, "straight"], [2, "relaxed"], [2, "slim"], [2, "cropped"]] : [[3, "straight"], [2.2, "relaxed"], [1, "slim"], [1.2, "cropped"], [outdoors ? .6 : 1.6, "shorts"], [outdoors ? 2.4 : 1, "cargo"]]);
  const short = cut === "shorts";
  const under = t.weighted(smart ? [[5, "shirt"], [2, "rollneck"], [1.5, "polo"], [1, "longTee"]] : [[2, "tee"], [1.2, "longTee"], [1.4, "polo"], [3.2, "shirt"], [short ? 2 : 1, "campShirt"], [short ? .2 : 1.4, "rollneck"]]);
  const over = t.weighted(smart ? [[2, null], [3, "blazer"], [2.5, "waistcoat"], [1.5, "cardigan"], [1, "tunicCoat"]]
    : short ? [[6, null], [1.5, "overshirt"], [1, "zipHoodie"]]
    : [[outdoors ? 1.4 : 3, null], [1, "bomber"], [1.2, "leather"], [1, "waistcoat"], [1.2, "overshirt"], [1.1, "cardigan"], [1, "zipHoodie"], [outdoors ? 1.4 : .7, "tunicCoat"], [outdoors ? 1.6 : .7, "gilet"], [1.1, "blazer"]]);
  const shoe = t.weighted(short ? [[4, "trainers"], [1.5, "loafers"], [1.5, "hightops"]]
    : smart ? [[4, "loafers"], [2, "ankle"], [1, "trainers"]]
    : cut === "slim" ? [[2.4, "ankle"], [2, "trainers"], [1.4, "loafers"], [.8, "hightops"]]
    : cut === "cropped" ? [[3, "trainers"], [3, "loafers"], [1.5, "hightops"], [1.5, "ankle"]]
    : [[3, "trainers"], [2, "loafers"], [2, "ankle"], [outdoors || over === "tunicCoat" ? 3 : 1, "mid"], [1, "hightops"], [over === "tunicCoat" ? 2.5 : .3, "tall"]]);
  const lean = { ...(smart ? { depth: [[1, 1], [3, 2], [6, 3]], neutral: .3 } : {}), ...(over === "leather" ? { swap: 0 } : {}) };
  const p = drawPalette(t, direction, lean, skin);
  lower(t, p, smart || cut === "cargo" ? 0 : .32);
  const hide = over === "leather" ? t.vary(t.pick(["#2a2725", "#4a3528", "#3b2d29", "#5e2b2b", p.leather])) : null;
  const inner = !over || hide ? p.top : t.weighted([[5, p.pale], [3, p.accent], [2, Math.abs(value(p.deep) - value(p.top)) > .15 ? p.deep : p.pale]]);
  const [shoePiece, shoeCut] = footwear[shoe](t), sporty = shoe === "trainers" || shoe === "hightops";
  const shoeLayer = { piece: shoePiece, ...shoeCut, color: sporty ? t.weighted([[10, p.pale], [5, p.deep], [1.5, p.accent], [2, echo(p.top, p.pale, p.deep)]]) : p.leather, sole: sporty ? p.pale : p.sole };
  const trousers = { piece: "trousers", ...bottoms[cut](t), color: p.bottom };
  const base = { piece: "top", ...bases[under](t), color: inner, trim: ["shirt", "campShirt"].includes(under) ? p.pale : p.metal };
  const layers = [];
  const tucked = shoePiece === "boots" && (cut === "slim" || shoe === "tall");
  if (shoePiece === "boots" && !tucked) layers.push({ ...shoeLayer, height: Math.max(shoeLayer.height, 1.68), ease: Math.min(shoeLayer.ease, 5), straight: 0, cuff: 0 });
  layers.push(trousers, base);
  if (over) layers.push({ piece: "top", ...outers[over](t), color: hide ?? p.top, trim: p.metal });
  if (over === "tunicCoat") layers.push({ piece: "belt", color: p.leather, at: 1, height: t.whole(34, 44), trim: p.metal });
  if (shoePiece !== "boots" || tucked) layers.push(shoeLayer);
  if ((over === "tunicCoat" || over === "leather") && t.chance(.2)) layers.push({ piece: "gloves", color: p.leather, from: t.part(1.78, 1.9), cuff: t.pick([0, 14]) });
  const patterned = over && !hide ? outerDesigns[over] : baseDesigns[under], festive = direction === "Festive";
  const style = { outfit: "None", tailor: { layers }, clothColor: over && !hide ? p.top : inner };
  style.clothDesign = t.weighted(patterned.map(([weight, name]) => [festive ? weight * (festiveDesigns[name] ?? 1) : weight, name]));
  if (style.clothDesign === "Quiet weave" && !short && cut !== "cargo" && t.chance(.14)) style.secondDesign = t.pick(["Herringbone", "Herringbone", "Windowpane"]);
  if (!["Quiet weave", "Herringbone"].includes(style.clothDesign)) {
    const print = printColour(t, style.clothColor, p);
    if (print) style.clothAccent = print;
  }
  return { style, outfit: "Work clothes", palette: p };
}

function armourLook(t, direction, skin) {
  const look = t.weighted([[5, "Light fantasy"], [2, "Heavy fantasy"], [2.5, "Light sci-fi"], [.8, "Heavy sci-fi"]]), scifi = /sci-fi/.test(look);
  const p = drawPalette(t, direction, { depth: [[.3, 1], [5, 2], [5, 3]], swap: 0 }, skin), seed = Math.floor(t.draw() * 1000), pieces = {};
  const shell = t.chance(.5) ? p.pale : p.top;
  const { layers } = armourSet(seed, look);
  for (const layer of layers) {
    if (!armourLooks.includes(look) || pieces[layer.piece]) continue;
    if (layer.material === "lacquer") pieces[layer.piece] = { color: shell, trim: p.accent };
    else if (layer.material === "leather") pieces[layer.piece] = { color: p.leather, trim: p.metal };
    else if (layer.material === "steel") pieces[layer.piece] = { trim: layer.trim === layer.color ? layer.trim : p.metal };
    else if (scifi) continue;
    else if (layer.piece === "top") pieces.top = { color: p.top };
    else if (layer.piece === "trousers") pieces.trousers = { color: p.deep };
    else pieces[layer.piece] = { color: p.leather };
  }
  if (!scifi && seed % 5 < 2) pieces.cuirass.collar = "mail standard";
  if (!scifi && seed % 5) pieces.cuirass.device = ["Night moth", "Reed heron", "Knotted oak", "Compass"][seed % 4];
  if (look === "Light fantasy" && seed % 3 === 0) {
    const rightPlate = layers.find(l => l.piece === "pauldrons")?.balance.startsWith("right");
    pieces.travellingMantle = { color: p.deep, trim: p.top, clasp: p.metal, shoulder: rightPlate ? "left" : "right" };
  }
  return { style: { outfit: "None", armour: { look, seed, pieces }, clothColor: p.top, clothDesign: "Quiet weave" }, outfit: "Work clothes", palette: p };
}

function wardrobeQuantile(seed) {
  const group = (seed >>> 0) >>> 4;
  const random = randomStream(group ^ 0x3c7fe149);
  const slots = Array.from({length:16}, (_,i) => i);
  for (let last=15; last>0; last--) {
    const j = Math.floor(random()*(last+1));
    [slots[last], slots[j]] = [slots[j], slots[last]];
  }
  return (slots[seed & 15] + randomStream(seed ^ 0x12852369)()) / 16;
}

export function completeLook(form, seed, direction = "Any") {
  if (!lookDirections.includes(direction)) direction = "Any";
  const t = tools(randomStream((seed ^ 0x9e3779b9) >>> 0)), skin = form?.appearance?.skin ?? null;
  const fits = name => direction === "Any" || (direction === "Festive" ? presets[name].suits.some(kind => ["Smart", "Festive"].includes(kind)) : presets[name].suits.includes(direction));
  const table = Object.keys(presets).filter(fits).map(name => [presets[name].weight, name]);
  table.push([separatesShare[direction] ?? 0, "separates"], [armourShare[direction] ?? 0, "armour"]);
  const costumes = Object.keys(presets).filter(name => presets[name].attire && fits(name)).map(name => [presets[name].attire, name]);
  const costume = tools(randomStream((seed ^ 0x51a77e3d) >>> 0));
  let wardrobe;
  const ensembles = Object.keys(presets).filter(name => presets[name].everyday && fits(name)).map(name => [presets[name].everyday, name]);
  const everyday = tools(randomStream((seed ^ 0x2f6b8d13) >>> 0));
  const capsules = Object.keys(presets).filter(name => presets[name].capsule && fits(name)).map(name => [presets[name].capsule, name]);
  const drawn = tools(randomStream((seed ^ 0x7b1d4c95) >>> 0));
  if (costumes.length && costume.chance(attireShare[direction] ?? 0)) wardrobe = costume.weighted(costumes);
  else if (ensembles.length && everyday.chance(everydayShare[direction] ?? 0)) wardrobe = everyday.weighted(ensembles);
  else if (capsules.length && drawn.chance(capsuleShare[direction] ?? 0)) wardrobe = drawn.weighted(capsules);
  else if (direction === "Any") {
    const free = table.map(([weight, name]) => [weight * (presets[name]?.trousers === false ? 2.05 : 1), name]);
    wardrobe = tools(() => wardrobeQuantile(seed)).weighted(free);
    t.draw();
  } else wardrobe = t.weighted(table);
  let look = wardrobe === "separates" ? separatesLook(t, direction, skin) : wardrobe === "armour" ? armourLook(t, direction, skin) : presetLook(t, wardrobe, direction, skin);
  const field = tools(randomStream((seed ^ 0x6e1a47c3) >>> 0));
  if (field.chance(einarShare[direction] ?? 0) && !look.style.tailor && !look.style.armour) { wardrobe = einarOutfit; look = presetLook(field, wardrobe, direction, skin); }
  const street = tools(randomStream((seed ^ 0x3d1a84c7) >>> 0));
  if (presets[wardrobe]?.weight > 0 && !look.style.tailor && !look.style.armour) {
    const chance = { Any: .085, Everyday: .12, Workwear: .16, Outdoors: .12 }[direction] ?? 0;
    if (street.chance(chance)) {
      const casual = direction === "Everyday" || (direction === "Any" && street.chance(.5));
      wardrobe = casual ? "Hoodie and denim shorts" : "Survey vest";
      look = presetLook(street, wardrobe, direction, skin);
    }
  }
  const scanned = tools(randomStream((seed ^ 0x5ca97e21) >>> 0));
  if (presets[wardrobe]?.weight > 0 && !look.style.tailor && !look.style.armour && scanned.chance(scannedShare[direction] ?? 0)) {
    const worn = Object.keys(scannedClothes).filter(fits);
    if (worn.length) { wardrobe = scanned.pick(worn); look = presetLook(scanned, wardrobe, direction, skin); }
  }
  const p = look.palette, vivid = [p.accent, p.top, p.bottom].find(colour => hsl(colour)[1] > .3 && value(colour) > .25 && value(colour) < .8) ?? p.accent;
  const marks = [];
  if (direction === "Festive" && t.chance(.3)) {
    const kind = t.pick(["Paint dots", "Paint dots", "Paint streaks"]);
    marks.push(faceMark(kind, Math.floor(t.draw() * 4294967296), { place: kind === "Paint dots" ? t.pick(["Under eye", "Brow"]) : "Cheek", side: "Both", strength: t.part(.7, .9), size: t.part(.3, .5), tone: vivid }));
  }
  return { style: look.style, outfit: look.outfit, paint: vivid, marks, wardrobe, scheme: p.scheme };
}
