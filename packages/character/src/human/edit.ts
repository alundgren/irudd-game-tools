import type { HumanBody } from "./body.js";
import { castSkin } from "./cast.js";
import { randomHuman } from "./draw.js";
import { humanWornCast, type HumanAdultParams } from "./generator.js";
import { measurementGroups, type MeasurementRegion } from "./measurements.js";
import { humanRange, isHumanAxis, type HumanAxis } from "./surface.js";

export function changeMeasurement(
  params: HumanAdultParams,
  axis: HumanAxis,
  value: number,
): HumanAdultParams {
  const [min, max] = humanRange(axis);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`Keep ${axis} between ${min} and ${max}.`);
  return { ...params, human: { ...params.human, [axis]: value } };
}

export function rerollRegion(
  body: HumanBody,
  params: HumanAdultParams,
  region: MeasurementRegion,
  seed: number,
  strength?: "subtle" | "exploratory" | "radical",
): HumanAdultParams {
  const draw = randomHuman(body, seed, "any", { relaxed: false });
  const human = { ...params.human };
  for (const key of Object.keys(measurementGroups[region])) {
    const value = draw[key];
    if (value === undefined || !isHumanAxis(key)) continue;
    const amount = strength === "subtle" ? 0.25 : strength === "exploratory" ? 0.65 : 1;
    const from = human[key] ?? humanRange(key)[2];
    human[key] = amount === 1 ? value : from + (value - from) * amount;
  }
  return { ...params, human };
}

export function skinTone(params: HumanAdultParams): string {
  const cast = humanWornCast(params);
  return (cast && (params.style.castSkin ?? castSkin(cast))) || params.skin;
}

export function tintSkin(params: HumanAdultParams, skin: string): HumanAdultParams {
  if (humanWornCast(params)) return { ...params, style: { ...params.style, castSkin: skin } };
  return { ...params, sourceSkin: params.sourceSkin ?? params.skin, skin };
}

export function restoreSkin(params: HumanAdultParams): HumanAdultParams {
  const cast = humanWornCast(params);
  const tone = cast && castSkin(cast);
  if (tone) return { ...params, style: { ...params.style, castSkin: tone } };
  const { sourceSkin, ...rest } = params;
  return { ...rest, skin: sourceSkin ?? params.skin };
}
