import { Vector3 } from "three";
import type { FigureBuild } from "@irudd/document";

const heights = [
  0.035, 0.11, 0.2, 0.29, 0.38, 0.47, 0.54, 0.61, 0.68, 0.75, 0.81, 0.86, 0.92, 0.97,
];

export function sectionFit(
  profile: NonNullable<FigureBuild["sectionProfile"]>,
  joints: readonly (readonly [string, Vector3])[],
) {
  const { height, stations } = profile;
  const rows = stations.map((row, index) => {
    const y = heights[index] ?? 0;
    const tangent = row.map((value, k) => {
      const before = stations[index - 1]?.[k],
        after = stations[index + 1]?.[k];
      const a = before === undefined ? 0 : (value - before) / (y - (heights[index - 1] ?? y));
      const b = after === undefined ? 0 : (after - value) / ((heights[index + 1] ?? y) - y);
      return a * b > 0 ? (2 * a * b) / (a + b) : 0;
    });
    return { row, y, tangent };
  });
  function warp(v: Vector3) {
    const y = v.y / height;
    let index = rows.findIndex((row) => row.y >= y);
    if (index < 0) index = rows.length - 1;
    const a = rows[Math.max(0, index - 1)],
      b = rows[Math.max(1, index)];
    if (!a || !b) throw new Error("Missing section stations.");
    const d = b.y - a.y,
      t = Math.min(1, Math.max(0, (y - a.y) / d));
    const mix = t * t * (3 - 2 * t),
      m = d * t * (1 - t);
    const at = (k: 0 | 1 | 2 | 3) =>
      (1 - mix) * a.row[k] +
      mix * b.row[k] +
      m * ((1 - t) * (a.tangent[k] ?? 0) - t * (b.tangent[k] ?? 0));
    v.x = v.x * at(0) + height * at(2);
    v.z = v.z * at(1) + height * at(3);
    return v;
  }
  const rest = new Map(joints);
  const step = height / 256,
    radius = height * 0.068;
  const fields = ["left", "right"].map((side) => {
    const samples = new Map<number, readonly [number, number, number, number]>();
    const shoulder = rest.get(side + " upper arm"),
      elbow = rest.get(side + " forearm"),
      wrist = rest.get(side + " hand");
    if (!shoulder || !elbow || !wrist) return samples;
    const top = warp(shoulder.clone()),
      bottom = warp(wrist.clone()),
      middle = warp(elbow.clone());
    const span = shoulder.y - wrist.y;
    if (span > 4 * step)
      middle
        .copy(top)
        .sub(shoulder)
        .lerp(bottom.clone().sub(wrist), Math.max(0, Math.min(1, (shoulder.y - elbow.y) / span)))
        .add(elbow);
    for (const [a, b, wa, wb] of [
      [shoulder, elbow, top, middle],
      [elbow, wrist, middle, bottom],
    ] as const) {
      if (a.y - b.y < 2 * step) continue;
      for (
        let j = Math.max(0, Math.ceil(b.y / step));
        j <= Math.min(256, Math.floor(a.y / step));
        j++
      ) {
        const t = (a.y - j * step) / (a.y - b.y),
          mid = a.clone().lerp(b, t);
        const drift = wa.clone().lerp(wb, t).sub(warp(mid.clone()));
        samples.set(j, [mid.x, mid.z, drift.x, drift.z]);
      }
    }
    return samples;
  });
  return (v: Vector3) => {
    const level = v.y / step,
      j = Math.floor(level),
      t = level - j;
    let dx = 0,
      dz = 0;
    for (const field of fields)
      for (const k of [0, 1]) {
        const sample = field.get(j + k);
        if (!sample) continue;
        const [x, z, deltaX, deltaZ] = sample;
        const r2 = ((v.x - x) ** 2 + (v.z - z) ** 2) / (radius * radius);
        const fade = Math.min(1, Math.max(0, (1.7 - r2) / 1.1)),
          w = (k ? t : 1 - t) * fade * fade * (3 - 2 * fade);
        dx += w * deltaX;
        dz += w * deltaZ;
      }
    warp(v);
    v.x += dx;
    v.z += dz;
    return v;
  };
}
