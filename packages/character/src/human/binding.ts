// What the skin needs to bind an adult, apart from the builder so the rig and
// the cloth joints read it without depending on the build.

import type * as T from "three";
import type { BoneName } from "./catalogue.js";
import type { HumanAdultParams } from "./generator.js";
import type { HumanWeights } from "./mesh.js";

/** What the skin needs to bind an adult: each region's bone and the pieces' authored weights. */
export interface HumanBuild {
  readonly bones: ReadonlyMap<string, BoneName>;
  readonly weights: (mesh: T.Mesh) => HumanWeights | undefined;
  readonly params: HumanAdultParams;
}
