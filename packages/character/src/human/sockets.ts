// Where a limb root seats on an adult (scapulaSocket in
// character-view/human-sockets.js at 2761eb1).

import { boneNames } from "./catalogue.js";
import type { HumanSurface } from "./surface.js";

/**
 * A shoulder blade on the rear surface of the evaluated skin, relative to the
 * chest joint: a spar starts a little inside the back and leaves along the
 * swept shoulder. `side` 1 is the left blade, -1 the right.
 */
export function scapulaSocket(surface: HumanSurface, side: 1 | -1): [number, number, number] {
  const chest = boneNames.indexOf("spine_03") * 3;
  const shoulder = boneNames.indexOf(side > 0 ? "upperarm_l" : "upperarm_r") * 3;
  const { joints, positions, indices } = surface;
  const chestX = joints[chest] ?? 0;
  const k = surface.height / 1.72;
  const x = chestX + ((joints[shoulder] ?? 0) - chestX) * 0.49;
  const y = (joints[shoulder + 1] ?? 0) - 0.061 * k;
  const startZ = -3;
  let rear = Infinity;
  // The ray points along +Z, so its projection is XY. Signed edge weights
  // both test the projected triangle and interpolate its depth at the socket.
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    const a = (indices[i] ?? 0) * 3;
    const b = (indices[i + 1] ?? 0) * 3;
    const c = (indices[i + 2] ?? 0) * 3;
    const ax = (positions[a] ?? 0) - x,
      ay = (positions[a + 1] ?? 0) - y;
    const bx = (positions[b] ?? 0) - x,
      by = (positions[b + 1] ?? 0) - y;
    const cx = (positions[c] ?? 0) - x,
      cy = (positions[c + 1] ?? 0) - y;
    const u = cx * by - cy * bx;
    const v = ax * cy - ay * cx;
    const w = bx * ay - by * ax;
    if ((u < 0 || v < 0 || w < 0) && (u > 0 || v > 0 || w > 0)) continue;
    const sum = u + v + w;
    if (sum === 0) continue;
    const distance =
      (u * ((positions[a + 2] ?? 0) - startZ) +
        v * ((positions[b + 2] ?? 0) - startZ) +
        w * ((positions[c + 2] ?? 0) - startZ)) /
      sum;
    if (distance >= 0) rear = Math.min(rear, startZ + distance);
  }
  if (!Number.isFinite(rear)) throw new Error("Could not find the adult's shoulder-blade surface.");
  return [x - chestX, y - (joints[chest + 1] ?? 0), rear + 0.012 * k - (joints[chest + 2] ?? 0)];
}
