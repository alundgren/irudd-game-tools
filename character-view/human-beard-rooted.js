// Short beard hair rooted in the skin. Three kinds of card share one sheet of drawn hairs:
//   thatch  broad close tufts under the rest, only where the beard is full, which hide the skin
//   coat    small tufts lying along the growth, thinning out toward bare cheek
//   fringe  rows of hairs standing off the skin, which give the jaw and chin a hairy outline
//   stray   single longer hairs at odd angles
//   feather single hairs lying close where the coat gives way to bare skin
// Every card starts on a skin triangle and takes that triangle's expression offsets and joint
// weights, so the hair follows a smile and the neck the way the skin under it does.
import * as T from "three";
import { BRISTLE_SIZE, BRISTLE_TILES } from "./human-beard-bristles.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (v, a, b) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The four strongest joints of a point inside a skin triangle. */
function blendWeights(skinWeights, ids, weights, bones, blend) {
  const sum = new Map();
  for (let j = 0; j < 3; j++)
    for (let k = 0; k < 4; k++) {
      const w = skinWeights.weights[ids[j] * 4 + k] * weights[j];
      if (w > 0) {
        const bone = skinWeights.boneIndices[ids[j] * 4 + k];
        sum.set(bone, (sum.get(bone) ?? 0) + w);
      }
    }
  const top = [...sum].sort((a, b) => b[1] - a[1]).slice(0, 4), total = top.reduce((n, [, w]) => n + w, 0) || 1;
  for (let k = 0; k < 4; k++) {
    bones[k] = top[k]?.[0] ?? 0;
    blend[k] = top[k] ? top[k][1] / total : 0;
  }
}

const cellHash = (x, y, z, salt) => {
  let h = Math.imul(x + salt, 374761393) ^ Math.imul(y + 17, 668265263) ^ Math.imul(z + 31, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/**
 * Hair gathers into clumps a few millimetres across. Returns the nearest clump's centre, three
 * values of its own, and how far inside it the point lies: 0 on the parting between two clumps.
 */
function clumpAt(point, cell, salt, out, stretch) {
  // Clumps are longer down the face than across it, the way the hair grows.
  const p = out.at.set(point.x, point.y / stretch, point.z);
  const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell), gz = Math.floor(p.z / cell);
  let best = Infinity, second = Infinity;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
    const x = gx + i, y = gy + j, z = gz + k;
    const cx = (x + cellHash(x, y, z, salt)) * cell, cy = (y + cellHash(x, y, z, salt + 7)) * cell, cz = (z + cellHash(x, y, z, salt + 13)) * cell;
    const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
    if (d < best) {
      second = best; best = d;
      out.centre.set(cx, cy * stretch, cz);
      out.turn = cellHash(x, y, z, salt + 29); out.tone = cellHash(x, y, z, salt + 41); out.length = cellHash(x, y, z, salt + 53);
    } else if (d < second) second = d;
  }
  out.inside = (second - best) / (second + best + 1e-9);
  return out;
}

/**
 * Grow the cards. `field` describes the face: skin attributes, the beard's density and border
 * values per vertex, the eligible triangles, lip and eye limits, and a sampler over the skin.
 * Returns plain arrays for a geometry, with `bones` and `blend` when the skin carries weights.
 */
export function rootedBeard(field, cfg, colour, noise, rng, seed = 0) {
  const { pos, nor, moves, dens, borderFactor, wMous, wChin, mm, mouthY, inside, sample, inLips, eyeFloor, skinWeights } = field;
  const out = { position: [], normal: [], colour: [], uv: [], index: [], moves: moves.map(() => []), bones: [], blend: [] };
  const root = new T.Vector3(), skinN = new T.Vector3(), flow = new T.Vector3(), side = new T.Vector3(),
    macroN = new T.Vector3(), up = new T.Vector3(), under = new T.Vector3(0, -0.35, -1).normalize(),
    pt = new T.Vector3(), n = new T.Vector3();
  const clump = { at: new T.Vector3(), centre: new T.Vector3(), turn: 0, tone: 0, length: 0, inside: 0 }, toCentre = new T.Vector3();
  const size = cfg.cardScale ?? 1;
  const rgb = [0, 0, 0], shift = [0, 0, 0], bones = [0, 0, 0, 0], blend = [0, 0, 0, 0];
  const pick = (tiles) => tiles[Math.floor(rng() * tiles.length) % tiles.length];
  const zoneName = (z) => (z === 1 ? "mous" : z === 2 ? "chin" : z === 5 ? "sideburn" : z === 4 ? "cheek" : "jaw");

  function card(sampled, kind) {
    const { tri, weights } = sampled, ids = tri.ids;
    root.set(0, 0, 0); skinN.set(0, 0, 0);
    let density = 0, border = 0, mous = 0, chin = 0;
    for (let j = 0; j < 3; j++) {
      const id = ids[j], w = weights[j];
      root.x += pos.getX(id) * w; root.y += pos.getY(id) * w; root.z += pos.getZ(id) * w;
      skinN.x += nor.getX(id) * w; skinN.y += nor.getY(id) * w; skinN.z += nor.getZ(id) * w;
      density += dens[id] * w; border += borderFactor[id] * w; mous += wMous[id] * w; chin += wChin[id] * w;
    }
    skinN.normalize();
    if (density < 0.1 || inLips(root)) return;
    // Every hair rooted between the nose and the lip belongs to the moustache and lies the way it does.
    const isMous = tri.z === 1 || mous > 0.45 || field.onUpperLip(root), zone = isMous ? "mous" : chin > 0.35 ? "chin" : zoneName(tri.z);
    // How much hair grows here: full in the core, thinning steadily to nothing at the border.
    const grown = smooth(border, 0.02, 0.8) * (0.3 + 0.7 * smooth(density, 0.12, 0.62));
    // Feather hairs grow only in the band where the coat is thinning out.
    clumpAt(root, cfg.clumpSize * mm, seed & 0xffff, clump, cfg.clumpStretch);
    // Between two clumps the outer hair parts and the darker undergrowth shows.
    const parting = 1 - smooth(clump.inside, 0.02, 0.24), open = 1 - cfg.parting * parting;
    const chance = kind === "thatch" ? (isMous ? 1 : smooth(grown, 0.16, 0.5)) : kind === "coat" ? (isMous ? smooth(density, 0.12, 0.4) : grown * open) : kind === "fringe" ? grown * cfg.fringeShare[zone] * open
      : kind === "feather" ? smooth(border, 0.0, 0.14) * (1 - smooth(border, 0.42, 0.8)) : 0.35 + 0.65 * grown;
    // Over the lip no single hair stands clear of the rest: the moustache lies close.
    if (isMous && kind === "stray") return;
    if (rng() > chance) return;

    // Growth direction: down the cheek, forward round the jaw, back toward the neck under it,
    // and out from the middle over the lip.
    const sgn = root.x >= 0 ? 1 : -1, ax = Math.abs(root.x);
    // Each half of the moustache falls from under the nose and turns out toward its corner of the mouth.
    if (isMous) flow.set(sgn * (0.3 + 0.55 * smooth(ax, 1 * mm, 12 * mm)), -0.6, 0.06);
    // The chin fans out from its middle, the jaw sweeps forward and the cheek falls back toward its angle.
    else if (zone === "chin") flow.set(sgn * 0.3 * smooth(ax, 2 * mm, 20 * mm), -1, 0.12);
    else if (zone === "jaw") flow.set(-sgn * 0.35, -0.8, 0.35);
    else if (zone === "cheek") flow.set(sgn * 0.12, -0.95, -0.25);
    else flow.set(0, -1, -0.06);
    if (!isMous) flow.normalize().lerp(under, 0.85 * smooth(-skinN.y, 0.25, 0.75));
    flow.addScaledVector(skinN, -flow.dot(skinN));
    if (flow.lengthSq() < 1e-8) flow.set(0, -1, 0).addScaledVector(skinN, skinN.y);
    flow.normalize();
    // Hair swirls a little over a few centimetres and each tuft has its own turn.
    const swirl = (noise(root.x * 38, root.y * 38, root.z * 38) - 0.5) * (isMous ? 0.3 : 0.6);
    // Every hair of a clump shares its turn and leans in toward its middle, so the clump ends in a point.
    side.crossVectors(skinN, flow).normalize();
    const lean = clamp(toCentre.copy(clump.centre).sub(root).dot(side) / (cfg.clumpSize * mm), -0.5, 0.5);
    const gather = isMous || kind === "stray" || kind === "feather" ? 0 : (clump.turn - 0.5) * cfg.clumpTurn + lean * cfg.clumpGather;
    const turn = swirl + gather + (rng() - 0.5) * (kind === "stray" ? 1.9 : kind === "fringe" ? 0.9 : kind === "feather" ? 0.9 : isMous ? 0.3 : 0.32);
    flow.applyAxisAngle(skinN, turn);
    side.crossVectors(skinN, flow).normalize();
    macroN.copy(root).sub(inside).normalize();

    const thin = 0.7 + 0.3 * grown, sink = -0.22 * mm;
    const r0 = rng(), r1 = rng(), r2 = rng(), r3 = rng();
    let corners, tile, points = null;
    // A hair that would reach the lips or an eye is cut shorter, and left out if that is not enough.
    for (const scale of [1, 0.66, 0.42]) {
      corners = [];
      if (kind === "fringe") {
        const half = size * (3.4 + 2.4 * r0) * (0.6 + 0.4 * grown) * mm, tall = scale * (0.8 + 0.4 * clump.length) * cfg.fringeHeight[zone] * (0.62 + 0.62 * r1) * thin * mm;
        up.copy(skinN).addScaledVector(flow, Math.tan(0.45 + 0.5 * r2)).normalize();
        tile = pick(grown > 0.55 ? BRISTLE_TILES.fringe : BRISTLE_TILES.fringeSparse);
        for (const [across, along] of [[-1, 0], [1, 0], [-1, 1], [1, 1]])
          corners.push([across * half, 0, along ? tall : 0, along, across]);
      } else {
        const stray = kind === "stray", feather = kind === "feather", thatch = kind === "thatch";
        const length = scale * size * cfg.length[zone] * (0.78 + 0.3 * r0) * (0.8 + 0.4 * clump.length) * (feather ? 0.8 : thin) * (stray ? 1.45 : thatch ? 1.12 : 1) * mm;
        const width = isMous && cfg.mousWidth ? (cfg.mousWidth[0] + (cfg.mousWidth[1] - cfg.mousWidth[0]) * r1) * (thatch ? 1.25 : 1) * mm : clamp(length / mm * (thatch ? 0.8 : 0.52 + 0.2 * r1) / scale, 2.6, isMous ? (thatch ? 4.6 : 3.4) : size * (thatch ? 7.6 : 5.6)) * mm;
        const lift = cfg.lift[zone] * (0.55 + 0.9 * r2) * (feather ? 0.45 : 0.4 + 0.6 * grown) * (stray ? 2.2 : thatch ? 0.3 : 1) * mm;
        up.copy(skinN);
        const q = (isMous ? 0.95 : grown) * (0.75 + 0.5 * r3);
        // Where growth is thin the hairs are few and separate.
        tile = pick(thatch ? BRISTLE_TILES.thatch : stray || feather ? BRISTLE_TILES.single : !isMous && grown < 0.5 ? (r3 < 1.5 * grown ? BRISTLE_TILES.sparse : BRISTLE_TILES.single) : q > 0.7 ? BRISTLE_TILES.dense : q > 0.5 ? BRISTLE_TILES.medium : q > 0.3 ? BRISTLE_TILES.sparse : BRISTLE_TILES.single);
        for (const [across, along] of [[-1, 0], [1, 0], [-1, 1], [1, 1]])
          corners.push([across * width * 0.5 * (along ? 1 : 0.86), along * length, along ? lift : 0, along, across]);
      }
      // Hair keeps clear of the lips and the eyes, wherever it is rooted.
      points = corners.map(([across, along, rise, tip]) => {
        const p = root.clone().addScaledVector(side, across).addScaledVector(flow, along).addScaledVector(up, rise);
        if (!tip) p.addScaledVector(skinN, sink);
        return p;
      });
        if (!points.some((p, k) => corners[k][3] && (inLips(p, isMous ? 0.3 * mm : 1.2 * mm) || eyeFloor(p)))) break;
        points = null;
    }
    if (!points) return;

    const streak = (noise(root.x * 48 + 9, root.y * 12, root.z * 48) - 0.5) * 2, lockRnd = rng();
    const shade = {
      layer: kind === "coat" ? "outer" : "whisker", streak, lockRnd, borderFade: border,
      downFacing: smooth(-skinN.y, 0.05, 0.68), centerChin: 1 - smooth(ax, 18 * mm, 54 * mm),
      lipCrease: smooth(12 * mm - Math.abs(root.y - (mouthY - 8 * mm)), 0, 12 * mm) * (1 - smooth(ax, 14 * mm, 32 * mm)),
    };
    const flip = rng() < 0.5, first = out.position.length / 3, [tx, ty, tw, th] = tile;
    if (skinWeights) blendWeights(skinWeights, ids, weights, bones, blend);
    points.forEach((p, k) => {
      const [, , , tip, across] = corners[k];
      out.position.push(p.x, p.y, p.z);
      // Lit like the face it grows from, with a slight turn across each card.
      n.copy(macroN).multiplyScalar(0.45).addScaledVector(skinN, 0.55).addScaledVector(side, across * 0.1).normalize();
      out.normal.push(n.x, n.y, n.z);
      colour(rgb, { ...shade, along: tip });
      // The roots are in each other's shade and take a little warmth from the skin between them.
      // Thin growth is finer hair, which shows more of the skin's colour.
      // The undergrowth is hair in shade. Over it each clump has its own tone, darker toward its parting.
      const body = kind === "thatch" ? cfg.underShade * (0.9 + 0.2 * clump.tone)
        : (1 - cfg.clumpTone * 0.5 + cfg.clumpTone * clump.tone) * (1 - cfg.partingShade * parting);
      const depth = cfg.gain * body * (tip ? cfg.tipLight : isMous ? cfg.mousRootShade ?? cfg.rootShade : cfg.rootShade), warm = ((tip ? cfg.skinWarmth * 0.25 : cfg.skinWarmth) + (cfg.thinWarmth ?? 0.4) * (1 - grown) * (kind === "fringe" ? 0.5 : 1)) * cfg.warmth;
      out.colour.push(...["r", "g", "b"].map((c, k) => Math.min(1, rgb[k] * depth * (1 - warm) + field.skinTone[c] * warm)));
      const u = tx + 1.5 + (tw - 3) * ((across < 0) !== flip ? 0 : 1), v = ty + 1.5 + (th - 3) * (1 - tip);
      out.uv.push(u / BRISTLE_SIZE, 1 - v / BRISTLE_SIZE);
      if (skinWeights) { out.bones.push(...bones); out.blend.push(...blend); }
    });
    moves.forEach((target, e) => {
      shift[0] = shift[1] = shift[2] = 0;
      for (let j = 0; j < 3; j++) for (let axis = 0; axis < 3; axis++) shift[axis] += target.array[ids[j] * 3 + axis] * weights[j];
      for (let k = 0; k < 4; k++) out.moves[e].push(shift[0], shift[1], shift[2]);
    });
    out.index.push(first, first + 1, first + 3, first, first + 3, first + 2);
  }

  const beard = (tr) => tr.z !== 1 && tr.mAvg < 0.34;
  for (const s of sample((tr) => beard(tr) && tr.dAvg >= 0.12, cfg.coatSpacing, 0x29c7, 0.5)) card(s, "coat");
  for (const s of sample((tr) => beard(tr) && tr.dAvg >= 0.2, cfg.thatchSpacing, 0x1b37, 0.15)) card(s, "thatch");
  for (const s of sample((tr) => !beard(tr), cfg.mousSpacing, 0x3f41, 0.25)) card(s, "coat");
  for (const s of sample((tr) => !beard(tr), cfg.mousSpacing * 1.3, 0x2a61, 0.6)) card(s, "thatch");
  for (const s of sample((tr) => tr.dAvg >= 0.14, cfg.fringeSpacing, 0x4d89, 0.35)) card(s, "fringe");
  if (cfg.straySpacing) for (const s of sample((tr) => tr.dAvg >= 0.12, cfg.straySpacing, 0x5a73, 0.7)) card(s, "stray");
  if (cfg.featherSpacing) for (const s of sample((tr) => beard(tr) && tr.bAvg < 0.85, cfg.featherSpacing, 0x7e15, 0.6)) card(s, "feather");
  return out;
}
