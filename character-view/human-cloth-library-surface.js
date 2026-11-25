import * as T from "three";

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise2(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy),
    b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1),
    d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy;
}

// Per-garment panel-to-fabric construction assignments for authored system library clothes
// that lack baked ORM surface maps. Preserves 100% of artists' diffuse paint & fold normals.
// Panel index matches `panels[i] - 1` (when panel-charted) or `dyes[name]` rule index (fallback).
const LIBRARY_FABRICS = {
  male_elegantsuit01: {
    // dyes: 0=accent (tie), 1=light (dress shirt), 2=main (suit jacket/trousers)
    byRule: ["silk_tie", "poplin", "wool_twill"],
    fallback: "wool_twill",
  },
  female_elegantsuit01: {
    // dyes: 0=blouse, 1=skirt/jacket
    byRule: ["blouse_silk", "wool_twill"],
    fallback: "wool_twill",
  },
  male_casualsuit01: {
    // panels: 0=overshirt, 1=denim jeans, 2=accent
    byRule: ["flannel", "denim", "poplin"],
    fallback: "leather",
  },
  male_casualsuit03: {
    // panels: 0=striped shirt, 1=denim jeans, 2=accent
    byRule: ["poplin", "denim", "poplin"],
    fallback: "leather",
  },
  male_casualsuit05: {
    // dyes: 0=jeans, 1=tee/accent, 2=dark/denim, 3=field jacket
    byRule: ["denim", "jersey", "denim", "canvas"],
    fallback: "leather",
  },
  male_worksuit01: {
    // dyes: 0=white tee, 1=workwear overalls
    byRule: ["jersey", "canvas"],
    fallback: "leather",
  },
  female_sportsuit01: {
    // panels: 0=track top, 1=leggings, 2=accent stripe
    byRule: ["pique", "stretch_knit", "stretch_knit"],
    fallback: "stretch_knit",
  },
  shoes01: { byRule: ["leather"], fallback: "rubber" },
  shoes02: { byRule: ["leather"], fallback: "rubber" },
  shoes05: { byRule: ["pique"], fallback: "rubber" },
};

// Evaluate procedural directional construction height [0..1] and PBR roughness [0..1] in UV space.
// Spatial frequencies are chosen so weave wales span 3-6 texels inside the final 24K/1024 shared atlas.
function sampleFabric(kind, u, v, out) {
  let h = 0.5;
  let r = 0.8;
  let ao = 1.0;

  if (kind === "denim") {
    // Steep 3x1 diagonal twill wales + warp slub variation + dry-to-burnished denim roughness.
    const diag = (u * 0.78 + v * 0.62) * 104;
    const f = diag - Math.floor(diag);
    const wale = Math.sin(f * Math.PI * 2);
    const slub = noise2(u * 130, v * 22) - 0.5;
    const wear = noise2(u * 11, v * 11);
    h = clamp(0.5 + 0.28 * wale + 0.14 * slub, 0.08, 0.94);
    r = clamp(0.84 - 0.09 * wale - 0.08 * wear + 0.05 * Math.abs(slub), 0.66, 0.94);
    ao = 0.91 + 0.09 * (0.5 + 0.5 * wale);
  } else if (kind === "wool_twill") {
    // Fine worsted wool diagonal twill + dry matte felted light response.
    const diag = (u * 0.72 + v * 0.69) * 160;
    const wale = Math.sin(diag * Math.PI * 2);
    const felted = noise2(u * 82, v * 82) - 0.5;
    h = clamp(0.5 + 0.16 * wale + 0.12 * felted, 0.16, 0.86);
    r = clamp(0.86 - 0.05 * wale + 0.06 * Math.abs(felted), 0.76, 0.95);
    ao = 0.93 + 0.07 * (0.5 + 0.5 * wale);
  } else if (kind === "flannel") {
    // Soft brushed diagonal twill flannel with cozy matte pile.
    const diag = (u * 0.7 + v * 0.7) * 76;
    const wale = Math.sin(diag * Math.PI * 2);
    const nap = noise2(u * 54, v * 54) - 0.5;
    h = clamp(0.5 + 0.24 * wale + 0.22 * nap, 0.1, 0.92);
    r = clamp(0.90 - 0.04 * wale + 0.05 * nap, 0.80, 0.96);
    ao = 0.93 + 0.07 * (0.5 + 0.5 * wale);
  } else if (kind === "canvas") {
    // Heavy 2x2 basketweave duck outerwear.
    const bx = u * 72,
      by = v * 72;
    const ix = Math.floor(bx),
      iy = Math.floor(by);
    const fx = bx - ix,
      fy = by - iy;
    const overWarp = ((ix + iy) & 1) === 0;
    const rib = overWarp ? Math.sin(fx * Math.PI) * (0.65 + 0.35 * Math.sin(fy * Math.PI)) : Math.sin(fy * Math.PI) * (0.65 + 0.35 * Math.sin(fx * Math.PI));
    const slub = noise2(u * 42, v * 42) - 0.5;
    h = clamp(0.18 + 0.68 * rib + 0.10 * slub, 0.06, 0.96);
    r = clamp(0.88 - 0.12 * rib + 0.06 * slub, 0.72, 0.95);
    ao = 0.88 + 0.12 * rib;
  } else if (kind === "poplin") {
    // Crisp garment-weight woven cotton / linen with orthogonal plain weave + slub threads.
    const wx = Math.sin(u * 108 * Math.PI * 2);
    const wy = Math.sin(v * 108 * Math.PI * 2);
    const slubH = (noise2(u * 18, v * 110) - 0.5) * 0.32;
    const slubV = (noise2(u * 110, v * 18) - 0.5) * 0.24;
    const weave = 0.5 * (wx * wy) + slubH + slubV;
    h = clamp(0.5 + 0.26 * weave, 0.14, 0.88);
    r = clamp(0.60 - 0.07 * weave, 0.48, 0.72);
    ao = 0.95 + 0.05 * clamp(0.5 + weave, 0, 1);
  } else if (kind === "blouse_silk") {
    // Crisp satin-cotton / silk blouse with lustrous light response.
    const diag = (u * 0.6 + v * 0.8) * 104;
    const wave = Math.sin(diag * Math.PI * 2);
    const sheen = noise2(u * 14, v * 14) - 0.5;
    h = clamp(0.5 + 0.18 * wave, 0.22, 0.78);
    r = clamp(0.46 - 0.07 * wave + 0.06 * sheen, 0.36, 0.58);
    ao = 0.96 + 0.04 * (0.5 + 0.5 * wave);
  } else if (kind === "silk_tie") {
    // Repp-ribbed lustrous silk necktie (high specular contrast beside wool suit).
    const rib = Math.sin((u * 0.75 + v * 0.66) * 74 * Math.PI * 2);
    h = clamp(0.5 + 0.32 * rib, 0.12, 0.90);
    r = clamp(0.28 - 0.07 * rib, 0.18, 0.38);
    ao = 0.93 + 0.07 * (0.5 + 0.5 * rib);
  } else if (kind === "jersey") {
    // Fine vertical cotton jersey knit wales + soft matte response.
    const wale = Math.sin(u * 92 * Math.PI * 2);
    const course = Math.sin((v * 74 + Math.abs(((u * 92) % 1 + 1) % 1 - 0.5) * 0.7) * Math.PI * 2);
    const knit = 0.62 * wale + 0.38 * course;
    h = clamp(0.5 + 0.26 * knit, 0.14, 0.88);
    r = clamp(0.84 - 0.06 * knit, 0.74, 0.92);
    ao = 0.93 + 0.07 * (0.5 + 0.5 * knit);
  } else if (kind === "pique") {
    // Breathable athletic pique / micro-mesh knit.
    const gx = Math.cos(u * 88 * Math.PI * 2);
    const gy = Math.cos(v * 88 * Math.PI * 2);
    const cell = gx * gy;
    h = clamp(0.5 + 0.34 * cell, 0.10, 0.90);
    r = clamp(0.68 - 0.09 * cell, 0.54, 0.80);
    ao = 0.90 + 0.10 * (0.5 + 0.5 * cell);
  } else if (kind === "stretch_knit") {
    // Sleek athletic stretch leggings with subtle vertical knit lustre.
    const rib = Math.sin(u * 98 * Math.PI * 2);
    const sheen = noise2(u * 12, v * 12) - 0.5;
    h = clamp(0.5 + 0.18 * rib, 0.24, 0.78);
    r = clamp(0.45 - 0.06 * rib + 0.05 * sheen, 0.34, 0.56);
    ao = 0.96 + 0.04 * (0.5 + 0.5 * rib);
  } else if (kind === "leather") {
    // Full-grain pebbled oiled leather with satin specular highlights.
    const n1 = noise2(u * 56, v * 56);
    const n2 = noise2(u * 112 + n1 * 1.4, v * 112 - n1 * 1.1);
    const fold = noise2(u * 14, v * 14);
    const grain = 0.55 * n1 + 0.45 * n2;
    h = clamp(0.24 + 0.56 * grain + 0.12 * (fold - 0.5), 0.1, 0.92);
    r = clamp(0.46 - 0.12 * grain - 0.05 * fold, 0.30, 0.56);
    ao = 0.92 + 0.08 * grain;
  } else {
    // Matte rubber sole.
    const grit = noise2(u * 75, v * 75) - 0.5;
    h = clamp(0.5 + 0.16 * grit, 0.28, 0.72);
    r = clamp(0.84 + 0.06 * grit, 0.76, 0.92);
    ao = 0.96;
  }

  out[0] = h;
  out[1] = r;
  out[2] = ao;
}

const cache = new Map();

export function hasLibraryFabricProfile(name) {
  return Object.hasOwn(LIBRARY_FABRICS, name);
}

/**
 * Synthesize cached ORM (AO + per-panel fabric roughness) and UDN-blended directional
 * weave normal maps for an authored system library garment without overwriting its
 * painted diffuse texture or existing sculpted fold normals.
 */
export function buildLibraryFabricMaps(name, sourceTex, existingNormalTex, existingAoTex, panels, dyeRules) {
  if (!hasLibraryFabricProfile(name) || !sourceTex?.image || typeof document === "undefined") {
    return null;
  }
  if (cache.has(name)) return cache.get(name);

  const spec = LIBRARY_FABRICS[name];
  const img = sourceTex.image;
  const srcW = img.width || 0;
  const srcH = img.height || 0;
  if (srcW < 8 || srcH < 8) return null;
  const w = Math.min(512, srcW);
  const h = Math.min(512, srcH);

  const ormCanvas = document.createElement("canvas");
  ormCanvas.width = w;
  ormCanvas.height = h;
  const ormCtx = ormCanvas.getContext("2d");
  if (!ormCtx || typeof ormCtx.createImageData !== "function" || typeof ormCtx.putImageData !== "function") {
    return null;
  }

  const readPixels = (tex) => {
    if (!tex?.image) return null;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof ctx.drawImage !== "function" || typeof ctx.getImageData !== "function") return null;
    ctx.drawImage(tex.image, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h)?.data;
    return data && data.length >= w * h * 4 ? data : null;
  };

  const srcData = readPixels(sourceTex);
  if (!srcData) return null;
  const baseNormData = readPixels(existingNormalTex);
  const baseAoData = readPixels(existingAoTex);

  const heightBuf = new Float32Array(w * h);
  const ormImg = ormCtx.createImageData(w, h);
  const ormData = ormImg.data;
  const sampleOut = new Float64Array(3);

  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / h));
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const idx = y * w + x;
      const o = idx * 4;
      const srcAlpha = srcData[o + 3];
      const r0 = srcData[o] / 255,
        g0 = srcData[o + 1] / 255,
        b0 = srcData[o + 2] / 255;
      const max = Math.max(r0, g0, b0),
        min = Math.min(r0, g0, b0);
      const l = (max + min) * 0.5,
        d = max - min;
      const s = d < 1e-4 ? 0 : d / (l < 0.5 ? max + min : 2 - max - min);
      const hue =
        d < 1e-4
          ? 0
          : (((max === r0 ? (g0 - b0) / d : max === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4) + 6) % 6) / 6;

      let ruleIdx = -1;
      if (panels) {
        const sx = Math.min(srcW - 1, Math.floor((x * srcW) / w));
        ruleIdx = panels[sy * srcW + sx] - 1;
        if (ruleIdx === 0 && name === "female_sportsuit01" && s > 0.45 && hue < 0.16) ruleIdx = 2;
      } else if (dyeRules) {
        ruleIdx = dyeRules.findIndex((rule) => rule.pick(hue, s, l));
      }

      const kind = (ruleIdx >= 0 && spec.byRule[ruleIdx]) || spec.fallback;
      sampleFabric(kind, u, v, sampleOut);

      heightBuf[idx] = sampleOut[0];
      const hasAo = baseAoData && srcAlpha >= 16 && baseAoData[o + 3] >= 16;
      const existingAo = hasAo ? Math.max(0.2, baseAoData[o] / 255) : 1.0;
      ormData[o] = Math.round(255 * clamp(existingAo * sampleOut[2], 0, 1));
      ormData[o + 1] = Math.round(255 * clamp(sampleOut[1], 0.16, 0.96));
      ormData[o + 2] = 0;
      ormData[o + 3] = 255;
    }
  }
  ormCtx.putImageData(ormImg, 0, 0);

  // Derive directional fabric weave normal and UDN-blend onto existing baked fold normal map.
  const normCanvas = document.createElement("canvas");
  normCanvas.width = w;
  normCanvas.height = h;
  const normCtx = normCanvas.getContext("2d");
  const normImg = normCtx.createImageData(w, h);
  const normData = normImg.data;
  const weaveGain = baseNormData ? 0.40 : 0.36;

  for (let y = 0; y < h; y++) {
    const top = y > 0 ? y - 1 : 0;
    const bot = y + 1 < h ? y + 1 : h - 1;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < w ? x + 1 : w - 1;
      const i = row + x;
      const o = i * 4;
      if (srcData[o + 3] < 16) {
        normData[o] = 128;
        normData[o + 1] = 128;
        normData[o + 2] = 255;
        normData[o + 3] = 255;
        continue;
      }
      const wx = weaveGain * (heightBuf[row + left] - heightBuf[row + right]);
      const wy = weaveGain * (heightBuf[bot * w + x] - heightBuf[top * w + x]);

      let bx = 0,
        by = 0,
        bz = 1;
      if (baseNormData && baseNormData[o + 3] >= 16 && (baseNormData[o] > 8 || baseNormData[o + 1] > 8 || baseNormData[o + 2] > 128)) {
        bx = (baseNormData[o] / 127.5 - 1) * 0.85;
        by = (baseNormData[o + 1] / 127.5 - 1) * 0.85;
        bz = Math.max(0.15, baseNormData[o + 2] / 127.5 - 1);
      }
      // UDN blend preserves broad authored garment folds while adding crisp fabric weave.
      const nx = bx + wx;
      const ny = by + wy;
      const nz = bz;
      const len = Math.hypot(nx, ny, nz) || 1;
      normData[o] = Math.round(127.5 + (127.5 * nx) / len);
      normData[o + 1] = Math.round(127.5 + (127.5 * ny) / len);
      normData[o + 2] = Math.round(127.5 + (127.5 * nz) / len);
      normData[o + 3] = 255;
    }
  }
  normCtx.putImageData(normImg, 0, 0);

  const surface = new T.CanvasTexture(ormCanvas);
  surface.anisotropy = 4;
  surface.flipY = sourceTex.flipY;

  const normal = new T.CanvasTexture(normCanvas);
  normal.anisotropy = 4;
  normal.flipY = sourceTex.flipY;

  const entry = { surface, normal };
  cache.set(name, entry);
  return entry;
}
