import { MathUtils } from "three";

const { clamp, smoothstep } = MathUtils;

export const RELIEF_FAMILIES = [
  "chitin",
  "scales",
  "wet",
  "pebbled",
  "pelt",
  "plumage",
];

function hash3(x, y, z, seed) {
  let h =
    Math.imul(x | 0, 73856093) ^
    Math.imul(y | 0, 19349663) ^
    Math.imul(z | 0, 83492791) ^
    (seed | 0);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise3(x, y, z, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const c000 = hash3(ix, iy, iz, seed);
  const c100 = hash3(ix + 1, iy, iz, seed);
  const c010 = hash3(ix, iy + 1, iz, seed);
  const c110 = hash3(ix + 1, iy + 1, iz, seed);
  const c001 = hash3(ix, iy, iz + 1, seed);
  const c101 = hash3(ix + 1, iy, iz + 1, seed);
  const c011 = hash3(ix, iy + 1, iz + 1, seed);
  const c111 = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

function noise2(x, y, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy;
}

export function worley3(out, x, y, z, seed) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let d1 = 1e9,
    d2 = 1e9,
    cellId = 0;
  for (let dz = -1; dz <= 1; dz++) {
    const cz = iz + dz;
    for (let dy = -1; dy <= 1; dy++) {
      const cy = iy + dy;
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const jx = cx + 0.16 + 0.68 * hash3(cx, cy, cz, seed) - x;
        const jy = cy + 0.16 + 0.68 * hash3(cx, cy, cz, seed ^ 1543) - y;
        const jz = cz + 0.16 + 0.68 * hash3(cx, cy, cz, seed ^ 9377) - z;
        const q = jx * jx + jy * jy + jz * jz;
        if (q < d1) {
          d2 = d1;
          d1 = q;
          cellId = hash3(cx, cy, cz, seed ^ 31337);
        } else if (q < d2) {
          d2 = q;
        }
      }
    }
  }
  out[0] = Math.sqrt(d1);
  out[1] = Math.sqrt(d2);
  out[2] = cellId;
}

/**
 * Deterministically classify a creature plan into a coherent biological relief profile.
 * Respects explicit `skin.coat.family` and `skin.surface` artist choices while giving
 * each anatomical archetype a distinct, blind-readable material identity.
 */
export function classifyCreatureRelief(plan, skin = plan?.skin) {
  const limbs = plan?.limbs ?? [];
  const head = plan?.head ?? {};
  const back = plan?.back ?? {};
  const tail = plan?.tail ?? {};
  const details = plan?.details ?? [];
  const fam = plan?.family ?? "";

  const hasTentacles = limbs.some((l) => l.kind === "tentacle");
  const hasFins = limbs.some((l) => l.kind === "fin");
  const hasFeatherWing = limbs.some((l) => l.kind === "wing" && l.structure === "feather");
  const hasBatWing = limbs.some((l) => l.kind === "wing" && l.structure === "bat");
  const hasInsectWing = limbs.some((l) => l.kind === "wing" && l.structure === "insect");
  const hasInsectLeg = limbs.some((l) => l.kind === "leg" && l.style === "insect");
  const hasBirdLeg = limbs.some((l) => l.kind === "leg" && l.style === "bird");
  const hasPincer = limbs.some((l) => l.end === "pincer");
  const hasHoof = limbs.some((l) => l.end === "hoof");
  const isMandible = head.snout === "mandibles";
  const isBeakOrBill = head.snout === "beak" || head.snout === "bill";
  const isStinger = tail.kind === "stinger";
  const hasShag = back.kind === "shag mantle" || details.includes("mane");
  const hasArmor =
    back.kind === "plates" || back.kind === "shingles" || details.includes("belly plates");
  const hasGill = back.kind === "gill fans";
  const isArthropod =
    isMandible ||
    isStinger ||
    hasInsectWing ||
    hasPincer ||
    fam === "skitter" ||
    (fam === "mantis" && hasInsectLeg);

  // 1. Explicit coat family always wins (preserves legacy coated presets & manual coat choices).
  const coatFam = skin?.coat?.family;
  if (coatFam === "wet skin") {
    return {
      family: "wet",
      sub: hasTentacles ? "cephalopod" : "aquatic",
      bumpMetres: hasTentacles ? 0.0085 : 0.0068,
      baseRough: 0.22,
    };
  }
  if (coatFam === "plumage") {
    return { family: "plumage", sub: "avian", bumpMetres: 0.0064, baseRough: 0.68 };
  }
  if (coatFam === "pelt") {
    return { family: "pelt", sub: "fur", bumpMetres: 0.0068, baseRough: 0.84 };
  }
  if (coatFam === "scutes") {
    return isArthropod
      ? { family: "chitin", sub: "arthropod", bumpMetres: 0.0105, baseRough: 0.30 }
      : {
          family: "scales",
          sub: hasArmor || fam === "tank" ? "armoured" : "reptile",
          bumpMetres: hasArmor || fam === "tank" ? 0.0105 : 0.0088,
          baseRough: 0.48,
        };
  }

  // 2. Aquatic & cephalopod anatomy -> glistening wet mantle / hydrodynamic skin.
  if (fam === "drifter" || (hasTentacles && !hasInsectLeg && !hasHoof && !isMandible && fam !== "envoy")) {
    return { family: "wet", sub: "cephalopod", bumpMetres: 0.0088, baseRough: 0.20 };
  }
  if (fam === "swimmer" || hasFins || hasGill) {
    return { family: "wet", sub: "aquatic", bumpMetres: 0.0070, baseRough: 0.22 };
  }

  // 3. Arthropods & insectoids -> glossy segmented chitin with contrasting matte joints.
  if (isArthropod) {
    return {
      family: "chitin",
      sub: hasInsectLeg ? "arthropod" : "plated",
      bumpMetres: 0.0108,
      baseRough: 0.28,
    };
  }

  // 4. Feathered flyers & waders -> layered avian plumage + scaly bird shins.
  if (
    hasFeatherWing ||
    fam === "wader" ||
    (isBeakOrBill && hasBirdLeg && !hasArmor && fam !== "tank" && fam !== "stalker" && fam !== "hopper")
  ) {
    return { family: "plumage", sub: "avian", bumpMetres: 0.0066, baseRough: 0.66 };
  }

  // 5. Furry grazers, hoofed mammals, shag-mantle / bat-winged mammals -> directional combed pelt.
  if (
    hasShag ||
    hasHoof ||
    hasBatWing ||
    fam === "grazer" ||
    (details.includes("tail tuft") && !hasArmor && skin?.surface !== "scales")
  ) {
    return { family: "pelt", sub: "fur", bumpMetres: 0.0068, baseRough: 0.84 };
  }

  // 6. Armored tanks, stalker predators, and bare spiky reptiles -> overlapping keeled scales + smooth belly.
  if (
    fam === "tank" ||
    fam === "stalker" ||
    hasArmor ||
    (back.kind === "spikes" && !plan?.dress && fam !== "brute" && fam !== "envoy")
  ) {
    const armoured = fam === "tank" || hasArmor;
    return {
      family: "scales",
      sub: armoured ? "armoured" : "reptile",
      bumpMetres: armoured ? 0.0108 : 0.0092,
      baseRough: armoured ? 0.48 : 0.46,
    };
  }

  // 7. Expressive bipeds, brutes, hoppers, striders, radial walkers:
  //    pebbled leathery hide with dorsal bosses & flexion folds (or reptile scales if bare + surface==="scales" + no whiskers/dress).
  if (
    skin?.surface === "scales" &&
    !head.whiskers &&
    !plan?.dress &&
    fam !== "hopper" &&
    fam !== "strider" &&
    fam !== "brute" &&
    !hasInsectLeg
  ) {
    return { family: "scales", sub: "reptile", bumpMetres: 0.0090, baseRough: 0.48 };
  }

  return { family: "pebbled", sub: "hide", bumpMetres: 0.0082, baseRough: 0.62 };
}

/**
 * Evaluate staggered caudally-overlapping roof-tile scales or contour feathers
 * in physical surface-aligned coordinates `(uAlong, uAcross)`.
 * Writes `[height, lapShadow, keel, cellId, inTip]` into `dst`.
 */
function sampleImbricated(dst, uAlong, uAcross, pitchA, pitchC, tipCurve, keelSharp, seed) {
  const rowF = uAlong / pitchA;
  const rBase = Math.floor(rowF);
  let bestH = -1;
  let bestLap = 0;
  let bestKeel = 0;
  let bestId = 0.5;
  let bestTip = 0;

  // Test the covering cranial row (rBase - 1) and the current row (rBase).
  // Because uAlong increases caudally, the tile with smaller row index overlaps
  // on top of the tile behind it wherever fy < tipEdge!
  for (let pass = 0; pass < 2; pass++) {
    const r = rBase - pass;
    const fy = rowF - r; // [0..1) for pass=0, [1..2) for pass=1
    const stagger = (r & 1) !== 0 ? 0.5 : 0;
    const colF = uAcross / pitchC + stagger;
    const c = Math.floor(colF);
    const fx = colF - c - 0.5; // [-0.5..0.5]
    const cid = hash2(c, r, seed);
    const jitterLen = (cid - 0.5) * 0.10;
    // Rounded shield/teardrop caudal edge.
    const edge = 1.24 + jitterLen - tipCurve * fx * fx;
    const margin = edge - fy;
    if (margin > 0) {
      // Inside this scale/feather tile; pass=1 (cranial) naturally overlaps pass=0.
      const edgeMask = smoothstep(margin, 0.0, 0.24);
      const sideMask = 1 - smoothstep(Math.abs(fx), 0.34, 0.50);
      const ramp = smoothstep(fy, 0.04, 0.92);
      const crown = (0.28 + 0.54 * ramp) * (0.72 + 0.28 * sideMask) * (0.42 + 0.58 * edgeMask);
      const keel =
        Math.exp(-fx * fx * keelSharp) *
        smoothstep(fy, 0.16, 0.72) *
        smoothstep(margin, 0.02, 0.26);
      // Slight elevation bias for the overlapping cranial tile so it always wins cleanly.
      const h = crown + 0.24 * keel + (pass === 1 ? 0.08 : 0);
      if (pass === 1 || h > bestH) {
        bestH = h;
        bestKeel = keel;
        bestId = cid;
        bestTip = smoothstep(margin, 0.0, 0.18) * (1 - smoothstep(margin, 0.18, 0.44));
        // Shadow right at the thin rim where the tile drops off.
        bestLap = Math.max(bestLap, (1 - edgeMask) * 0.85);
        if (pass === 1 && margin > 0.06) {
          // Completely covered by the cranial overlapping tile.
          break;
        }
      }
    } else {
      // Just behind the trailing edge of the cranial tile -> cast lap crevice shadow!
      const behind = -margin;
      const castShadow = 1 - smoothstep(behind, 0.0, 0.28);
      bestLap = Math.max(bestLap, castShadow);
    }
  }

  dst[0] = clamp(bestH < 0 ? 0.12 : bestH, 0.04, 1.0);
  dst[1] = clamp(bestLap, 0, 1);
  dst[2] = clamp(bestKeel, 0, 1);
  dst[3] = bestId;
  dst[4] = bestTip;
}

/**
 * Evaluate biological surface relief in native anatomical coordinates.
 * Zero heap allocations per sample.
 *
 * Writes into `out`:
 *   out[0] = height   [0..1] (for tangent-space normal map)
 *   out[1] = rough    [0.12..0.93] (for PBR roughness map)
 *   out[2] = shadeMul [0.68..1.14] (crevice AO / crown articulation multiplier)
 *   out[3] = paleLift [0..0.38] (subtle pale oral/ventral/ridge highlight blend)
 */
export function evaluateBiologicalRelief(out, ctx, scratchCell, wBuf) {
  const {
    profile,
    seed,
    scaleRef,
    px,
    py,
    pz,
    tSpine,
    sAlong,
    uAcross,
    flankNorm,
    dorsal,
    ventral,
    dorsalCoord,
    shoulder,
    fbmMac,
    nMac2,
    markGuard,
    mAlpha,
    isHead,
    isMuzzle,
    isLimb,
    isTail,
    isTentacle,
    isBirdLeg,
    isExtremity,
    hasAxis,
    limbT,
    limbAlong,
    limbArc,
    limbUp,
    jointProx,
  } = ctx;

  const fam = profile.family;
  const sub = profile.sub;

  // Choose native anatomical surface coordinates (head->tail on body/neck, proximal->distal on limbs/tail/tentacles).
  const alongM = hasAxis ? (isHead ? -limbAlong : limbAlong) : -sAlong;
  const acrossM = hasAxis ? limbArc : uAcross;

  // Subtle organic domain warp so patterns follow living anatomy rather than sterile grids.
  const warpM = 0.018 * scaleRef;
  const uA = alongM + fbmMac * warpM;
  const uC = acrossM + (nMac2 - 0.5) * warpM * 1.1;

  let height = 0.5;
  let rough = profile.baseRough;
  let shadeMul = 1.0;
  let paleLift = 0.0;

  if (fam === "chitin") {
    // ── GLOSSY SEGMENTED EXOSKELETON & CONTRASTING MATTE JOINTS ──
    const isLimbSeg = isLimb && hasAxis;
    const isTailSeg = isTail && hasAxis;

    if (isLimbSeg) {
      // Exoskeleton limb tubes with contrasting matte dark articulating joints.
      const jCrease = smoothstep(jointProx, 0.35, 0.88);
      const jCore = smoothstep(jointProx, 0.62, 0.96);
      const flute = 0.5 + 0.5 * Math.cos((acrossM / Math.max(0.015, 0.045 * scaleRef)) * Math.PI * 2);
      const segRing = Math.abs(Math.sin(limbT * Math.PI * 3));
      const bevel = smoothstep(jointProx, 0.12, 0.42) * (1 - jCrease);
      height = clamp(0.76 + 0.09 * flute + 0.08 * bevel - 0.64 * jCrease, 0.06, 0.98);
      rough = clamp(0.22 + 0.06 * (1 - flute) + 0.64 * jCrease - 0.04 * bevel, 0.16, 0.90);
      shadeMul = 1.0 - 0.28 * jCore - 0.08 * jCrease + 0.05 * bevel + 0.03 * segRing * (1 - jCrease);
    } else if (isTailSeg) {
      // Overlapping curved carapace rings along scorpion/insect tail.
      const rings = 9;
      const phase = limbT * rings + 0.14 * limbUp;
      const f = phase - Math.floor(phase);
      const suture = 1 - smoothstep(Math.min(f, 1 - f), 0.02, 0.16);
      const rim = smoothstep(f, 0.68, 0.88) * (1 - smoothstep(f, 0.88, 0.98));
      const dorsalKeel = Math.exp(-Math.pow(1 - Math.max(0, limbUp), 2) * 14) * smoothstep(limbUp, 0.3, 0.85);
      height = clamp(0.78 + 0.14 * rim + 0.12 * dorsalKeel - 0.68 * suture, 0.06, 0.99);
      rough = clamp(0.20 + 0.66 * suture - 0.04 * rim, 0.16, 0.90);
      shadeMul = 1.0 - 0.28 * suture + 0.06 * rim + 0.04 * dorsalKeel;
    } else {
      // Body & head carapace tergites curving backward down flanks + dorsal keel + pleurite seam.
      const segCount = isHead ? 3.5 : 8.0;
      const curveBack = 0.34 * clamp(flankNorm, 0, 1.3) * (1 - 0.5 * dorsal);
      const segPhase = tSpine * segCount + curveBack + fbmMac * 0.16;
      const f = segPhase - Math.floor(segPhase);
      const suture = 1 - smoothstep(Math.min(f, 1 - f), 0.018, 0.13);
      const bevelRim = smoothstep(f, 0.72, 0.88) * (1 - smoothstep(f, 0.88, 0.98));
      // Lateral pleurite border separating dorsal carapace from flatter ventral sternites.
      const pleurite = 1 - smoothstep(Math.abs(dorsalCoord - 0.02), 0.03, 0.15);
      const dorsalKeel =
        Math.exp(-flankNorm * flankNorm * 14) * dorsal * (1 - suture) * (isHead ? 0.55 : 1.0);
      // Restrained micro-pitted beetle carapace sheen (never grainy noise).
      const pf = 28 / scaleRef;
      const pit = noise3(px * pf, py * pf, pz * pf, seed ^ 0x4c19);
      const microPit = smoothstep(pit, 0.64, 0.82) * 0.06;

      const crevice = Math.max(suture, pleurite * 0.68);
      const plateBody = (1 - crevice) * (0.76 + 0.11 * bevelRim + 0.14 * dorsalKeel - microPit);
      height = clamp(0.10 + plateBody, 0.06, 0.99);

      const crownRough = 0.19 + 0.18 * ventral + 0.07 * microPit - 0.04 * bevelRim - 0.03 * dorsalKeel;
      rough = clamp(crownRough + (0.86 - crownRough) * crevice, 0.15, 0.91);
      shadeMul =
        1.0 -
        (0.28 * suture + 0.14 * pleurite) * (0.65 + 0.35 * markGuard) +
        0.065 * bevelRim +
        0.055 * dorsalKeel;
    }
  } else if (fam === "scales") {
    // ── OVERLAPPING KEELED DORSAL SCALES + SMOOTH FLEXING VENTRAL BELLY ──
    const armoured = sub === "armoured";
    let pitchA = (armoured ? 0.070 : 0.052) * scaleRef;
    let pitchC = (armoured ? 0.066 : 0.046) * scaleRef;
    if (isHead) {
      pitchA *= 0.66;
      pitchC *= 0.66;
    } else if (isLimb || isTail) {
      pitchA *= 0.72;
      pitchC *= 0.72;
    }

    sampleImbricated(
      scratchCell,
      uA,
      uC,
      pitchA,
      pitchC,
      armoured ? 1.15 : 1.38,
      armoured ? 20 : 28,
      seed ^ 0x71e3,
    );
    const scH = scratchCell[0];
    const lapShadow = scratchCell[1];
    const keel = scratchCell[2];
    const cellId = scratchCell[3];
    const tipRim = scratchCell[4];

    // Dorsal boldness vs smooth flexing ventral belly scutes!
    const bellyMask = isHead || isLimb ? 0 : smoothstep(-dorsalCoord, 0.06, 0.50);
    const dorsalPower = isLimb ? 0.78 : isHead ? 0.72 : 0.45 + 0.55 * dorsal;

    // Broad smooth flexing transverse ventral belly scutes (wide plates, soft flex creases).
    const bellyPitch = 0.066 * scaleRef;
    const bPhase = uA / bellyPitch;
    const bf = bPhase - Math.floor(bPhase);
    const bCrease = 1 - smoothstep(Math.min(bf, 1 - bf), 0.02, 0.15);
    const bHeight = 0.58 + 0.14 * Math.sin(bf * Math.PI) - 0.24 * bCrease;
    const bRough = 0.56 + 0.16 * bCrease;
    const bShade = 1.0 - 0.11 * bCrease + 0.03 * Math.sin(bf * Math.PI);

    // Dorsal keeled scale height, roughness, and crevice shading.
    const dHeight = clamp(0.14 + (scH - 0.14) * (0.65 + 0.35 * dorsalPower) + 0.12 * keel * dorsalPower, 0.06, 0.99);
    const dRough = clamp(
      0.34 + 0.52 * lapShadow - 0.08 * keel * dorsalPower + (armoured ? 0.04 : 0.0) + 0.04 * (cellId - 0.5),
      0.24,
      0.92,
    );
    const dShade =
      1.0 -
      0.23 * lapShadow * dorsalPower * (0.62 + 0.38 * markGuard) +
      0.07 * keel * dorsalPower +
      0.04 * tipRim * dorsalPower +
      (cellId - 0.5) * 0.055;

    height = dHeight + (bHeight - dHeight) * bellyMask;
    rough = dRough + (bRough - dRough) * bellyMask;
    shadeMul = dShade + (bShade - dShade) * bellyMask;
    // Slight smooth warm/pale sheen on flexing ventral belly plates.
    paleLift = bellyMask * 0.07 * (1 - bCrease);
  } else if (fam === "wet") {
    // ── WET GLISTENING MANTLE, CEPHALOPOD TUBERCLES & AQUATIC MYOMERES ──
    if (sub === "cephalopod") {
      if (isTentacle && hasAxis) {
        // Tentacles: longitudinal aboral muscular ridges on back, smooth pale supple oral bed
        // around the main agent's geometric suction cups!
        const oralMask = smoothstep(-limbUp, 0.12, 0.55);
        const aboralMask = 1 - oralMask;
        const ribFreq = 0.036 * scaleRef;
        const ribWave = 0.5 + 0.5 * Math.cos((acrossM / Math.max(0.012, ribFreq)) * Math.PI * 2 + fbmMac * 1.4);
        // Subtle transverse muscular annulations along the tentacle.
        const annWave = 0.5 + 0.5 * Math.sin((limbAlong / Math.max(0.02, 0.052 * scaleRef)) * Math.PI * 2);
        const ridgeH = 0.42 + 0.34 * ribWave + 0.10 * annWave;
        const oralH = 0.48 + 0.08 * annWave;
        height = clamp(ridgeH * aboralMask + oralH * oralMask, 0.12, 0.94);
        rough = clamp(0.14 + 0.14 * (1 - ribWave) * aboralMask + 0.16 * oralMask, 0.12, 0.48);
        shadeMul = 1.0 - 0.14 * (1 - ribWave) * aboralMask + 0.05 * ribWave * aboralMask;
        paleLift = oralMask * 0.24 * (1 - 0.45 * mAlpha);
      } else {
        // Mantle dome & head: glistening wet sheen + clustered fleshy dorsal tubercles + axial muscle ribs!
        const tf = 13.5 / scaleRef;
        worley3(wBuf, px * tf + fbmMac * 0.9, py * tf, pz * tf, seed ^ 0x62a1);
        const tubDome = (1 - smoothstep(wBuf[0], 0.14, 0.42)) * smoothstep(nMac2, 0.32, 0.72);
        const tubZone = smoothstep(dorsalCoord, -0.15, 0.45) * (isHead ? 0.85 : 1.0);
        const tub = tubDome * tubZone;

        // Broad longitudinal mantle undulations (fleshy elastic skin).
        const mantleWave = 0.5 + 0.5 * Math.cos((acrossM / (0.095 * scaleRef)) * Math.PI * 2 + fbmMac * 2.0);
        const fold = 1 - smoothstep(mantleWave, 0.0, 0.38);

        height = clamp(0.46 + 0.18 * mantleWave + 0.38 * tub - 0.16 * fold, 0.10, 0.98);
        // Ultra-glossy wet mantle crowns & tubercles, slightly softer in deep skin folds.
        rough = clamp(0.13 + 0.26 * fold - 0.04 * tub + 0.08 * ventral, 0.11, 0.52);
        shadeMul = 1.0 - 0.12 * fold + 0.08 * tub + 0.04 * fbmMac;
        paleLift = 0.08 * tub * (1 - 0.5 * mAlpha);
      }
    } else {
      // Hydrodynamic aquatic swimmer / gill-fan amphibian:
      // sleek wet gloss, crisp lateral-line sensory canal, subtle chevron myomere muscle bands!
      const latDist = Math.abs(dorsalCoord - 0.04);
      const latGroove = (1 - smoothstep(latDist, 0.015, 0.075)) * (isHead ? 0.25 : 1.0);
      const latPore =
        latGroove * (1 - smoothstep(Math.abs(((uA / (0.045 * scaleRef)) % 1 + 1) % 1 - 0.5), 0.08, 0.22));
      // W-shaped myomere swimming muscle chevrons along the trunk.
      const myoPhase = (uA / (0.072 * scaleRef)) - 0.58 * Math.abs(dorsalCoord - 0.04);
      const myo = 0.5 + 0.5 * Math.sin(myoPhase * Math.PI * 2);
      const myoSep = 1 - smoothstep(myo, 0.0, 0.22);
      // Sleek dorsal micro-scales catching wet specular glides.
      const sf = 28 / scaleRef;
      const sheenScale = noise2(uA * sf, uC * sf, seed ^ 0x38d7);

      height = clamp(0.56 + 0.14 * myo - 0.24 * latGroove - 0.14 * latPore + 0.08 * (sheenScale - 0.5) * dorsal, 0.08, 0.94);
      rough = clamp(0.14 + 0.10 * ventral + 0.18 * latGroove + 0.10 * myoSep - 0.03 * dorsal, 0.12, 0.48);
      shadeMul = 1.0 - 0.14 * latGroove - 0.08 * myoSep * (0.5 + 0.5 * markGuard) + 0.04 * myo * dorsal;
      paleLift = 0.09 * ventral * (1 - 0.5 * mAlpha);
    }
  } else if (fam === "plumage") {
    // ── LAYERED AVIAN CONTOUR FEATHERS + SCALY BIRD SHINS ──
    if (isBirdLeg && hasAxis) {
      // Reptilian transverse scutellate tarsus scales wrapping bird shins & feet!
      const scutePitch = 0.030 * scaleRef;
      const sf = limbAlong / scutePitch + 0.18 * limbUp;
      const f = sf - Math.floor(sf);
      const lap = 1 - smoothstep(Math.min(f, 1 - f), 0.03, 0.20);
      height = clamp(0.28 + 0.58 * smoothstep(f, 0.06, 0.86) - 0.22 * lap, 0.08, 0.94);
      rough = clamp(0.38 + 0.42 * lap, 0.34, 0.86);
      shadeMul = 1.0 - 0.22 * lap + 0.05 * smoothstep(f, 0.65, 0.88);
    } else {
      // Elongated caudally-combed contour feathers (larger layered coverts on shoulders/back, softer down on belly).
      const pitchA = (isHead ? 0.044 : 0.072) * scaleRef * (1 + 0.18 * shoulder);
      const pitchC = (isHead ? 0.024 : 0.035) * scaleRef;
      sampleImbricated(scratchCell, uA, uC, pitchA, pitchC, 1.45, 42, seed ^ 0x9b21);
      const fH = scratchCell[0];
      const lap = scratchCell[1];
      const rachis = scratchCell[2];
      const cid = scratchCell[3];

      // Delicate directional barb striations along feather vanes.
      const barb = 0.5 + 0.5 * Math.sin((uA / (pitchA * 0.22) - Math.abs(((uC / pitchC) % 1 + 1) % 1 - 0.5) * 4.5) * Math.PI);
      const downy = ventral * 0.45;
      height = clamp(0.34 + (fH - 0.34) * (1 - 0.35 * downy) + 0.09 * rachis + 0.06 * (barb - 0.5) * (1 - downy), 0.10, 0.96);
      rough = clamp(0.56 + 0.26 * lap + 0.14 * downy - 0.06 * rachis + (cid - 0.5) * 0.05, 0.46, 0.90);
      shadeMul =
        1.0 -
        0.18 * lap * (0.65 + 0.35 * markGuard) +
        0.045 * rachis +
        0.025 * (barb - 0.5) +
        (cid - 0.5) * 0.05;
    }
  } else if (fam === "pelt") {
    // ── DIRECTIONAL COMBED MAMMAL FUR + SATIN BARE MUZZLE / PAWS ──
    const bareMask = isMuzzle
      ? 0.85
      : isExtremity
        ? smoothstep(limbT, 0.55, 0.92)
        : 0;
    const furMask = 1 - bareMask;

    // Two-scale anisotropic combed fur locks flowing head-to-tail along spine and down limbs.
    const lockAcross1 = 17.5 / scaleRef;
    const lockAlong1 = 4.6 / scaleRef;
    const lockAcross2 = 42.0 / scaleRef;
    const lockAlong2 = 10.5 / scaleRef;

    const curl = Math.sin(uA * (9.5 / scaleRef) + fbmMac * 4.2) * 0.012 * scaleRef;
    const lock1 = noise2((uC + curl) * lockAcross1, uA * lockAlong1, seed ^ 0x51c3);
    const lock2 = noise2((uC - curl * 0.6) * lockAcross2, uA * lockAlong2, seed ^ 0xa31f);
    // Shingled tuft step so fur layers read directionally at 128px & 256px.
    const tuftPhase = uA * (11.5 / scaleRef) + lock1 * 1.35;
    const tuftF = tuftPhase - Math.floor(tuftPhase);
    const tuftTip = 1 - smoothstep(tuftF, 0.72, 0.98);
    const furDepth = 0.56 * lock1 + 0.44 * lock2;
    const furH = clamp(0.24 + 0.52 * furDepth + 0.16 * tuftTip, 0.08, 0.94);

    // Sleek satin leathery bare nose/muzzle/paw pebble.
    const nf = 48 / scaleRef;
    worley3(wBuf, px * nf, py * nf, pz * nf, seed ^ 0x294b);
    const nosePeb = smoothstep(wBuf[1] - wBuf[0], 0.02, 0.34);
    const bareH = 0.46 + 0.24 * nosePeb;

    height = furH * furMask + bareH * bareMask;
    // Matte velvety pelt (0.78..0.92) sharply contrasted against satin leathery muzzle/paws (0.36..0.52)!
    const furRough = clamp(0.92 - 0.14 * furDepth - 0.04 * dorsal, 0.76, 0.93);
    const bareRough = clamp(0.36 + 0.18 * (1 - nosePeb), 0.32, 0.56);
    rough = furRough * furMask + bareRough * bareMask;

    const furShade = 1.0 - 0.16 * (1 - furDepth) * (0.65 + 0.35 * markGuard) + 0.055 * (furDepth - 0.5);
    const bareShade = 1.0 - 0.08 * (1 - nosePeb);
    shadeMul = furShade * furMask + bareShade * bareMask;
  } else {
    // ── PEBBLED LEATHERS / REPTILIAN-MAMMAL HIDE & ANATOMICAL FLEXURE FOLDS ──
    // Macro dorsal dermal bosses (readable at 128px & 256px) + meso dermal pebbles (256px & close).
    const bf = (isHead ? 22 : 14.5) / scaleRef;
    worley3(wBuf, px * bf + fbmMac * 0.9, py * bf, pz * bf, seed ^ 0x82b3);
    const bossEdge = wBuf[1] - wBuf[0];
    const bossDome = smoothstep(bossEdge, 0.02, 0.36) * (1 - 0.25 * clamp(wBuf[0], 0, 1));
    const bossId = wBuf[2];

    const pf = 32 / scaleRef;
    worley3(wBuf, px * pf + fbmMac * 0.7, py * pf, pz * pf, seed ^ 0x91d5);
    const pebDome = smoothstep(wBuf[1] - wBuf[0], 0.02, 0.38);

    // Dorsal/outer boss emphasis vs finer flexible flanks & belly.
    const bossWeight = isLimb ? 0.55 : isHead ? 0.52 : 0.28 + 0.72 * dorsal;

    // Anatomical skin-flexure folds at neck collar, ventral belly, and limb bends!
    const neckFoldZone = isHead ? 0 : smoothstep(tSpine, 0.78, 0.92) * (1 - smoothstep(tSpine, 1.02, 1.18));
    const foldWave = 0.5 + 0.5 * Math.sin((uA / (0.048 * scaleRef) + fbmMac * 1.4) * Math.PI * 2);
    const foldCrease =
      (1 - smoothstep(foldWave, 0.0, 0.24)) *
      clamp(0.55 * ventral + 0.75 * neckFoldZone + (isLimb && hasAxis ? 0.85 * smoothstep(jointProx, 0.38, 0.88) : 0), 0, 1);

    const microH = bossDome * bossWeight + pebDome * (1 - 0.42 * bossWeight);
    height = clamp(0.18 + 0.62 * microH - 0.28 * foldCrease + 0.08 * (nMac2 - 0.5), 0.06, 0.96);

    const crownR = 0.48 + 0.14 * ventral - 0.08 * dorsal;
    rough = clamp(crownR + 0.34 * (1 - microH) + 0.24 * foldCrease, 0.38, 0.91);
    shadeMul =
      1.0 -
      (0.16 * (1 - bossDome) * bossWeight + 0.08 * (1 - pebDome) + 0.17 * foldCrease) *
        (0.65 + 0.35 * markGuard) +
      0.055 * bossDome * bossWeight +
      (bossId - 0.5) * 0.04;
    paleLift = 0.05 * ventral * (1 - foldCrease) * (1 - 0.5 * mAlpha);
  }

  out[0] = clamp(height, 0, 1);
  out[1] = clamp(rough, 0.11, 0.93);
  out[2] = clamp(shadeMul, 0.66, 1.14);
  out[3] = clamp(paleLift, 0, 0.38);
}
