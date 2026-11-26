import * as T from "three";

const { smoothstep } = T.MathUtils;

const ocelli: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.24, 0.24, 0.077, 0.24],
  [0.46, 0.09, 0.105, 0.33],
  [0.72, 0.13, 0.13, 0.38],
];

export type FlankPaint = (
  colour: T.Color,
  station: number,
  dorsal: number,
  grain: number,
  weight: number,
) => T.Color;

export function flankPaint(
  style: string | undefined,
  accent: T.Color,
  pale: T.Color,
  base: T.Color,
): FlankPaint | undefined {
  if (style !== "Lateral stripe" && style !== "Saddle" && style !== "Flank ocelli")
    return undefined;
  const edge = base.clone().multiplyScalar(0.28);
  return (colour, station, dorsal, grain, weight) => {
    const end = smoothstep(station, -0.02, 0.18) * (1 - smoothstep(station, 0.83, 1.02));
    if (!end || weight <= 0) return colour;
    const t = station;
    const y = dorsal + grain * 0.16;
    const strength = end * weight;
    if (style === "Lateral stripe") {
      const centre = 0.04 + 0.2 * Math.sin(Math.PI * t) - 0.31 * t;
      const offset = y - centre;
      const width = 0.085 + 0.12 * Math.sin(Math.PI * t);
      colour.lerp(edge, strength * 0.84 * (1 - smoothstep(Math.abs(offset), width, width + 0.09)));
      colour.lerp(
        accent,
        strength * 0.79 * (1 - smoothstep(Math.abs(offset), width * 0.4, width * 0.8)),
      );
      colour.lerp(pale, strength * 0.63 * (1 - smoothstep(Math.abs(offset - width), 0.015, 0.085)));
    } else if (style === "Saddle") {
      const border = 0.53 - 0.44 * Math.sin(Math.PI * t) + 0.14 * Math.sin(3 * Math.PI * t);
      const offset = y - border;
      colour.lerp(edge, strength * 0.88 * smoothstep(offset, -0.12, 0.02));
      colour.lerp(accent, strength * 0.74 * smoothstep(offset, 0.05, 0.34));
      colour.lerp(pale, strength * 0.48 * (1 - smoothstep(Math.abs(offset + 0.05), 0.015, 0.08)));
    } else {
      for (const [centre, height, width, depth] of ocelli) {
        const x = (t - centre) / width;
        if (Math.abs(x) >= 1.14) continue;
        const dy = (y - height + 0.09 * x) / depth;
        const radius = Math.hypot(x, dy);
        colour.lerp(edge, strength * 0.92 * (1 - smoothstep(radius, 0.88, 1.14)));
        colour.lerp(accent, strength * 0.92 * (1 - smoothstep(radius, 0.6, 0.83)));
        const eye = Math.hypot(x + 0.09, dy - 0.19);
        colour.lerp(pale, strength * 0.77 * (1 - smoothstep(eye, 0.23, 0.42)));
      }
    }
    return colour;
  };
}
