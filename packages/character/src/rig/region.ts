// A skinned region: the meshes of one document part and the bones that drive them.

import type * as T from "three";
import type { MotionRoleName, OutfitRoleName } from "@irudd/document";
import type { BuildPart } from "../view.js";
import type { Digit } from "../surfaces/hand.js";

export type RigRole = MotionRoleName | OutfitRoleName;

/** A hand digit with its three joints. */
export interface Finger extends Digit {
  readonly chain: ReadonlyArray<T.Bone>;
  /** The axis the digit curls about, in world space. */
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
  /** Digit chains of the region's hand meshes. */
  fingers: Map<T.Mesh, Finger[]>;
}
