import * as T from "three";
import { isMesh } from "../mesh.js";
import {
  carry,
  followers,
  plantFeet,
  poseLimbs,
  scopes,
  spread,
  tipReach,
  type Limb,
  type PoseLimbs,
  type PoseScope,
  type TipReach,
} from "./limb-pose.js";
import type { JointBinding } from "./poses.js";
import type { Rig } from "./skin.js";
import { wristReach, type ElbowDirection, type WristReach } from "./wrist-reach.js";

export type PoseTool = "rotate" | "translate" | "reach" | "tip";

export interface PoseChoice {
  readonly key: string;
  readonly tool: PoseTool;
  readonly scopes: ReadonlyArray<PoseScope>;
  readonly scope: PoseScope;
  readonly canReach: boolean;
  readonly canTip: boolean;
  readonly canPlant: boolean;
  readonly plant: boolean;
  readonly guided: boolean;
}

type Snapshot = ReadonlyArray<readonly [T.Bone, T.Vector3, T.Quaternion]>;

const scopeLabels = { leg: "legs", arm: "arms", wing: "wings", fin: "fins", tail: "tails" };

export function scopeLabel(scope: PoseScope, limb: Limb | undefined, count: number): string {
  if (scope === "one") return "This joint only";
  if (scope === "pair") return "Left and right together";
  return "All " + count + " " + (limb ? scopeLabels[limb.kind] : "limbs");
}

export class PoseSession {
  readonly target = new T.Object3D();
  readonly limbs: PoseLimbs;
  readonly plantable: boolean;
  private readonly rig: Rig;
  private chosen: JointBinding | undefined;
  private reach: WristReach | undefined;
  private tips: TipReach[] | undefined;
  private following: Limb[] = [];
  private planted: { hold(): number } | undefined;
  private last: { turn: T.Quaternion; place: T.Vector3 } | undefined;
  private history: Snapshot[] = [];
  private dragStart: Snapshot | undefined;
  tool: PoseTool = "rotate";
  scope: PoseScope = "one";
  plant: boolean;
  elbow: ElbowDirection = "original";
  roll = 0;
  note = "";

  constructor(rig: Rig, creaturePlan: boolean) {
    this.rig = rig;
    rig.actor.updateMatrixWorld(true);
    this.limbs = poseLimbs(rig.regions, rig.bindings);
    this.plantable = this.limbs.limbs.some((l) => l.kind === "leg" && l.chain);
    this.plant = this.plantable && creaturePlan;
  }

  get undoable(): boolean {
    return this.history.length > 0;
  }

  get guiding(): boolean {
    return (this.tool === "reach" && !!this.reach) || (this.tool === "tip" && !!this.tips?.length);
  }

  get joint(): T.Bone | undefined {
    return this.chosen?.bone;
  }

  limb(): Limb | undefined {
    return this.chosen && this.limbs.joints.get(this.chosen)?.limb;
  }

  choose(
    key: string,
    tool = this.tool,
    scope = this.scope,
    plant = this.plant,
  ): PoseChoice | undefined {
    const binding = this.rig.bindings.get(key);
    if (!binding) return undefined;
    this.rig.actor.updateMatrixWorld(true);
    this.chosen = binding;
    const part = binding.address.part;
    this.reach =
      binding.address.digit || part === null
        ? undefined
        : wristReach(this.rig.regions, this.rig.bindings, part);
    const limb = this.limb();
    if (tool === "reach" && !this.reach) tool = "rotate";
    if (tool === "tip" && !limb?.chain) tool = "rotate";
    this.tool = tool;
    const options = scopes(this.limbs.limbs, limb);
    this.scope = options.includes(scope) ? scope : "one";
    this.plant = this.plantable && plant;
    this.following = followers(this.limbs.limbs, limb, this.scope);
    const posed = limb ? [limb, ...this.following] : [];
    this.planted = this.plant ? plantFeet(this.limbs.limbs, posed) : undefined;
    this.tips = tool === "tip" ? posed.flatMap((l) => tipReach(l) ?? []) : undefined;
    this.track();
    this.elbow = "original";
    this.roll = 0;
    const start = tool === "reach" ? this.reach?.initial : this.tips?.[0]?.initial;
    if (start) this.target.position.copy(start);
    this.target.updateMatrixWorld();
    return {
      key,
      tool,
      scopes: options,
      scope: this.scope,
      canReach: !!this.reach,
      canTip: !!limb?.chain,
      canPlant: this.plantable,
      plant: this.plant,
      guided: this.guiding,
    };
  }

  scopeLabel(scope: PoseScope): string {
    const limb = this.limb();
    return scopeLabel(
      scope,
      limb,
      limb ? this.limbs.limbs.filter((l) => l.kind === limb.kind).length : 0,
    );
  }

  private track() {
    this.last = this.chosen && {
      turn: this.chosen.bone.quaternion.clone(),
      place: this.chosen.bone.position.clone(),
    };
  }

  follow() {
    if (!this.chosen || !this.last) return;
    spread(this.rig.bindings, this.limbs.joints, this.chosen, this.last, this.following);
    this.track();
    this.planted?.hold();
    this.rig.actor.updateMatrixWorld(true);
  }

  guide(): string {
    if (this.tool === "reach") return this.guideWrist();
    if (this.tool === "tip") return this.guideTip();
    this.follow();
    return "";
  }

  private guideWrist(): string {
    if (!this.reach) return "";
    const miss = this.reach.solve(
      this.target.position,
      T.MathUtils.clamp(Number.isFinite(this.roll) ? this.roll : 0, -180, 180),
      this.elbow,
    );
    this.rig.actor.updateMatrixWorld(true);
    this.note =
      miss > 0.001
        ? "At full reach, " + (miss * 100).toFixed(1) + " cm from the target."
        : "Wrist reached the target. The hand kept its orientation.";
    return this.note;
  }

  private guideTip(): string {
    const [first, ...rest] = this.tips ?? [];
    const limb = this.limb();
    if (!first || !limb) return "";
    const offset = this.target.position.clone().sub(first.initial);
    let miss = first.solve(this.target.position);
    for (const tip of rest)
      miss = Math.max(miss, tip.solve(tip.initial.clone().add(carry(limb, tip.limb).move(offset))));
    this.planted?.hold();
    this.rig.actor.updateMatrixWorld(true);
    this.note =
      miss > 0.001
        ? "At full reach, " + (miss * 100).toFixed(1) + " cm from the target."
        : rest.length
          ? rest.length + 1 + " limb tips moved together."
          : "The limb tip reached the target.";
    return this.note;
  }

  nudge(axis: "x" | "y" | "z", amount: number) {
    if (!this.chosen || !amount) return;
    const before = this.snapshot();
    const direction = new T.Vector3();
    direction[axis] = 1;
    if (this.guiding) {
      this.target.position.addScaledVector(direction, amount);
      this.target.updateMatrixWorld();
      this.guide();
    } else {
      if (this.tool === "rotate")
        this.chosen.bone.rotateOnAxis(direction, T.MathUtils.degToRad(amount));
      else this.chosen.bone.translateOnAxis(direction, amount);
      this.follow();
    }
    this.remember(before);
  }

  relax() {
    if (!this.chosen) return;
    const before = this.snapshot();
    this.chosen.bone.position.copy(this.chosen.position);
    this.chosen.bone.quaternion.copy(this.chosen.rotation);
    this.follow();
    this.remember(before);
  }

  reguide() {
    const before = this.snapshot();
    this.guide();
    this.remember(before);
  }

  pickSurface(ray: T.Raycaster): boolean {
    const meshes: T.Object3D[] = [];
    for (const node of this.rig.actor.children)
      if (isMesh(node)) {
        if (node instanceof T.SkinnedMesh) {
          node.computeBoundingSphere();
          node.computeBoundingBox();
        }
        meshes.push(node);
      }
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) {
      this.note = "Choose a point on the character surface.";
      return false;
    }
    const before = this.snapshot();
    this.target.position.copy(hit.point);
    this.target.updateMatrixWorld();
    this.guide();
    this.remember(before);
    return true;
  }

  beginDrag() {
    this.dragStart = this.snapshot();
  }

  endDrag() {
    if (this.dragStart) this.remember(this.dragStart);
    this.dragStart = undefined;
  }

  undo(): boolean {
    const before = this.history.pop();
    if (!before) return false;
    for (const [bone, place, turn] of before) {
      bone.position.copy(place);
      bone.quaternion.copy(turn);
    }
    this.rig.actor.updateMatrixWorld(true);
    if (this.chosen) {
      const key = [...this.rig.bindings].find(([, b]) => b === this.chosen)?.[0];
      if (key) this.choose(key);
    }
    return true;
  }

  private snapshot(): Snapshot {
    return [...this.rig.bindings.values()].map(
      (b) => [b.bone, b.bone.position.clone(), b.bone.quaternion.clone()] as const,
    );
  }

  private remember(before: Snapshot) {
    const changed = before.some(
      ([bone, place, turn]) =>
        bone.position.distanceToSquared(place) > 1e-14 ||
        1 - Math.abs(bone.quaternion.dot(turn)) > 1e-12,
    );
    if (!changed) return;
    this.history.push(before);
    if (this.history.length > 48) this.history.shift();
  }
}
