import { MathUtils } from "three";

export function placeDrawnAnatomy(plan) {
  const { spine, head, limbs } = plan;
  const leg = limbs.find((l) => l.kind === "leg");
  if (!leg) return plan;
  const wing = limbs.find((l) => l.kind === "wing");
  const upright = spine.rear > 65 && spine.front > 65;
  const crowdedFootprint =
    leg.pairs >= 3 &&
    spine.rear < 25 &&
    leg.splay < 27 &&
    ((leg.to - leg.from) * spine.length) / (leg.pairs - 1) <
      2.35 * spine.girth * leg.girth;
  if (crowdedFootprint) {
    const stationSpan = Math.max(0.55, leg.to - leg.from);
    spine.length = Math.min(
      3,
      Math.max(
        spine.length,
        ((leg.pairs - 1) * 2.35 * spine.girth * leg.girth) / stationSpan,
      ),
    );
    leg.girth *= 0.78;
    leg.splay = Math.max(leg.splay, 14);
    spine.bulge[1] *= 0.9;
    spine.bulge[3] *= 1.04;
    head.neck = Math.max(head.neck, spine.girth * 1.23);
    head.neckPitch = Math.min(head.neckPitch, 30);
    if (head.eyes === 1 && head.eyePlace === "front") {
      head.eyePlace = "top";
      head.eyeSize = Math.max(head.eyeSize, 1.16);
    }
  }
  if (upright && leg.pairs === 1 && leg.style === "pillar") {
    spine.rear = MathUtils.lerp(44, 64, (spine.rear - 65) / 25);
    spine.front = MathUtils.lerp(22, 42, (spine.front - 65) / 27);
    spine.arch = Math.max(4, spine.arch);
    spine.bulge[0] *= 1.08;
    spine.bulge[1] *= 0.91;
    spine.bulge[3] *= 1.13;
    leg.splay = Math.max(14, leg.splay);
    head.neck = Math.max(head.neck, 0.9 * spine.girth);
    head.neckPitch = Math.min(32, head.neckPitch);
    if (!["none", "stub"].includes(plan.tail.kind))
      plan.tail.length = Math.max(plan.tail.length, 0.73 * spine.length);
    plan.details = plan.details.filter(
      (detail) => detail !== "belly plates" || plan.back.kind !== "fins",
    );
  }
  if (upright && leg.pairs >= 3 && leg.style === "insect" && wing) {
    spine.rear = 8 + 0.13 * (spine.rear - 65);
    spine.front = 36 + 0.7 * (spine.front - 65);
    spine.length = Math.max(
      spine.length,
      spine.girth * (4.1 + 0.62 * leg.pairs),
    );
    spine.arch = Math.min(8, spine.arch);
    spine.flat = Math.max(1.12, spine.flat);
    leg.from = 0.13;
    leg.to = 0.86;
    leg.fan = Math.min(leg.fan, 113);
    leg.girth *= 0.72;
    head.neck = MathUtils.clamp(
      head.neck,
      0.9 * spine.girth,
      1.5 * spine.girth,
    );
    head.neckPitch = Math.min(32, head.neckPitch);
    head.stalks *= 0.5;
    wing.from = wing.to = Math.max(wing.from, 0.7);
    wing.rise = Math.max(36, wing.rise);
    plan.details = plan.details.filter(
      (x) => !["shoulder spikes", "spurs", "belly plates"].includes(x),
    );
  }
  if (leg.end === "paddle" && leg.side === "both") {
    const ankleFraction = {
      pillar: 0.496,
      mammal: 0.2116,
      bird: 0.2116,
      insect: 0.138,
    }[leg.style];
    const halfSpan = 3 * spine.girth * leg.girth * ankleFraction;
    if (halfSpan > 0.6 * spine.stance) {
      leg.girth = Math.max(0.3, leg.girth * 0.6 * spine.stance / halfSpan);
      leg.splay = Math.max(leg.splay, 27);
    }
  }
  if (["bill", "beak", "trunk"].includes(head.snout))
    for (const arm of limbs.filter(
      (l) =>
        l.kind === "arm" &&
        l.end === "pincer" &&
        l.from > 0.48 &&
        l.drop < 50 &&
        l.forward > 25,
    )) {
      arm.drop = Math.max(64, arm.drop);
      arm.forward = Math.min(24, arm.forward);
    }
  return plan;
}
