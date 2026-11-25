// Curly and coily hair as clumps: each card carries a painted lock of ringlets or a cluster of coils, and the
// cards are bedded in the volume the hair fills, leaning out of it so the outline of the head is curls too.
//   curlMap()                      the picture of the clumps, shared by every curly style
//   curlCards(cards, context)      fills `cards` for a style whose spec has `curl`
// The grey channels hold the original lock paintings and their feathered coverage.
import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import coilPaint from "./human-coil-undercoat-data.json" with { type: "json" };
import paintedCurls from "./human-curl-paint.json" with {type: "json"};
import { add, clamp, cross, dot, hash1, length, mix, noise3, smooth, sub, unit } from "./human-style-kit.js";

const DEG = Math.PI / 180, TAU = Math.PI * 2;

// Four painted locks, in order of decreasing curl diameter.
export const curlTiles = Array.from({ length: 4 }, (_, i) => [64 * i, 0, 64, 128]);

let artwork = null;
/**
 * Curl clumps drawn as pixels: `data` is RGBA, rows from the top. A ringlet has its tip up and its root down.
 * The colour is a grey that the hair colour is multiplied by; the alpha is the hair.
 */
export function curlPixels() {
  if (artwork) return artwork;
  const {width, height} = paintedCurls;
  const samples = unzlibSync(Uint8Array.from(atob(paintedCurls.toneAlpha), c => c.charCodeAt(0)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.fill(samples[i * 2], i * 4, i * 4 + 3);
    data[i * 4 + 3] = samples[i * 2 + 1];
  }
  return artwork = { width, height, data };
}

let curlTexture = null;
/** The curl picture as a texture. */
export function curlMap() {
  if (curlTexture) return curlTexture;
  const { width, height, data } = curlPixels();
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
    curlTexture = new T.CanvasTexture(canvas);
  } else {
    const turned = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) turned.set(data.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
    curlTexture = new T.DataTexture(turned, width, height, T.RGBAFormat);
    curlTexture.magFilter = T.LinearFilter; curlTexture.minFilter = T.LinearMipmapLinearFilter; curlTexture.generateMipmaps = true;
    curlTexture.needsUpdate = true;
  }
  curlTexture.name = "Hair curls";
  curlTexture.colorSpace = T.SRGBColorSpace;
  curlTexture.anisotropy = 4;
  return curlTexture;
}

let undercoatTexture;
/** Dense small curls on the scalp underneath the larger free locks. The lip
 * of the round chart is neutral white so each head keeps its own hairline fade. */
export function curlUndercoat() {
  if (undercoatTexture) return undercoatTexture;
  const size = 512, data = new Uint8Array(size * size * 4);
  const tones = unzlibSync(Uint8Array.from(atob(coilPaint.tone), c=>c.charCodeAt(0)));
  // Sample the continuous interior of the coil mass at anatomical scale. Mirror
  // across square edges to continue the irregular fibres over the circular UVs.
  const mirror = t => 1-Math.abs((t % 2)-1);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const i=y*size+x;
    const u = Math.floor(mirror(x/size*3.6+.31)*(coilPaint.size-1));
    const v = Math.floor(mirror(y/size*3.6+.27)*(coilPaint.size-1));
    const radius = Math.hypot(2*x/size-1,2*y/size-1);
    const value = Math.round(mix(tones[v*coilPaint.size+u],255,smooth(.94,.995,radius)));
    data.set([value,value,value,255],i*4);
  }
  if (typeof document === "undefined") {
    undercoatTexture = new T.DataTexture(data, size, size);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(size, size);
    image.data.set(data);
    ctx.putImageData(image, 0, 0);
    undercoatTexture = new T.CanvasTexture(canvas);
  }
  undercoatTexture.name = "Coiled undercoat";
  undercoatTexture.colorSpace = T.SRGBColorSpace;
  undercoatTexture.magFilter = T.LinearFilter;
  undercoatTexture.minFilter = T.LinearMipmapLinearFilter;
  undercoatTexture.generateMipmaps = true;
  undercoatTexture.needsUpdate = true;
  return undercoatTexture;
}

/** How far the clumps of a style raise the surface of its volume at a direction, as a share of -1 to 1. */
export function clumpRelief(q, mm) {
  const scale = 95 / mm;
  return 1.6 * (noise3(q[0] * scale + 11, q[1] * scale, q[2] * scale + 3) - .5) + .8 * (noise3(q[0] * scale * 2.1, q[1] * scale * 2.1 + 5, q[2] * scale * 2.1) - .5);
}

/**
 * Fill `cards` with the clumps of a curly style.
 *   spec.curl   { kind: "coil" | "ringlet", card: side of a coil card or width of a ringlet in millimetres,
 *                 long: length of a ringlet in millimetres, hang: how far a ringlet turns to hang down, 0 to 1 }
 * `allowed` is the number of triangles the cards may use.
 */
export function curlCards(cards, { spec, body, wear, ears, f, k, margin, cutAt, seat, volume, hair, tone, allowed }) {
  const mm = k / 1000, P = body.P, curl = spec.curl, hanging = curl.kind === "ringlet", pieces = hanging && curl.long > 50 ? 3 : 2, each = hanging ? 2 * pieces : 2;
  const plan = [];
  let wanted = 0;
  for (let t = 0; t < body.tri.length; t += 3) {
    const i = body.tri[t], j = body.tri[t + 1], c = body.tri[t + 2];
    if (wear[i] < .5 || wear[j] < .5 || wear[c] < .5 || ears.mark[i] || ears.mark[j] || ears.mark[c]) continue;
    const a = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], b = [P[j * 3], P[j * 3 + 1], P[j * 3 + 2]], d = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    const mid = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3], at = f.aim(mid), far = margin(at.phi, at.eps);
    if (far < -1) continue;
    const out = volume(at, Math.max(0, far)), grown = mix(.5, 1, smooth(0, spec.rim, far)), side = curl.card * mm * grown;
    // The surface of a volume is larger than the scalp under it, and steeper where it rises from the hairline.
    const area = length(cross(sub(b, a), sub(d, a))) / 2 * (1 + out / (.09 * k)) ** 2 * Math.hypot(1, (volume(at, Math.max(0, far) + 2) - out) / (.0032 * k));
    const count = area * 3.8 / (side * (hanging ? .75 * curl.long * mm * grown : side) * .6);
    plan.push({ a, b, d, count, t });
    wanted += count;
  }
  const thin = Math.min(1, allowed / each / Math.max(1, wanted)), widen = Math.min(1.45, 1 / Math.sqrt(thin));
  const down = [0, -1, 0];
  let carry = .5, card = 0;
  for (const { a, b, d, count, t } of plan) {
    carry += count * thin;
    for (; carry >= 1; carry--) {
      const rnd = n => hash1(t * 131 + card * 17 + n);
      card++;
      let u = rnd(1), v = rnd(2);
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const root = [a[0] + (b[0] - a[0]) * u + (d[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (d[1] - a[1]) * v, a[2] + (b[2] - a[2]) * u + (d[2] - a[2]) * v];
      const at = f.aim(root), far = margin(at.phi, at.eps);
      if (far < 0) continue;
      const here = cutAt(at.q, at.phi, far);
      const ringlet = hanging;
      // Hair thins towards the hairline round the sides and the back, and grows thickly up to it over the forehead.
      if (rnd(3) > mix(smooth(.25 * here.fade, here.fade + 1.3, far) ** .7, smooth(-.3, 1, far), here.forehead)) continue;
      const scalp = seat(at.q, 0);
      // Beside an ear two surfaces lie in one direction. A clump grows only where the map is the skin its root is on.
      if (length(sub(scalp.p, root)) > .004 * k) continue;
      const out = volume(at, far), base = seat(at.q, here.under, .92*out), n = base.n;
      // Clumps are small and close at the hairline and reach their size where the volume has its depth.
      const grown = mix(.45, 1, smooth(0, spec.rim, far)) * mix(.8, 1, here.top), wide = curl.card * mm * grown * (.82 + .36 * rnd(4)) * widen * (ringlet ? .83 : .30);
      const long = ringlet ? curl.long * mm * grown * (.75 + .5 * rnd(5)) * mix(.7, 1, smooth(0, 1, 1 - here.top + .4)) : wide * 2.6;
      let g = sub(down, n.map(x => x * dot(down, n)));
      g = length(g) < .15 ? unit(cross(n, [1, 0, 0])) : unit(g);
      const across = cross(n, g), turn = ringlet ? (rnd(6) - .5) * 1.5 : TAU * rnd(6);
      const lie = unit(add(g.map(x => x * Math.cos(turn)), across, Math.sin(turn)));
      // A card leans out of the volume, so the outline of the head is the edges of clumps.
      const lean = (ringlet ? mix(6, 20, rnd(7)) : mix(12, 34, rnd(7) ** 1.8)) * DEG * mix(.35, 1, smooth(0, .6 * spec.rim, far));
      const axis = unit(add(lie.map(x => x * Math.cos(lean)), n, Math.sin(lean)));
      const flat = unit(cross(n, axis)), up = cross(axis, flat), roll = (rnd(8) - .5) * (ringlet ? .8 : 1.2);
      const span = unit(add(flat.map(x => x * Math.cos(roll)), up, Math.sin(roll)));
      const shade = (1 + .5 * (rnd(9) - .5)) * (1 + .2 * (noise3(at.q[0] * 5 + 2, at.q[1] * 5, at.q[2] * 5) - .5)) * mix(.86, 1, here.top);
      const fine = .45 * (1 - here.forehead) * (1 - smooth(0, here.fade, far));
      const tiles = curlTiles, tile = tiles[ringlet ? Math.floor(rnd(10) * tiles.length) % tiles.length : 2 + Math.floor(rnd(10)*2)%2], flip = rnd(11) < .5;
      const skinning = body.skinOf(scalp.v >= 0 ? scalp.v : body.nearest(root, 8)), first = cards.position.length / 3;
      // The root of a card is bedded in the volume and its tip stands out of it.
      const start = add(base.p, n, -.44 * long * Math.sin(lean) - .0018 * k), stations = ringlet ? pieces : 1;
      // The painted side of every card faces out of the volume.
      const turned = dot(cross(span, axis), n) > 0 ? -1 : 1;
      let p = start, run = axis;
      for (let step = 0; step <= stations; step++) {
        const along = step / stations;
        if (step) {
          // A ringlet turns to hang as it leaves the head.
          if (ringlet && step > 1) run = unit(add(run, down, curl.hang * (.6 + .8 * rnd(12))));
          p = add(p, run, long / stations);
        }
        // Every card is lit as the volume it lies in, so the mass shades as one round thing and no card glints.
        const face = n;
        for (const sign of [-1, 1]) {
          const flatPoint = add(p, span, sign * wide * .5 * turned);
          const dir = f.aim(flatPoint);
          const rim = margin(dir.phi, dir.eps);
          const anchor = seat(dir.q, .001 * k, .92*volume(dir, Math.max(0,rim)));
          const blend = .48 * (1 - smooth(.35,.9,along));
          const q = flatPoint.map((x,j)=>mix(x,anchor.p[j]+anchor.n[j]*.0012*k,blend));
          cards.position.push(...q); cards.normal.push(...unit(face.map((x,j)=>mix(x,anchor.n[j],blend))));
          const value = Math.min(1.25, shade * mix(.83, 1, along));
          cards.color.push(mix(hair.r * value, tone.r, fine), mix(hair.g * value, tone.g, fine), mix(hair.b * value, tone.b, fine));
          const x = tile[0] + 1 + (tile[2] - 2) * ((sign < 0) !== flip ? 0 : 1), y = tile[1] + 1 + (tile[3] - 2) * (1 - along);
          cards.uv.push(x / paintedCurls.width, 1 - y / paintedCurls.height);
          cards.bones.push(...skinning[0]); cards.weights.push(...skinning[1]);
        }
        if (step) { const i = first + step * 2; cards.index.push(i - 2, i + 1, i - 1, i - 2, i, i + 1); }
      }
    }
  }
  return cards;
}
