// Hair and facial hair combed by MakeHuman community artists, from packs indexed as CC0. See docs/human-grooms.md for the individual file headers.
//   authoredHair      hair style name -> packed groom
//   authoredAssets    the packed grooms, in the form human-library.js fits, trims and tints
//   authoredCredits   style name -> { groom, author, licence, source, pack }
// Packed by scripts/pack-human-grooms.py from the official `hair01` and `bodyparts05` asset packs. The hair is
// worn through human-library.js like the system library hair; the facial hair through human-face-hair.js.
import * as T from "three";
import { addBeardWhiskers } from "./human-beard-whiskers.js";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import assets from "./human-grooms-data.json" with { type: "json" };

export const authoredAssets = assets;
export const authoredHair = {
  "Loose waves": "cloud_waves",
  "Layered short": "short_layered",
  "Receding short": "short_receding",
  "Sleek bob": "bob_blunt",
  "Fringed bob": "bob_blunt_fringe",
  "Angled bob": "bob_inverted",
  "Curled-under bob": "bob_curled",
  "Tied bun": "bun_tied",
};
// Facial hair styles worn as authored cards: the groom, how many triangles a game model spends on it, and for
// a deeper beard how far the middle of the groom stands out from the face and hangs below the chin (metres on a
// 1.72 m adult). The border of the groom stays on the skin.
export const authoredFacialHair = {
  Moustache: { groom: "moustache_viking", triangles: 1000 },
};
export const authoredCredits = Object.fromEntries([...Object.entries(authoredHair), ...Object.entries(authoredFacialHair).map(([style, worn]) => [style, worn.groom])]
  .filter(([, groom]) => assets[groom]).map(([style, groom]) => [style, { groom, ...assets[groom].credit }]));

/**
 * Hold hair that stands off the head in the shape its artist combed. A card vertex is fitted to the skin under
 * it, which is right for hair lying on the scalp and wrong for a hem hanging centimetres from a neck: there
 * every fold of the skin swings it. Such a vertex follows the skull as a whole instead, stretched to the
 * width, height and depth of this head. In between the two are blended by how far the vertex stands off.
 *   p         fitted positions (changed in place)
 *   anchor    where each vertex is tied on this body, anchorRest the same on the resting body
 *   offsets   the authored stand-off of each vertex, in metres
 *   onSkull   1 for a vertex tied to the skull, 0 for one tied to neck or shoulders
 */
export function settleAuthored(p, anchor, anchorRest, offsets, onSkull) {
  const count = p.length / 3, gain = [1, 1, 1], shift = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    // Least squares of this head against the resting one, along each axis.
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < count; i++) if (onSkull[i]) { const x = anchorRest[i * 3 + d], y = anchor[i * 3 + d]; n++; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const spread = n * sxx - sx * sx;
    if (n < 8 || spread < 1e-9) { shift[d] = n ? (sy - sx) / n : 0; continue; }
    gain[d] = Math.min(1.3, Math.max(.77, (n * sxy - sx * sy) / spread));
    shift[d] = (sy - gain[d] * sx) / n;
  }
  for (let i = 0; i < count; i++) {
    const j = i * 3, off = Math.hypot(offsets[j], offsets[j + 1], offsets[j + 2]);
    let t = Math.min(1, Math.max(0, (off - .006) / .022));
    t = onSkull[i] ? t * t * (3 - 2 * t) : 1;
    if (!t) continue;
    for (let d = 0; d < 3; d++) p[j + d] += ((anchorRest[j + d] + offsets[j + d]) * gain[d] + shift[d] - p[j + d]) * t;
  }
  return p;
}

const decoded = new Map();
function field(name, key, Type) {
  const id = name + "/" + key;
  if (!decoded.has(id)) {
    const raw = unzlibSync(Uint8Array.from(atob(assets[name][key]), (c) => c.charCodeAt(0)));
    decoded.set(id, new Type(raw.buffer, raw.byteOffset, raw.byteLength / Type.BYTES_PER_ELEMENT));
  }
  return decoded.get(id);
}

/**
 * Authored facial hair as a mesh in the head's frame: the artist's strand cards tied to the face, each vertex
 * carrying the expression offsets of the skin it is tied to, so the hair follows the jaw, lips and cheeks.
 *   style     a name of authoredFacialHair
 *   s, idMap  the evaluated adult and its source vertex ids -> indices
 *   moves     per expression, the displacement of every skin point (expressionDisplacements)
 *   map       the strand picture in the hair colour, or none (then `colour` tints the plain cards)
 *   name      the name of the mesh
 * A beard has thousands of strand cards. Whole cards are left out evenly until the style's triangle count is
 * met, and the rest are widened to keep the cover, so the same mesh serves the editor and a game model.
 */
export function authoredFacialMesh(style, s, idMap, origin, moves, names, material, colour, map, meshName = "facial-hair") {
  const worn = authoredFacialHair[style], name = worn.groom;
  const refs = field(name, "refs", Uint16Array), weights = field(name, "weights", Float32Array), offsets = field(name, "offsets", Float32Array),
    corners = field(name, "corners", Uint16Array), uvCorners = field(name, "uvCorners", Uint16Array), uv = field(name, "uv", Uint16Array);
  const count = refs.length / 3, k = s.height / 1.72, p = new Float32Array(count * 3), anchor = new Float32Array(count * 3), shifts = moves.map(() => new Float32Array(count * 3));
  for (let i = 0; i < count; i++) {
    const off = [offsets[i * 3] * k, offsets[i * 3 + 1] * k, offsets[i * 3 + 2] * k];
    for (let d = 0; d < 3; d++) {
      let value = 0;
      for (let c = i * 3; c < i * 3 + 3; c++) {
        const at = idMap.get(refs[c]) * 3 + d;
        value += weights[c] * s.positions[at];
        for (let e = 0; e < moves.length; e++) shifts[e][i * 3 + d] += weights[c] * moves[e][at] * k;
      }
      anchor[i * 3 + d] = value - origin[d];
      p[i * 3 + d] = anchor[i * 3 + d] + off[d];
    }
  }
  if (worn.out) {
    // A fuller beard: the groom is raised from the face by how far each point lies inside its border, and hangs
    // from the chin. Rings of points are counted in from the open edge.
    const edges = new Map(), beside = Array.from({ length: count }, () => []);
    for (let c = 0; c < corners.length; c += 3) for (let j = 0; j < 3; j++) {
      const u = corners[c + j], v = corners[c + (j + 1) % 3], key = u < v ? u * count + v : v * count + u;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      beside[u].push(v); beside[v].push(u);
    }
    const ring = new Int16Array(count).fill(-1);
    let wave = [];
    for (const [key, uses] of edges) if (uses === 1) for (const v of [Math.floor(key / count), key % count]) if (ring[v] < 0) { ring[v] = 0; wave.push(v); }
    for (let depth = 1; wave.length; depth++) {
      const next = [];
      for (const v of wave) for (const u of beside[v]) if (ring[u] < 0) { ring[u] = depth; next.push(u); }
      wave = next;
    }
    let low = Infinity, high = -Infinity, cx = 0, cz = 0;
    for (let i = 0; i < count; i++) { low = Math.min(low, anchor[i * 3 + 1]); high = Math.max(high, anchor[i * 3 + 1]); cx += anchor[i * 3] / count; cz += anchor[i * 3 + 2] / count; }
    for (let i = 0; i < count; i++) {
      const inner = Math.min(1, Math.max(0, ring[i]) / 3), depth = inner * inner * (3 - 2 * inner);
      const out = [anchor[i * 3] - cx, 0, anchor[i * 3 + 2] - (cz - .05 * k)], size = Math.hypot(out[0], out[2]) || 1;
      // Hair hangs most from the chin and jaw, the lowest third of the groom.
      const under = Math.min(1, Math.max(0, (low + (high - low) * .42 - anchor[i * 3 + 1]) / ((high - low) * .3)));
      p[i * 3] += out[0] / size * worn.out * k * depth;
      p[i * 3 + 2] += out[2] / size * worn.out * k * depth;
      p[i * 3 + 1] -= worn.drop * k * depth * under * under;
    }
  }
  // Cards are the connected pieces of the source mesh.
  const parent = Int32Array.from({ length: count }, (_, i) => i), root = (v) => { while (parent[v] !== v) v = parent[v] = parent[parent[v]]; return v; };
  for (let c = 0; c < corners.length; c += 3) { parent[root(corners[c + 1])] = root(corners[c]); parent[root(corners[c + 2])] = root(corners[c]); }
  const share = Math.min(1, worn.triangles / (corners.length / 3)), kept = (v) => (Math.imul(root(v) + 11, 2654435761) >>> 0) / 4294967296 < share;
  // What is left is widened about the middle of each card.
  const widen = Math.min(1.7, 1 / Math.sqrt(share)), centre = new Map();
  if (widen > 1.01) {
    for (let i = 0; i < count; i++) { const r = root(i), c = centre.get(r) ?? centre.set(r, [0, 0, 0, 0]).get(r); c[0] += p[i * 3]; c[1] += p[i * 3 + 1]; c[2] += p[i * 3 + 2]; c[3]++; }
    for (let i = 0; i < count; i++) { const c = centre.get(root(i)); for (let d = 0; d < 3; d++) p[i * 3 + d] = c[d] / c[3] + (p[i * 3 + d] - c[d] / c[3]) * (d === 1 ? 1 + (widen - 1) * .35 : widen); }
  }
  // Lit as part of the face they grow from: away from a point inside the head, not as flat chips.
  let low = Infinity, high = -Infinity, back = Infinity;
  for (let i = 0; i < count; i++) { low = Math.min(low, anchor[i * 3 + 1]); high = Math.max(high, anchor[i * 3 + 1]); back = Math.min(back, anchor[i * 3 + 2]); }
  const inside = [0, (low + high) / 2 + .02 * k, back - .02 * k];
  const pos = [], norm = [], tex = [], index = [], moved = moves.map(() => []), seen = new Map();
  for (let c = 0; c < corners.length; c += 3) {
    if (!kept(corners[c])) continue;
    for (let d = c; d < c + 3; d++) {
      const v = corners[d], t = uvCorners[d], key = v * 65536 + t;
      if (!seen.has(key)) {
        seen.set(key, pos.length / 3);
        pos.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
        const n = [anchor[v * 3] - inside[0], anchor[v * 3 + 1] - inside[1], anchor[v * 3 + 2] - inside[2]], size = Math.hypot(...n) || 1;
        norm.push(n[0] / size, n[1] / size, n[2] / size);
        tex.push(uv[t * 2] / 65535, uv[t * 2 + 1] / 65535);
        moved.forEach((out, e) => out.push(shifts[e][v * 3], shifts[e][v * 3 + 1], shifts[e][v * 3 + 2]));
      }
      index.push(seen.get(key));
    }
  }
  if (map && assets[name].whiskers)
    addBeardWhiskers({pos,norm,tex,index,moved}, assets[name].whiskers, k, Boolean(worn.out));
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(tex, 2));
  // White vertex colour, so the mesh joins the vertex-coloured fibres of a face without a second material kind.
  geometry.setAttribute("color", new T.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  geometry.setIndex(index);
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = moved.map((values, e) => { const attr = new T.Float32BufferAttribute(values, 3); attr.name = names[e]; return attr; });
  const m = material(map ? "#ffffff" : "#" + colour.getHexString()).clone();
  m.vertexColors = true;
  m.roughness = .76;
  m.map = map ?? null;
  if (map) { m.alphaTest = .3; m.alphaToCoverage = true; }
  m.side = T.DoubleSide;
  // Already as few cards as a game model carries, so its export keeps every one.
  m.userData = { ...m.userData, fibreLOD: true };
  const mesh = new T.Mesh(geometry, m);
  mesh.name = meshName;
  mesh.userData.authoredGroom = name;
  mesh.castShadow = false;
  mesh.updateMorphTargets();
  return mesh;
}
