import { MathUtils } from "three";
import { randomStream } from "../../random.js";
import { need } from "./need.js";
import type { Plan, Skin } from "./types.js";

export const coatFamilies = ["plumage", "pelt", "scutes", "wet skin"] as const;
type CoatFamily = (typeof coatFamilies)[number];
type Coat = NonNullable<Skin["coat"]>;
const { clamp } = MathUtils;
export function readCreatureCoat(raw: unknown): Coat | null {
  if (typeof raw !== "object" || raw === null) return null;
  const family = coatFamilies.find((f) => "family" in raw && f === raw.family);
  if (!family) return null;
  const field = (key: string): unknown => (key in raw ? Reflect.get(raw, key) : undefined);
  const bounded = (n: unknown, a: number, b: number, fallback: number) =>
    typeof n === "number" && Number.isFinite(n) ? clamp(n, a, b) : fallback;
  return {
    family,
    ...(field("graded") === true ? { graded: true as const } : {}),
    contrast: bounded(field("contrast"), 0, 1, 0.76),
    density: bounded(field("density"), 0.55, 1.8, 1),
    seed: Math.floor(bounded(field("seed"), 0, 0xffffffff, 1)),
  };
}
export function drawCreatureCoat(plan: Plan, seed: number): Skin {
  const draw = randomStream((seed ^ 0x4f8b2a13) >>> 0);
  const has = (kind: string, style?: string) =>
    plan.limbs.some(
      (l) =>
        l.kind === kind &&
        (!style ||
          ("style" in l && l.style === style) ||
          ("structure" in l && l.structure === style)),
    );
  const options: CoatFamily[] =
    plan.back.kind === "shag mantle"
      ? ["pelt"]
      : has("wing", "feather")
        ? ["plumage"]
        : plan.back.kind === "shingles"
          ? ["scutes", "scutes", "plumage"]
          : has("fin") || plan.back.kind === "gill fans"
            ? ["wet skin", "wet skin", "scutes"]
            : has("leg", "insect")
              ? ["scutes", "wet skin"]
              : plan.head.snout === "beak" || has("leg", "bird")
                ? ["plumage", "plumage", "scutes"]
                : ["pelt", "pelt", "wet skin", "scutes"];
  const family = need(options[Math.floor(draw() * options.length)]);
  return {
    ...plan.skin,
    coat: {
      family,
      graded: true,
      contrast: 0.68 + 0.27 * draw(),
      density: 0.76 + 0.52 * draw(),
      seed: Math.floor(draw() * 4294967296),
    },
  };
}
