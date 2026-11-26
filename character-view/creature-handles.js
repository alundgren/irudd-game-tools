import { Vector3 } from "three";
import { spineFrame } from "./creature-plan.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v) => Math.round(v * 1000) / 1000;

export const girthNames = ["hips", "loin", "belly", "chest", "shoulders"];
export const girthStations = [0.1, 0.25, 0.5, 0.75, 0.9];
export const girthRange = [0.4, 2.2];
export const limbNames = {
  leg: "legs",
  arm: "arms",
  wing: "wings",
  fin: "fins",
  tentacle: "tentacles",
};
const roots = {
  leg: [0.68, -0.3],
  arm: [0.86, 0],
  wing: [0.5, 0.62],
  fin: [0.9, 0],
  tentacle: [0.82, 0],
};

export function limbStations(limb) {
  if (limb.pairs === 1) return [(limb.from + limb.to) / 2];
  const front = Math.max(limb.from, limb.to),
    rear = Math.min(limb.from, limb.to);
  return Array.from(
    { length: limb.pairs },
    (_, i) => front + ((rear - front) * i) / (limb.pairs - 1),
  );
}
export const limbSides = (limb) =>
  limb.side === "left" ? [1] : limb.side === "right" ? [-1] : [1, -1];
export const limbCentre = (limb) => (limb.from + limb.to) / 2;

export function limbRoot(frame, kind, station, side) {
  const at = frame.at(station),
    [w, d] = at.radius,
    [across, back] = roots[kind];
  return at.centre
    .clone()
    .add(new Vector3(side * w * across, 0, 0))
    .addScaledVector(at.dorsal, d * back);
}

export function girthDirection(frame, station, view) {
  const at = frame.at(station);
  if (!view) return [0, 1];
  const n = new Vector3().crossVectors(at.tangent, view.forward);
  if (n.length() < 0.2) return [0, 1];
  n.normalize();
  const up = n.dot(view.up);
  if (Math.abs(up) > 0.2 ? up < 0 : n.dot(view.right) < 0) n.negate();
  return [n.x, n.dot(at.dorsal)];
}

export function girthPoint(frame, station, [across, back]) {
  const at = frame.at(station),
    [w, d] = at.radius,
    reach = Math.hypot(w * across, d * back) || 1;
  return {
    centre: at.centre,
    point: at.centre
      .clone()
      .add(new Vector3((w * w * across) / reach, 0, 0))
      .addScaledVector(at.dorsal, (d * d * back) / reach),
  };
}

export function girthRing(frame, station, count = 40) {
  const at = frame.at(station),
    [w, d] = at.radius;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return at.centre
      .clone()
      .add(new Vector3(w * Math.cos(a), 0, 0))
      .addScaledVector(at.dorsal, d * Math.sin(a));
  });
}

export function setGirth(plan, index, value) {
  const bulge = [...plan.spine.bulge];
  bulge[index] = round(clamp(value, ...girthRange));
  return { ...plan, spine: { ...plan.spine, bulge } };
}

export function solveGirth(plan, index, beyond) {
  let [low, high] = girthRange;
  if (beyond(setGirth(plan, index, low)) >= 0) return setGirth(plan, index, low);
  if (beyond(setGirth(plan, index, high)) <= 0)
    return setGirth(plan, index, high);
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2;
    if (beyond(setGirth(plan, index, mid)) > 0) high = mid;
    else low = mid;
  }
  return setGirth(plan, index, (low + high) / 2);
}

export function girthAxis(handle, px) {
  const centre = px(handle.centre),
    spot = px(handle.point),
    reach = Math.hypot(spot[0] - centre[0], spot[1] - centre[1]);
  return reach > 1
    ? [(spot[0] - centre[0]) / reach, (spot[1] - centre[1]) / reach]
    : [0, -1];
}
export function pullGirth(start, handle, axis, goal, px) {
  return solveGirth(start, handle.index, (candidate) => {
    const spot = px(
      girthPoint(spineFrame(candidate), handle.station, handle.direction).point,
    );
    return (spot[0] - goal[0]) * axis[0] + (spot[1] - goal[1]) * axis[1];
  });
}
export const limbRail = (frame, kind, side, px, steps = 64) =>
  Array.from({ length: steps + 1 }, (_, i) =>
    px(limbRoot(frame, kind, i / steps, side)),
  );

export function moveLimbs(plan, index, station) {
  const limb = plan.limbs[index];
  const shift = clamp(
    station - limbCentre(limb),
    -Math.min(limb.from, limb.to),
    1 - Math.max(limb.from, limb.to),
  );
  const from = round(clamp(limb.from + shift, 0, 1)),
    to = round(clamp(limb.to + shift, 0, 1));
  return {
    ...plan,
    limbs: plan.limbs.map((l, i) => (i === index ? { ...l, from, to } : l)),
  };
}

export function nearestAlong(line, [x, y]) {
  let best = 0,
    least = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i],
      [bx, by] = line[i + 1];
    const dx = bx - ax,
      dy = by - ay,
      span = dx * dx + dy * dy;
    const f = span ? clamp(((x - ax) * dx + (y - ay) * dy) / span, 0, 1) : 0;
    const gap = Math.hypot(x - ax - dx * f, y - ay - dy * f);
    if (gap < least) {
      least = gap;
      best = (i + f) / (line.length - 1);
    }
  }
  return best;
}
export const lineLength = (line) =>
  line.reduce(
    (sum, p, i) =>
      i ? sum + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0,
    0,
  );

export function viewOf(camera) {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  return {
    right: new Vector3(e[0], e[1], e[2]).normalize(),
    up: new Vector3(e[4], e[5], e[6]).normalize(),
    forward: new Vector3(-e[8], -e[9], -e[10]).normalize(),
  };
}

export function creatureHandles(plan, view) {
  const frame = spineFrame(plan);
  const girths = girthStations.map((station, index) => {
    const direction = girthDirection(frame, station, view);
    return {
      kind: "girth",
      index,
      key: "girth " + index,
      station,
      direction,
      ...girthPoint(frame, station, direction),
      label: "Thickness at the " + girthNames[index],
    };
  });
  const seen = {};
  const limbs = plan.limbs.map((limb, index) => {
    const sides = limbSides(limb),
      station = limbCentre(limb);
    let side = sides[0];
    if (sides.length > 1 && view)
      side =
        limbRoot(frame, limb.kind, station, 1).dot(view.forward) <=
        limbRoot(frame, limb.kind, station, -1).dot(view.forward)
          ? 1
          : -1;
    seen[limb.kind] = (seen[limb.kind] ?? 0) + 1;
    const several = plan.limbs.filter((l) => l.kind === limb.kind).length > 1;
    return {
      kind: "limb",
      index,
      key: "limb " + index,
      station,
      side,
      point: limbRoot(frame, limb.kind, station, side),
      label:
        "Move the " +
        limbNames[limb.kind] +
        (several ? " (group " + seen[limb.kind] + ")" : "") +
        " along the spine",
    };
  });
  return { frame, handles: [...girths, ...limbs] };
}

export function girthReadout(plan, index) {
  return (
    girthNames[index][0].toUpperCase() +
    girthNames[index].slice(1) +
    " thickness ×" +
    plan.spine.bulge[index].toFixed(2)
  );
}
export function limbReadout(plan, index) {
  const limb = plan.limbs[index],
    name = limbNames[limb.kind],
    stations = limbStations(limb);
  const rear = stations.at(-1).toFixed(2),
    front = stations[0].toFixed(2);
  return (
    name[0].toUpperCase() +
    name.slice(1) +
    " at " +
    (rear === front ? front : rear + "–" + front) +
    " (0 hips, 1 chest)"
  );
}
