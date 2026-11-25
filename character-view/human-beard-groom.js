// Original procedural beard groom built from coherent directed overlapping locks,
// feathered graduating cheek borders, and individual silhouette hairs across
// anatomical facial growth zones. Roots and silhouette fibres share an original texture.
//   beardGroom(skin, form, material, colours, fit) -> THREE.Mesh | null
//   beardStrandPixels() -> { width, height, data }
//   beardStrandMap() -> THREE.Texture
import * as T from "three";
import { bedColumn, bedRow, beardStrandMap, beardSurfaceMaps, shortBeardCover, shortBeardGrowth } from "./human-beard-texture.js";
export { beardStrandMap, beardStrandPixels } from "./human-beard-texture.js";
import { randomStream } from "./random.js";
import { facePoint, growthAt } from "./human-face-hair.js";
import { bristleMaps } from "./human-beard-bristles.js";
import { rootedBeard } from "./human-beard-rooted.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (v, a, b) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const srgbOf = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hash3(ix, iy, iz, seed) {
  let h = Math.imul(ix + seed, 374761393) ^ Math.imul(iy + 17, 668265263) ^ Math.imul(iz + 31, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x, y, z, seed = 101) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c00 = mix(hash3(ix, iy, iz, seed), hash3(ix + 1, iy, iz, seed), ux);
  const c10 = mix(hash3(ix, iy + 1, iz, seed), hash3(ix + 1, iy + 1, iz, seed), ux);
  const c01 = mix(hash3(ix, iy, iz + 1, seed), hash3(ix + 1, iy, iz + 1, seed), ux);
  const c11 = mix(hash3(ix, iy + 1, iz + 1, seed), hash3(ix + 1, iy + 1, iz + 1, seed), ux);
  return mix(mix(c00, c10, uy), mix(c01, c11, uy), uz);
}

// ---------------------------------------------------------------------------------------------
// Original 256x256 beard strand atlas (4x2 grid of 64x128 tiles)
// Every tile has feathered roots AND staggered feathered hair tips — ZERO opaque square edges!
// Row 0: 4 dense overlapping tapered beard-lock tiles (crisp individual hairs + feathered tips)
// Row 1: two sparse edge tiles and a continuous 128px patch of short hairs.

export const BEARD_TILES = {
  lock: [
    [0, 0, 64, 128],
    [64, 0, 64, 128],
    [128, 0, 64, 128],
    [192, 0, 64, 128],
  ],
  border: [
    [0, 128, 64, 128],
    [64, 128, 64, 128],
  ],
  bed: [128, 128, 128, 128],
};

// ---------------------------------------------------------------------------------------------
// Faithful hair-colour palette with genuine tonal variation (grey salt-and-pepper, blond depth, dark sheen)

function classifyHair(hair) {
  const sr = srgbOf(clamp(hair.r)), sg = srgbOf(clamp(hair.g)), sb = srgbOf(clamp(hair.b));
  const sMax = Math.max(sr, sg, sb), sMin = Math.min(sr, sg, sb);
  const sRelChroma = (sMax - sMin) / Math.max(0.05, sMax);
  const luma = 0.2126 * hair.r + 0.7152 * hair.g + 0.0722 * hair.b;
  const greyness = smooth(luma, 0.14, 0.34) * (1 - smooth(sRelChroma, 0.16, 0.34));
  const blondness = smooth(luma, 0.14, 0.35) * smooth(sRelChroma, 0.22, 0.44);
  const darkness = 1 - smooth(luma, 0.03, 0.14);
  return { luma, greyness, blondness, darkness };
}

function lockVertexColour(out, hair, skin, cls, opts) {
  const { layer, along, streak, lockRnd, downFacing, borderFade, centerChin, lipCrease } = opts;
  const { greyness, blondness, darkness } = cls;

  // Keep per-card root-to-tip swing subtle (eliminates scaly/checkerboard card-edge chatter!)
  // while putting bold sculptural shading at the anatomical macro & vertical lock-streak scale.
  const alongProfile = 0.90 + 0.16 * Math.sin(clamp(along) * Math.PI * 0.72);
  const underShadow = 1 - 0.30 * downFacing;
  const creaseShadow = 1 - 0.15 * lipCrease;
  const layerMult = layer === "border" ? 0.96 : layer === "whisker" ? 1.06 : 1.03;

  // Coherent multi-card vertical lock streaks (minimal per-card random jitter so adjacent shingled locks flow together)
  let tone = 1.00 + 0.22 * streak + (lockRnd - 0.5) * 0.08;
  let rShift = 1, gShift = 1, bShift = 1;
  let sheenFloor = 0;

  if (greyness > 0.02) {
    // True multi-tone salt-and-pepper grey anchored cleanly to the character's grey hairColor:
    // Coherent steel/ash-grey streaks (0.64..0.82) woven with weathered mid-grey (0.86..1.04)
    // and silver highlights on the chin centre & moustache (1.08..1.24).
    const silverSignal = clamp(
      0.50 + 0.36 * streak + 0.18 * centerChin + (lockRnd - 0.5) * 0.16 +
      (layer === "whisker" ? 0.12 : 0.04)
    );
    const greyTone = silverSignal < 0.30
      ? mix(0.62, 0.80, silverSignal / 0.30)
      : silverSignal < 0.68
        ? mix(0.84, 1.05, (silverSignal - 0.30) / 0.38)
        : mix(1.07, 1.24, (silverSignal - 0.68) / 0.32);
    tone = mix(tone, greyTone, greyness);
    const cool = greyness * (1 - smooth(silverSignal, 0.20, 0.58));
    rShift *= 1 - 0.045 * cool;
    gShift *= 1 - 0.01 * cool;
    bShift *= 1 + 0.045 * cool;
  }

  if (blondness > 0.02) {
    const blondTone = mix(
      0.78,
      1.20,
      clamp(0.46 + 0.22 * along + 0.26 * streak + (lockRnd - 0.5) * 0.10 + 0.04)
    );
    tone = mix(tone, blondTone, blondness);
    const warmDepth = blondness * (1 - along) * 0.06;
    rShift *= 1 + warmDepth;
    gShift *= 1 + warmDepth * 0.18;
    bShift *= 1 - warmDepth * 0.65;
  }

  if (darkness > 0.02) {
    const darkTone = mix(0.80, 1.44, clamp(0.48 + 0.34 * streak + (lockRnd - 0.5) * 0.14));
    tone = mix(tone, darkTone, darkness);
    sheenFloor = darkness * (layer === "under" ? 0.003 : 0.015) * smooth(along, 0.18, 0.65) * clamp(0.45 + 0.55 * streak);
  }

  const gain = clamp(tone * alongProfile * underShadow * creaseShadow * layerMult, 0.42, 1.38);
  let r = clamp(hair.r * gain * rShift + sheenFloor);
  let g = clamp(hair.g * gain * gShift + sheenFloor);
  let b = clamp(hair.b * gain * bShift + sheenFloor * 1.03);

  // Graduating cheek border: fine rooted hairs near bare skin soften smoothly out of the cheek
  if (borderFade < 1) {
    const skinMix = (1 - borderFade) * (1 - clamp(along * 0.72)) * (layer === "border" ? 0.58 : 0.24);
    r = mix(r, skin.r, skinMix);
    g = mix(g, skin.g, skinMix);
    b = mix(b, skin.b, skinMix);
  }

  out[0] = r;
  out[1] = g;
  out[2] = b;
}

// ---------------------------------------------------------------------------------------------
// Anatomical beard groom builder

const STYLE_CONFIG = {
  "Clipped beard": {
    full: false, paintedBed: true,
    standOut: {mous:.7, chin:1.6, jaw:1.2, cheek:.6, sideburn:.6},
    lockLen: {mous:3.4, chin:5.4, jaw:4.8, cheek:3.7, sideburn:4.1},
    lockWid: {mous:1.9, chin:2.9, jaw:2.5, cheek:1.8, sideburn:1.8},
    outerSpacing:5.6, mousSpacing:3.8, borderSpacing:4.6, whiskerSpacing:11,
    hangDrop:0, hangOut:0,
  },
  "Short beard": {
    full: false,
    // Rooted hair: lengths, tip lift and fringe height in millimetres for each part of the face.
    rooted: {
      paintFloor: 0.5, paintFull: 0.86, mousWidth: [1.7, 2.5],
      length: { mous: 4.6, chin: 9.0, jaw: 8.4, cheek: 7.0, sideburn: 6.0 },
      lift: { mous: 0.45, chin: 1.6, jaw: 1.3, cheek: 0.75, sideburn: 0.65 },
      fringeHeight: { mous: 2.0, chin: 5.2, jaw: 4.6, cheek: 2.7, sideburn: 2.4 },
      // The share of fringe sites that grow one: most along the jaw and chin, few on the cheek.
      fringeShare: { mous: 0.25, chin: 1, jaw: 1, cheek: 0.5, sideburn: 0.5 },
      coatSpacing: 3.8,
      mousSpacing: 1.7,
      fringeSpacing: 5.0,
      straySpacing: 9,
      featherSpacing: 4.6,
      thatchSpacing: 4.2,
      // Clumps: their width in millimetres, how far each turns from the growth around it and
      // gathers to a point, how much its tone differs from the next, and how far the outer hair
      // opens along the partings between clumps.
      clumpSize: 5.5,
      clumpStretch: 2.4,
      clumpTurn: 0.6,
      clumpGather: 0.7,
      clumpTone: 0.5,
      parting: 0.42,
      partingShade: 0.2,
      // Shade of the undergrowth and of the root of each hair against its tip.
      underShade: 0.56,
      rootShade: 0.66,
      tipLight: 1.08,
      gain: 1.26,
      skinWarmth: 0.1, thinWarmth: 0.12,
      // A game model carries fewer, larger cards and leaves out the single hairs.
      compact: { coatSpacing: 4.7, thatchSpacing: 5.2, mousSpacing: 2.2, fringeSpacing: 6.4, straySpacing: 0, featherSpacing: 6.5, cardScale: 1.22 },
    },
  },
  "Full beard": {
    full: true,
    standOut: { mous: 2.3, chin: 10.0, jaw: 7.0, cheek: 2.8, sideburn: 1.7 },
    lockLen: { mous: 7.2, chin: 21.8, jaw: 19.2, cheek: 14.2, sideburn: 11.2 },
    lockWid: { mous: 4.3, chin: 11.4, jaw: 10.6, cheek: 9.2, sideburn: 6.8 },
    outerSpacing: 6.5,
    mousSpacing: 4.2,
    borderSpacing: 6.2,
    whiskerSpacing: 14.5,
    hangDrop: 15.5,
    hangOut: 7.2,
  },
};

export const beardGroomStyles = Object.keys(STYLE_CONFIG);

/**
 * Build an original anatomical beard groom directly on the adult's head skin geometry.
 * Every vertex inherits barycentric expression morph targets (Blink, Smile, BrowLift)
 * from its anchor skin triangle so the beard moves seamlessly with smiles and jaw shapes.
 */
export function beardGroom(skin, form, material, colours, fit = null, compact = false) {
  const styleName = form.humanStyle?.facialHair;
  const cfg = STYLE_CONFIG[styleName];
  if (!cfg || !skin?.geometry) return null;

  const g = skin.geometry;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const index = g.index.array;
  const moves = g.morphAttributes.position ?? [];
  const count = pos.count;
  const seed = (form.origin?.seed ?? 0) >>> 0;
  const k = (form.human?.height ?? 1.72) / 1.72;
  const mm = k / 1000;

  // Locate exact eye lower floor so sideburns climb beside ears cleanly without ever entering eye bounds
  let eyeMinY = Infinity, eyeHalfX = 0.046 * k;
  if (fit?.s?.eyeGroups && fit.origin) {
    let minY = Infinity, maxAbsX = 0;
    for (const ids of fit.s.eyeGroups) {
      for (const id of ids) {
        const x = fit.s.positions[id * 3] - fit.origin[0];
        const y = fit.s.positions[id * 3 + 1] - fit.origin[1];
        if (y < minY) minY = y;
        if (Math.abs(x) > maxAbsX) maxAbsX = Math.abs(x);
      }
    }
    if (Number.isFinite(minY)) {
      eyeMinY = minY;
      eyeHalfX = Math.max(maxAbsX, 0.042 * k);
    }
  }

  // Evaluate growth zones & face landmarks on skin vertices
  const wMous = new Float32Array(count);
  const wChin = new Float32Array(count);
  const wSide = new Float32Array(count);
  const dens = new Float32Array(count);
  const borderFactor = new Float32Array(count);
  const zoneId = new Uint8Array(count); // 0=none, 1=mous, 2=chin, 3=jaw, 4=cheek, 5=sideburn
  const w = [0, 0, 0];

  let mousLowY = Infinity, mousCenterLowY = Infinity, mousCenterHighY = -Infinity;
  let chinHighY = -Infinity, chinCenterHighY = -Infinity, chinLowY = Infinity;
  let jawMaxX = 0.05 * k, minYAll = Infinity, maxYAll = -Infinity, backZ = Infinity;

  // First quick pass to measure exact centre vs corner upper/lower lip borders and jaw landmarks
  for (let i = 0; i < count; i++) {
    const px = pos.getX(i), py = pos.getY(i), ax = Math.abs(px);
    const [fx, fy] = facePoint(uv.getX(i), uv.getY(i));
    growthAt(fx, fy, w);
    if (w[0] > 0.35) {
      if (py < mousLowY) mousLowY = py;
      if (ax < 10 * mm) {
        if (py < mousCenterLowY) mousCenterLowY = py;
        if (py > mousCenterHighY) mousCenterHighY = py;
      }
    }
    if (w[1] > 0.35) {
      if (py > chinHighY) chinHighY = py;
      if (ax < 12 * mm && py > chinCenterHighY) chinCenterHighY = py;
    }
    if (w[1] > 0.30 && py < chinLowY) chinLowY = py;
    if (w[2] > 0.25 && ax > jawMaxX) jawMaxX = ax;
  }
  if (!Number.isFinite(chinLowY)) return null;
  const mouthY = Number.isFinite(mousCenterLowY) && Number.isFinite(chinCenterHighY)
    ? 0.5 * (mousCenterLowY + chinCenterHighY)
    : Number.isFinite(mousLowY) && Number.isFinite(chinHighY)
      ? 0.5 * (mousLowY + chinHighY)
      : chinLowY + 0.048 * k;
  if (!Number.isFinite(eyeMinY)) eyeMinY = mouthY + 0.065 * k;
  // Exact arched red-lip clearance curves matching real anatomical upper & lower vermilion borders:
  // `mousCenterHighY` sits right under the nose, `mousCenterLowY` sits at the upper lip border.
  const lipSlitY = Number.isFinite(mousCenterLowY) ? mousCenterLowY : mouthY;
  const philtrumSpan = Number.isFinite(mousCenterHighY) ? Math.max(10 * mm, mousCenterHighY - lipSlitY) : 14 * mm;
  const upperLipCenterY = lipSlitY + Math.max(2.0 * mm, philtrumSpan * 0.14);
  const upperLipCornerY = lipSlitY - 2.4 * mm;
  const lowerLipCenterY = Math.min(
    Number.isFinite(chinCenterHighY) ? chinCenterHighY - 0.5 * mm : lipSlitY - 9.5 * mm,
    lipSlitY - 8.5 * mm
  );
  const upperLipArchY = (absX) => mix(upperLipCenterY, upperLipCornerY, smooth(absX, 4 * mm, 24 * mm));
  const lowerLipArchY = (absX) => mix(lowerLipCenterY, upperLipCornerY - 3.5 * mm, smooth(absX, 6 * mm, 24 * mm));

  // Second pass: continuous anatomical beard mask with clean curved cheek line & seamless sideburns
  for (let i = 0; i < count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i), ax = Math.abs(px);
    const [fx, fy] = facePoint(uv.getX(i), uv.getY(i));
    growthAt(fx, fy, w);

    // Gentle organic cheek contour rising smoothly from mouth corners toward a tapered pre-ear sideburn
    const wobble =
      (noise3(px * 26, py * 26, pz * 26, (seed ^ 0x19d2) & 0xffff) - 0.5) * 0.044 +
      (noise3(px * 74, py * 74, pz * 74, (seed ^ 0x4b71) & 0xffff) - 0.5) * 0.022;
    const lateral = Math.abs(fy - 0.5) * 2;
    const cheekLineFx = 0.635 - 0.085 * smooth(lateral, 0.28, 0.74);
    const cheekMask = smooth(fx + wobble, cheekLineFx - 0.075, cheekLineFx + 0.075);
    // Softly tapered vertical sideburn curving naturally up in front of the ear (no rectangular box step)
    const sbHeight = smooth(py, mouthY - 6 * mm, eyeMinY - 4 * mm);
    const sbFrontZ = mix(0.044, 0.026, sbHeight) * k;
    const preEarSideburn =
      smooth(ax, Math.max(eyeHalfX + 13 * mm, jawMaxX * 0.74), Math.max(eyeHalfX + 21 * mm, jawMaxX * 0.87)) *
      smooth(pz, 0.008 * k, 0.022 * k) *
      (1 - smooth(pz, sbFrontZ - 0.008 * k, sbFrontZ + 0.010 * k)) *
      smooth(py, mouthY - 10 * mm, mouthY + 8 * mm) *
      (1 - smooth(py, eyeMinY - 16 * mm, eyeMinY + 2 * mm)) *
      smooth(Math.abs(nor.getX(i)), 0.50, 0.84) *
      (0.75 + 0.25 * noise3(px * 55, py * 55, pz * 55, (seed ^ 0x2c33) & 0xffff));

    const rim = smooth(Math.min(fx, 1 - fx), 0.005, 0.038) * smooth(Math.min(fy, 1 - fy), 0.006, 0.036);
    const neckTrim = smooth(pz, 0.008 * k, 0.024 * k);

    // Arched upper & lower vermilion lip exclusion — keeps red lips 100% framed and unobstructed
    const uArch = upperLipArchY(ax);
    const lArch = lowerLipArchY(ax);
    const inLipOval = ax < 24 * mm && py < uArch && py > lArch;
    const upperLipClear = inLipOval ? 0 : smooth(py, uArch, uArch + 2.6 * mm);
    const lowerLipClear = inLipOval ? 0 : smooth(lArch - py, 0, 3.6 * mm) + smooth(ax, 20 * mm, 29 * mm);

    let m = smooth(w[0], 0.14, 0.58) * rim * upperLipClear;
    let c = smooth(w[1], 0.10, 0.56) * rim * neckTrim * clamp(lowerLipClear);
    let s = Math.max(
      smooth(w[2], 0.08, 0.56) * cheekMask * rim * neckTrim * (inLipOval ? 0 : 1),
      preEarSideburn * 0.84
    );
    if (cfg.rooted) {
      // Cards grow only where the skin paint is already well covered, so thin growth is paint alone.
      const hairs = smooth(shortBeardCover(shortBeardGrowth(fx, fy, w)), cfg.rooted.paintFloor, cfg.rooted.paintFull);
      m *= smooth(shortBeardCover(shortBeardGrowth(fx, fy, w)), 0.22, 0.6);
      c *= hairs;
      s = smooth(w[2], 0.08, 0.56) * rim * neckTrim * (inLipOval ? 0 : 1) * hairs;
    }

    wMous[i] = m;
    wChin[i] = c;
    wSide[i] = s;
    const d = Math.max(m, c, s);
    dens[i] = d;

    if (d > 0.15) {
      if (py < minYAll) minYAll = py;
      if (py > maxYAll) maxYAll = py;
      if (pz < backZ) backZ = pz;
    }
  }

  // Classify anatomical zones & cheek-border graduation factor per vertex
  for (let i = 0; i < count; i++) {
    const d = dens[i];
    if (d < 0.10) {
      dens[i] = 0;
      continue;
    }
    const px = pos.getX(i), py = pos.getY(i), ny = nor.getY(i);
    if (Math.abs(px) < eyeHalfX + 3.5 * mm && py > eyeMinY - 3.5 * mm) {
      dens[i] = 0;
      continue;
    }
    const m = wMous[i], c = wChin[i], s = wSide[i];
    if (m >= c && m >= s && m > 0.16) {
      zoneId[i] = 1; // moustache
      borderFactor[i] = smooth(m, 0.16, 0.58);
    } else if (c >= s && c > 0.14) {
      zoneId[i] = 2; // chin & soul patch
      borderFactor[i] = smooth(c, 0.14, 0.52);
    } else if (Math.abs(px) > jawMaxX * 0.74 && py > mouthY + 4 * mm) {
      zoneId[i] = 5; // sideburn
      borderFactor[i] = smooth(s, 0.14, 0.58);
    } else if (py < mouthY - 7 * mm || ny < -0.18) {
      zoneId[i] = 3; // jawline & lower cheek
      borderFactor[i] = smooth(s, 0.14, 0.54);
    } else {
      zoneId[i] = 4; // upper cheek border
      borderFactor[i] = smooth(s, 0.12, 0.68);
    }
  }

  const inside = new T.Vector3(0, 0.5 * (minYAll + maxYAll) + 0.022 * k, (Number.isFinite(backZ) ? backZ : 0) - 0.022 * k);
  const hair = colours.hair;
  const skinTone = colours.skin;
  const hairCls = classifyHair(hair);

  // Collect eligible skin triangles
  const a = new T.Vector3(), b = new T.Vector3(), cVec = new T.Vector3();
  const ab = new T.Vector3(), ac = new T.Vector3();
  const tris = [];
  for (let t = 0; t < index.length; t += 3) {
    const i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
    const dAvg = (dens[i0] + dens[i1] + dens[i2]) / 3;
    if (dAvg < 0.12) continue;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    cVec.fromBufferAttribute(pos, i2);
    const area = 0.5 * ab.subVectors(b, a).cross(ac.subVectors(cVec, a)).length();
    if (area < 1e-9) continue;
    const cx = (a.x + b.x + cVec.x) / 3, cy = (a.y + b.y + cVec.y) / 3, cz = (a.z + b.z + cVec.z) / 3;
    const bAvg = (borderFactor[i0] + borderFactor[i1] + borderFactor[i2]) / 3;
    const mAvg = (wMous[i0] + wMous[i1] + wMous[i2]) / 3;
    const z0 = zoneId[i0], z1 = zoneId[i1], z2 = zoneId[i2];
    const z = z0 === z1 || z0 === z2 ? z0 : z1 === z2 ? z1 : Math.max(z0, z1, z2);
    tris.push({ ids: [i0, i1, i2], area, cx, cy, cz, dAvg, bAvg, mAvg, z });
  }
  if (!tris.length) return null;

  // Stratified 3D grid sampler with subtle per-pass offset so under-coat & outer locks interleave cleanly
  function sampleStratified(predicate, spacingMm, passSeed, gridOffset = 0) {
    const cell = spacingMm * mm;
    const rng = randomStream(seed ^ passSeed);
    const buckets = new Map();
    for (let ti = 0; ti < tris.length; ti++) {
      const tr = tris[ti];
      if (!predicate(tr)) continue;
      const gx = Math.floor((tr.cx + gridOffset * cell) / cell);
      const gy = Math.floor((tr.cy + gridOffset * cell) / cell);
      const gz = Math.floor((tr.cz + gridOffset * cell) / cell);
      const key = `${gx},${gy},${gz}`;
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(tr);
    }
    const samples = [];
    for (const list of buckets.values()) {
      let totalA = 0;
      for (let i = 0; i < list.length; i++) totalA += list[i].area;
      let pick = rng() * totalA;
      let chosen = list[list.length - 1];
      for (let i = 0; i < list.length; i++) {
        pick -= list[i].area;
        if (pick <= 0) {
          chosen = list[i];
          break;
        }
      }
      let u = rng(), v = rng();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      samples.push({ tri: chosen, weights: [1 - u - v, u, v] });
    }
    return samples;
  }

  if (cfg.rooted) {
    const inLips = (p, margin = 0) => {
      const ax = Math.abs(p.x);
      return ax < 24 * mm + margin && p.y < upperLipArchY(ax) + margin && p.y > lowerLipArchY(ax) - margin;
    };
    const noseBaseY = Number.isFinite(mousCenterHighY) ? mousCenterHighY + 3 * mm : mouthY + 22 * mm;
    const onUpperLip = (p) => Math.abs(p.x) < 26 * mm && p.y > upperLipArchY(Math.abs(p.x)) && p.y < noseBaseY;
    const eyeFloor = (p) => Math.abs(p.x) < eyeHalfX + 2.5 * mm && p.y > eyeMinY - 2.5 * mm;
    const colour = (out, opts) => lockVertexColour(out, hair, skinTone, hairCls, opts);
    const grown = rootedBeard(
      { pos, nor, moves, skinTone, dens, borderFactor, wMous, wChin, mm, mouthY, inside, sample: sampleStratified, inLips, onUpperLip, eyeFloor,
        skinWeights: skin.humanWeights?.weights ? skin.humanWeights : null },
      // Pale hair is lifted to stay silver among its own shadows. Dark hair keeps its depth.
      // Dark hair takes less of the colour of the skin, which would turn it purple.
      { ...cfg.rooted, ...(compact ? cfg.rooted.compact : null), gain: mix(1, cfg.rooted.gain, smooth(hairCls.luma, 0.12, 0.4)), mousRootShade: mix(cfg.rooted.rootShade, 0.44, smooth(hairCls.luma, 0.12, 0.4)), warmth: mix(0.35, 1, smooth(hairCls.luma, 0.03, 0.2)) }, colour, (x, y, z) => noise3(x, y, z, (seed ^ 0x5c31) & 0xffff), randomStream(seed ^ 0x62ea4d06), seed ^ 0x3c6e);
    if (!grown.index.length) return null;
    const mesh = beardMesh(grown.position, grown.normal, grown.colour, grown.uv, grown.index, grown.moves, moves, material, bristleMaps(), styleName);
    mesh.material.alphaTest = 0.5;
    if (grown.bones.length)
      mesh.humanWeights = { boneIndices: Uint8Array.from(grown.bones), weights: Float32Array.from(grown.blend), names: skin.humanWeights.names };
    return mesh;
  }

  const outPos = [];
  const outNor = [];
  const outCol = [];
  const outUv = [];
  const outIdx = [];
  const outMoves = moves.map(() => []);

  const root = new T.Vector3();
  const skinN = new T.Vector3();
  const macroN = new T.Vector3();
  const flow = new T.Vector3();
  const side = new T.Vector3();
  const pt = new T.Vector3();
  const vNorm = new T.Vector3();
  const colRgb = [0, 0, 0];
  const moveTmp = [0, 0, 0];
  const tileSize = 256;

  function emitLock(sample, layer, rng) {
    const { tri, weights } = sample;
    const ids = tri.ids;
    root.set(0, 0, 0);
    skinN.set(0, 0, 0);
    let dVal = 0, bVal = 0, mVal = 0, cVal = 0;
    for (let j = 0; j < 3; j++) {
      const id = ids[j], wj = weights[j];
      root.x += pos.getX(id) * wj;
      root.y += pos.getY(id) * wj;
      root.z += pos.getZ(id) * wj;
      skinN.x += nor.getX(id) * wj;
      skinN.y += nor.getY(id) * wj;
      skinN.z += nor.getZ(id) * wj;
      dVal += dens[id] * wj;
      bVal += borderFactor[id] * wj;
      mVal += wMous[id] * wj;
      cVal += wChin[id] * wj;
    }
    skinN.normalize();
    if (dVal < 0.10) return;
    if(layer==="outer" && tri.z!==1 && mVal<.34 && skinN.y>-.26 && bVal>.58 && rng()<(cfg.full ? .42 : .26)) return;
    // Reject any root inside the arched vermilion lip oval
    const axRoot = Math.abs(root.x);
    if (axRoot < 24 * mm && root.y < upperLipArchY(axRoot) && root.y > lowerLipArchY(axRoot)) return;

    const zone = tri.z;
    const isMous = zone === 1 || mVal > 0.45;
    const isChin = !isMous && (zone === 2 || cVal > 0.35);
    const isSideburn = !isMous && !isChin && zone === 5;
    const isCheek = !isMous && !isChin && !isSideburn && zone === 4;

    const sgnX = root.x >= 0 ? 1 : -1;
    const yawNoise = (rng() - 0.5) * (layer === "whisker" ? 0.28 : 0.12);
    if (isMous) {
      // Part cleanly at philtrum and sweep horizontally outward along the upper lip arch — ZERO fangs over red lip!
      const outPull = smooth(Math.abs(root.x), 1.0 * mm, 9 * mm);
      const cornerDrop = smooth(Math.abs(root.x), 12 * mm, 24 * mm);
      flow.set(sgnX * (0.78 + 0.22 * outPull) + yawNoise * 0.15, -0.16 - 0.34 * cornerDrop, 0.08);
    } else if (isSideburn) {
      flow.set(yawNoise * 0.20, -0.98, -0.08);
    } else if (isCheek) {
      flow.set(-sgnX * 0.10 + yawNoise, -0.95, -0.04);
    } else if (isChin) {
      // Broad, strong natural beard drape (avoid pointy V-tip on full beard!)
      const inward = cfg.full ? -sgnX * 0.06 * smooth(Math.abs(root.x), 14 * mm, 42 * mm) : 0;
      flow.set(inward + yawNoise * 0.36, -1.0, cfg.full ? 0.12 : 0.06);
    } else {
      flow.set(-sgnX * 0.20 + yawNoise * 0.44, -0.93, 0.20);
    }

    const gravityBlend = cfg.full && !isMous && !isSideburn && !isCheek ? 0.38 : 0.10;
    const surfFlow = flow.clone().addScaledVector(skinN, -flow.dot(skinN));
    if (surfFlow.lengthSq() < 1e-6) surfFlow.set(0, -1, 0);
    else surfFlow.normalize();
    flow.normalize().multiplyScalar(gravityBlend).addScaledVector(surfFlow, 1 - gravityBlend).normalize();

    side.crossVectors(skinN, flow);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    else side.normalize();

    const zKey = isMous ? "mous" : isChin ? "chin" : isSideburn ? "sideburn" : isCheek ? "cheek" : "jaw";
    const lowerChin = smooth(mouthY - root.y, 16 * mm, 56 * mm);
    const centerChin = 1 - smooth(Math.abs(root.x), 18 * mm, 54 * mm);
    const chinHangWeight = isChin ? smooth(mouthY - root.y, 18 * mm, 52 * mm) : (zone === 3 ? 0.68 * lowerChin : 0);

    let len = cfg.lockLen[zKey] * (0.86 + 0.28 * rng()) * mm;
    let wid = cfg.lockWid[zKey] * (0.88 + 0.24 * rng()) * mm;
    wid *= cfg.full ? .50 : .46;
    len *= cfg.full ? .94 : .76;
    let stand = cfg.standOut[zKey] * (0.78 + 0.36 * bVal) * mm;

    if (layer === "border") {
      // Extra-sleek graduating cheek-border transition hairs hugging the cheek flush
      len *= 0.68 + 0.26 * bVal;
      wid *= 0.94;
      stand *= 0.18 + 0.28 * bVal;
    } else if (layer === "whisker") {
      len *= 0.84 + 0.28 * rng();
      wid *= 0.76;
      stand *= 1.10;
    } else {
      stand *= 0.90 + 0.22 * rng();
    }

    // Keep moustache neat & trim right above the central Cupid's bow
    if (isMous) {
      const philtrumTrim = 0.56 + 0.44 * smooth(Math.abs(root.x), 5 * mm, 18 * mm);
      len *= philtrumTrim;
    }

    const extraDrop = cfg.hangDrop * chinHangWeight * (0.72 + 0.32 * centerChin) * (layer === "border" ? 0 : 1) * mm;
    const extraOut = cfg.hangOut * chinHangWeight * (0.62 + 0.38 * centerChin) * (layer === "border" ? 0 : 1) * mm;
    len += extraDrop * 0.45;
    stand += extraOut * 0.55;
    if (!cfg.full && skinN.y < -0.35) len *= 0.62;

    let tile;
    if (layer === "border") {
      tile = BEARD_TILES.border[Math.floor(rng() * BEARD_TILES.border.length)];
    } else if (layer === "whisker") {
      tile = BEARD_TILES.border[1];
    } else {
      tile = BEARD_TILES.lock[Math.floor(rng() * 4)];
    }
    const flip = rng() < 0.5;
    const steps =
      layer === "border" || layer === "whisker"
        ? 1
        : cfg.full && (isChin || zone === 3) && len > 18 * mm
          ? 2
          : isMous || isSideburn || isCheek
            ? 1
            : 2;

    // Coherent vertical lock-streak noise (smooth multi-lock salt-and-pepper & tonal ribbons)
    const streak = (noise3(root.x * 48, root.y * 12, root.z * 48, (seed ^ 0x5c31) & 0xffff) - 0.5) * 2;
    const lockRnd = rng();
    const downFacing = smooth(-skinN.y, 0.05, 0.68);
    const lipCrease = smooth(12 * mm - Math.abs(root.y - (mouthY - 8 * mm)), 0, 12 * mm) * (1 - smooth(Math.abs(root.x), 14 * mm, 32 * mm));
    const lockTilt = (rng() - 0.5) * 0.11;

    const lockShifts = moves.map((target) => {
      moveTmp[0] = moveTmp[1] = moveTmp[2] = 0;
      for (let j = 0; j < 3; j++) {
        const id = ids[j], wj = weights[j];
        moveTmp[0] += target.array[id * 3] * wj;
        moveTmp[1] += target.array[id * 3 + 1] * wj;
        moveTmp[2] += target.array[id * 3 + 2] * wj;
      }
      return [moveTmp[0], moveTmp[1], moveTmp[2]];
    });

    const rootSink = layer === "border" ? 0.12 * mm : stand * 0.34;
    const first = outPos.length / 3;
    macroN.copy(root).sub(inside).normalize();

    for (let step = 0; step <= steps; step++) {
      const along = step / steps;
      // Sleek combed profile: rises smoothly from root and settles down along the beard contour
      const arch = smooth(along, 0, 0.52) * (1 - 0.28 * along * along);
      const lift = mix(rootSink, stand, arch);
      const dropY = -(len * (cfg.full ? 0.14 : 0.05) + extraDrop * 0.34) * along * along;
      const forwardZ = extraOut * 0.38 * Math.sin(along * Math.PI * 0.72);
      const waveSide = (cfg.full ? 1.1 : 0.3) * mm * Math.sin(along * Math.PI * 1.4 + lockRnd * 6.28) * along;
      const halfW = wid * 0.5 * (1 - 0.26 * along);

      for (const sign of [-1, 1]) {
        pt.copy(root)
          .addScaledVector(flow, len * along)
          .addScaledVector(side, sign * halfW + waveSide)
          .addScaledVector(skinN, lift);
        pt.y += dropY;
        pt.z += forwardZ;

        // Hard eye-floor clamp between outer eye corners
        if (Math.abs(pt.x) < eyeHalfX + 2.5 * mm && pt.y > eyeMinY - 2.5 * mm) {
          pt.y = eyeMinY - 2.5 * mm;
        }
        // Strict arched red-lip clearance for EVERY lock regardless of zone:
        // locks rooted above the lip slit never dip below the upper lip arch; locks rooted below never rise above the lower lip arch!
        const axPt = Math.abs(pt.x);
        if (axPt < 25 * mm) {
          if (root.y >= lipSlitY) {
            const uFloor = upperLipArchY(axPt);
            if (pt.y < uFloor) pt.y = uFloor;
          } else {
            const lCeil = lowerLipArchY(axPt);
            if (pt.y > lCeil) pt.y = lCeil;
          }
        }

        // Smooth cohesive macro-lighting + subtle lock ridge relief (eliminates flat-chip sparkle)
        vNorm
          .copy(macroN)
          .multiplyScalar(0.76)
          .addScaledVector(skinN, 0.16)
          .addScaledVector(side, sign * 0.12)
          .addScaledVector(flow, lockTilt)
          .normalize();

        outPos.push(pt.x, pt.y, pt.z);
        outNor.push(vNorm.x, vNorm.y, vNorm.z);

        lockVertexColour(colRgb, hair, skinTone, hairCls, {
          layer,
          along,
          streak,
          lockRnd,
          downFacing,
          borderFade: bVal,
          centerChin,
          lipCrease,
        });
        outCol.push(colRgb[0], colRgb[1], colRgb[2]);

        const uFrac = (sign < 0) !== flip ? 0 : 1;
        const uPx = tile[0] + 2.5 + (tile[2] - 5) * uFrac;
        const vPx = tile[1] + 2.5 + (tile[3] - 5) * (1 - along);
        outUv.push(uPx / tileSize, 1 - vPx / tileSize);

        for (let e = 0; e < lockShifts.length; e++) {
          const sh = lockShifts[e];
          outMoves[e].push(sh[0], sh[1], sh[2]);
        }
      }

      if (step > 0) {
        const at = first + step * 2;
        outIdx.push(at - 2, at + 1, at - 1, at - 2, at, at + 1);
      }
    }
  }

  const passRng = randomStream(seed ^ 0x62ea4d06);

  // A low, continuous layer of short hairs fills the core below the loose whiskers.
  const bedVertex = new Int32Array(count).fill(-1);
  const cells = new Map(), samples = [];
  function bedPoint(id) {
    if (bedVertex[id] >= 0) return bedVertex[id];
    const [fx,fy] = facePoint(uv.getX(id),uv.getY(id));
    // Cluster in the face chart so neighbouring samples follow the same UV
    // and morphs without spending the game face's triangles on buried hair.
    const cell = Math.floor(36*fx) + 64*Math.floor(46*fy);
    let slot = cells.get(cell);
    if (slot === undefined) {
      slot = samples.length;
      cells.set(cell,slot);
      samples.push(0);
      for(const buffer of [outPos,outNor,outCol,...outMoves]) buffer.push(0,0,0);
      outUv.push(0,0);
    }
    bedVertex[id] = slot;
    samples[slot]++;
    pt.fromBufferAttribute(pos,id);
    skinN.fromBufferAttribute(nor,id);
    const centre = 1 - smooth(Math.abs(pt.x),18*mm,60*mm);
    const lower = smooth(mouthY - pt.y,16*mm,46*mm) * (.52+.48*centre);
    const density = smooth(dens[id], cfg.full ? .26 : .40, .88);
    const depth = mm*(cfg.full ? 2.1+5.2*lower : .35+.95*lower);
    pt.addScaledVector(skinN,density*depth-(1-density)*(cfg.full ? 3.4 : 2.6)*mm);
    pt.y -= lower*density*(cfg.full ? 14 : 1.7)*mm;
    if(cfg.full) pt.z += lower*density*5*mm;
    const tone = 1.12+.10*centre-.14*smooth(-skinN.y,0,.7);
    const blend = (cfg.full ? .92 : .84)*smooth(dens[id], cfg.full ? .18 : .32, .82);
    for (let k=0;k<3;k++) {
      const offset=3*slot+k, channel=["r","g","b"][k];
      outPos[offset] += pt.getComponent(k);
      outNor[offset] += skinN.getComponent(k);
      outCol[offset] += mix(skinTone[channel],hair[channel]*tone+.007*hairCls.darkness,blend);
      moves.forEach((target,e) => {outMoves[e][offset] += target.array[3*id+k];});
    }
    outUv[2*slot] += bedColumn(fy)/tileSize;
    outUv[2*slot+1] += 1-bedRow(fx)/tileSize;
    return slot;
  }
  const bedFaces = new Set();
  for(const tri of cfg.paintedBed ? [] : tris){
    if(tri.z===1 || (!cfg.full && (tri.z===4 || tri.z===5)) || tri.dAvg<(cfg.full ? .16 : .34) || tri.ids.some(id=>wMous[id]>.30)) continue;
    const [a,b,c] = tri.ids.map(bedPoint);
    if(a===b || b===c || c===a) continue;
    const key=[a,b,c].sort((a,b)=>a-b).join(",");
    if(bedFaces.has(key)) continue;
    bedFaces.add(key);
    outIdx.push(a,b,c);
  }
  for(let i=0;i<samples.length;i++){
    for(const buffer of [outPos,outCol,...outMoves])
      for(let k=0;k<3;k++) buffer[3*i+k]/=samples[i];
    skinN.fromArray(outNor,3*i).normalize().toArray(outNor,3*i);
    outUv[2*i]/=samples[i]; outUv[2*i+1]/=samples[i];
  }

  // 2. Primary sculpted outer beard locks (interleaved 0.5-cell offset for seamless overlap)
  const outerSamples = sampleStratified(
    (tr) => tr.z !== 1 && tr.dAvg >= 0.26 && tr.bAvg >= 0.24,
    cfg.outerSpacing,
    0x29c7,
    0.5
  );
  for (const s of outerSamples) emitLock(s, "outer", passRng);

  // 3. Moustache & upper-lip locks
  const mousSamples = sampleStratified(
    (tr) => tr.z === 1 || tr.mAvg >= 0.34,
    cfg.mousSpacing,
    0x3f41,
    0.25
  );
  for (const s of mousSamples) emitLock(s, "outer", passRng);

  // 4. Graduating cheek-border & sideburn feathered transition locks (soft rooted fringe along cheek line)
  const borderSamples = sampleStratified(
    (tr) => tr.z !== 1 && tr.dAvg >= 0.12 && tr.bAvg >= 0.10 && tr.bAvg < 0.78,
    cfg.borderSpacing,
    0x4d89,
    0.35
  );
  for (const s of borderSamples) emitLock(s, "border", passRng);

  // 5. Loose individual silhouette whiskers & flyaway hairs along chin & jaw rim
  const whiskerSamples = sampleStratified(
    (tr) => tr.dAvg >= 0.32 && (tr.z === 2 || tr.z === 3),
    cfg.whiskerSpacing,
    0x5a73,
    0.7
  );
  for (const s of whiskerSamples) emitLock(s, "whisker", passRng);

  if (!outIdx.length) return null;

  return beardMesh(outPos, outNor, outCol, outUv, outIdx, outMoves, moves, material, { map: beardStrandMap(), ...beardSurfaceMaps() }, styleName);
}

function beardMesh(outPos, outNor, outCol, outUv, outIdx, outMoves, moves, material, maps, styleName) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(outPos, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(outNor, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(outCol, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(outUv, 2));
  geometry.setIndex(outIdx);
  if (moves.length) {
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = outMoves.map((values, e) => {
      const attr = new T.Float32BufferAttribute(values, 3);
      attr.name = moves[e].name;
      return attr;
    });
  }

  const m = material("#ffffff").clone();
  m.vertexColors = true;
  m.roughness = 1;
  Object.assign(m, maps);
  m.alphaTest = 0.32;
  m.alphaToCoverage = false;
  m.side = T.DoubleSide;
  m.userData = { ...m.userData, fibreLOD: true, portrait: true };

  const mesh = new T.Mesh(geometry, m);
  mesh.name = "facial-hair";
  mesh.userData.originalBeardGroom = styleName;
  mesh.castShadow = false;
  mesh.updateMorphTargets();
  return mesh;
}
