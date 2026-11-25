// Skin that an outfit covers and nobody can see.
//
// A reduced export moves every surface a little, and cloth lies only millimetres off the skin, so skin left in place
// under a garment comes through it as specks. Leaving that skin out also spends the triangles where they show.

import { dot, loops, sub } from "./human-style-kit.js";

/**
 * Whether a shell covers each skin point. Skin within `margin` of one of the shell's open edges is not covered,
 * because a viewer can see in there: up a sleeve, under a hem, into a collar.
 */
function cover(body, s, margin) {
  const over = new Uint8Array(body.count), P = body.P, grid = new Map(), key = (x, y, z) => Math.floor(x / margin) + "," + Math.floor(y / margin) + "," + Math.floor(z / margin);
  for (const loop of loops(s)) for (const i of loop) {
    const a = s.anchor(i), k = key(...a);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(a);
  }
  for (let i = 0; i < s.count; i++) {
    // A shell is cut from the skin, so away from its cut edges and its added detail a vertex still names one skin point.
    const a = s.anchor(i), v = body.nearest(a, 1);
    if (v < 0 || (P[v * 3] - a[0]) ** 2 + (P[v * 3 + 1] - a[1]) ** 2 + (P[v * 3 + 2] - a[2]) ** 2 > 1e-8) continue;
    if (dot(sub(s.at(i), a), s.normal(i)) > .0005) over[v] = 1;
  }
  for (let v = 0; v < body.count; v++) {
    if (!over[v]) continue;
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    open: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      for (const a of grid.get(key(x + dx * margin, y + dy * margin, z + dz * margin)) ?? [])
        if ((a[0] - x) ** 2 + (a[1] - y) ** 2 + (a[2] - z) ** 2 < margin * margin) { over[v] = 0; break open; }
  }
  return over;
}

/**
 * The source vertex ids of the skin under the shells of `pieces`, in the form `humanRegions` leaves out.
 *   margin  how far in from an opening the skin stays, in metres on a 1.72 m figure
 */
export function concealed(body, pieces, { margin = .04 } = {}) {
  const hidden = new Set();
  for (const piece of pieces) for (const s of piece.shells ?? []) {
    const over = cover(body, s, margin * body.scale);
    for (let v = 0; v < body.count; v++) if (over[v]) hidden.add(body.surface.ids[v]);
  }
  return hidden;
}
