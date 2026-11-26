import * as T from "three";
import type { JointPose, PoseJoint } from "@irudd/document";
import { isMesh } from "../mesh.js";
import { gazeNames } from "../surfaces/eyes.js";
import { expressions } from "./expressions.js";
import { poseClipName } from "./poses.js";
import type { Rig } from "./skin.js";

export class MotionPreview {
  readonly rig: Rig;
  readonly clips: T.AnimationClip[];
  readonly morphs = new Set<string>();
  readonly mixer: T.AnimationMixer;
  private readonly faces: T.Mesh[] = [];
  private readonly standing: { bone: T.Bone; at: T.Vector3; turn: T.Quaternion }[];
  private clip: T.AnimationClip | undefined;
  expression = "Rest";
  strength = 1;
  gaze: [number, number] = [0, 0];
  playing = false;
  time = 0;
  name = "Rest";

  constructor(rig: Rig) {
    this.rig = rig;
    this.mixer = new T.AnimationMixer(rig.actor);
    this.standing = rig.skeleton.bones.map((bone) => ({
      bone,
      at: bone.position.clone(),
      turn: bone.quaternion.clone(),
    }));
    this.clips = [...rig.clips];
    const gazeTracks: T.KeyframeTrack[] = [];
    rig.actor.traverse((node) => {
      if (!isMesh(node) || !node.morphTargetDictionary) return;
      this.faces.push(node);
      for (const name of Object.keys(node.morphTargetDictionary)) this.morphs.add(name);
      for (const [i, name] of gazeNames.entries()) {
        if (node.morphTargetDictionary[name] === undefined) continue;
        const values = [0, 0, 0, 0, 0, 0];
        values[i + 1] = 1;
        gazeTracks.push(
          new T.NumberKeyframeTrack(
            node.name + ".morphTargetInfluences[" + name + "]",
            [0, 0.6, 1.2, 1.8, 2.4, 3],
            values,
          ),
        );
      }
    });
    if (gazeTracks.length) this.clips.push(new T.AnimationClip("Gaze", 3, gazeTracks));
  }

  select(name: string) {
    this.playing = false;
    this.mixer.stopAllAction();
    for (const { bone, at, turn } of this.standing) {
      bone.position.copy(at);
      bone.quaternion.copy(turn);
    }
    if (name === "Fitting pose")
      for (const b of this.rig.bindings.values()) {
        b.bone.position.copy(b.position);
        b.bone.quaternion.copy(b.rotation);
      }
    this.name = name;
    this.clip = this.clips.find((c) => c.name === name);
    if (this.clip) this.mixer.clipAction(this.clip).reset().play();
    this.seek(0);
  }

  seek(fraction: number) {
    this.time = T.MathUtils.clamp(fraction, 0, 1);
    if (this.clip) this.mixer.setTime(Math.min(this.time, 1 - 1e-8) * this.clip.duration);
    this.face();
  }

  advance(seconds: number) {
    if (this.playing && this.clip) this.seek((this.time + seconds / this.clip.duration) % 1);
  }

  setFace(expression: string, strength: number, x: number, y: number) {
    this.expression = expression;
    this.strength = strength;
    this.gaze = [x, y];
    for (const mesh of this.faces) for (const name of expressions) this.weight(mesh, name, 0);
    if (this.clip) this.mixer.update(0);
    this.face();
  }

  private weight(mesh: T.Mesh, name: string, value: number) {
    const index = mesh.morphTargetDictionary?.[name];
    if (index !== undefined && mesh.morphTargetInfluences)
      mesh.morphTargetInfluences[index] = value;
  }

  private face() {
    const [x, y] = this.gaze;
    const values = [x, -x, y, -y];
    for (const mesh of this.faces) {
      if (this.name !== "Gaze")
        gazeNames.forEach((n, i) => this.weight(mesh, n, Math.max(0, values[i] ?? 0)));
      if (this.expression !== "Rest") this.weight(mesh, this.expression, this.strength);
    }
  }

  adjust(key: string, mode: string, axis: "x" | "y" | "z", amount: number) {
    const b = this.rig.bindings.get(key);
    if (!b) return;
    this.playing = false;
    const direction = new T.Vector3();
    direction[axis] = 1;
    if (mode === "Rotate") b.bone.rotateOnAxis(direction, T.MathUtils.degToRad(amount));
    else if (mode === "Move") b.bone.translateOnAxis(direction, amount);
    else {
      b.bone.position.copy(b.position);
      b.bone.quaternion.copy(b.rotation);
    }
  }

  capture(name: string, saved: readonly JointPose[]): JointPose {
    const joints: PoseJoint[] = [];
    for (const b of this.rig.bindings.values()) {
      const turn = b.rotation.clone().invert().multiply(b.bone.quaternion).normalize();
      const shift = b.bone.position.clone().sub(b.position);
      const rotated = 1 - Math.abs(turn.w) > 1e-10,
        moved = shift.lengthSq() > 1e-12;
      if (rotated || moved)
        joints.push({
          ...b.address,
          ...(rotated ? { turn: turn.toArray() } : {}),
          ...(moved ? { shift: shift.toArray() } : {}),
        });
    }
    const previous = saved.find((p) => poseClipName(p.name) === this.name);
    for (const joint of previous?.joints ?? []) {
      if (
        !this.rig.bindings.has(JSON.stringify([joint.part ?? "", joint.station, joint.digit ?? ""]))
      )
        joints.push(joint);
    }
    return { name, joints };
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rig.actor);
    this.rig.dispose();
  }
}
