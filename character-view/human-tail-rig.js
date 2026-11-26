import { AnimationMixer, Bone, LoopOnce, Matrix3, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { humanBinding } from "./human-mesh.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const UP = new Vector3(0, 1, 0);
export const TAIL = { hang: [.7, .92], spring: [[12, .32], [8.5, .26]], reach: .45, clear: .96, sway: [.11, .24], bounce: [.04, .1] };

export function addTailJoints(regions, bones, index) {
  const tails = [], found = new Map();
  const rest = bone => { const v = new Vector3(); for (let o = bone; o?.isBone; o = o.parent) v.add(o.position); return v; };
  for (const s of regions.values()) for (const source of s.meshes ?? []) {
    const meta = source.humanWeights?.hairJoints;
    if (!meta || found.has(meta) || !source.humanWeights.names) continue;
    const ids = humanBinding(s, regions, index, source.humanWeights.names), named = name => bones[ids[source.humanWeights.names.indexOf(name)]];
    const [head, neck, chest] = meta.names.map(named);
    if (!head || !chest) continue;
    source.updateMatrixWorld(true);
    const matrix = source.matrixWorld, scale = new Vector3().setFromMatrixScale(matrix).y, tie = new Vector3(meta.tie[0] - meta.head[0], meta.tie[1] - meta.head[1], meta.tie[2] - meta.head[2]).applyMatrix3(new Matrix3().setFromMatrix4(matrix)).add(rest(head)), long = meta.long * scale;
    const pos = source.geometry.attributes.position, p = new Vector3(), sums = [new Vector3(), new Vector3()], n = [0, 0];
    for (let i = meta.from; i < meta.from + meta.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      const t = (tie.y - p.y) / long;
      if (t > .42 && t < .58) { sums[0].add(p); n[0]++; }
      if (t > .88) { sums[1].add(p); n[1]++; }
    }
    if (!n[0] || !n[1]) continue;
    const mid = sums[0].divideScalar(n[0]), tip = sums[1].divideScalar(n[1]);
    const make = (name, at, parent, from) => {
      const made = new Bone();
      made.name = "J" + bones.length + "_" + name;
      made.userData.garmentSupport = true;
      made.position.copy(at).sub(from);
      parent.add(made);
      index.set(made, bones.length);
      bones.push(made);
      return made;
    };
    const first = make("hair_tail_1", tie, head, rest(head)), second = make("hair_tail_2", mid, first, tie);
    const tail = { meta, head, neck, chest, joints: [first, second], tie, mid, tip, long, restHead: rest(head), restChest: rest(chest), indices: [index.get(first), index.get(second)], matrix: matrix.clone() };
    found.set(meta, tail);
    tails.push(tail);
  }
  tails.weigh = meta => {
    const tail = found.get(meta);
    if (!tail) return null;
    const { tie, long, indices } = tail, pairs = [];
    return (p, ids, blend, at) => {
      const i = at / 4;
      if (i < meta.from || i >= meta.from + meta.count) return;
      const t = (tie.y - p.y) / long, free = smooth(.03, .14, t), low = smooth(.3, .72, t);
      if (free <= 0) return;
      pairs.length = 0;
      for (let j = 0; j < 4; j++) if (blend[at + j] > 0) pairs.push([ids[at + j], (1 - free) * blend[at + j]]);
      pairs.push([indices[0], free * (1 - low)], [indices[1], free * low]);
      pairs.sort((x, y) => y[1] - x[1]);
      const kept = pairs.slice(0, 4), total = kept.reduce((sum, x) => sum + x[1], 0) || 1;
      for (let j = 0; j < 4; j++) { ids[at + j] = kept[j]?.[0] ?? 0; blend[at + j] = kept[j] ? kept[j][1] / total : 0; }
    };
  };
  return tails;
}

function follow(goal, dt, omega, zeta, loop, cap) {
  const n = goal.length, out = goal.slice();
  if (n < 3) return out;
  const steps = Math.max(2, Math.ceil(omega * dt / .15)), h = dt / steps, count = loop ? n - 1 : n;
  let x = goal[0], v = 0;
  const advance = (from, to) => { for (let i = 1; i <= steps; i++) { const g = from + (to - from) * i / steps; v += (omega * omega * (g - x) - 2 * zeta * omega * v) * h; x += v * h; } };
  if (loop) {
    for (let round = 0; round < 6; round++) for (let k = 0; k < count; k++) { advance(goal[(k + count - 1) % count], goal[k]); out[k] = x; }
    out[n - 1] = out[0];
  } else for (let k = 1; k < n; k++) { advance(goal[k - 1], goal[k]); out[k] = x; }
  return out.map((x, k) => goal[k] + clamp(x - goal[k], -cap, cap));
}

const nearest = (p, a, b, out) => { out.subVectors(b, a); const t = clamp(p.clone().sub(a).dot(out) / (out.lengthSq() || 1), 0, 1); return out.multiplyScalar(t).add(a); };

function solve(tail, states, dt, loop, gait) {
  const { tie, mid, tip, restHead, restChest } = tail, still = states.length < 3, on = new Vector3(), q = new Quaternion();
  const rests = [mid, tip], lengths = [mid.distanceTo(tie), tip.distanceTo(mid)], dirs = [mid.clone().sub(tie).normalize(), tip.clone().sub(mid).normalize()];
  const clear = rests.map(p => p.distanceTo(nearest(p, restHead, restChest, on)) * TAIL.clear);
  const goals = rests.map((p, i) => states.map(s => {
    const rigid = p.clone().sub(restHead).applyMatrix4(s.matrix), hang = p.clone().sub(tie).applyAxisAngle(UP, s.yaw).add(s.tie);
    return rigid.lerp(hang, TAIL.hang[i]);
  }));
  if (gait) goals.forEach((list, i) => list.forEach((p, k) => {
    const s = states[k], t = k / (states.length - 1) * Math.PI * 2, reach = lengths[0] + (i ? lengths[1] : 0);
    const across = TAIL.sway[i] * reach * Math.sin(t), back = -TAIL.bounce[i] * reach * (.5 + .5 * Math.cos(2 * t + .6));
    p.x += across * Math.cos(s.yaw) + back * Math.sin(s.yaw);
    p.z += -across * Math.sin(s.yaw) + back * Math.cos(s.yaw);
  }));
  const moved = goals.map((list, i) => {
    if (still) return list;
    const cap = TAIL.reach * lengths[i], axes = ["x", "y", "z"].map(d => follow(list.map(p => p[d]), dt, ...TAIL.spring[i], loop, cap));
    return list.map((_, k) => new Vector3(axes[0][k], axes[1][k], axes[2][k]));
  });
  return states.map((s, k) => {
    const turns = [];
    let from = s.tie;
    for (let i = 0; i < 2; i++) {
      const p = moved[i][k];
      for (let pass = 0; pass < 2; pass++) {
        const d = p.clone().sub(from).setLength(lengths[i]);
        p.copy(from).add(d);
        const near = nearest(p, s.head, s.chest, on), off = p.clone().sub(near), far = off.length();
        if (far < clear[i]) p.copy(near).add(far > 1e-6 ? off.setLength(clear[i]) : new Vector3(0, 0, -clear[i]));
      }
      const d = p.clone().sub(from).normalize();
      p.copy(from).addScaledVector(d, lengths[i]);
      const yaw = new Quaternion().setFromAxisAngle(UP, s.yaw);
      turns.push(q.setFromUnitVectors(dirs[i].clone().applyQuaternion(yaw), d).clone().multiply(yaw));
      from = p;
    }
    return turns;
  });
}

export function animateTails(actor, tails, clips) {
  if (!tails.length) return;
  const mixer = new AnimationMixer(actor), q = new Quaternion(), z = new Vector3();
  for (const clip of clips) {
    const held = clip.name === "Stand" || clip.name.startsWith("Pose · ") || !(clip.duration > 0), frames = held ? 1 : 32;
    const action = mixer.clipAction(clip), states = [], times = [];
    action.clampWhenFinished = true;
    action.setLoop(LoopOnce, 1).play();
    for (let k = 0; k <= frames; k++) {
      action.time = clip.duration * k / frames;
      mixer.update(0);
      actor.updateMatrixWorld(true);
      times.push(held ? k * (clip.duration || 1) : action.time);
      states.push(tails.map(tail => {
        tail.head.getWorldQuaternion(q);
        z.set(0, 0, 1).applyQuaternion(q);
        const matrix = tail.head.matrixWorld.clone();
        return { matrix, turn: q.clone(), yaw: Math.atan2(z.x, z.z), tie: tail.tie.clone().sub(tail.restHead).applyMatrix4(matrix), head: new Vector3().setFromMatrixPosition(matrix), chest: new Vector3().setFromMatrixPosition(tail.chest.matrixWorld) };
      }));
    }
    action.stop();
    mixer.uncacheClip(clip);
    tails.forEach((tail, n) => {
      const own = states.map(s => s[n]), first = own[0], last = own[frames];
      const loop = !held && first.tie.distanceTo(last.tie) < .002 && first.turn.angleTo(last.turn) < .01;
      const solved = solve(tail, own, clip.duration / frames, loop, loop && clip.name === "Walk"), values = [[], []], before = [null, null];
      own.forEach((state, k) => {
        const [a, b] = solved[k], local = [state.turn.clone().invert().multiply(a), a.clone().invert().multiply(b)];
        local.forEach((turn, i) => {
          if (before[i] && before[i].dot(turn) < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
          before[i] = turn;
          values[i].push(turn.x, turn.y, turn.z, turn.w);
        });
      });
      const made = tail.joints.map((joint, i) => new QuaternionKeyframeTrack(joint.name + ".quaternion", times, values[i]));
      const names = new Set(made.map(track => track.name));
      clip.tracks = clip.tracks.filter(track => !names.has(track.name)).concat(made);
    });
  }
}
