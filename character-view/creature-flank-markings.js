import { MathUtils } from "three";

export const flankMarkings = ["None", "Lateral stripe", "Saddle", "Flank ocelli"];
const { smoothstep } = MathUtils;

export function flankPaint(style, accent, pale, base) {
  if (!flankMarkings.slice(1).includes(style)) return null;
  const edge = base.clone().multiplyScalar(.28);
  return (colour, station, dorsal, grain, weight) => {
    const end = smoothstep(station, -.02, .18) * (1 - smoothstep(station, .83, 1.02));
    if (!end || weight <= 0) return colour;
    const t = station;
    const y = dorsal + grain * .16;
    const strength = end * weight;
    if (style === "Lateral stripe") {
      const centre = .04 + .20 * Math.sin(Math.PI * t) - .31 * t;
      const offset = y - centre;
      const width = .085 + .12 * Math.sin(Math.PI * t);
      colour.lerp(edge, strength * .84 * (1 - smoothstep(Math.abs(offset), width, width + .09)));
      colour.lerp(accent, strength * .79 * (1 - smoothstep(Math.abs(offset), width * .40, width * .80)));
      colour.lerp(pale, strength * .63 * (1 - smoothstep(Math.abs(offset - width), .015, .085)));
    } else if (style === "Saddle") {
      const border = .53 - .44 * Math.sin(Math.PI * t) + .14 * Math.sin(3 * Math.PI * t);
      const offset = y - border;
      colour.lerp(edge, strength * .88 * smoothstep(offset, -.12, .02));
      colour.lerp(accent, strength * .74 * smoothstep(offset, .05, .34));
      colour.lerp(pale, strength * .48 * (1 - smoothstep(Math.abs(offset + .05), .015, .08)));
    } else {
      for (const [centre, height, width, depth] of ocelli) {
        const x = (t - centre) / width;
        if (Math.abs(x) >= 1.14) continue;
        const dy = (y - height + .09 * x) / depth;
        const radius = Math.hypot(x, dy);
        colour.lerp(edge, strength * .92 * (1 - smoothstep(radius, .88, 1.14)));
        colour.lerp(accent, strength * .92 * (1 - smoothstep(radius, .60, .83)));
        const eye = Math.hypot(x + .09, dy - .19);
        colour.lerp(pale, strength * .77 * (1 - smoothstep(eye, .23, .42)));
      }
    }
    return colour;
  };
}

const ocelli = [[.24, .24, .077, .24], [.46, .09, .105, .33], [.72, .13, .13, .38]];
