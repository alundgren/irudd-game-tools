import type { EarringStyle } from "./earrings.js";
export interface AccessoryStyle extends EarringStyle {
  readonly accentColor?: string;
  readonly clothLight?: string;
  readonly hat?: string;
  readonly hatColor?: string;
  readonly waistBag?: string;
  readonly facialHair?: string;
  readonly handProp?: string;
  readonly hairColor?: string;
  readonly leatherColor?: string;
  readonly clothSecond?: string;
}
