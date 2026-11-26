// A prepared view of a turnaround sheet, measured from its pixels. Ported
// from preparePanel in character-view/turnaround.js at 2761eb1. Free of
// three.js, so a host process measures panels with the raster it has.
//
// Dilation supplies the nearest foreground colour outside thin silhouettes.
// It keeps the chroma key out of texture filtering at the edge of a claw.

/** One prepared view of a sheet: 640 px square, key removed and dilated. */
export interface Panel {
  readonly size: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  readonly mask: Uint8Array;
  readonly mid: number;
  readonly feet: number;
  readonly span: number;
}

/**
 * A view panel from the pixels of one sheet quadrant drawn into a `size`
 * square canvas: the subject's mask, its centre, feet and span. The pixels
 * are dilated in place.
 */
export function panelFromPixels(pixels: Uint8ClampedArray<ArrayBuffer>, size: number): Panel {
  if (pixels.length !== size * size * 4) throw new Error("A panel needs size × size RGBA pixels.");
  const px = (i: number) => pixels[i] ?? 0;
  const mask = new Uint8Array(size * size);
  const subject = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  let tail = 0;
  for (let i = 0; i < mask.length; i++) {
    const off = i * 4;
    const r = px(off);
    const g = px(off + 1);
    const b = px(off + 2);
    const keyed = Math.min(r, b) > 108 && Math.min(r, b) > g * 1.7 + 32;
    if (px(off + 3) >= 190 && !keyed) subject[i] = 1;
  }
  for (let i = 2 * size + 2; i < mask.length - 2 * size - 2; i++) {
    if (!subject[i]) continue;
    // Exclude antialiased key-colour spill before extending surface colours.
    if (!subject[i - 2] || !subject[i + 2] || !subject[i - size * 2] || !subject[i + size * 2])
      continue;
    mask[i] = 1;
    queue[tail++] = i;
    const x = i % size;
    const y = Math.floor(i / size);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (maxY - minY < size * 0.15 || maxX - minX < size * 0.04)
    throw new Error("Each view needs a visible subject on magenta or transparency.");
  const filled = mask.slice();
  // Fine hair resamples saturated key pixels into pastel fringe colours.
  // Extend clean neighbours through that narrow fringe without changing its silhouette.
  let clean = 0;
  for (let j = 0; j < tail; j++) {
    const i = queue[j] ?? 0;
    const k = i * 4;
    const x = i % size;
    const y = Math.floor(i / size);
    const magenta = px(k) - px(k + 1) > 15 && px(k + 2) - px(k + 1) > 14;
    const nearEdge =
      x < 8 ||
      x >= size - 8 ||
      y < 8 ||
      y >= size - 8 ||
      !subject[i - 8] ||
      !subject[i + 8] ||
      !subject[i - 8 * size] ||
      !subject[i + 8 * size];
    let isolated = false;
    if (magenta && !nearEdge && y < minY + (maxY - minY) * 0.15) {
      let measured = 0;
      let purple = 0;
      for (const [dx, dy] of [
        [-13, 0],
        [13, 0],
        [0, 13],
        [-9, 9],
        [9, 9],
        [0, 22],
      ] as const) {
        const v = i + dx + dy * size;
        if (!mask[v]) continue;
        measured++;
        if (Math.min(px(4 * v), px(4 * v + 2)) - px(4 * v + 1) > 13) purple++;
      }
      isolated = measured >= 2 && purple * 2 < measured;
    }
    if (magenta && (nearEdge || isolated)) filled[i] = 0;
    else queue[clean++] = i;
  }
  tail = clean;
  for (let i = 0; i < tail; i++) {
    const at = queue[i] ?? 0;
    const x = at % size;
    for (const next of [x > 0 ? at - 1 : -1, x < size - 1 ? at + 1 : -1, at - size, at + size]) {
      if (next < 0 || next >= mask.length || filled[next]) continue;
      filled[next] = 1;
      queue[tail++] = next;
      const a = at * 4;
      const b = next * 4;
      pixels[b] = px(a);
      pixels[b + 1] = px(a + 1);
      pixels[b + 2] = px(a + 2);
      pixels[b + 3] = 255;
    }
  }
  return { size, pixels, mask, mid: (minX + maxX) / 2, feet: maxY, span: maxY - minY };
}
