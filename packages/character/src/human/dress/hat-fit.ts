import type * as T from "three";
import type { HumanSurface } from "../surface.js";
import { surfaceFrame, type HeadFrame } from "./fringe.js";
import { mix, smooth, unit, clamp, sub, type Vec } from "./kit.js";
const DEG = Math.PI / 180;
interface Cut {
  front: number;
  side: number;
  back: number;
  tip: number;
  gap: number;
  cloth: string;
}
const cuts: Record<string, Cut> = {
  "Flying cap and goggles": {
    front: 18,
    side: -23,
    back: -30,
    tip: 0,
    gap: 0.003,
    cloth: "leather",
  },
  "Ribbed watch cap": { front: 15, side: 8, back: -9, tip: 0, gap: 0.0065, cloth: "knit" },
  "Bucket hat": { front: 21, side: 10, back: -6, tip: 0, gap: 0.0065, cloth: "twill" },
  Beret: { front: 25, side: 13, back: -2, tip: 5, gap: 0.006, cloth: "felt" },
  "Flat cap": { front: 15, side: 8, back: -9, tip: 0, gap: 0.006, cloth: "tweed" },
};

function hatHead(f: HeadFrame) {
  const turn = (u: Vec, a: number): Vec => [
    u[0] * Math.cos(a) + u[2] * Math.sin(a),
    u[1],
    u[2] * Math.cos(a) - u[0] * Math.sin(a),
  ];
  const sides = (u: Vec) => {
    const r = f.bone(u),
      flat = Math.hypot(u[0], u[2]) || 1e-9,
      w = smooth(0.68, 0.86, Math.abs(u[0]) / flat) * smooth(0.5, 0.34, u[1]);
    return w
      ? mix(r, Math.min(r, (f.bone(turn(u, 30 * DEG)) + f.bone(turn(u, -30 * DEG))) / 2), w)
      : r;
  };
  const crown = 70 * DEG,
    bone = (u: Vec) => {
      const high = Math.asin(clamp(u[1], -1, 1));
      if (high <= crown) return sides(u);
      const flat = Math.hypot(u[0], u[2]) || 1e-9,
        c = Math.cos(crown) / flat,
        base = sides([u[0] * c, Math.sin(crown), u[2] * c]);
      return mix(
        base > 0.5 * f.size ? base : f.radii[1],
        f.radii[1],
        smooth(crown, 90 * DEG, high),
      );
    };
  const direction = (phi: number, eps: number) => {
    const c = Math.cos(eps);
    return unit([
      c * Math.sin(phi) * f.radii[0],
      Math.sin(eps) * f.radii[1],
      c * Math.cos(phi) * f.radii[2],
    ]);
  };
  let earTop = f.earElevation ?? -Infinity;
  for (const side of [-1, 1])
    for (let phi = 70; phi <= 120; phi += 5)
      for (let eps = 34; eps >= -24; eps -= 2) {
        const u = direction(side * phi * DEG, eps * DEG);
        if (f.bone(u) - bone(u) > 0.004 * f.k) {
          earTop = Math.max(earTop, eps * DEG);
          break;
        }
      }
  return {
    k: f.k,
    centre: f.centre,
    size: f.size,
    earTop,
    direction,
    place(phi: number, eps: number, h: number) {
      const u = direction(phi, eps),
        r = bone(u) + h;
      return [f.centre[0] + u[0] * r, f.centre[1] + u[1] * r, f.centre[2] + u[2] * r];
    },
    over(p: Vec) {
      const d = sub(p, f.centre),
        r = Math.hypot(d[0], d[1], d[2]) || 1e-9,
        u: Vec = [d[0] / r, d[1] / r, d[2] / r],
        a = f.aim(p);
      return { phi: a.phi, eps: a.eps, r, u, h: r - bone(u) };
    },
  };
}

function bandLine(f: ReturnType<typeof hatHead>, cut: Cut) {
  const side = Math.max(cut.side * DEG, Number.isFinite(f.earTop) ? f.earTop + 5 * DEG : -1),
    front = cut.front * DEG,
    back = cut.back * DEG;
  const a = ((front + back) / 2 + side) / 2,
    b = (front - back) / 2,
    c = ((front + back) / 2 - side) / 2;
  return (phi: number) =>
    a + b * Math.cos(phi) + c * Math.cos(2 * phi) + cut.tip * DEG * Math.sin(phi);
}

function tuckHair(
  f: ReturnType<typeof hatHead>,
  line: (phi: number) => number,
  gap: number,
  meshes: readonly T.Mesh[],
  holdLength: boolean,
) {
  const limit = gap * 0.5,
    hold = 10 * DEG,
    ease = 30 * DEG;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    if (!position) continue;
    mesh.geometry = mesh.geometry.clone();
    const p = mesh.geometry.getAttribute("position");
    let moved = 0;
    for (let i = 0; i < p.count; i++) {
      const at: Vec = [p.getX(i), p.getY(i), p.getZ(i)],
        o = f.over(at);
      if (o.h <= limit * 0.5 || o.h > 0.2) continue;
      const below = line(o.phi) - o.eps;
      if (below >= ease) continue;
      const pressed = limit * (1 - Math.exp(-o.h / limit)),
        h = mix(pressed, o.h, smooth(hold, ease, below));
      if (h >= o.h - 1e-5) continue;
      const r = o.r - o.h + h;
      const y = holdLength && o.eps < 0 ? at[1] : f.centre[1] + o.u[1] * r;
      p.setXYZ(i, f.centre[0] + o.u[0] * r, y, f.centre[2] + o.u[2] * r);
      moved++;
    }
    if (moved) {
      p.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  }
}

export function fitHairUnderHat(
  surface: HumanSurface,
  hat: string | undefined,
  hair: string | undefined,
  meshes: readonly T.Mesh[],
) {
  const cut = hat && cuts[hat];
  if (!cut || !meshes.length) return;
  const frame = hatHead(surfaceFrame(surface)),
    flight = hat === "Flying cap and goggles";
  const line = flight
    ? (phi: number) => 0.35 - 1.12 * smooth(0.32, 1.27, Math.abs(phi))
    : bandLine(frame, cut);
  tuckHair(
    frame,
    line,
    (hair === "None" || hair === "Buzz cut" ? 0.0032 : cut.gap) * frame.k,
    meshes,
    flight,
  );
}
