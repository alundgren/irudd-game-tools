import { Matrix4, Vector3, MathUtils } from "three";
import { sectionDepth } from "./profile-fit.js";

export function headFrame(mesh) {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox,
    center = box.getCenter(new Vector3()),
    size = box.getSize(new Vector3());
  const scale = mesh.getWorldScale(new Vector3()),
    height = Math.max(size.y * scale.y, 1e-6);
  const factor = scale.divideScalar(height);
  return {
    center,
    factor,
    height,
    half: 0.56 * Math.max(1, size.x * factor.x),
  };
}
const vector = (v, length, limit) =>
  Array.isArray(v) &&
  v.length === length &&
  v.every((n) => Number.isFinite(n) && Math.abs(n) <= limit);
export function validFrontFit(pass) {
  return (
    pass &&
    Number.isFinite(pass.radius) &&
    pass.radius >= 0.1 &&
    pass.radius <= 0.65 &&
    Number.isFinite(pass.amount) &&
    pass.amount >= 0 &&
    pass.amount <= 1 &&
    Array.isArray(pass.pins) &&
    pass.pins.length >= 3 &&
    pass.pins.length <= 32 &&
    pass.pins.every(
      (p, i, a) =>
        vector(p?.at, 3, 6) &&
        vector(p.shift, 2, 0.35) &&
        (!i ||
          a
            .slice(0, i)
            .every(
              (q) => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]) > 0.008,
            )),
    )
  );
}
// A planar similarity registers the two pictures using the first two fixed
// landmarks. The photograph can have any crop, magnification or in-plane tilt.
export function registerFrontPairs(pairs, radius = 0.3) {
  if (pairs.length < 3)
    throw new Error("Mark two alignment pairs and at least one feature.");
  const [a, b] = pairs;
  const dx = b.photo[0] - a.photo[0],
    dy = b.photo[1] - a.photo[1],
    d = dx * dx + dy * dy;
  const sx = b.at[0] - a.at[0],
    sy = b.at[1] - a.at[1];
  if (d < 0.0004 || Math.hypot(sx, sy) < 0.12)
    throw new Error("Choose two widely separated alignment points.");
  const u = (sx * dx + sy * dy) / d,
    v = (sy * dx - sx * dy) / d;
  const pins = pairs.map(({ at, photo }, i) => {
    const x = photo[0] - a.photo[0],
      y = photo[1] - a.photo[1];
    return {
      at: [...at],
      shift:
        i < 2
          ? [0, 0]
          : [a.at[0] + u * x - v * y - at[0], a.at[1] + v * x + u * y - at[1]],
    };
  });
  const pass = { pins, radius, amount: 1 };
  if (!validFrontFit(pass))
    throw new Error(
      "Space the points apart and keep each correction within 35% of head height.",
    );
  return pass;
}
// Fit a local 2D similarity at each projected vertex (moving least squares,
// Schaefer, McPhail & Warren, 2006). Broad shifts can then narrow a whole
// jaw without creating an indentation just under each selected point.
function frontalWarp(pass) {
  const pins = [...pass.pins];
  // Free boundary controls keep a sparse mouth/jaw fit from resizing the crown.
  for (const [x, y] of [
    [0, 0.49],
    [-0.32, 0.47],
    [0.32, 0.47],
    [0, -0.5],
  ])
    if (pins.every((p) => Math.hypot(p.at[0] - x, p.at[1] - y) > 0.12))
      pins.push({ at: [x, y, 0], shift: [0, 0] });
  const weights = new Float64Array(pins.length);
  return (x, y, z) => {
    let sum = 0,
      px = 0,
      py = 0,
      dx = 0,
      dy = 0,
      nearest = Infinity;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i],
        dist = (p.at[0] - x) ** 2 + (p.at[1] - y) ** 2;
      nearest = Math.min(nearest, dist);
      const w = 1 / Math.max(1e-10, dist);
      weights[i] = w;
      sum += w;
      px += w * p.at[0];
      py += w * p.at[1];
      dx += w * p.shift[0];
      dy += w * p.shift[1];
    }
    px /= sum;
    py /= sum;
    dx /= sum;
    dy /= sum;
    let dot = 0,
      cross = 0,
      norm = 0;
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i],
        a = p.at[0] - px,
        b = p.at[1] - py,
        ex = p.shift[0] - dx,
        ey = p.shift[1] - dy,
        w = weights[i];
      dot += w * (a * ex + b * ey);
      cross += w * (a * ey - b * ex);
      norm += w * (a * a + b * b);
    }
    const u = x - px,
      v = y - py;
    if (norm > 1e-10) {
      dx += (dot * u - cross * v) / norm;
      dy += (cross * u + dot * v) / norm;
    }
    const local =
      1 -
      MathUtils.smoothstep(
        Math.sqrt(nearest),
        pass.radius * 0.65,
        pass.radius * 1.8,
      );
    // Side contours carry their nearby rear surface with them. The middle of
    // the occiput stays behind the editing area.
    const depth = MathUtils.smoothstep(z + 0.55 * Math.abs(x), -0.52, -0.16);
    return [dx * local * depth * pass.amount, dy * local * depth * pass.amount];
  };
}
export function applyFrontFit(mesh, pass, retainProfile = false, owner = mesh) {
  if (!pass.amount) return;
  const { center, factor } = headFrame(mesh),
    g = mesh.geometry,
    pos = g.attributes.position,
    box = g.boundingBox;
  const bottom = box.min.y + 0.008 / factor.y,
    top = box.max.y - 0.008 / factor.y;
  const before = retainProfile ? sectionDepth(g, bottom, top) : null;
  const warp = frontalWarp(pass);
  function move(x, y, z) {
    const [dx, dy] = warp(
      (x - center.x) * factor.x,
      (y - center.y) * factor.y,
      (z - center.z) * factor.z,
    );
    return [x + dx / factor.x, y + dy / factor.y, z];
  }
  for (let i = 0; i < pos.count; i++)
    pos.setXYZ(i, ...move(pos.getX(i), pos.getY(i), pos.getZ(i)));
  const after = before ? sectionDepth(g, bottom, top) : null;
  function keepDepth(x, y, z) {
    if (!before) return [x, y, z];
    const last = after.near.length - 1,
      t = ((y - bottom) / (top - bottom)) * last;
    if (t < 0 || t >= last) return [x, y, z];
    const lo = Math.floor(t),
      f = t - lo;
    const sample = (arr) => MathUtils.lerp(arr[lo], arr[lo + 1], f);
    const original = sample(before.near),
      front = sample(after.near),
      rear = sample(after.rear);
    if (!Number.isFinite(original - front + rear) || front <= rear)
      return [x, y, z];
    const w = MathUtils.smoothstep((z - rear) / (front - rear), 0.6, 1);
    return [x, y, z + (original - front) * w];
  }
  if (before)
    for (let i = 0; i < pos.count; i++)
      pos.setXYZ(i, ...keepDepth(pos.getX(i), pos.getY(i), pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  // A spectacle rim, an ear and its attached hair occupy different local frames.
  // Carry nearby vertices through the same field as the face; the part records
  // and the independently editable attachments remain intact.
  owner.updateWorldMatrix(true, true);
  const fromWorld = mesh.matrixWorld.clone().invert();
  owner.traverse((child) => {
    if (
      !child.isMesh ||
      child === mesh ||
      child.userData.eyePiece ||
      child.userData.faceSurface
    )
      return;
    const toFace = new Matrix4().multiplyMatrices(fromWorld, child.matrixWorld),
      fromFace = toFace.clone().invert();
    const source = child.geometry.attributes.position,
      pt = new Vector3(),
      changed = [];
    for (let i = 0; i < source.count; i++) {
      pt.fromBufferAttribute(source, i).applyMatrix4(toFace);
      const at = move(pt.x, pt.y, pt.z);
      if (Math.abs(at[0] - pt.x) + Math.abs(at[1] - pt.y) < 1e-7) continue;
      pt.fromArray(at).applyMatrix4(fromFace);
      changed.push([i, pt.x, pt.y, pt.z]);
    }
    if (changed.length) {
      child.geometry = child.geometry.clone();
      const g = child.geometry,
        p = g.attributes.position;
      for (const row of changed) p.setXYZ(...row);
      p.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
  });
  // Eye patches and each keyed position live in the face's local coordinates.
  // Warp both endpoints before reconstructing the relative gaze or blink.
  for (const eye of mesh.children.filter((c) => c.userData.eyePiece)) {
    const eg = eye.geometry,
      ep = eg.attributes.position,
      targets = eg.morphAttributes.position ?? [];
    for (let i = 0; i < ep.count; i++) {
      const x = ep.getX(i),
        y = ep.getY(i),
        z = ep.getZ(i),
        rest = keepDepth(...move(x, y, z));
      for (const target of targets) {
        const to = keepDepth(
          ...move(x + target.getX(i), y + target.getY(i), z + target.getZ(i)),
        );
        target.setXYZ(i, to[0] - rest[0], to[1] - rest[1], to[2] - rest[2]);
      }
      ep.setXYZ(i, ...rest);
    }
    ep.needsUpdate = true;
    eg.computeVertexNormals();
    eg.computeBoundingBox();
    eg.computeBoundingSphere();
    targets.forEach((target, i) => {
      target.needsUpdate = true;
      const posed = eg.clone(),
        pp = posed.attributes.position;
      for (let j = 0; j < pp.array.length; j++) pp.array[j] += target.array[j];
      posed.computeVertexNormals();
      const normal = eg.morphAttributes.normal?.[i];
      if (normal)
        for (let j = 0; j < normal.array.length; j++)
          normal.array[j] =
            posed.attributes.normal.array[j] - eg.attributes.normal.array[j];
      posed.dispose();
    });
  }
}
