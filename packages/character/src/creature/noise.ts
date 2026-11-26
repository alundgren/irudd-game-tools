// Integer hashes and lattice noise for a creature's hide. Ported from
// character-view/creature-hide.js and creature-relief.js at 2761eb1, which
// share these definitions.

export function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 73856093) ^
    Math.imul(y | 0, 19349663) ^
    Math.imul(z | 0, 83492791) ^
    (seed | 0);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
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

export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy;
}

/** Worley cell distances: `out` receives the nearest, the second nearest and the nearest cell's hash. */
export function worley3(out: Float64Array, x: number, y: number, z: number, seed: number): void {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let d1 = 1e9;
  let d2 = 1e9;
  let cellId = 0;
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
        } else if (q < d2) d2 = q;
      }
    }
  }
  out[0] = Math.sqrt(d1);
  out[1] = Math.sqrt(d2);
  out[2] = cellId;
}

/** A Float64Array slot; the arrays here are fixed-size scratch buffers. */
export function slot(a: Float64Array, i: number): number {
  return a[i] ?? 0;
}
