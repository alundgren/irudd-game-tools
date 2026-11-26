import { AnimationMixer, Bone, LoopOnce, Matrix3, Matrix4, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from "three";
import { humanBinding } from "./human-mesh.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const UP = new Vector3(0, 1, 0);

export function addDrapeJoints(regions, bones, index) {
  const drapes = [], found = new Map();
  const rest = bone => { const v = new Vector3(); for (let o = bone; o?.isBone; o = o.parent) v.add(o.position); return v; };
  for (const s of regions.values()) for (const source of s.meshes ?? []) {
    const meta = source.humanWeights?.clothJoints;
    if (!meta || found.has(meta)) continue;
    const names = ["pelvis", ...new Set(meta.legs.flatMap(leg => [leg.from, leg.to]))], ids = humanBinding(s, regions, index, names);
    const bone = name => bones[ids[names.indexOf(name)]], pelvis = bone("pelvis"), hips = rest(pelvis);
    const matrix = source.matrixWorld, linear = new Matrix3().setFromMatrix4(matrix), scale = new Vector3().setFromMatrixScale(matrix).y * meta.scale;
    const world = p => new Vector3(p[0] - meta.pelvis[0], p[1] - meta.pelvis[1], p[2] - meta.pelvis[2]).applyMatrix3(linear).add(hips);
    const level = y => world([meta.pelvis[0], y, meta.pelvis[2]]).y, centre = world([meta.axis[0], meta.pelvis[1], meta.axis[1]]), floor = level(meta.floor), unit = scale / meta.scale;
    const joints = meta.joints.map(joint => {
      const made = new Bone(), at = world(joint.at), from = world(joint.from), dir = new Vector3(joint.dir[0], 0, joint.dir[1]).transformDirection(matrix);
      made.name = "J" + bones.length + "_" + joint.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      made.userData.garmentSupport = true;
      made.position.copy(at).sub(hips);
      pelvis.add(made);
      index.set(made, bones.length);
      bones.push(made);
      const flat = p => Math.hypot(p.x - centre.x, p.z - centre.z);
      return { bone: made, level: joint.level, column: joint.column, y: at.y, radius: flat(at), free: joint.free * unit, ux: dir.x, uz: dir.z, fromY: from.y, fromRadius: flat(from) };
    });
    const legs = meta.legs.map(leg => ({ a: bone(leg.from), b: bone(leg.to), radii: leg.radii.map(r => r * unit), sole: leg.from.startsWith("foot") }))
      .filter(leg => leg.a !== leg.b && leg.a !== pelvis && leg.b !== pelvis);
    for (const leg of legs) { leg.restA = rest(leg.a); leg.restB = rest(leg.b); }
    const drape = { meta, pelvis, hips, centre, floor, scale, joints, legs, columns: meta.columns, low: level(meta.low), high: level(meta.high), indices: joints.map(j => index.get(j.bone)) };
    drape.fitted = { x: hips.x, y: hips.y, z: hips.z, yaw: 0, floor, balls: balls(legs, leg => leg.restA, leg => leg.restB) };
    found.set(meta, drape);
    drapes.push(drape);
  }
  drapes.weigh = meta => {
    const drape = found.get(meta);
    if (!drape) return null;
    const { low, high, columns, centre, indices } = drape, ring = l => drape.joints.filter(j => j.level === l).sort((p, r) => p.column - r.column);
    const [first, second] = [ring(0), ring(1)], angle = j => Math.atan2(j.ux, j.uz), start = angle(first[0]), step = Math.PI * 2 / columns;
    const way = Math.sin(angle(first[1]) - start) < 0 ? -1 : 1, y1 = first[0].y, y2 = second[0].y, pairs = [];
    return (p, ids, blend, at) => {
      const t = clamp((p.y - low) / (high - low), 0, 1), body = t * t * (3 - 2 * t);
      if (body >= 1) return;
      pairs.length = 0;
      if (body > 0) {
        const order = [0, 1, 2, 3].sort((i, j) => blend[at + j] - blend[at + i]), sum = blend[at + order[0]] + blend[at + order[1]] || 1;
        for (const i of order.slice(0, 2)) if (blend[at + i] > 0) pairs.push([ids[at + i], body * blend[at + i] / sum]);
      }
      const turn = way * (Math.atan2(p.x - centre.x, p.z - centre.z) - start) / step, f = ((turn % columns) + columns) % columns, c0 = Math.floor(f), u = f - c0, deep = clamp((y1 - p.y) / (y1 - y2), 0, 1);
      for (const [ringOf, part] of [[first, 1 - deep], [second, deep]]) for (const [c, w] of [[c0 % columns, 1 - u], [(c0 + 1) % columns, u]])
        if (part * w > 0) pairs.push([indices[drape.joints.indexOf(ringOf[c])], (1 - body) * part * w]);
      pairs.sort((x, y) => y[1] - x[1]);
      const kept = pairs.slice(0, 4), total = kept.reduce((sum, x) => sum + x[1], 0) || 1;
      for (let i = 0; i < 4; i++) { ids[at + i] = kept[i]?.[0] ?? 0; blend[at + i] = kept[i] ? kept[i][1] / total : 0; }
    };
  };
  drapes.stance = posture => { if (drapes.length) posture.narrowest = Math.max(.045, posture.half); };
  return drapes;
}

function balls(legs, from, to) {
  const out = [];
  for (const leg of legs) {
    const a = from(leg), b = to(leg), n = leg.radii.length;
    for (let i = 0; i < n; i++) { const t = (i + .5) / n; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, r: leg.radii[i] }); }
    if (!leg.sole) out.push({ x: b.x, y: b.y, z: b.z, r: 1.15 * leg.radii[n - 1] });
  }
  return out;
}

const a = new Vector3(), b = new Vector3(), q = new Quaternion();
function read(drape) {
  const pelvis = drape.pelvis.matrixWorld;
  a.setFromMatrixPosition(pelvis);
  drape.pelvis.getWorldQuaternion(q);
  b.set(0, 0, 1).applyQuaternion(q);
  const state = { x: a.x, y: a.y, z: a.z, yaw: Math.atan2(b.x, b.z), matrix: pelvis.clone(), turn: q.clone(), floor: Infinity };
  const ends = new Map(), end = bone => { if (!ends.has(bone)) ends.set(bone, new Vector3().setFromMatrixPosition(bone.matrixWorld)); return ends.get(bone); };
  state.balls = balls(drape.legs, leg => end(leg.a), leg => end(leg.b));
  for (const leg of drape.legs) if (leg.sole) state.floor = Math.min(state.floor, end(leg.a).y - (leg.restA.y - drape.floor), end(leg.b).y - (leg.restB.y - drape.floor));
  if (!Number.isFinite(state.floor)) state.floor = drape.floor;
  return state;
}

function reaches(list, cx, cz, ux, uz, low, high) {
  const out = [];
  for (const ball of list) {
    let r = ball.r;
    const off = ball.y < low ? low - ball.y : ball.y > high ? ball.y - high : 0;
    if (off >= r) continue;
    if (off) r = Math.sqrt(r * r - off * off);
    const wx = ball.x - cx, wz = ball.z - cz, along = wx * ux + wz * uz, across = Math.max(0, Math.abs(wx * uz - wz * ux) - .4 * Math.max(0, along));
    if (across < r) out.push([along + Math.sqrt(r * r - across * across), ball.y, ball.y + .75 * ball.r, along]);
  }
  return out;
}
const most = list => list.reduce((m, x) => Math.max(m, x[0]), -Infinity);

function follow(goal, dt, omega, zeta, loop, cap) {
  const n = goal.length, out = goal.slice();
  if (n < 3) return out;
  const steps = Math.max(2, Math.ceil(omega * dt / .15)), h = dt / steps, count = loop ? n - 1 : n;
  let x = goal[0], v = 0;
  const advance = (from, to) => { for (let i = 1; i <= steps; i++) { const g = from + (to - from) * i / steps; v += (omega * omega * (g - x) - 2 * zeta * omega * v) * h; x += v * h; } };
  if (loop) {
    for (let round = 0; round < 4; round++) for (let k = 0; k < count; k++) { advance(goal[(k + count - 1) % count], goal[k]); out[k] = x; }
    out[n - 1] = out[0];
  } else for (let k = 1; k < n; k++) { advance(goal[k - 1], goal[k]); out[k] = x; }
  return out.map((x, k) => goal[k] + clamp(x - goal[k], -cap, cap));
}
function settle(goal, dt, time, loop) {
  const n = goal.length, out = goal.slice();
  if (n < 3) return out;
  const keep = Math.exp(-dt / time), last = loop ? n - 1 : n;
  let x = goal[0];
  for (let round = loop ? 3 : 1; round > 0; round--) for (let k = 0; k < last; k++) { x = Math.max(goal[k], goal[k] + (x - goal[k]) * keep); out[k] = x; }
  if (loop) out[n - 1] = out[0];
  return out;
}

function solve(drape, states, dt, { loop, speed }) {
  const { joints, columns, scale, fitted, hips, centre } = drape, n = states.length, gap = .01 * scale, still = n < 3;
  const level = l => joints.filter(j => j.level === l).sort((p, r) => p.column - r.column), rings = [level(0), level(1)];
  const height = l => rings[l][0].y, column = c => ((c % columns) + columns) % columns;
  const ox = centre.x - hips.x, oz = centre.z - hips.z;
  const lagged = rings.map((_, l) => {
    const drag = clamp(speed, 0, 2) * (l ? .03 : .012), spring = l ? [10, .55] : [16, .7], cap = (l ? .07 : .035) * scale;
    const cx = states.map(s => s.x + ox * Math.cos(s.yaw) + oz * Math.sin(s.yaw) - drag * Math.sin(s.yaw));
    const cz = states.map(s => s.z - ox * Math.sin(s.yaw) + oz * Math.cos(s.yaw) - drag * Math.cos(s.yaw));
    const yaw = states.map(s => s.yaw);
    return still ? { cx, cz, yaw } : { cx: follow(cx, dt, ...spring, loop, cap), cz: follow(cz, dt, ...spring, loop, cap), yaw: follow(yaw, dt, ...spring, loop, .35) };
  });
  const dir = (joint, yaw) => [joint.ux * Math.cos(yaw) + joint.uz * Math.sin(yaw), -joint.ux * Math.sin(yaw) + joint.uz * Math.cos(yaw)];
  const mid = (height(0) + height(1)) / 2, dip = .04 * scale;
  const cut = rings.map((ring, l) => ring.map(j => most(reaches(fitted.balls, centre.x, centre.z, j.ux, j.uz, l ? height(1) - dip : mid, l ? height(0) : Infinity))));
  const hold = (j, reach, was) => j.radius + Math.max(j.free, reach + gap) - Math.max(j.free, was + gap);
  const loose = rings.map((ring, l) => ring.map((j, c) => hold(j, -Infinity, cut[l][c])));
  const spread = row => row.map((r, c) => Math.max(r, .5 * r + .25 * (row[column(c - 1)] + row[column(c + 1)])));
  const between = [], upper = [], hard = [], laps = [];
  states.forEach((s, k) => {
    const drop = s.y - fitted.y, y1 = height(0) + drop, y2 = height(1) + drop;
    const above = rings[0].map(j => { const [ux, uz] = dir(j, lagged[0].yaw[k]); return reaches(s.balls, lagged[0].cx[k], lagged[0].cz[k], ux, uz, (y1 + y2) / 2, Infinity); });
    upper.push(spread(rings[0].map((j, c) => hold(j, most(above[c]), cut[0][c]))));
    laps.push(above);
    const lists = rings[1].map(j => { const [ux, uz] = dir(j, lagged[1].yaw[k]); return reaches(s.balls, lagged[1].cx[k], lagged[1].cz[k], ux, uz, y2 - dip, y1); });
    between.push(lists.map(list => list.map(([reach, y]) => [reach, clamp((y1 - y) / Math.max(1e-6, y1 - y2), 0, 1)])));
    hard.push(spread(rings[1].map((j, c) => hold(j, most(lists[c]), cut[1][c]))));
  });
  const perColumn = (rows, f) => { const out = rows.map(row => row.slice()); for (let c = 0; c < columns; c++) f(rows.map(row => row[c])).forEach((x, k) => { out[k][c] = x; }); return out; };
  const first = still ? upper : perColumn(upper, col => settle(col, dt, .09, loop));
  const hang = first.map(row => row.map((r, c) => loose[1][c] + .9 * (r - loose[0][c])));
  const swung = still ? hang : perColumn(hang, col => follow(col, dt, 10, .6, loop, .3 * scale));
  const hem = swung.map((row, k) => row.map((r, c) => Math.max(r, hard[k][c])));
  return states.map((s, k) => {
    const drop = s.y - fitted.y, out = [];
    const ring1 = first[k].map((r, c) => {
      let need = r;
      for (const [reach, t] of between[k][c]) if (t < .7) need = Math.max(need, (reach + gap - t * hem[k][c]) / (1 - t));
      return Math.min(need, Math.max(r, hem[k][c]));
    });
    const placed = [];
    for (let c = 0; c < columns; c++) {
      const j1 = rings[0][c], j2 = rings[1][c], top = j1.fromY + drop;
      const l1 = Math.hypot(j1.radius - j1.fromRadius, j1.fromY - j1.y), l2 = Math.hypot(j2.radius - j1.radius, j1.y - j2.y);
      let r1 = Math.max(ring1[c], .4 * j1.radius), r2 = Math.max(hem[k][c], .4 * j2.radius);
      const fall1 = Math.sqrt(Math.max(l1 * l1 - (r1 - j1.fromRadius) ** 2, 0));
      let y1 = top - Math.max(fall1, j1.fromY - j1.y - .08 * scale);
      for (const [, , over, far] of laps[k][c]) if (far > j1.fromRadius + .03 * scale)
        y1 = Math.max(y1, Math.min(top + .05 * scale, top - (top - over - gap) * (r1 - j1.fromRadius) / (far - j1.fromRadius)));
      const left = clamp(l1 + l2 - Math.hypot(r1 - j1.fromRadius, top - y1), .5 * l2, 1.25 * l2);
      let y2 = y1 - Math.sqrt(Math.max(left * left - (r2 - r1) ** 2, (.5 * left) ** 2));
      const least2 = s.floor + Math.min(j2.y - fitted.floor, .045 * scale), least1 = Math.max(s.floor + Math.min(j1.y - fitted.floor, .11 * scale), least2 + .02 * scale);
      if (y2 < least2) { r2 += Math.min(.5 * (least2 - y2), .16 * scale); y2 = least2; }
      if (y1 < least1) { r1 += Math.min(.4 * (least1 - y1), .12 * scale); y1 = least1; }
      placed.push([[j1, r1, y1], [j2, r2, y2]]);
    }
    for (let l = 0; l < 2; l++) {
      const rise = placed.map(row => row[l][2] - (row[l][0].y + drop)), eased = spread(rise);
      placed.forEach((row, c) => {
        const [j, r] = row[l], y = row[l][2] + eased[c] - rise[c], yaw = lagged[l].yaw[k], [ux, uz] = dir(j, yaw);
        out[drape.joints.indexOf(j)] = { x: lagged[l].cx[k] + ux * r, y, z: lagged[l].cz[k] + uz * r, yaw };
      });
    }
    return out;
  });
}

export function animateDrapes(actor, drapes, clips) {
  if (!drapes.length) return;
  const mixer = new AnimationMixer(actor), inverse = new Matrix4(), turn = new Quaternion(), place = new Vector3();
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
      states.push(drapes.map(read));
    }
    action.stop();
    mixer.uncacheClip(clip);
    drapes.forEach((drape, n) => {
      const own = states.map(s => s[n]), first = own[0], last = own[frames], far = (p, r) => Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z);
      const loop = !held && far(first, last) < .002 && first.balls.every((ball, i) => far(ball, last.balls[i]) < .004);
      let speed = 0, at = 0;
      for (const leg of drape.legs) {
        if (clip.name === "Walk" && leg.sole) { const z = own.map(s => s.balls[at].z); speed = Math.max(speed, (Math.max(...z) - Math.min(...z)) / (.6 * clip.duration)); }
        at += leg.radii.length;
      }
      const solved = solve(drape, own, clip.duration / frames, { loop, speed }), made = [];
      drape.joints.forEach((joint, i) => {
        const places = [], turns = [];
        own.forEach((state, k) => {
          const to = solved[k][i];
          inverse.copy(state.matrix).invert();
          place.set(to.x, to.y, to.z).applyMatrix4(inverse);
          turn.copy(state.turn).invert().multiply(q.setFromAxisAngle(UP, to.yaw));
          places.push(place.x, place.y, place.z);
          turns.push(turn.x, turn.y, turn.z, turn.w);
        });
        made.push(new VectorKeyframeTrack(joint.bone.name + ".position", times, places), new QuaternionKeyframeTrack(joint.bone.name + ".quaternion", times, turns));
      });
      const names = new Set(made.map(track => track.name));
      clip.tracks = clip.tracks.filter(track => !names.has(track.name)).concat(made);
    });
  }
}
