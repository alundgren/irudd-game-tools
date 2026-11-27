import type { Piece, Shell } from "./kit.js";
import type { TailorLayer } from "./tailor-data.js";
export interface BreastplateFit {
  readonly layer: TailorLayer;
  readonly ribs: number;
  readonly centreZ: number;
  readonly bottom: number;
  readonly top: number;
}
export interface TailoredPart {
  readonly piece: Piece;
  readonly tone: string;
  readonly region: string;
  readonly name: string;
  readonly type: string;
  readonly mantleFinish?: TailorLayer;
  readonly stamping?: TailorLayer;
  readonly cover?: Shell;
  readonly shell?: Shell;
  readonly hem?: number;
  readonly ground?: number;
  readonly breastplate?: BreastplateFit;
}
