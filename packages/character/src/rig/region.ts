import type * as T from "three";
import type { MotionRoleName, OutfitRoleName } from "@irudd/document";
import type { BuildPart } from "../view.js";
import type { Digit } from "../surfaces/hand.js";

export type RigRole = MotionRoleName | OutfitRoleName;

export interface Finger extends Digit {
  readonly chain: ReadonlyArray<T.Bone>;
  readonly axis: T.Vector3;
}

export interface Region {
  readonly part: BuildPart;
  readonly role: RigRole;
  readonly object: T.Object3D;
  readonly meshes: T.Mesh[];
  readonly bounds: T.Box3;
  points: T.Vector3[];
  bones: T.Bone[];
  fingers: Map<T.Mesh, Finger[]>;
}
