import type { AccessoryStyle } from "./accessory-style.js";
import { fittedFan } from "./fan.js";
import { fittedWaistBag } from "./waist-bag.js";
import type { Raster } from "../../raster.js";
import { fittedHeadwear } from "./headwear.js";
import * as T from "three";
import type { HumanBody } from "../body.js";
import { fittedEarrings } from "./earrings.js";
import type { HumanSurface } from "../surface.js";

export type { AccessoryStyle } from "./accessory-style.js";
export function fittedAccessories(
  body: HumanBody,
  s: HumanSurface,
  style: AccessoryStyle | undefined,
  material: (tone: string, type: string) => T.Material,
  plain = false,
  clothing: readonly T.Mesh[] = [],
  raster?: Raster,
) {
  const pieces: {
    mesh: T.Mesh;
    region: string;
    skin?: { boneIndices: ArrayLike<number>; weights: ArrayLike<number> };
  }[] = [];
  if (
    !style ||
    ![style.hat, style.earrings, style.waistBag, style.handProp, style.facialHair].some(
      (v) => v && v !== "None",
    )
  )
    return pieces;
  pieces.push(...fittedEarrings(body, s, style, material, plain));
  pieces.push(
    ...fittedHeadwear(
      body,
      s,
      style.hat,
      style.hatColor ??
        (style.hat === "Flying cap and goggles"
          ? "#6c4d39"
          : style.hat === "Ribbed watch cap"
            ? "#674e39"
            : (style.clothSecond ?? "#5a4a3c")),
      "hat",
      material,
      plain,
    ),
  );
  pieces.push(
    ...fittedHeadwear(
      body,
      s,
      style.facialHair,
      style.hairColor ?? "#51433b",
      "facialHair",
      material,
      plain,
    ),
  );
  for (const piece of fittedWaistBag(s, style, clothing, material, plain))
    pieces.push({
      mesh: piece.mesh,
      region: piece.region,
      skin: { boneIndices: piece.boneIndices, weights: piece.weights },
    });
  pieces.push(
    ...fittedFan(s, style, material, plain, raster).map((mesh) => ({ mesh, region: "hand_r" })),
  );
  return pieces;
}
