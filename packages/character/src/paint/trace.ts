// Tracing a body region from a sheet's silhouettes. Ported from traceRegion
// in character-view/turnaround.js at 2761eb1, arithmetic in the same order,
// so a traced binding is the one G0 bakes from. Free of three.js, so a host
// process traces with the panels it measured.

import type { Digest, FigurePaint } from "@irudd/document";
import type { Panel } from "./panel.js";

/** A sheet's four prepared views, as `Panels` in turnaround.ts. */
type Panels = readonly [Panel, Panel, Panel, Panel];
/** A traced binding with its sheet, as `Binding` in turnaround.ts. */
type Binding = FigurePaint & { readonly atlas: Digest };

/** A track row: height, left, right, rear and fore limits, in standing-height units. */
export type TrackRow = readonly [number, number, number, number, number];

function projected(panel: Panel, horizontal: number, height: number): number {
  const px = Math.max(0, Math.min(panel.size - 1, Math.round(panel.mid + horizontal * panel.span)));
  const py = Math.max(0, Math.min(panel.size - 1, Math.round(panel.feet - height * panel.span)));
  return py * panel.size + px;
}

function section(
  panel: Panel,
  low: number,
  high: number,
  y: number,
  reverse = false,
): readonly [number, number] | undefined {
  const sign = reverse ? -1 : 1;
  const step = 1 / panel.span;
  let a = low;
  let b = high;
  while (a < b && !panel.mask[projected(panel, sign * a, y)]) a += step;
  while (b > a && !panel.mask[projected(panel, sign * b, y)]) b -= step;
  return a < b ? [a, b] : undefined;
}

/** three.js's MathUtils.lerp, which G0 traces with: the same rounding. */
const lerp = (x: number, y: number, t: number) => (1 - t) * x + t * y;

const row = <V>(list: ReadonlyArray<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Track index out of range.");
  return v;
};

/**
 * The rest binding of a region within the track's limits on the front and
 * right views, sampled at `samples` heights and smoothed twice, pivoted at
 * its lowest section.
 */
export function traceRegion(
  panels: Panels,
  atlas: Digest,
  region: string,
  height: number,
  track: ReadonlyArray<TrackRow>,
  samples = 26,
): Binding {
  const knots: number[][] = [];
  const first = row(track, 0);
  const last = row(track, track.length - 1);
  for (let n = 0; n < samples; n++) {
    const y = lerp(first[0], last[0], n / (samples - 1));
    let k = 1;
    while (k < track.length - 1 && row(track, k)[0] < y) k++;
    const a = row(track, k - 1);
    const b = row(track, k);
    const t = (y - a[0]) / (b[0] - a[0]);
    const bounds = [1, 2, 3, 4].map((i) => lerp(row(a, i), row(b, i), t));
    const front = section(panels[0], row(bounds, 0), row(bounds, 1), y);
    const profile = section(panels[1], row(bounds, 2), row(bounds, 3), y, true);
    if (!front || !profile) continue;
    const [left, right] = front;
    const [rear, fore] = profile;
    knots.push([
      ((left + right) * height) / 2,
      y * height,
      ((rear + fore) * height) / 2,
      Math.max(0.001, ((right - left) * height) / 2),
      Math.max(0.001, ((fore - rear) * height) / 2),
    ]);
  }
  if (knots.length < 2) throw new Error("A region must cover at least two visible cross sections.");
  // A few source pixels can move a silhouette sideways at a hair tip or an
  // overlapping plate. Regularise the cross sections before fitting the loft.
  for (let pass = 0; pass < 2; pass++) {
    const prev = knots.map((v) => v.slice());
    for (let i = 1; i < knots.length - 1; i++)
      for (const j of [0, 2, 3, 4]) {
        const knot = row(knots, i);
        knot[j] =
          0.25 * row(row(prev, i - 1), j) +
          0.5 * row(row(prev, i), j) +
          0.25 * row(row(prev, i + 1), j);
      }
  }
  const base = row(knots, 0);
  const pivot = [row(base, 0), row(base, 1), row(base, 2)] as const;
  const rest = knots.map(
    (k) =>
      [
        row(k, 0) - pivot[0],
        row(k, 1) - pivot[1],
        row(k, 2) - pivot[2],
        row(k, 3),
        row(k, 4),
      ] as const,
  );
  return { atlas, region, height, offset: pivot, rest, profile: 1 };
}
