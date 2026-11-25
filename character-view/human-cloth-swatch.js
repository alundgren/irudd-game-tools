import { CanvasTexture, Color, Float32BufferAttribute, SRGBColorSpace } from "three";

import { unzlibSync } from "three/addons/libs/fflate.module.js";
import scallop from "./human-scallop-thread.json" with {type:"json"};

export const clothDesigns = [
  "Plain cloth", "Outfit swatch", "Quiet weave", "Pinstripe", "Windowpane",
  "Breton stripe", "Herringbone", "Colour block",
  "Gingham", "Small dots", "Chest band", "Knit yoke", "Hem border", "Scallop brocade",
];
// A second piece of the outfit may carry its own design. "Plain cloth" leaves it in the quiet weave.
export const secondDesigns = clothDesigns.filter(name => name !== "Outfit swatch");

// A named part selects a fabric. Print placement belongs to the outfit so
// picking a print never puts it on the buttons, bindings or hardware.
const fabrics = {
  "T-shirt": "jersey", "Hoodie": "jersey", "Joggers": "jersey",
  "Sweater": "wool", "Skirt": "twill", "Tights": "jersey", "Socks": "jersey",
  "Jeans": "denim", "Chinos": "twill", "Trousers": "twill",
  "Work trousers": "twill", "Field trousers": "twill",
  "Shirt": "poplin", "Undershirt": "jersey",
  "Evening bodice": "silk", "Gored satin skirt": "silk", "Gathered overskirt": "silk",
  "Dress bodice": "poplin", "Dress skirt": "poplin", "Sash": "satin",
  "Overcoat": "wool", "Coat skirt": "wool", "Coat belt": "wool",
  "Scarf": "wool", "Coveralls": "twill", "Chore jacket": "canvas",
  "Field jacket": "canvas", "Apron": "waxed cotton",
  "Vest": "sports knit", "Shorts": "sports knit",
  "Breeches": "twill", "Cloak": "wool", "Tunic": "wool", "Tunic skirt": "wool",
  "Parka": "ripstop", "Parka skirt": "ripstop", "Snow trousers": "ripstop",
  // The capsule (human-style-capsule.js).
  "Split mantle": "wool", "Shoulder cloak": "wool", "Mantle lining": "silk",
  "Short bomber": "satin", "Rolled-sleeve bomber": "canvas", "Ribbing": "jersey", "Tucked top": "jersey", "Wide trousers": "twill", "Cuffed wide trousers": "twill",
  "Bodice": "silk", "Shoulder wing": "silk", "Gored skirt": "silk", "Draped skirt": "silk", "Skirt panel": "silk", "Skirt facing": "satin", "Girdle": "satin",
};

// The style fields that name tones one by one (human-style.js `toneFields`).
const directedFields = ["clothSecond", "clothLight", "accentColor", "leatherColor", "soleColor", "metalColor"];

const primaryParts = {
  "T-shirt and jeans": ["T-shirt", "Breton stripe"],
  "Hoodie and joggers": ["Hoodie", "Colour block"],
  "Shirt and chinos": ["Shirt", "Windowpane"],
  "Sweater and skirt": ["Sweater", "Breton stripe"],
  "Evening gown": ["Gored satin skirt", "Hem border"],
  "Day dress": ["Dress bodice", "Windowpane", "Dress skirt"],
  "Running kit": ["Vest", "Colour block"],
  "Coveralls": ["Coveralls", "Workwear tape"],
  "Chore jacket": ["Chore jacket", "Colour block"],
  "Workshop apron": ["Apron", "Workbench stripe"],
  "Overcoat": ["Overcoat", "Herringbone", "Coat skirt"],
  "Explorer": ["Field jacket", "Colour block"],
  "Traveller": ["Cloak", "Woven border"],
  "Parka": ["Parka", "Colour block", "Parka skirt"],
  "Leather armour": ["Tunic", "Quiet weave", "Tunic skirt"],
  "Split mantle": ["Split mantle", "Herringbone"],
  "Hooded shoulder cloak": ["Shoulder cloak", "Herringbone"],
  "Bomber and wide trousers": ["Short bomber", "Colour block"],
  "Rolled bomber and cuffed trousers": ["Rolled-sleeve bomber", "Colour block"],
  "Bodice and gored skirt": ["Skirt panel", "Scallop brocade"],
  "Draped bodice gown": ["Skirt panel", "Scallop brocade"],
};

// The pieces that take `secondDesign`: the other large cloth of each outfit.
const secondParts = {
  "T-shirt and jeans": ["Jeans"],
  "Hoodie and joggers": ["Joggers"],
  "Shirt and chinos": ["Chinos"],
  "Sweater and skirt": ["Skirt"],
  "Day dress": ["Sash"],
  "Running kit": ["Shorts"],
  "Chore jacket": ["Work trousers"],
  "Workshop apron": ["Shirt"],
  "Overcoat": ["Scarf"],
  "Explorer": ["Field trousers"],
  "Traveller": ["Tunic", "Tunic skirt"],
  "Parka": ["Snow trousers"],
  "Leather armour": ["Breeches"],
  "Split mantle": ["Tunic", "Tunic skirt"],
  "Hooded shoulder cloak": ["Tunic", "Tunic skirt"],
  "Bomber and wide trousers": ["Wide trousers"],
  "Rolled bomber and cuffed trousers": ["Cuffed wide trousers"],
};

// Pieces tailored one by one are named by what they are.
const tailoredFabrics = { "Top": "jersey", "Hooded top": "jersey", "Jacket": "canvas", "Trousers": "twill", "Shorts": "twill" };

const cloth = {
  jersey: [.86, .085, .0070],
  wool: [.96, .145, .0092],
  twill: [.80, .13, .0068],
  denim: [.88, .165, .0078],
  poplin: [.7, .085, .0062],
  satin: [.40, .052, .0062],
  silk: [.68, .062, .0066],
  canvas: [.90, .135, .0086],
  "waxed cotton": [.68, .115, .0076],
  "sports knit": [.62, .095, .0066],
  ripstop: [.56, .10, .0142],
};

function designFor(outfit, name, style) {
  const [main, pattern, matching] = primaryParts[outfit] ?? [], second = style.secondDesign;
  if (outfit === "Evening gown" && style.clothDesign === "Scallop brocade")
    return name === "Gathered overskirt" || name === "Evening bodice" ? style.clothDesign : "Hem border";
  if (name === main || name === matching) return style.clothDesign === "Outfit swatch" ? pattern : style.clothDesign;
  if (second && second !== "Plain cloth" && secondParts[outfit]?.includes(name)) return second;
  return "Quiet weave";
}

const mix = (a, b, k) => a + (b - a) * k;
const fold = (x, step) => Math.abs(x - Math.round(x / step) * step);
const band = (x, half, feather = .002) => 1 - Math.max(0, Math.min(1, (x - half) / feather + .5));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Panel registration in rest-space metres. The print stays in the cloth UV
// as the model moves. Front and back share the same height and grain.
export function clothChart(positions, landmarks) {
  const { shoulder, waist, chest } = landmarks;
  const points = new Float32Array(positions.count * 2);
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i) - chest[2];
    // Widen the chart around the flank without introducing a mirrored UV seam.
    const u = x * (1 + .19 * Math.min(1, Math.abs(z) / .17));
    const v = positions.getY(i) - waist;
    points[i * 2] = u;
    points[i * 2 + 1] = v;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const u0 = minU - .008, v0 = minV - .008;
  const du = maxU - minU + .016, dv = maxV - minV + .016;
  for (let i = 0; i < points.length; i += 2) {
    points[i] = (points[i] - u0) / du;
    points[i + 1] = (points[i + 1] - v0) / dv;
  }
  return { uv: new Float32BufferAttribute(points, 2), u0, v0, du, dv, yoke: shoulder - waist };
}

// Unroll an open gathered sheet from its sewn edge. Rows vary in length
// as the gores widen. The border follows its lifted hem across every fold.
function gatheredChart(position, [rows, columns], landmarks) {
  const coords = new Float32Array(2*position.count);
  const lengths = [];
  let width = 0, height = 0;
  const distance = (a,b) => Math.hypot(position.getX(a)-position.getX(b),
    position.getY(a)-position.getY(b), position.getZ(a)-position.getZ(b));
  for (let j=0; j<columns; j++) {
    let drop = 0;
    for(let i=1;i<rows;i++) drop += distance(i*columns+j,(i-1)*columns+j);
    height += drop / columns;
  }
  for (let i=0; i<rows; i++) {
    let arc = 0;
    for(let j=0;j<columns;j++) {
      const id=i*columns+j;
      if(j) arc += distance(id,id-1);
      coords[id*2] = arc;
      coords[id*2+1] = .01 + .98*(1-i/(rows-1));
    }
    lengths.push(arc);
    width = Math.max(width,arc);
  }
  for (let i=0;i<position.count;i++) {
    coords[2*i] = .5 + .98*(coords[2*i]-.5*lengths[Math.floor(i/columns)])/width;
  }
  return {uv:new Float32BufferAttribute(coords,2), u0:-width/2, v0:0,
    du:width, dv:height, yoke:landmarks.shoulder-landmarks.waist};
}

// Original painted goldwork. The field stores thread coverage and the relief
// of its satin stitches. Staggered fans share one scale across both garment panels.
let threadField;
function brocadeThread(x, y) {
  threadField ??= unzlibSync(Uint8Array.from(atob(scallop.thread), c => c.charCodeAt(0)));
  const row = Math.floor(y / .156);
  const dx = x / .202 + .5 * (row & 1);
  const dy = y / .156 - row;
  const u = Math.floor((dx - Math.floor(dx)) * scallop.size);
  const v = Math.min(scallop.size - 1, Math.floor((1 - dy) * scallop.size));
  return threadField[v * scallop.size + u] / 255;
}

function printAt(pattern, x, y, chart, outfit, meshName) {
  if (pattern === "Scallop brocade") {
    const ground = brocadeThread(1.4*x,1.4*y);
    if (meshName === "Gathered overskirt") {
      const hem = y/chart.dv;
      const rail = Math.max(band(Math.abs(hem-.046),.0025,.003),
        band(Math.abs(hem-.244),.0025,.003));
      const border = hem > .054 && hem < .235
        ? brocadeThread(x, (hem-.054)*.156/.181) : 0;
      return [.12*ground + .70*border + .38*rail, .07*(1-ground)];
    }
    if (meshName === "Evening bodice") {
      const yoke = (y-chart.v0)/chart.dv;
      const trim = Math.max(0,1-Math.abs(yoke-.57)/.33);
      return [.04 + (.12 + .34*trim)*ground, .09*(1-ground)];
    }
    return [.025 + .46*ground, .09*(1-ground)];
  }
  if (pattern === "Pinstripe")
    return [.54 * band(fold(x, .033), .0015, .0018), 0];
  if (pattern === "Windowpane") {
    const warp = band(fold(x, .068), .0031);
    const weft = band(fold(y - .014, .071), .0034);
    const paired = .27 * band(fold(x + .012, .068), .0015);
    return [.55 * Math.max(warp, weft, paired) + .22 * warp * weft, .17 * Math.max(warp, weft)];
  }
  if (pattern === "Breton stripe") {
    // A plain yoke and hem frame yarn-dyed stripes.
    const inside = band(Math.abs(y - (chart.v0 + chart.dv * .51)), chart.dv * .40, .005);
    return [.77 * band(fold(y, .061), .009) * inside, 0];
  }
  if (pattern === "Herringbone") {
    const chevron = fold(x + .008, .028) * .76;
    return [.31 * band(fold(y + chevron, .021), .003), .29];
  }
  if (pattern === "Workbench stripe") {
    const pin = band(fold(x + .046, .12), .0024);
    const backing = band(fold(x + .044, .12), .009);
    const bib = band(Math.abs(x), .19, .021);
    return [.38 * pin * bib, .34 * backing * bib];
  }
  if (pattern === "Workwear tape") {
    // A pair of sewn visibility strips, outside the central zip or placket.
    const awayFromZip = 1 - band(Math.abs(x), .031, .009);
    const chest = band(Math.abs(y - chart.yoke * .53), .012);
    const welt = band(Math.abs(y - chart.yoke * .53 + .021), .0022);
    return [awayFromZip * (.64 * chest + .29 * welt), .31 * chest];
  }
  if (pattern === "Woven border") {
    const hem = y - chart.v0;
    const inner = band(Math.abs(hem - .095), .028, .005);
    const outer = Math.max(band(Math.abs(hem - .057), .003), band(Math.abs(hem - .132), .003));
    const diamond = band(fold(x, .048) + Math.abs(hem - .095) * 1.3, .018, .003);
    return [.58 * inner * diamond + .52 * outer, .36 * inner];
  }
  if (pattern === "Gingham") {
    // Even bands both ways: half tone where one crosses, full where both do.
    const warp = band(fold(x, .03), .0075, .0015), weft = band(fold(y, .03), .0075, .0015);
    return [.36 * (warp + weft) + .1 * warp * weft, 0];
  }
  if (pattern === "Small dots") {
    const row = Math.round(y / .034), dx = fold(x + (row % 2 ? .02 : 0), .04), dy = y - row * .034;
    // Drawn a little narrow: the chart widens round the flank, and a dot there should not read as an oval.
    return [.82 * band(Math.hypot(dx * 1.3, dy * .92), .0058, .0016), 0];
  }
  if (pattern === "Chest band") {
    // One broad band across the chest with a fine line under it.
    const at = chart.yoke * .58;
    return [.9 * band(Math.abs(y - at), .024, .003) + .8 * band(Math.abs(y - at + .041), .0042, .002), 0];
  }
  if (pattern === "Knit yoke") {
    // Rows of small knitted figures across the shoulders, as on a yoked jumper.
    const from = chart.yoke * .7, inside = 1 - band(y - from, .001, .006);
    const zig = band(Math.abs(y - from - .03 - fold(x, .022) * .9), .0048, .002);
    const row = Math.max(band(Math.abs(y - from - .008), .0032, .0016), band(Math.abs(y - from - .068), .0032, .0016));
    const seed = band(Math.hypot(fold(x + .011, .022), y - from - .086), .0046, .0016);
    const lower = band(Math.hypot(fold(x, .044), y - from + .012), .004, .0016);
    return [Math.min(1, inside * (.8 * zig + .78 * row + .8 * seed) + .7 * lower), 0];
  }
  if (pattern === "Hem border") {
    // Two lines and a row of small lozenges above the lower edge.
    const hem = y - chart.v0;
    const lines = Math.max(band(Math.abs(hem - .034), .0034, .0016), band(Math.abs(hem - .082), .0034, .0016));
    const lozenge = band(fold(x, .034) + Math.abs(hem - .058) * 1.25, .0088, .002);
    return [.8 * lines + .78 * lozenge, .2 * band(Math.abs(hem - .058), .024, .004)];
  }
  if (pattern === "Colour block") {
    const active = outfit === "Running kit" || outfit === "Parka";
    const seam = (active ? .51 : .7) * chart.yoke + Math.min(Math.abs(x), .36) * (active ? -.65 : .13);
    const above = 1 - band(y - seam, .001, .005);
    const piping = band(Math.abs(y - seam + .014), active ? .005 : .002);
    return [piping * .85 + above * (active ? .84 : .51), above * .32];
  }
  return [0, 0];
}

// Dyed cloth is never one flat tone: yarn takes dye unevenly, and wear lightens it in broad soft patches.
const washes = {
  denim: .36, canvas: .26, twill: .22, wool: .22, "waxed cotton": .28,
  jersey: .16, poplin: .12, ripstop: .13, "sports knit": .12, satin: .08, silk: .09,
};
// Peak to trough in metres at the scale of the cloth chart, calibrated so directional
// weaves, knit ribs, twill wales and seams read cleanly inside the 24K/1024 shared atlas.
const yarnHeight = {
  denim: .0048, canvas: .0050, twill: .0044, wool: .0058, "waxed cotton": .0042,
  jersey: .0030, poplin: .0028, ripstop: .0042, "sports knit": .0028, satin: .0018, silk: .0022,
};
const grainAt = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return n - Math.floor(n); };
function cloud(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  return mix(mix(grainAt(i, j), grainAt(i + 1, j), a), mix(grainAt(i, j + 1), grainAt(i + 1, j + 1), a), b) * 2 - 1;
}

// Compute directional construction geometry [albedoMod, height01, roughScale01, weftLift] for one cloth texel.
// Designed at macro+meso spatial wavelengths (6-15 mm) that survive 24K/1024 atlas downsampling cleanly.
function fabricConstruction(fabric, meshName, x, y, chart, pitch, contrast, out) {
  const hemY = y - chart.v0;
  let albedoMod = 1;
  let height = 0.5;
  let roughScale = 0.90;
  let weftLift = 0;

  if (fabric === "wool") {
    const isKnit = meshName === "Sweater" || meshName === "Scarf";
    if (isKnit) {
      // Chunky vertical knit wales with interlocking V-loop courses + ribbed hem band.
      const ribBand = hemY < 0.058 ? 1 - clamp((hemY - 0.048) / 0.010, 0, 1) : 0;
      const weltSeam = band(Math.abs(hemY - 0.056), 0.0020, 0.0022);
      const waleP = ribBand > 0.5 ? 0.0078 : 0.0096;
      const courseP = 0.0074;
      const waleX = (x / waleP) % 1;
      const wFrac = waleX < 0 ? waleX + 1 : waleX;
      const waleRib = Math.sin(wFrac * Math.PI); // rounded vertical knit column [0..1]
      const vLeg = Math.abs(wFrac - 0.5) * 2; // 0 at center of knit column, 1 at trough
      const loop = 0.5 + 0.5 * Math.cos(((y / courseP) + vLeg * 0.65) * Math.PI * 2);
      const fuzz = cloud(x * 75, y * 75) * 0.12;
      const knitH = ribBand > 0.5
        ? 0.16 + 0.74 * waleRib + 0.08 * loop
        : 0.14 + 0.64 * waleRib + 0.18 * loop * (0.45 + 0.55 * waleRib);
      height = clamp(knitH + fuzz - 0.26 * weltSeam, 0.06, 0.96);
      // Deep shadowed troughs between chunky knit ribs + velvety matte yarn light response.
      albedoMod = 1 + contrast * ((knitH - 0.54) * 1.45 + fuzz * 0.5) - 0.12 * weltSeam;
      roughScale = clamp(0.99 - 0.07 * waleRib - 0.04 * loop, 0.86, 1.0);
    } else {
      // Heavy felted/twill outerwear wool (Overcoat, Cloak, Tunic): directional diagonal tweed weave + felled hem.
      const diag = (x * 0.72 + y * 0.69) / pitch;
      const wale = Math.sin(diag * Math.PI * 2);
      const cross = Math.sin(((x * -0.69 + y * 0.72) / (pitch * 1.15)) * Math.PI * 2);
      const nap = cloud(x * 55, y * 55) * 0.22;
      const hemLine = band(Math.abs(hemY - 0.032), 0.0022, 0.0024);
      const stitch = hemLine * band(fold(x, 0.009), 0.0032, 0.0018);
      height = clamp(0.50 + 0.28 * wale + 0.10 * cross + nap + 0.24 * stitch - 0.16 * hemLine, 0.08, 0.94);
      albedoMod = 1 + contrast * (0.62 * wale + 0.25 * cross + nap * 0.85) - 0.09 * hemLine;
      roughScale = clamp(0.98 - 0.06 * wale + 0.04 * Math.abs(nap), 0.85, 1.0);
    }
  } else if (fabric === "denim" || fabric === "twill") {
    // Classic 3x1 right-hand diagonal twill wales (steeper and bolder on denim).
    const isDenim = fabric === "denim";
    const diag = (x * 0.78 + y * 0.62) / pitch;
    const f = diag - Math.floor(diag);
    // Asymmetric rounded twill ridge catches raking light cleanly across atlas mip levels.
    const wale = Math.sin(f * Math.PI * 2) * 0.72 + Math.sin(f * Math.PI * 4) * 0.20;
    const warpSlub = cloud(x * (isDenim ? 72 : 58), y * 14);
    const weftSlub = cloud(x * 16, y * 68);
    const wearPatch = 0.5 + 0.5 * cloud(x * 6.5, y * 4.5);
    // Double-needle workwear hem & subtle vertical outseam stitch track.
    const hemStitch = (band(Math.abs(hemY - 0.026), 0.0016, 0.0018) + (isDenim ? band(Math.abs(hemY - 0.034), 0.0015, 0.0018) : 0))
      * band(fold(x, 0.0082), 0.0029, 0.0016);
    const hemFold = band(Math.abs(hemY - 0.030), 0.0026, 0.0028);
    height = clamp(0.50 + (isDenim ? 0.34 : 0.29) * wale + 0.13 * warpSlub + 0.06 * weftSlub + 0.26 * hemStitch - 0.14 * hemFold, 0.06, 0.96);
    albedoMod = 1 + contrast * (0.72 * wale + 0.42 * warpSlub + 0.18 * weftSlub) - 0.10 * hemFold;
    // Recessed weft troughs on denim flash subtle pale undyed yarn undertone!
    weftLift = isDenim ? clamp((-wale - 0.10) * 0.20 + Math.max(0, weftSlub) * 0.07, 0, 0.24) : 0;
    roughScale = clamp((isDenim ? 0.94 : 0.90) - 0.12 * wale - (isDenim ? 0.10 : 0.06) * wearPatch - 0.06 * hemStitch, 0.68, 0.99);
  } else if (fabric === "canvas") {
    // Heavy 2x2 basketweave outerwear duck + felled double-needle workwear seams.
    const bx = x / pitch, by = y / pitch;
    const ix = Math.floor(bx), iy = Math.floor(by);
    const fx = bx - ix, fy = by - iy;
    const overWarp = ((ix + iy) & 1) === 0;
    const rib = overWarp
      ? Math.sin(fx * Math.PI) * (0.58 + 0.42 * Math.sin(fy * Math.PI))
      : Math.sin(fy * Math.PI) * (0.58 + 0.42 * Math.sin(fx * Math.PI));
    const slub = cloud(x * 38, y * 38) * 0.18;
    const hemFold = band(Math.abs(hemY - 0.032), 0.0028, 0.0028);
    const stitch = (band(Math.abs(hemY - 0.027), 0.0017, 0.0018) + band(Math.abs(hemY - 0.036), 0.0017, 0.0018))
      * band(fold(x, 0.0085), 0.0030, 0.0016);
    const placket = band(Math.abs(Math.abs(x) - 0.019), 0.0018, 0.0020) * band(fold(y, 0.009), 0.0032, 0.0016);
    height = clamp(0.16 + 0.68 * rib + slub + 0.26 * Math.max(stitch, placket) - 0.16 * hemFold, 0.06, 0.96);
    albedoMod = 1 + contrast * ((rib - 0.5) * 1.35 + slub * 0.9) - 0.11 * hemFold;
    roughScale = clamp(0.97 - 0.16 * rib - 0.05 * Math.max(stitch, placket), 0.74, 0.99);
  } else if (fabric === "poplin") {
    // Garment-weight woven cotton / linen: crisp orthogonal weave + natural directional warp/weft slubs + placket/hem stitch.
    const wx = Math.sin((x / pitch) * Math.PI * 2);
    const wy = Math.sin((y / pitch) * Math.PI * 2);
    const slubWeft = cloud(x * 11, y * 92) * 0.34;
    const slubWarp = cloud(x * 92, y * 11) * 0.24;
    const weave = 0.52 * (wx * wy) + slubWeft + slubWarp;
    const hemStitch = band(Math.abs(hemY - 0.020), 0.0014, 0.0016) * band(fold(x, 0.0072), 0.0025, 0.0014);
    const placket = meshName === "Shirt"
      ? band(Math.abs(Math.abs(x) - 0.015), 0.0016, 0.0018) * band(fold(y, 0.0075), 0.0026, 0.0015)
      : 0;
    height = clamp(0.50 + 0.28 * weave + 0.24 * Math.max(hemStitch, placket), 0.12, 0.92);
    albedoMod = 1 + contrast * (0.72 * weave);
    // Crisp dry-satin shirting sheen (material.roughness = 0.70 -> effective ~0.52..0.69).
    roughScale = clamp(0.92 - 0.14 * weave - 0.06 * Math.max(hemStitch, placket), 0.72, 0.99);
  } else if (fabric === "jersey" || fabric === "sports knit") {
    // Fine vertical knit wales + ribbed bottom cuff band (Hoodie/Joggers) or breathable athletic pique (sports knit).
    const isSport = fabric === "sports knit";
    const ribBand = !isSport && (meshName === "Hoodie" || meshName === "Joggers") && hemY < 0.052
      ? 1 - clamp((hemY - 0.044) / 0.008, 0, 1)
      : 0;
    const welt = !isSport && (meshName === "Hoodie" || meshName === "Joggers")
      ? band(Math.abs(hemY - 0.050), 0.0018, 0.0020)
      : 0;
    if (isSport) {
      const gx = Math.cos((x / pitch) * Math.PI * 2);
      const gy = Math.cos((y / pitch) * Math.PI * 2);
      const cell = gx * gy;
      const stitch = band(Math.abs(hemY - 0.022), 0.0015, 0.0017) * band(fold(x, 0.0075), 0.0026, 0.0015);
      height = clamp(0.50 + 0.34 * cell + 0.22 * stitch, 0.10, 0.92);
      albedoMod = 1 + contrast * (0.72 * cell);
      roughScale = clamp(0.88 - 0.18 * cell - 0.06 * stitch, 0.64, 0.98);
    } else {
      const waleP = ribBand > 0.5 ? 0.0072 : pitch;
      const wale = Math.sin((x / waleP) * Math.PI * 2);
      const course = Math.cos((y / (pitch * 1.15) + Math.abs(((x / waleP) % 1 + 1) % 1 - 0.5) * 0.75) * Math.PI * 2);
      const marl = cloud(x * 48, y * 18) * 0.22;
      const stitch = band(Math.abs(hemY - 0.024), 0.0015, 0.0017) * band(fold(x, 0.0075), 0.0026, 0.0015);
      const knit = ribBand > 0.5 ? 0.78 * wale + 0.22 * course : 0.55 * wale + 0.32 * course + marl;
      height = clamp(0.50 + 0.32 * knit + 0.22 * stitch - 0.22 * welt, 0.10, 0.94);
      albedoMod = 1 + contrast * (0.78 * knit) - 0.10 * welt;
      roughScale = clamp(0.95 - 0.09 * knit, 0.80, 0.99);
    }
  } else if (fabric === "waxed cotton") {
    // Tight cotton base + bold waxed pull-up crease lines with strong waxy semi-gloss vs matte crease contrast.
    const weave = Math.sin((x / pitch) * Math.PI * 2) * Math.sin((y / pitch) * Math.PI * 2);
    const c1 = Math.abs(cloud(x * 7.5, y * 6.2));
    const c2 = Math.abs(cloud(x * 16.5 + 4.1, y * 14.0 - 2.3));
    const crease = (1 - clamp(c1 / 0.22, 0, 1)) * 0.72 + (1 - clamp(c2 / 0.18, 0, 1)) * 0.38;
    const hemStitch = band(Math.abs(hemY - 0.026), 0.0018, 0.0020) * band(fold(x, 0.0085), 0.0030, 0.0016);
    height = clamp(0.58 + 0.16 * weave - 0.36 * crease + 0.24 * hemStitch, 0.08, 0.94);
    albedoMod = 1 + contrast * (0.35 * weave + 0.55 * crease);
    // Flat waxed planes gleam (effective rough ~0.31), bent pull-up creases go dry matte (~0.65)!
    roughScale = clamp(0.46 + 0.48 * crease - 0.06 * weave, 0.38, 0.98);
  } else if (fabric === "ripstop") {
    // Raised 14mm reinforced cross-grid cords + quilted horizontal parka baffles + sleek shell sheen.
    const gx = band(fold(x, pitch), 0.0015, 0.0018);
    const gy = band(fold(y, pitch), 0.0015, 0.0018);
    const grid = Math.max(gx, gy);
    const baffle = meshName === "Parka" || meshName === "Parka skirt"
      ? band(fold(y, 0.135), 0.0032, 0.0042)
      : 0;
    const puff = meshName === "Parka" || meshName === "Parka skirt"
      ? Math.sin((((y / 0.135) % 1 + 1) % 1) * Math.PI)
      : 0.5;
    const fine = Math.sin((x / 0.0052) * Math.PI * 2) * Math.sin((y / 0.0052) * Math.PI * 2) * 0.14;
    height = clamp(0.38 + 0.24 * puff + 0.34 * grid + fine - 0.34 * baffle, 0.06, 0.96);
    albedoMod = 1 + contrast * (0.48 * grid + 0.28 * (puff - 0.5)) - 0.14 * baffle;
    // Sleek technical nylon panes (~0.30..0.38) vs matte raised ripstop cords & baffle seams (~0.54)!
    roughScale = clamp(0.56 + 0.34 * grid + 0.26 * baffle - 0.08 * puff, 0.46, 0.98);
  } else {
    // Silk & Satin: lustrous diagonal charmeuse sheen with flowing drape shimmer + delicate rolled hem.
    const isSatin = fabric === "satin";
    const diag = (x * 0.55 + y * 0.84) / pitch;
    const weave = Math.sin(diag * Math.PI * 2);
    const shimmer = 0.5 + 0.5 * Math.sin(x * 16 + cloud(x * 5, y * 4) * 2.4);
    const hem = band(Math.abs(hemY - 0.018), 0.0015, 0.0018);
    height = clamp(0.50 + (isSatin ? 0.16 : 0.22) * weave + 0.14 * hem, 0.20, 0.86);
    albedoMod = 1 + contrast * (0.48 * weave + 0.35 * (shimmer - 0.5));
    roughScale = clamp((isSatin ? 0.68 : 0.92) - (isSatin ? 0.14 : 0.09) * shimmer - 0.07 * weave, 0.48, 0.98);
  }

  out[0] = albedoMod;
  out[1] = height;
  out[2] = roughScale;
  out[3] = weftLift;
}

function swatchMap(chart, dye, accent, fabric, pattern, outfit, depth = 0, meshName = "") {
  const canvas = document.createElement("canvas");
  canvas.width = clamp(Math.round(chart.du * 720), 128, 704);
  canvas.height = clamp(Math.round(chart.dv * 720), 128, 704);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  const reliefCanvas = depth ? document.createElement("canvas") : null;
  if (reliefCanvas) {
    reliefCanvas.width = canvas.width;
    reliefCanvas.height = canvas.height;
  }
  const reliefCtx = reliefCanvas?.getContext("2d");
  const relief = reliefCtx?.createImageData(canvas.width, canvas.height);
  const [, contrast, pitch] = cloth[fabric];
  const base = dye.toArray();
  const other = accent.toArray();
  const dark = base.map(value => value * .67);
  // Pale cloth shows little of its wash: mottling as strong as on a dark dye would read as dirt.
  const fade = clamp(1.1 - (base[0] * .2126 + base[1] * .7152 + base[2] * .0722) * 1.5, .25, 1);
  // Use a lookup for colour-space conversion along the linear-light dye blend.
  const encoded = Array.from({ length: 1024 }, (_, i) => {
    const v = i / 1023;
    return 255 * (v < .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055);
  });
  const weftTone = base.map(v => mix(v, 0.78, 0.48));
  const fabOut = new Float64Array(4);
  for (let row = 0, i = 0; row < canvas.height; row++) {
    const y = chart.v0 + chart.dv * (1 - (row + .5) / canvas.height);
    for (let col = 0; col < canvas.width; col++, i += 4) {
      const x = chart.u0 + chart.du * (col + .5) / canvas.width;
      const [tint, shade] = printAt(pattern, x, y, chart, outfit, meshName);
      fabricConstruction(fabric, meshName, x, y, chart, pitch, contrast, fabOut);
      let light = fabOut[0];
      const weftLift = fabOut[3];
      if (depth) {
        // Broad patches of wash, finer mottling in the yarn, and a turned edge a shade deeper along the lower hem.
        const wash = (washes[fabric] ?? .04) * depth * fade;
        light *= 1 + wash * (cloud(x * 9, y * 5) * .6 + cloud(x * 37 + 9, y * 29) * .4 + cloud(x * 120, y * 40 + 5) * .16) - wash * .65 * band(Math.abs(y - chart.v0 - .03), .0018, .0022);
        // Height and roughness describe the construction. A change of dye
        // or a printed stripe leaves the actual yarn in exactly the same place.
        const brocade = pattern === "Scallop brocade" ? tint : 0;
        relief.data[i] = Math.round(255 * clamp(fabOut[1] + brocade * .52, 0, 1));
        relief.data[i + 1] = Math.round(255 * clamp(fabOut[2] - brocade * .22, .38, 1));
        relief.data[i + 2] = 0;
        relief.data[i + 3] = 255;
      }
      for (let channel = 0; channel < 3; channel++) {
        let dyed = mix(mix(base[channel], dark[channel], shade), other[channel], Math.min(1, tint));
        if (weftLift > 0) dyed = mix(dyed, weftTone[channel], weftLift * (1 - Math.min(1, tint)));
        const colour = dyed * light;
        image.data[i + channel] = encoded[Math.round(clamp(colour, 0, 1) * 1023)];
      }
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  let surface = null;
  if (relief) {
    reliefCtx.putImageData(relief, 0, 0);
    surface = new CanvasTexture(reliefCanvas);
    surface.anisotropy = texture.anisotropy;
  }
  return { texture, surface };
}

export function finishCloth(mesh, outfit, style, landmarks, panelGrid) {
  const design = style.clothDesign, fabric = fabrics[mesh.name];
  if (!fabric || !design || design === "Plain cloth") return;
  // A style that names its tones is woven with the uneven depth of dyed cloth; one saved before keeps its even weave.
  weave(mesh, fabric, designFor(outfit, mesh.name, style), style.clothAccent, outfit, landmarks, directedFields.some(field => style[field]) ? 1 : 0, panelGrid);
}

/**
 * Cloth for an outfit tailored piece by piece. The outermost top takes `clothDesign`, trousers or shorts take
 * `secondDesign` and other cloth takes the quiet weave. A style without a design, or with the design a preset
 * outfit chooses for itself, leaves tailored pieces as they are.
 */
export function finishTailored(meshes, style, landmarks) {
  const design = style.clothDesign, second = style.secondDesign;
  if (!design || design === "Plain cloth" || design === "Outfit swatch") return;
  const clothMeshes = meshes.filter(mesh => mesh.userData.styleType === "cloth" && tailoredFabrics[mesh.name]);
  const outer = clothMeshes.findLast(mesh => mesh.userData.styleRegion === "spine_03");
  for (const mesh of clothMeshes) {
    const pattern = mesh === outer ? design : second && second !== "Plain cloth" && mesh.userData.styleRegion === "pelvis" ? second : "Quiet weave";
    weave(mesh, tailoredFabrics[mesh.name], pattern, mesh === outer ? style.clothAccent : null, null, landmarks, 1);
  }
}

function weave(mesh, fabric, pattern, accent, outfit, landmarks, depth = 0, panelGrid) {
  const material = mesh.material.clone();
  const dye = material.color.clone();
  const hue = dye.getHSL({ h: 0, s: 0, l: 0 });
  // The pale yarn stays coherent with a dark shell, with some warm fibre tone.
  const trim = accent ? new Color(accent)
    : dye.clone().lerp(new Color(hue.l > .42 ? "#233039" : "#dfd0ae"), pattern === "Herringbone" ? .23 : .58);
  material.roughness = cloth[fabric][0];
  material.metalness = 0;
  material.name = mesh.name + " · " + fabric;
  if (typeof document !== "undefined") {
    const chart = panelGrid ? gatheredChart(mesh.geometry.attributes.position, panelGrid, landmarks) : clothChart(mesh.geometry.attributes.position, landmarks);
    const { texture, surface } = swatchMap(chart, dye, trim, fabric, pattern, outfit, depth, mesh.name);
    mesh.geometry.setAttribute("uv", chart.uv);
    material.color.set(0xffffff);
    material.map = texture;
    material.bumpMap = surface;
    if (surface) {
      material.bumpScale = yarnHeight[fabric];
      material.roughnessMap = surface;
    }
    material.addEventListener("dispose", () => {
      texture.dispose();
      surface?.dispose();
    });
  }
  mesh.material = material;
}
