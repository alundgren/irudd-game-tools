import type * as T from "three";
import type { BoneName } from "./catalogue.js";
import type { HumanAdultParams } from "./generator.js";
import type { HumanWeights } from "./mesh.js";

export interface HumanBuild {
  readonly bones: ReadonlyMap<string, BoneName>;
  readonly weights: (mesh: T.Mesh) => HumanWeights | undefined;
  readonly params: HumanAdultParams;
}
