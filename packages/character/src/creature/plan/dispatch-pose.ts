import { Bone, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { chainReach } from "../../rig/chain-reach.js";
import { gripCentre, gripRadius, palmDimensions } from "./grip.js";
import { need } from "./need.js";
import type { Form, FormPart, FormPose } from "./types.js";

export const dispatchPoseName = "Present dispatch";
const radians = Math.PI / 180;
interface Frame {
  at: Vector3;
  q: Quaternion;
}
const euler = (r: readonly number[]) =>
  new Euler((r[0] ?? 0) * radians, (r[1] ?? 0) * radians, (r[2] ?? 0) * radians);
const degrees = (q: Quaternion) => {
  const e = new Euler().setFromQuaternion(q);
  return [e.x / radians, e.y / radians, e.z / radians];
};
export function dispatchHand(
  form: Form,
  side = "left",
  unavailable?: Set<string>,
): FormPart | undefined {
  const hands = form.parts.filter(
    (p) =>
      !unavailable?.has(p.id) &&
      p.shape === "hand" &&
      p.motionRole === "hand" &&
      (p.grip?.fingers ?? 0) >= 2 &&
      /^(left|right) arm /.test(p.id),
  );
  return hands.find((p) => p.id.startsWith(side + " ")) ?? hands[0];
}
function restFrames(parts: FormPart[]) {
  const by = new Map(parts.map((p) => [p.id, p])),
    cache = new Map<string, Frame>();
  const get = (id: string): Frame => {
    const known = cache.get(id);
    if (known) return known;
    const p = need(by.get(id)),
      parent = p.parent ? get(p.parent) : null;
    const at = new Vector3().fromArray(p.position),
      q = new Quaternion().setFromEuler(euler(p.rotation));
    if (parent) {
      at.applyQuaternion(parent.q).add(parent.at);
      q.premultiply(parent.q);
    }
    const frame = { at, q };
    cache.set(id, frame);
    return frame;
  };
  return get;
}
function orientation(axis: Vector3, normal: Vector3) {
  const z = new Vector3().crossVectors(axis, normal).normalize();
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(axis, z.clone().cross(axis), z),
  );
}
export function handHandle(hand: FormPart) {
  const scale = hand.size.map((n, i) => n / need(palmDimensions[i]));
  return {
    centre: new Vector3().fromArray(gripCentre.map((n, i) => n * need(scale[i]))),
    radius: gripRadius * 0.5 * (need(scale[1]) + need(scale[2])),
    length: need(hand.size[0]) * 1.48,
  };
}

export function placeInHand(
  form: Form,
  hand: FormPart,
  tube: FormPart,
  sourceGrip: Vector3,
  axis: Vector3,
  radial: Vector3,
) {
  const fingers = handHandle(hand),
    source = orientation(axis, radial),
    side = hand.id.startsWith("left") ? 1 : -1;
  const target = orientation(new Vector3(side, 0, 0), new Vector3(0, 0, -1));
  const rot = target.multiply(source.invert());
  const frames = restFrames(form.parts),
    tubeOrigin = frames(tube.id).at;
  tube.parent = hand.id;
  tube.position = tubeOrigin.sub(sourceGrip).applyQuaternion(rot).add(fingers.centre).toArray();
  tube.rotation = degrees(rot);
  hand.grip = { ...hand.grip, cylindrical: true, spread: 0 };
  const carry = dispatchArmPose(form, hand, false);
  if (carry) bindCarry(form, carry);
  const held = form.parts.find((p) => p.id === hand.id);
  const pose = held && dispatchArmPose(form, held, true);
  if (pose) form.poses = [...(form.poses ?? []).filter((p) => p.name !== dispatchPoseName), pose];
}
function dispatchArmPose(form: Form, hand: FormPart, present: boolean): FormPose | null {
  const fore = form.parts.find((p) => p.id === hand.parent),
    upper = form.parts.find((p) => p.id === fore?.parent);
  if (!fore || !upper) return null;
  const frames = restFrames(form.parts),
    shoulder = frames(upper.id).at,
    elbow = frames(fore.id).at,
    wrist = frames(hand.id);
  const carrier = new Bone(),
    a = new Bone(),
    b = new Bone(),
    c = new Bone();
  carrier.add(a);
  a.add(b);
  b.add(c);
  a.position.copy(shoulder);
  b.position.subVectors(elbow, shoulder);
  c.position.subVectors(wrist.at, elbow);
  carrier.updateMatrixWorld(true);
  const solve = chainReach([a, b, c], "arm");
  if (!solve) return null;
  const side = hand.id.startsWith("left") ? 1 : -1,
    reach = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist.at);
  const aim = present ? new Vector3(0.46 * side, -0.025, 1) : new Vector3(0.35 * side, -0.49, 0.11);
  solve.solve(shoulder.clone().addScaledVector(aim.normalize(), reach * (present ? 0.97 : 0.52)));
  const cap = present
    ? new Vector3(side * 0.35, 0.08, 0.94)
    : new Vector3(side * 0.14, 0.78, -0.57);
  const across = cap.normalize().multiplyScalar(side);
  const palmUp = present ? new Vector3(side * 0.45, 0.92, 0) : new Vector3(side, 0, 0.24);
  const fingerDirection = new Vector3().crossVectors(palmUp, across).normalize();
  const palm = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(
      across,
      fingerDirection,
      across.clone().cross(fingerDirection).normalize(),
    ),
  );
  const total = palm.multiply(wrist.q.clone().invert());
  c.quaternion.copy(b.getWorldQuaternion(new Quaternion()).invert().multiply(total));
  const rows: [FormPart, Bone][] = [
    [upper, a],
    [fore, b],
    [hand, c],
  ];
  return {
    name: dispatchPoseName,
    joints: rows.map(([p, bone]) => ({ part: p.id, station: 0, turn: bone.quaternion.toArray() })),
  };
}

function bindCarry(form: Form, pose: FormPose) {
  const frames = restFrames(form.parts);
  const rotations = pose.joints.map((row): [string, number[]] => {
    const p = need(form.parts.find((part) => part.id === row.part));
    const parent = frames(need(p.parent)).q.clone(),
      local = new Quaternion().setFromEuler(euler(p.rotation));
    local.premultiply(
      parent
        .clone()
        .invert()
        .multiply(new Quaternion().fromArray(row.turn ?? [0, 0, 0, 1]))
        .multiply(parent),
    );
    return [p.id, degrees(local)];
  });
  for (const [id, rotation] of rotations) {
    const index = form.parts.findIndex((p) => p.id === id);
    form.parts[index] = { ...need(form.parts[index]), rotation };
  }
}
