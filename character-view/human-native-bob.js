// The native bob family: MargaretToigo's four CC0 bobs worn as the one coherent volume their author modelled.
//   nativeBob(groom)      whether a packed groom belongs to the family
//   settleNativeBob(...)  the fit: the author's own shell carried to this head as a whole, eased to its shape
// A bob is a closed curtain of hair standing centimetres off the head. The library ties each point of a groom
// to a skin triangle and rebuilds it from there. On a body that is not the author's, neighbouring points land
// on differently turned triangles, and a smooth shell comes out rippled by several millimetres on every head,
// the resting one included. Here the shell is the author's mesh itself (human-native-bob-data.json, packed by
// .reference-cache/native-bobs14/pack-points.py from the same OBJ files as the groom). It is scaled to the
// skull as a whole, and only the smooth part of what the skin fit adds is kept, spread along the shell.
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import shells from "./human-native-bob-data.json" with { type: "json" };

export const nativeBobs = new Set(Object.keys(shells));
export const nativeBob = (groom) => nativeBobs.has(groom);
/** The strand picture and relief of each bob, as the library holds them (`texture`, `normal`). */
export const nativeBobMaps = Object.fromEntries(Object.entries(shells).filter(([, shell]) => shell.texture).map(([groom, { texture, normal }]) => [groom, { texture, normal }]));
const decoded = new Map();
function authored(groom) {
  if (!decoded.has(groom)) {
    const raw = unzlibSync(Uint8Array.from(atob(shells[groom].points), (c) => c.charCodeAt(0)));
    decoded.set(groom, new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
  }
  return decoded.get(groom);
}
const between = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const meshes = new WeakMap();
function neighbours(corners, count) {
  if (meshes.has(corners)) return meshes.get(corners);
  const sets = Array.from({ length: count }, () => new Set());
  for (let c = 0; c < corners.length; c += 3) for (let j = 0; j < 3; j++) {
    const a = corners[c + j], b = corners[c + (j + 1) % 3];
    sets[a].add(b); sets[b].add(a);
  }
  const beside = sets.map((set) => Uint32Array.from(set));
  meshes.set(corners, beside);
  return beside;
}
const ROUNDS = 24;
function relax(values, beside, rounds, stride = 3) {
  let from = values, to = new Float32Array(values.length);
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < beside.length; i++) {
      const near = beside[i];
      for (let d = 0; d < stride; d++) {
        let sum = from[i * stride + d];
        for (let n = 0; n < near.length; n++) sum += from[near[n] * stride + d];
        to[i * stride + d] = sum / (near.length + 1);
      }
    }
    [from, to] = [to, from];
  }
  return from;
}

// Each ear of a body: its side, the landmark at the top of its rim, how far out it stands and the box (height,
// depth) its flap fills. Read from the skin around the rim landmark, so a protruding ear is covered as it is.
function ears(body, k) {
  const { ids } = body.surface, out = [];
  for (const id of [5413, 12012]) {
    const at = ids.indexOf(id);
    if (at < 0 || at >= body.count) continue;
    const rim = body.point(at), side = Math.sign(rim[0]) || 1, near = [];
    for (let v = 0; v < body.count; v++) {
      const q = body.point(v);
      if (q[0] * side > 0 && q[1] < rim[1] + .006 * k && q[1] > rim[1] - .07 * k && Math.abs(q[2] - rim[2]) < .04 * k) near.push(q);
    }
    let far = 0;
    for (const q of near) far = Math.max(far, Math.abs(q[0]));
    const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
    for (const q of near) if (Math.abs(q[0]) > far - .012 * k) for (let d = 0; d < 2; d++) { low[d] = Math.min(low[d], q[d + 1]); high[d] = Math.max(high[d], q[d + 1]); }
    out.push({ side, rim, out: far, low, high });
  }
  return out;
}
/**
 * Fit a bob shell to a head.
 *   groom       the packed groom, one of nativeBobs
 *   p           positions from the library's fit to the skin, one per shell point (changed in place, returned)
 *   onSkull     1 for a point tied to the skull, 0 for one tied to neck or shoulders
 *   corners     the shell's triangles (three point indices each)
 *   frame       the head frame of this body (`surfaceFrame`); keeps the shell out of a fuller scalp
 *   body        the analysed body (`surfaceBody`); keeps the shell outside the ears
 */
export function settleNativeBob(groom, p, onSkull, corners, frame, body) {
  const shell = authored(groom), count = p.length / 3, gain = [1, 1, 1], shift = [0, 0, 0];
  if (shell.length !== p.length) throw new Error(groom + " does not match its authored shell");
  for (let d = 0; d < 3; d++) {
    // Least squares of the skin fit against the author's shell along each axis, over the points on the skull.
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < count; i++) if (onSkull[i]) { const x = shell[i * 3 + d], y = p[i * 3 + d]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const spread = n * sxx - sx * sx;
    if (n < 8 || spread < 1e-9) { shift[d] = n ? (sy - sx) / n : 0; continue; }
    gain[d] = Math.min(1.5, Math.max(.6, (n * sxy - sx * sy) / spread));
    shift[d] = (sy - gain[d] * sx) / n;
  }
  // What the whole-skull fit leaves over: the local shape of this head, and the ripple. Points tied below the
  // skull hang from the shell above them, so they carry none of their own. Easing along the shell keeps the
  // first and drops the second.
  const beside = neighbours(corners, count), left = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) if (onSkull[i]) for (let d = 0; d < 3; d++) left[i * 3 + d] = p[i * 3 + d] - (shell[i * 3 + d] * gain[d] + shift[d]);
  const eased = relax(left, beside, ROUNDS);
  for (let i = 0; i < count; i++) for (let d = 0; d < 3; d++) p[i * 3 + d] = shell[i * 3 + d] * gain[d] + shift[d] + eased[i * 3 + d];
  if (frame) {
    // Air over the skin where this head is fuller than the author's, more along the arm of a pair of glasses,
    // and the whole shell kept outside the ears and the hook of an arm behind them. The push is spread along the shell, so it leaves no dent.
    const k = frame.k, push = new Float32Array(count * 3), flaps = body ? ears(body, k) : [];
    let any = false;
    for (let i = 0; i < count; i++) {
      if (!onSkull[i]) continue;
      const j = i * 3, at = [p[j], p[j + 1], p[j + 2]];
      let arm = 0, need = 0;
      for (const ear of flaps) {
        if (at[0] * ear.side <= 0) continue;
        arm = Math.max(arm, (1 - between(Math.abs(at[1] - ear.rim[1]), .008 * k, .02 * k)) * between(at[2], ear.rim[2] - .03 * k, ear.rim[2] - .012 * k));
        const inside = (1 - between(Math.max(ear.low[0] - at[1], at[1] - ear.high[0]), 0, .014 * k)) * (1 - between(Math.max(ear.low[1] - .022 * k - at[2], at[2] - ear.high[1]), 0, .014 * k));
        need = Math.max(need, (ear.out + .005 * k - Math.abs(at[0])) * inside);
      }
      const out = frame.clear(at, (.0025 + .0045 * arm) * k);
      for (let d = 0; d < 3; d++) push[j + d] = out[d] - at[d];
      if (need > Math.abs(push[j])) push[j] = Math.sign(at[0]) * need;
      if (push[j] || push[j + 1] || push[j + 2]) any = true;
    }
    if (any) {
      const spread = relax(push, beside, 6);
      for (let i = 0; i < count; i++) {
        const j = i * 3, own = Math.hypot(push[j], push[j + 1], push[j + 2]), near = Math.hypot(spread[j], spread[j + 1], spread[j + 2]);
        const from = own >= near ? push : spread;
        for (let d = 0; d < 3; d++) p[j + d] += from[j + d];
      }
    }
  }
  return p;
}
