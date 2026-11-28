import * as T from "three";
import type { JointBinding } from "./poses.js";
import type { Region, RigRole } from "./region.js";
import { chainReach, type LimbKind } from "./chain-reach.js";

const families: ReadonlyArray<readonly [LimbKind, ReadonlyArray<RigRole>]> = [
  ["leg", ["thigh", "shin", "foot"]],
  ["arm", ["upper arm", "forearm", "hand"]],
  ["wing", ["wing"]],
  ["fin", ["fin"]],
  ["tail", ["tail"]],
];
const family = (role: RigRole | undefined): LimbKind | undefined =>
  role === undefined ? undefined : families.find(([, roles]) => roles.includes(role))?.[0];
const jointKey = (part: string, station: number) => JSON.stringify([part, station, ""]);
const up = new T.Vector3(0, 1, 0);
const mirrorTurn = (q: T.Quaternion) => new T.Quaternion(q.x, -q.y, -q.z, q.w);
const mirrorMove = (v: T.Vector3) => new T.Vector3(-v.x, v.y, v.z);

export interface Limb {
  readonly id: string;
  readonly kind: LimbKind;
  readonly root: Region;
  readonly joints: Map<string, string>;
  readonly parts: Region[];
  readonly side: number;
  readonly bearing: number | null;
  readonly hip: T.Vector3;
  readonly reach: number;
  layers: number;
  chain: readonly [T.Bone, T.Bone, T.Bone] | undefined;
  twin: Limb | undefined;
}

export interface LimbJoint {
  readonly limb: Limb;
  readonly place: string;
}

export interface PoseLimbs {
  readonly limbs: ReadonlyArray<Limb>;
  readonly joints: ReadonlyMap<JointBinding, LimbJoint>;
}

export function poseLimbs(
  regions: ReadonlyMap<string, Region>,
  bindings: ReadonlyMap<string, JointBinding>,
): PoseLimbs {
  const all = [...regions.values()];
  const children = (id: string) => all.filter((r) => r.part.parent === id);
  const limbs: Limb[] = [];
  const owner = new Map<string, [Limb, string, number]>();
  for (const root of all) {
    const kind = family(root.role);
    const parent = root.part.parent === null ? undefined : regions.get(root.part.parent);
    if (!kind || family(parent?.role) === kind) continue;
    const hip = root.points[0];
    if (!hip) continue;
    const parts: Region[] = [];
    const paths: [Region, string][] = [];
    const walk = (region: Region, path: string) => {
      parts.push(region);
      paths.push([region, path]);
      const seen = new Map<string, number>();
      for (const child of children(region.part.id)) {
        const label = child.role + "/" + child.part.shape;
        const n = seen.get(label) ?? 0;
        seen.set(label, n + 1);
        walk(child, path + ">" + label + "#" + n);
      }
    };
    walk(root, "");
    let tip = hip;
    for (const region of parts)
      for (const p of region.points)
        if (p.distanceToSquared(hip) > tip.distanceToSquared(hip)) tip = p;
    const reach = tip.distanceTo(hip);
    const side = Math.abs(hip.x) < 0.004 ? 0 : Math.sign(hip.x);
    const out = (tip.x - hip.x) * (side || 1),
      along = tip.z - hip.z;
    const bearing = Math.hypot(out, along) > 0.25 * reach ? Math.atan2(along, out) : null;
    const whole = limbs.find(
      (l) =>
        l.kind === kind &&
        (kind === "wing" || kind === "fin") &&
        l.side === side &&
        l.root.part.parent === root.part.parent &&
        l.hip.distanceTo(hip) < 0.3 * Math.max(l.reach, reach),
    );
    if (whole) {
      const layer = ++whole.layers;
      for (const [region, path] of paths) {
        whole.parts.push(region);
        owner.set(region.part.id, [whole, path, layer]);
      }
      continue;
    }
    const limb: Limb = {
      id: root.part.id,
      kind,
      root,
      joints: new Map(),
      parts,
      side,
      bearing,
      hip,
      reach,
      layers: 0,
      chain: undefined,
      twin: undefined,
    };
    for (const [region, path] of paths) owner.set(region.part.id, [limb, path, 0]);
    limbs.push(limb);
  }
  const joints = new Map<JointBinding, LimbJoint>();
  for (const [address, binding] of bindings) {
    const { part, station, digit } = binding.address;
    const found = part === null ? undefined : owner.get(part);
    if (!found) continue;
    const [limb, path, layer] = found;
    const place = path + "|" + station + "|" + (digit ?? "");
    limb.joints.set(layer + ":" + place, address);
    joints.set(binding, { limb, place });
  }
  const bone = (region: Region, station: number) =>
    bindings.get(jointKey(region.part.id, station))?.bone;
  for (const limb of limbs) {
    if (limb.kind !== "leg" && limb.kind !== "arm") continue;
    const first = limb.root;
    const second = children(first.part.id).find(
      (r) => r.role === (limb.kind === "leg" ? "shin" : "forearm"),
    );
    let chain: (T.Bone | undefined)[] | undefined;
    if (second?.points.length) {
      const hand = children(second.part.id).find((r) => r.role === "hand");
      chain = [
        bone(first, 0),
        bone(second, 0),
        limb.kind === "arm" && hand ? bone(hand, 0) : bone(second, second.points.length - 1),
      ];
    } else if (first.points.length > 2) chain = [bone(first, 0), bone(first, 1), bone(first, 2)];
    const [a, b, c] = chain ?? [];
    if (a && b && c && new Set([a, b, c]).size === 3) limb.chain = [a, b, c];
  }
  for (const limb of limbs) {
    let least = Infinity;
    for (const other of limbs) {
      if (
        other === limb ||
        other.kind !== limb.kind ||
        !limb.side ||
        other.side !== -limb.side ||
        other.root.part.parent !== limb.root.part.parent
      )
        continue;
      const d = other.hip.distanceTo(mirrorMove(limb.hip));
      if (d < least) {
        least = d;
        limb.twin = other;
      }
    }
  }
  return { limbs, joints };
}

export type PoseScope = "one" | "pair" | "kind";

export function scopes(limbs: ReadonlyArray<Limb>, limb: Limb | undefined): PoseScope[] {
  const kin = limb ? limbs.filter((l) => l.kind === limb.kind).length : 0;
  return [
    "one",
    ...(limb?.twin ? ["pair" as const] : []),
    ...(limb && kin > (limb.twin ? 2 : 1) ? ["kind" as const] : []),
  ];
}

export function followers(
  limbs: ReadonlyArray<Limb>,
  limb: Limb | undefined,
  scope: PoseScope,
): Limb[] {
  if (!limb || scope === "one") return [];
  if (scope === "pair") return limb.twin ? [limb.twin] : [];
  return limbs.filter((other) => other !== limb && other.kind === limb.kind);
}

export function carry(from: Limb, to: Limb) {
  const swing = new T.Quaternion();
  if (from.bearing !== null && to.bearing !== null)
    swing.setFromAxisAngle(up, from.bearing - to.bearing);
  const back = swing.clone().invert();
  return {
    turn(q: T.Quaternion) {
      let r = from.side < 0 ? mirrorTurn(q) : q.clone();
      r = swing.clone().multiply(r).multiply(back);
      return to.side < 0 ? mirrorTurn(r) : r;
    },
    move(v: T.Vector3) {
      const r = (from.side < 0 ? mirrorMove(v) : v.clone()).applyQuaternion(swing);
      return to.side < 0 ? mirrorMove(r) : r;
    },
  };
}

export function spread(
  bindings: ReadonlyMap<string, JointBinding>,
  joints: ReadonlyMap<JointBinding, LimbJoint>,
  binding: JointBinding,
  before: { readonly turn: T.Quaternion; readonly place: T.Vector3 },
  limbs: ReadonlyArray<Limb>,
): number {
  const own = joints.get(binding);
  if (!own) return 0;
  const turn = binding.bone.quaternion.clone().multiply(before.turn.clone().invert()),
    shift = binding.bone.position.clone().sub(before.place);
  let changed = 0;
  for (const limb of [own.limb, ...limbs]) {
    const map = carry(own.limb, limb);
    let any = false;
    for (let layer = 0; layer <= limb.layers; layer++) {
      const address = limb.joints.get(layer + ":" + own.place);
      const other = address === undefined ? undefined : bindings.get(address);
      if (!other || other === binding) continue;
      other.bone.quaternion.premultiply(map.turn(turn)).normalize();
      other.bone.position.add(map.move(shift));
      any = true;
    }
    if (any && limb !== own.limb) changed++;
  }
  return changed;
}

export interface TipReach {
  readonly limb: Limb;
  readonly initial: T.Vector3;
  solve(goal: T.Vector3): number;
}

export function tipReach(limb: Limb | undefined): TipReach | undefined {
  if (!limb?.chain) return undefined;
  const reach = chainReach(limb.chain, limb.kind);
  return reach && { limb, initial: reach.initial, solve: (goal) => reach.solve(goal) };
}

export function plantFeet(limbs: ReadonlyArray<Limb>, skip: ReadonlyArray<Limb> = []) {
  const feet = limbs
    .filter((l) => l.kind === "leg" && l.chain && !skip.includes(l))
    .flatMap((l) => tipReach(l) ?? []);
  return {
    count: feet.length,
    hold() {
      let miss = 0;
      for (const foot of feet) miss = Math.max(miss, foot.solve(foot.initial));
      return miss;
    },
  };
}
