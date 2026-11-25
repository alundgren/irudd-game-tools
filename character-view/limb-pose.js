import { MathUtils, Quaternion, Vector3 } from "three";

// Posing several limbs as one. A limb is a chain of jointed regions hanging
// from the body. Limbs of one kind share an edit: the change made to one
// joint is carried to the matching joint of its mirror twin or of every limb
// of that kind, each in its own direction around the body.
const families = [
  ["leg", ["thigh", "shin", "foot"]],
  ["arm", ["upper arm", "forearm", "hand"]],
  ["wing", ["wing"]],
  ["fin", ["fin"]],
  ["tail", ["tail"]],
];
const family = (role) => families.find(([, roles]) => roles.includes(role))?.[0];
const key = (part, station, digit) =>
  JSON.stringify([part, station, digit ?? ""]);
const up = new Vector3(0, 1, 0);
const mirrorTurn = (q) => new Quaternion(q.x, -q.y, -q.z, q.w);
const mirrorMove = (v) => new Vector3(-v.x, v.y, v.z);
const at = (bone) => bone.getWorldPosition(new Vector3());
const facing = (bone) => bone.getWorldQuaternion(new Quaternion());

export function poseLimbs(regions, bindings) {
  const all = [...regions.values()];
  const children = (id) => all.filter((r) => r.part.parent === id);
  const limbs = [],
    owner = new Map();
  for (const root of all) {
    const kind = family(root.role);
    if (!kind || family(regions.get(root.part.parent)?.role) === kind) continue;
    if (!root.points?.length) continue;
    const limb = { id: root.part.id, kind, root, joints: new Map(), parts: [] };
    // Each region is addressed by the roles on the way down from the root,
    // so the third claw of one foot matches the third claw of another.
    const walk = (region, path) => {
      limb.parts.push(region);
      owner.set(region.part.id, [limb, path]);
      const seen = new Map();
      for (const child of children(region.part.id)) {
        const label = child.role + "/" + child.part.shape;
        const n = seen.get(label) ?? 0;
        seen.set(label, n + 1);
        walk(child, path + ">" + label + "#" + n);
      }
    };
    walk(root, "");
    const hip = root.points[0];
    let tip = hip;
    for (const region of limb.parts)
      for (const p of region.points ?? [])
        if (p.distanceToSquared(hip) > tip.distanceToSquared(hip)) tip = p;
    const reach = tip.distanceTo(hip);
    limb.side = Math.abs(hip.x) < 0.004 ? 0 : Math.sign(hip.x);
    const out = (tip.x - hip.x) * (limb.side || 1),
      along = tip.z - hip.z;
    // Limbs that hang straight down have no direction around the body.
    limb.bearing =
      Math.hypot(out, along) > 0.25 * reach ? Math.atan2(along, out) : null;
    limb.hip = hip;
    limb.reach = reach;
    // A wing spar and its membrane, or a fin and its rays, hang from the body
    // side by side. They are one limb and are posed as one.
    const whole = limbs.find(
      (l) =>
        l.kind === kind &&
        (kind === "wing" || kind === "fin") &&
        l.side === limb.side &&
        l.root.part.parent === root.part.parent &&
        l.hip.distanceTo(hip) < 0.3 * Math.max(l.reach, reach),
    );
    if (whole) {
      const layer = ++whole.layers;
      for (const region of limb.parts) {
        whole.parts.push(region);
        const [, path] = owner.get(region.part.id);
        owner.set(region.part.id, [whole, path, layer]);
      }
      continue;
    }
    limb.layers = 0;
    limbs.push(limb);
  }
  for (const [address, binding] of bindings) {
    const { part, station, digit } = binding.address;
    const found = owner.get(part);
    if (!found) continue;
    const [limb, path, layer = 0] = found;
    const place = path + "|" + station + "|" + (digit ?? "");
    limb.joints.set(layer + ":" + place, address);
    binding.limb = limb;
    binding.limbJoint = place;
  }
  const bone = (region, station) =>
    bindings.get(key(region.part.id, station))?.bone;
  for (const limb of limbs) {
    const first = limb.root,
      second = children(first.part.id).find(
        (r) => r.role === (limb.kind === "leg" ? "shin" : "forearm"),
      );
    if (limb.kind !== "leg" && limb.kind !== "arm") continue;
    let chain;
    if (second?.points?.length) {
      const hand = children(second.part.id).find((r) => r.role === "hand");
      chain = [
        bone(first, 0),
        bone(second, 0),
        limb.kind === "arm" && hand
          ? bone(hand, 0)
          : bone(second, second.points.length - 1),
      ];
    } else if (first.points.length > 2)
      chain = [bone(first, 0), bone(first, 1), bone(first, 2)];
    if (chain?.every(Boolean) && new Set(chain).size === 3) limb.chain = chain;
  }
  for (const limb of limbs) {
    let best = null,
      least = Infinity;
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
        best = other;
      }
    }
    limb.twin = best;
  }
  return limbs;
}

// The limbs that follow an edit made on one limb.
export function followers(limbs, limb, scope) {
  if (!limb || scope === "one") return [];
  if (scope === "pair") return limb.twin ? [limb.twin] : [];
  return limbs.filter((other) => other !== limb && other.kind === limb.kind);
}

// Carry a joint turn or a move from one limb to another. A limb on the other
// side receives the mirror image. Limbs that point in different directions
// around the body receive the change turned to their own direction.
export function carry(from, to) {
  const swing = new Quaternion();
  if (from.bearing !== null && to.bearing !== null)
    swing.setFromAxisAngle(up, from.bearing - to.bearing);
  const back = swing.clone().invert();
  return {
    turn(q) {
      let r = from.side < 0 ? mirrorTurn(q) : q.clone();
      r = swing.clone().multiply(r).multiply(back);
      return to.side < 0 ? mirrorTurn(r) : r;
    },
    move(v) {
      const r = (from.side < 0 ? mirrorMove(v) : v.clone()).applyQuaternion(
        swing,
      );
      return to.side < 0 ? mirrorMove(r) : r;
    },
  };
}

// Apply the change a joint just received to the matching joints of the
// following limbs. `before` holds the joint's local turn and place before it.
export function spread(bindings, binding, before, limbs) {
  const turn = binding.bone.quaternion
      .clone()
      .multiply(before.turn.clone().invert()),
    shift = binding.bone.position.clone().sub(before.place);
  let changed = 0;
  for (const limb of [binding.limb, ...limbs]) {
    if (!limb) continue;
    const map = carry(binding.limb, limb);
    let any = false;
    for (let layer = 0; layer <= limb.layers; layer++) {
      const other = bindings.get(
        limb.joints.get(layer + ":" + binding.limbJoint),
      );
      if (!other || other === binding) continue;
      other.bone.quaternion.premultiply(map.turn(turn)).normalize();
      other.bone.position.add(map.move(shift));
      any = true;
    }
    if (any && limb !== binding.limb) changed++;
  }
  return changed;
}

function setFacing(bone, rotation) {
  bone.quaternion.copy(facing(bone.parent).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}
function aim(bone, end, toward) {
  const origin = at(bone);
  const from = at(end).sub(origin),
    to = toward.clone().sub(origin);
  if (from.lengthSq() < 1e-12 || to.lengthSq() < 1e-12) return;
  const turn = new Quaternion().setFromUnitVectors(
    from.normalize(),
    to.normalize(),
  );
  setFacing(bone, turn.multiply(facing(bone)));
}

// A two-joint solve in the current pose. The limb tip goes to a point in the
// room, the middle joint keeps bending the way it bends now and the foot or
// hand keeps the direction it faces.
export function tipReach(limb) {
  if (!limb?.chain) return null;
  const [a, b, c] = limb.chain;
  a.updateWorldMatrix(true, true);
  const pa = at(a),
    pb = at(b),
    pc = at(c);
  const upper = pa.distanceTo(pb),
    lower = pb.distanceTo(pc);
  if (Math.min(upper, lower) < 0.001) return null;
  const axis = pc.clone().sub(pa);
  if (axis.lengthSq() < 1e-12) axis.copy(pb).sub(pa);
  axis.normalize();
  const pole = pb.clone().sub(pa);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-6 * upper * upper) {
    pole.set(0, 0, limb.kind === "leg" ? 1 : -1);
    if (Math.abs(pole.dot(axis)) > 0.92) pole.set(1, 0, 0);
    pole.addScaledVector(axis, -pole.dot(axis));
  }
  pole.normalize();
  const original = limb.chain.map((j) => j.quaternion.clone());
  // The solve starts from joint turns relative to the carrier, so a body
  // that moves afterwards carries the bend direction with it.
  const carrier = a.parent,
    inCarrier = facing(carrier).invert(),
    axisLocal = axis.clone().applyQuaternion(inCarrier),
    poleLocal = pole.clone().applyQuaternion(inCarrier),
    tipFacing = facing(c);
  return {
    limb,
    initial: pc,
    solve(goal) {
      limb.chain.forEach((j, i) => j.quaternion.copy(original[i]));
      carrier.updateWorldMatrix(true, true);
      const origin = at(a),
        turn = facing(carrier);
      const axisNow = axisLocal.clone().applyQuaternion(turn),
        poleNow = poleLocal.clone().applyQuaternion(turn);
      const direction = goal.clone().sub(origin),
        wanted = direction.length();
      if (wanted < 1e-8) direction.copy(axisNow);
      else direction.divideScalar(wanted);
      const distance = MathUtils.clamp(
        wanted,
        Math.abs(upper - lower) + 1e-5,
        upper + lower - 1e-5,
      );
      const along =
          (upper * upper - lower * lower + distance * distance) /
          (2 * distance),
        side = Math.sqrt(Math.max(0, upper * upper - along * along));
      const bend = poleNow.applyQuaternion(
        new Quaternion().setFromUnitVectors(axisNow, direction),
      );
      const middle = origin
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(bend, side);
      const tip = origin.clone().addScaledVector(direction, distance);
      aim(a, b, middle);
      aim(b, c, tip);
      setFacing(c, tipFacing);
      return Math.max(0, wanted - distance);
    },
  };
}

// Feet that stay where they stand while the body is posed.
export function plantFeet(limbs, skip = []) {
  const feet = limbs
    .filter((l) => l.kind === "leg" && l.chain && !skip.includes(l))
    .map((l) => tipReach(l))
    .filter(Boolean);
  return {
    count: feet.length,
    hold() {
      let miss = 0;
      for (const foot of feet) miss = Math.max(miss, foot.solve(foot.initial));
      return miss;
    },
  };
}
