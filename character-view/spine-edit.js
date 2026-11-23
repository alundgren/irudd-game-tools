import { Vector3, Quaternion, Euler, CatmullRomCurve3, MathUtils } from "three";

export const spineAxes = ["bow", "side bend", "extend", "tip girth"];
const vector = (r) => new Vector3(r[0], r[1], r[2]);
const curve = (rows) =>
  new CatmullRomCurve3(rows.map(vector), false, "centripetal");
function radii(rows, t) {
  const u = t * (rows.length - 1),
    i = Math.min(rows.length - 2, Math.floor(u));
  return [3, 4].map((k) => MathUtils.lerp(rows[i][k], rows[i + 1][k], u - i));
}
function closestStation(point, samples) {
  const offset = new Vector3(),
    edge = new Vector3(),
    nearest = new Vector3();
  let distance = Infinity,
    result = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    edge.subVectors(samples[i + 1], samples[i]);
    const u = MathUtils.clamp(
      offset.subVectors(point, samples[i]).dot(edge) / (edge.lengthSq() || 1),
      0,
      1,
    );
    const squared = nearest
      .copy(samples[i])
      .addScaledVector(edge, u)
      .distanceToSquared(point);
    if (squared < distance) {
      distance = squared;
      result = (i + u) / (samples.length - 1);
    }
  }
  return result;
}
function stationMap(before, after) {
  if (before.length === after.length) return (t) => t;
  const anchors = [[0, 0]];
  let previous = 0;
  for (let i = 1; i < before.length - 1; i++) {
    const k = after.findIndex(
      (p, j) =>
        j > previous &&
        p.slice(0, 3).every((v, a) => Math.abs(v - before[i][a]) < 1e-7),
    );
    if (k > previous && k < after.length - 1) {
      anchors.push([i / (before.length - 1), k / (after.length - 1)]);
      previous = k;
    }
  }
  anchors.push([1, 1]);
  return (t) => {
    const j = anchors.findIndex(([x]) => x >= t);
    if (j <= 0) return 0;
    const [x, y] = anchors[j - 1],
      [xe, ye] = anchors[j];
    return MathUtils.lerp(y, ye, (t - x) / (xe - x));
  };
}
export function reshapeSpine(form, id, knots) {
  const old = form.parts.find((p) => p.id === id);
  if (
    old?.shape !== "sweep" ||
    !Array.isArray(knots) ||
    knots.length < 2 ||
    knots.length > 48 ||
    knots.some(
      (r) =>
        !Array.isArray(r) ||
        r.length !== 5 ||
        r.some((v) => !Number.isFinite(v)),
    )
  )
    throw new Error("Select a sweep and supply 2 to 48 valid cross sections.");
  const oldCurve = curve(old.knots),
    newCurve = curve(knots),
    samples = oldCurve.getPoints(Math.max(48, old.knots.length * 8)),
    station = stationMap(old.knots, knots);
  const frame = new Vector3(...(old.frameSize ?? [1, 1, 1])),
    horizontal = old.paint && old.paint.frame !== "path";
  function follow(pose) {
    const point = vector(pose.position).divide(frame),
      u = closestStation(point, samples),
      v = station(u);
    const a = oldCurve.getPoint(u),
      b = newCurve.getPoint(v),
      ta = horizontal ? new Vector3(0, 1, 0) : oldCurve.getTangent(u),
      tb = horizontal ? ta : newCurve.getTangent(v);
    const rotation = new Quaternion().setFromUnitVectors(ta, tb);
    const across =
      Math.abs(ta.x) < 0.85 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    across.addScaledVector(ta, -across.dot(ta)).normalize();
    const depth = new Vector3().crossVectors(ta, across).normalize(),
      offset = point.sub(a),
      [w, d] = radii(old.knots, u),
      [nw, nd] = radii(knots, v);
    const next = new Vector3()
      .addScaledVector(across, (offset.dot(across) * nw) / Math.max(0.0005, w))
      .addScaledVector(depth, (offset.dot(depth) * nd) / Math.max(0.0005, d))
      .addScaledVector(ta, offset.dot(ta))
      .applyQuaternion(rotation)
      .add(b)
      .multiply(frame);
    const q = new Quaternion()
        .setFromEuler(new Euler(...pose.rotation.map(MathUtils.degToRad)))
        .premultiply(rotation),
      angles = new Euler().setFromQuaternion(q);
    return {
      ...pose,
      position: next.toArray(),
      rotation: [angles.x, angles.y, angles.z].map(MathUtils.radToDeg),
    };
  }
  return {
    ...form,
    parts: form.parts.map((p) =>
      p.id === id
        ? { ...p, knots }
        : p.parent === id
          ? { ...follow(p), ...(p.mount ? { mount: follow(p.mount) } : {}) }
          : p,
    ),
  };
}
export function bendKnots(old, amounts) {
  let rows = old;
  if (old.length === 2 && (amounts.bow || amounts["side bend"]))
    rows = Array.from({ length: 5 }, (_, j) =>
      old[0].map((v, i) => MathUtils.lerp(v, old[1][i], j / 4)),
    );
  const c = curve(rows),
    span = c.getLength(),
    root = vector(rows[0]),
    axis = vector(rows.at(-1)).sub(root).normalize();
  const up =
    Math.abs(axis.y) > 0.8 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  up.addScaledVector(axis, -axis.dot(up)).normalize();
  const side = new Vector3().crossVectors(axis, up).normalize();
  return rows.map((r, i) => {
    const t = i / (rows.length - 1),
      bulge = Math.sin(t * Math.PI);
    const p = vector(r)
      .sub(root)
      .multiplyScalar(1 + (amounts.extend ?? 0) / 100)
      .add(root)
      .addScaledVector(up, (span * bulge * (amounts.bow ?? 0)) / 100)
      .addScaledVector(
        side,
        (span * t * t * (amounts["side bend"] ?? 0)) / 100,
      );
    const girth = 1 + (t * (amounts["tip girth"] ?? 0)) / 100;
    return [
      ...p.toArray(),
      ...r.slice(3).map((v) => MathUtils.clamp(v * girth, 0.0005, 4)),
    ];
  });
}
