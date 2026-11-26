import * as T from "three";
import type { HumanBuild } from "./binding.js";
import type { ClothJoints } from "./cloth-joints.js";
import type { Region } from "../rig/region.js";
import { humanBinding } from "./rig.js";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const UP = new T.Vector3(0, 1, 0);
const at = (a: ArrayLike<number>, i: number) => a[i] ?? 0;
type V3 = readonly [number, number, number];

interface Joint {
  readonly bone: T.Bone;
  readonly level: number;
  readonly column: number;
  readonly y: number;
  readonly radius: number;
  readonly free: number;
  readonly ux: number;
  readonly uz: number;
  readonly fromY: number;
  readonly fromRadius: number;
}

interface Leg {
  readonly a: T.Bone;
  readonly b: T.Bone;
  readonly radii: ReadonlyArray<number>;
  readonly sole: boolean;
  readonly restA: T.Vector3;
  readonly restB: T.Vector3;
}

interface Ball {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly r: number;
}

interface Drape {
  readonly pelvis: T.Bone;
  readonly hips: T.Vector3;
  readonly centre: T.Vector3;
  readonly floor: number;
  readonly scale: number;
  readonly joints: ReadonlyArray<Joint>;
  readonly legs: ReadonlyArray<Leg>;
  readonly columns: number;
  readonly low: number;
  readonly high: number;
  readonly indices: ReadonlyArray<number>;
  readonly fitted: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly floor: number;
    readonly balls: ReadonlyArray<Ball>;
  };
}

export type HangCloth = (p: T.Vector3, ids: Uint16Array, blend: Float32Array, at: number) => void;

export interface Drapes {
  readonly list: ReadonlyArray<Drape>;
  weigh(meta: ClothJoints): HangCloth | null;
  stance(posture: { readonly half: number; narrowest: number }): void;
}

export function addDrapeJoints(
  regions: ReadonlyMap<string, Region>,
  bones: T.Bone[],
  index: Map<T.Bone, number>,
  human: HumanBuild,
  cloth: (mesh: T.Mesh) => ClothJoints | undefined,
): Drapes {
  const list: Drape[] = [],
    found = new Map<ClothJoints, Drape>();
  const rest = (bone: T.Object3D) => {
    const v = new T.Vector3();
    for (let o: T.Object3D | null = bone; o instanceof T.Bone; o = o.parent) v.add(o.position);
    return v;
  };
  for (const s of regions.values())
    for (const source of s.meshes) {
      const meta = cloth(source);
      if (!meta || found.has(meta)) continue;
      const names = ["pelvis", ...new Set(meta.legs.flatMap((leg) => [leg.from, leg.to]))],
        ids = humanBinding(s, regions, index, names, human);
      const bone = (name: string) => {
        const made = bones[at(ids, names.indexOf(name))];
        if (!made) throw new Error(`A hanging garment needs the ${name} joint.`);
        return made;
      };
      const pelvis = bone("pelvis"),
        hips = rest(pelvis);
      const matrix = source.matrixWorld,
        linear = new T.Matrix3().setFromMatrix4(matrix),
        scale = new T.Vector3().setFromMatrixScale(matrix).y * meta.scale;
      const world = (p: V3) =>
        new T.Vector3(p[0] - meta.pelvis[0], p[1] - meta.pelvis[1], p[2] - meta.pelvis[2])
          .applyMatrix3(linear)
          .add(hips);
      const level = (y: number) => world([meta.pelvis[0], y, meta.pelvis[2]]).y,
        centre = world([meta.axis[0], meta.pelvis[1], meta.axis[1]]),
        floor = level(meta.floor),
        unit = scale / meta.scale;
      const flat = (p: T.Vector3) => Math.hypot(p.x - centre.x, p.z - centre.z);
      const joints = meta.joints.map((joint): Joint => {
        const made = new T.Bone(),
          to = world(joint.at),
          from = world(joint.from),
          dir = new T.Vector3(joint.dir[0], 0, joint.dir[1]).transformDirection(matrix);
        made.name = "J" + bones.length + "_" + joint.name.replace(/[^a-zA-Z0-9_-]/g, "_");
        made.userData["garmentSupport"] = true;
        made.position.copy(to).sub(hips);
        pelvis.add(made);
        index.set(made, bones.length);
        bones.push(made);
        return {
          bone: made,
          level: joint.level,
          column: joint.column,
          y: to.y,
          radius: flat(to),
          free: joint.free * unit,
          ux: dir.x,
          uz: dir.z,
          fromY: from.y,
          fromRadius: flat(from),
        };
      });
      const legs = meta.legs
        .map((leg) => ({
          a: bone(leg.from),
          b: bone(leg.to),
          radii: leg.radii.map((r) => r * unit),
          sole: leg.from.startsWith("foot"),
        }))
        .filter((leg) => leg.a !== leg.b && leg.a !== pelvis && leg.b !== pelvis)
        .map((leg): Leg => ({ ...leg, restA: rest(leg.a), restB: rest(leg.b) }));
      const drape: Drape = {
        pelvis,
        hips,
        centre,
        floor,
        scale,
        joints,
        legs,
        columns: meta.columns,
        low: level(meta.low),
        high: level(meta.high),
        indices: joints.map((j) => index.get(j.bone) ?? 0),
        fitted: {
          x: hips.x,
          y: hips.y,
          z: hips.z,
          floor,
          balls: balls(
            legs,
            (leg) => leg.restA,
            (leg) => leg.restB,
          ),
        },
      };
      found.set(meta, drape);
      list.push(drape);
    }
  return {
    list,
    weigh(meta) {
      const drape = found.get(meta);
      if (!drape) return null;
      const { low, high, columns, centre, indices } = drape;
      const ring = (l: number) =>
        drape.joints.filter((j) => j.level === l).sort((p, r) => p.column - r.column);
      const first = ring(0),
        second = ring(1);
      const angle = (j: Joint | undefined) => (j ? Math.atan2(j.ux, j.uz) : 0),
        start = angle(first[0]),
        step = (Math.PI * 2) / columns;
      const way = Math.sin(angle(first[1]) - start) < 0 ? -1 : 1,
        y1 = first[0]?.y ?? 0,
        y2 = second[0]?.y ?? 0,
        pairs: Array<[number, number]> = [];
      return (p, ids, blend, k) => {
        const t = clamp((p.y - low) / (high - low), 0, 1),
          body = t * t * (3 - 2 * t);
        if (body >= 1) return;
        pairs.length = 0;
        if (body > 0) {
          const order = [0, 1, 2, 3].sort((i, j) => at(blend, k + j) - at(blend, k + i));
          const o0 = order[0] ?? 0,
            o1 = order[1] ?? 0,
            sum = at(blend, k + o0) + at(blend, k + o1) || 1;
          for (const i of [o0, o1])
            if (at(blend, k + i) > 0) pairs.push([at(ids, k + i), (body * at(blend, k + i)) / sum]);
        }
        const turn = (way * (Math.atan2(p.x - centre.x, p.z - centre.z) - start)) / step,
          f = ((turn % columns) + columns) % columns,
          c0 = Math.floor(f),
          u = f - c0,
          deep = clamp((y1 - p.y) / (y1 - y2), 0, 1);
        for (const [ringOf, part] of [
          [first, 1 - deep],
          [second, deep],
        ] as const)
          for (const [c, w] of [
            [c0 % columns, 1 - u],
            [(c0 + 1) % columns, u],
          ] as const) {
            const joint = ringOf[c];
            if (part * w > 0 && joint)
              pairs.push([at(indices, drape.joints.indexOf(joint)), (1 - body) * part * w]);
          }
        pairs.sort((x, y) => y[1] - x[1]);
        const kept = pairs.slice(0, 4),
          total = kept.reduce((sum, x) => sum + x[1], 0) || 1;
        for (let i = 0; i < 4; i++) {
          const pair = kept[i];
          ids[k + i] = pair?.[0] ?? 0;
          blend[k + i] = pair ? pair[1] / total : 0;
        }
      };
    },
    stance(posture) {
      if (list.length) posture.narrowest = Math.max(0.045, posture.half);
    },
  };
}

function balls(
  legs: ReadonlyArray<Leg>,
  from: (leg: Leg) => T.Vector3,
  to: (leg: Leg) => T.Vector3,
): Ball[] {
  const out: Ball[] = [];
  for (const leg of legs) {
    const a = from(leg),
      b = to(leg),
      n = leg.radii.length;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        r: at(leg.radii, i),
      });
    }
    if (!leg.sole) out.push({ x: b.x, y: b.y, z: b.z, r: 1.15 * at(leg.radii, n - 1) });
  }
  return out;
}

interface State {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly matrix: T.Matrix4;
  readonly turn: T.Quaternion;
  readonly floor: number;
  readonly balls: ReadonlyArray<Ball>;
}

const va = new T.Vector3(),
  vb = new T.Vector3(),
  q = new T.Quaternion();
function read(drape: Drape): State {
  const pelvis = drape.pelvis.matrixWorld;
  va.setFromMatrixPosition(pelvis);
  drape.pelvis.getWorldQuaternion(q);
  vb.set(0, 0, 1).applyQuaternion(q);
  const ends = new Map<T.Bone, T.Vector3>(),
    end = (bone: T.Bone) => {
      let found = ends.get(bone);
      if (!found) ends.set(bone, (found = new T.Vector3().setFromMatrixPosition(bone.matrixWorld)));
      return found;
    };
  let floor = Infinity;
  const legBalls = balls(
    drape.legs,
    (leg) => end(leg.a),
    (leg) => end(leg.b),
  );
  for (const leg of drape.legs)
    if (leg.sole)
      floor = Math.min(
        floor,
        end(leg.a).y - (leg.restA.y - drape.floor),
        end(leg.b).y - (leg.restB.y - drape.floor),
      );
  return {
    x: va.x,
    y: va.y,
    z: va.z,
    yaw: Math.atan2(vb.x, vb.z),
    matrix: pelvis.clone(),
    turn: q.clone(),
    floor: Number.isFinite(floor) ? floor : drape.floor,
    balls: legBalls,
  };
}

type Reach = readonly [number, number, number, number];

function reaches(
  list: ReadonlyArray<Ball>,
  cx: number,
  cz: number,
  ux: number,
  uz: number,
  low: number,
  high: number,
): Reach[] {
  const out: Reach[] = [];
  for (const ball of list) {
    let r = ball.r;
    const off = ball.y < low ? low - ball.y : ball.y > high ? ball.y - high : 0;
    if (off >= r) continue;
    if (off) r = Math.sqrt(r * r - off * off);
    const wx = ball.x - cx,
      wz = ball.z - cz,
      along = wx * ux + wz * uz,
      across = Math.max(0, Math.abs(wx * uz - wz * ux) - 0.4 * Math.max(0, along));
    if (across < r)
      out.push([along + Math.sqrt(r * r - across * across), ball.y, ball.y + 0.75 * ball.r, along]);
  }
  return out;
}
const most = (list: ReadonlyArray<Reach>) => list.reduce((m, x) => Math.max(m, x[0]), -Infinity);

function follow(
  goal: ReadonlyArray<number>,
  dt: number,
  omega: number,
  zeta: number,
  loop: boolean,
  cap: number,
): number[] {
  const n = goal.length,
    out = goal.slice();
  if (n < 3) return out;
  const steps = Math.max(2, Math.ceil((omega * dt) / 0.15)),
    h = dt / steps,
    count = loop ? n - 1 : n;
  let x = at(goal, 0),
    v = 0;
  const advance = (from: number, to: number) => {
    for (let i = 1; i <= steps; i++) {
      const g = from + ((to - from) * i) / steps;
      v += (omega * omega * (g - x) - 2 * zeta * omega * v) * h;
      x += v * h;
    }
  };
  if (loop) {
    for (let round = 0; round < 4; round++)
      for (let k = 0; k < count; k++) {
        advance(at(goal, (k + count - 1) % count), at(goal, k));
        out[k] = x;
      }
    out[n - 1] = at(out, 0);
  } else
    for (let k = 1; k < n; k++) {
      advance(at(goal, k - 1), at(goal, k));
      out[k] = x;
    }
  return out.map((value, k) => at(goal, k) + clamp(value - at(goal, k), -cap, cap));
}
function settle(goal: ReadonlyArray<number>, dt: number, time: number, loop: boolean): number[] {
  const n = goal.length,
    out = goal.slice();
  if (n < 3) return out;
  const keep = Math.exp(-dt / time),
    last = loop ? n - 1 : n;
  let x = at(goal, 0);
  for (let round = loop ? 3 : 1; round > 0; round--)
    for (let k = 0; k < last; k++) {
      x = Math.max(at(goal, k), at(goal, k) + (x - at(goal, k)) * keep);
      out[k] = x;
    }
  if (loop) out[n - 1] = at(out, 0);
  return out;
}

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

const row = <A>(rows: ReadonlyArray<ReadonlyArray<A>>, k: number): ReadonlyArray<A> =>
  rows[k] ?? [];

function solve(
  drape: Drape,
  states: ReadonlyArray<State>,
  dt: number,
  { loop, speed }: { readonly loop: boolean; readonly speed: number },
): Placed[][] {
  const { joints, columns, scale, fitted, hips, centre } = drape,
    n = states.length,
    gap = 0.01 * scale,
    still = n < 3;
  const level = (l: number) =>
    joints.filter((j) => j.level === l).sort((p, r) => p.column - r.column);
  const rings = [level(0), level(1)] as const;
  const height = (l: 0 | 1) => rings[l][0]?.y ?? 0,
    column = (c: number) => ((c % columns) + columns) % columns;
  const ringJoint = (l: 0 | 1, c: number): Joint => {
    const joint = rings[l][c];
    if (!joint) throw new Error("A hanging garment's ring is missing a joint.");
    return joint;
  };
  const ox = centre.x - hips.x,
    oz = centre.z - hips.z;
  const lagFor = (l: 0 | 1): Lag => {
    const drag = clamp(speed, 0, 2) * (l ? 0.03 : 0.012),
      [omega, zeta] = l ? [10, 0.55] : [16, 0.7],
      cap = (l ? 0.07 : 0.035) * scale;
    const cx = states.map(
      (s) => s.x + ox * Math.cos(s.yaw) + oz * Math.sin(s.yaw) - drag * Math.sin(s.yaw),
    );
    const cz = states.map(
      (s) => s.z - ox * Math.sin(s.yaw) + oz * Math.cos(s.yaw) - drag * Math.cos(s.yaw),
    );
    const yaw = states.map((s) => s.yaw);
    return still
      ? { cx, cz, yaw }
      : {
          cx: follow(cx, dt, omega, zeta, loop, cap),
          cz: follow(cz, dt, omega, zeta, loop, cap),
          yaw: follow(yaw, dt, omega, zeta, loop, 0.35),
        };
  };
  const lagged = [lagFor(0), lagFor(1)] as const;
  const dir = (joint: Joint, yaw: number) =>
    [
      joint.ux * Math.cos(yaw) + joint.uz * Math.sin(yaw),
      -joint.ux * Math.sin(yaw) + joint.uz * Math.cos(yaw),
    ] as const;
  const mid = (height(0) + height(1)) / 2,
    dip = 0.04 * scale;
  const cut = ([0, 1] as const).map((l) =>
    rings[l].map((j) =>
      most(
        reaches(
          fitted.balls,
          centre.x,
          centre.z,
          j.ux,
          j.uz,
          l ? height(1) - dip : mid,
          l ? height(0) : Infinity,
        ),
      ),
    ),
  );
  const hold = (j: Joint, reach: number, was: number) =>
    j.radius + Math.max(j.free, reach + gap) - Math.max(j.free, was + gap);
  const loose = ([0, 1] as const).map((l) =>
    rings[l].map((j, c) => hold(j, -Infinity, at(row(cut, l), c))),
  );
  const spread = (values: ReadonlyArray<number>) =>
    values.map((r, c) =>
      Math.max(r, 0.5 * r + 0.25 * (at(values, column(c - 1)) + at(values, column(c + 1)))),
    );
  const between: Array<Array<Array<readonly [number, number]>>> = [],
    upper: number[][] = [],
    hard: number[][] = [],
    laps: Reach[][][] = [];
  states.forEach((s, k) => {
    const drop = s.y - fitted.y,
      y1 = height(0) + drop,
      y2 = height(1) + drop;
    const above = rings[0].map((j) => {
      const [ux, uz] = dir(j, at(lagged[0].yaw, k));
      return reaches(
        s.balls,
        at(lagged[0].cx, k),
        at(lagged[0].cz, k),
        ux,
        uz,
        (y1 + y2) / 2,
        Infinity,
      );
    });
    upper.push(spread(rings[0].map((j, c) => hold(j, most(above[c] ?? []), at(row(cut, 0), c)))));
    laps.push(above);
    const lists = rings[1].map((j) => {
      const [ux, uz] = dir(j, at(lagged[1].yaw, k));
      return reaches(s.balls, at(lagged[1].cx, k), at(lagged[1].cz, k), ux, uz, y2 - dip, y1);
    });
    between.push(
      lists.map((list) =>
        list.map(([reach, y]) => [reach, clamp((y1 - y) / Math.max(1e-6, y1 - y2), 0, 1)] as const),
      ),
    );
    hard.push(spread(rings[1].map((j, c) => hold(j, most(lists[c] ?? []), at(row(cut, 1), c)))));
  });
  const perColumn = (
    rows: ReadonlyArray<ReadonlyArray<number>>,
    f: (col: number[]) => number[],
  ) => {
    const out = rows.map((r) => r.slice());
    for (let c = 0; c < columns; c++)
      f(rows.map((r) => at(r, c))).forEach((x, k) => {
        const target = out[k];
        if (target) target[c] = x;
      });
    return out;
  };
  const first = still ? upper : perColumn(upper, (col) => settle(col, dt, 0.09, loop));
  const hang = first.map((r) =>
    r.map((value, c) => at(row(loose, 1), c) + 0.9 * (value - at(row(loose, 0), c))),
  );
  const swung = still
    ? hang
    : perColumn(hang, (col) => follow(col, dt, 10, 0.6, loop, 0.3 * scale));
  const hem = swung.map((r, k) => r.map((value, c) => Math.max(value, at(row(hard, k), c))));
  return states.map((s, k) => {
    const drop = s.y - fitted.y,
      out: Placed[] = [];
    const ring1 = row(first, k).map((r, c) => {
      let need = r;
      for (const [reach, t] of row(row(between, k), c))
        if (t < 0.7) need = Math.max(need, (reach + gap - t * at(row(hem, k), c)) / (1 - t));
      return Math.min(need, Math.max(r, at(row(hem, k), c)));
    });
    const placed: Array<
      readonly [readonly [Joint, number, number], readonly [Joint, number, number]]
    > = [];
    for (let c = 0; c < columns; c++) {
      const j1 = ringJoint(0, c),
        j2 = ringJoint(1, c),
        top = j1.fromY + drop;
      const l1 = Math.hypot(j1.radius - j1.fromRadius, j1.fromY - j1.y),
        l2 = Math.hypot(j2.radius - j1.radius, j1.y - j2.y);
      let r1 = Math.max(at(ring1, c), 0.4 * j1.radius),
        r2 = Math.max(at(row(hem, k), c), 0.4 * j2.radius);
      const fall1 = Math.sqrt(Math.max(l1 * l1 - (r1 - j1.fromRadius) ** 2, 0));
      let y1 = top - Math.max(fall1, j1.fromY - j1.y - 0.08 * scale);
      for (const [, , over, far] of row(row(laps, k), c))
        if (far > j1.fromRadius + 0.03 * scale)
          y1 = Math.max(
            y1,
            Math.min(
              top + 0.05 * scale,
              top - ((top - over - gap) * (r1 - j1.fromRadius)) / (far - j1.fromRadius),
            ),
          );
      const left = clamp(l1 + l2 - Math.hypot(r1 - j1.fromRadius, top - y1), 0.5 * l2, 1.25 * l2);
      let y2 = y1 - Math.sqrt(Math.max(left * left - (r2 - r1) ** 2, (0.5 * left) ** 2));
      const least2 = s.floor + Math.min(j2.y - fitted.floor, 0.045 * scale),
        least1 = Math.max(
          s.floor + Math.min(j1.y - fitted.floor, 0.11 * scale),
          least2 + 0.02 * scale,
        );
      if (y2 < least2) {
        r2 += Math.min(0.5 * (least2 - y2), 0.16 * scale);
        y2 = least2;
      }
      if (y1 < least1) {
        r1 += Math.min(0.4 * (least1 - y1), 0.12 * scale);
        y1 = least1;
      }
      placed.push([
        [j1, r1, y1],
        [j2, r2, y2],
      ]);
    }
    for (const l of [0, 1] as const) {
      const rise = placed.map((p) => p[l][2] - (p[l][0].y + drop)),
        eased = spread(rise);
      placed.forEach((p, c) => {
        const [j, r, y0] = p[l],
          y = y0 + at(eased, c) - at(rise, c),
          yaw = at(lagged[l].yaw, k),
          [ux, uz] = dir(j, yaw);
        out[drape.joints.indexOf(j)] = {
          x: at(lagged[l].cx, k) + ux * r,
          y,
          z: at(lagged[l].cz, k) + uz * r,
          yaw,
        };
      });
    }
    return out;
  });
}
interface Lag {
  readonly cx: ReadonlyArray<number>;
  readonly cz: ReadonlyArray<number>;
  readonly yaw: ReadonlyArray<number>;
}

export function animateDrapes(
  actor: T.Object3D,
  drapes: Drapes,
  clips: ReadonlyArray<T.AnimationClip>,
): void {
  if (!drapes.list.length) return;
  const mixer = new T.AnimationMixer(actor),
    inverse = new T.Matrix4(),
    turn = new T.Quaternion(),
    place = new T.Vector3();
  for (const clip of clips) {
    const held = clip.name === "Stand" || clip.name.startsWith("Pose · ") || !(clip.duration > 0),
      frames = held ? 1 : 32;
    const action = mixer.clipAction(clip),
      states: State[][] = [],
      times: number[] = [];
    action.clampWhenFinished = true;
    action.setLoop(T.LoopOnce, 1).play();
    for (let k = 0; k <= frames; k++) {
      action.time = (clip.duration * k) / frames;
      mixer.update(0);
      actor.updateMatrixWorld(true);
      times.push(held ? k * (clip.duration || 1) : action.time);
      states.push(drapes.list.map(read));
    }
    action.stop();
    mixer.uncacheClip(clip);
    drapes.list.forEach((drape, n) => {
      const own = states.map((s) => {
        const state = s[n];
        if (!state) throw new Error("A hanging garment lost its pose.");
        return state;
      });
      const firstState = own[0],
        lastState = own[frames];
      const far = (
        p: { x: number; y: number; z: number },
        r: { x: number; y: number; z: number },
      ) => Math.hypot(p.x - r.x, p.y - r.y, p.z - r.z);
      const loop =
        !held &&
        firstState !== undefined &&
        lastState !== undefined &&
        far(firstState, lastState) < 0.002 &&
        firstState.balls.every((ball, i) => {
          const other = lastState.balls[i];
          return other !== undefined && far(ball, other) < 0.004;
        });
      let speed = 0,
        ball = 0;
      for (const leg of drape.legs) {
        if (clip.name === "Walk" && leg.sole) {
          const z = own.map((s) => s.balls[ball]?.z ?? 0);
          speed = Math.max(speed, (Math.max(...z) - Math.min(...z)) / (0.6 * clip.duration));
        }
        ball += leg.radii.length;
      }
      const solved = solve(drape, own, clip.duration / frames, { loop, speed }),
        made: T.KeyframeTrack[] = [];
      drape.joints.forEach((joint, i) => {
        const places: number[] = [],
          turns: number[] = [];
        own.forEach((state, k) => {
          const to = solved[k]?.[i];
          if (!to) throw new Error("A hanging garment's joint was not placed.");
          inverse.copy(state.matrix).invert();
          place.set(to.x, to.y, to.z).applyMatrix4(inverse);
          turn.copy(state.turn).invert().multiply(q.setFromAxisAngle(UP, to.yaw));
          places.push(place.x, place.y, place.z);
          turns.push(turn.x, turn.y, turn.z, turn.w);
        });
        made.push(
          new T.VectorKeyframeTrack(joint.bone.name + ".position", times, places),
          new T.QuaternionKeyframeTrack(joint.bone.name + ".quaternion", times, turns),
        );
      });
      const names = new Set(made.map((track) => track.name));
      clip.tracks = clip.tracks.filter((track) => !names.has(track.name)).concat(made);
    });
  }
}
