import { Box3, Vector3, Matrix4, Euler, Quaternion, MathUtils } from "three";

import { paintSources, retainPaintSources } from "./paint-sources.js";
import { volumeBounds } from "./volume.js";
const anatomyBoxes = {
  head: [
    [-0.12, -0.05, -0.12],
    [0.12, 0.37, 0.14],
  ],
  torso: [
    [-0.21, -0.1, -0.16],
    [0.21, 0.59, 0.16],
  ],
  "left arm": [
    [-0.073, -0.55, -0.09],
    [0.15, 0.08, 0.13],
  ],
  "right arm": [
    [-0.15, -0.55, -0.09],
    [0.073, 0.08, 0.13],
  ],
  "left leg": [
    [-0.1, -0.85, -0.12],
    [0.106, 0.027, 0.18],
  ],
  "right leg": [
    [-0.106, -0.85, -0.12],
    [0.1, 0.027, 0.18],
  ],
};
const v = (a) => new Vector3(...a);
function local(p) {
  return new Matrix4().compose(
    v(p.position),
    new Quaternion().setFromEuler(
      new Euler(...p.rotation.map(MathUtils.degToRad)),
    ),
    v(p.size),
  );
}
function fields(m) {
  const pos = new Vector3(),
    size = new Vector3(),
    quat = new Quaternion();
  m.decompose(pos, quat, size);
  const e = new Euler().setFromQuaternion(quat);
  return {
    position: pos.toArray(),
    size: size.toArray(),
    rotation: [e.x, e.y, e.z].map((n) => MathUtils.radToDeg(n) || 0),
  };
}
function graph(parts) {
  const byId = new Map(parts.map((p) => [p.id, p])),
    worlds = new Map(),
    visiting = new Set();
  function world(id) {
    if (!id) return new Matrix4();
    if (worlds.has(id)) return worlds.get(id);
    const part = byId.get(id);
    if (!part || visiting.has(id))
      throw new Error("The attachment graph is invalid.");
    visiting.add(id);
    const result = mount(part.parent).multiply(local(part));
    visiting.delete(id);
    worlds.set(id, result);
    return result;
  }
  function mount(id) {
    const m = world(id).clone(),
      f = byId.get(id)?.frameSize;
    if (f) m.scale(v(f.map((x) => 1 / x)));
    return m;
  }
  function descendants(id) {
    const ids = new Set([id]);
    let before = 0;
    while (before !== ids.size) {
      before = ids.size;
      for (const p of parts) if (ids.has(p.parent)) ids.add(p.id);
    }
    return ids;
  }
  return { byId, world, mount, descendants };
}
function bounds(parts, world) {
  const box = new Box3().makeEmpty(),
    pnt = new Vector3();
  for (const p of parts) {
    const transform = world(p.id);
    if (p.shape === "sweep") {
      for (const [x, y, z, w, d] of p.knots) {
        for (const dx of [-w, w])
          for (const dz of [-d, d])
            box.expandByPoint(
              pnt.set(x + dx, y, z + dz).applyMatrix4(transform),
            );
      }
    } else {
      const [a, b] =
        (p.hull ? volumeBounds(p.hull) : anatomyBoxes[p.shape]) ??
        (p.shape === "hand"
          ? [
              [-0.62, -1, -0.6],
              [0.55, 0, 0.8],
            ]
          : [
              [-0.5, -0.5, -0.5],
              [0.5, 0.5, 0.5],
            ]);
      box.union(new Box3(v(a), v(b)).applyMatrix4(transform));
    }
  }
  return box;
}
export function extractComponent(form, id, includeChildren = true) {
  const g = graph(form.parts),
    root = g.byId.get(id);
  if (!root) throw new Error("Choose a source part.");
  const ids = includeChildren ? g.descendants(id) : new Set([id]);
  const source = form.parts.filter((p) => ids.has(p.id)),
    box = bounds(source, g.world),
    pose = fields(g.world(id));
  const partList = source.map((p) => {
    const q = structuredClone(p);
    if (Object.hasOwn(anatomyBoxes, p.shape))
      q.look = structuredClone(p.look ?? form.appearance);
    if (q.id === id) {
      Object.assign(q, pose, { position: [0, 0, 0] });
      delete q.parent;
      delete q.mount;
    }
    return q;
  });
  const displacement = v(pose.position);
  box.min.sub(displacement);
  box.max.sub(displacement);
  const artwork = {};
  for (const p of partList)
    if ((p.paint || p.hull) && form.artwork?.[(p.paint ?? p.hull).atlas])
      artwork[(p.paint ?? p.hull).atlas] =
        form.artwork[(p.paint ?? p.hull).atlas];
  const sources = retainPaintSources(
    { parts: partList },
    paintSources(form),
  ).occluders;
  return {
    root: id,
    parts: partList,
    ...(sources ? { occluders: sources } : {}),
    bounds: [box.min.toArray(), box.max.toArray()],
    ...(Object.keys(artwork).length ? { artwork } : {}),
  };
}
export function placeComponent(
  form,
  component,
  { target, mode = "replace", fit = true, socket = "above" } = {},
) {
  const g = graph(form.parts),
    selected = g.byId.get(target);
  if (!selected)
    throw new Error("Select the region that will receive the part.");
  if (!["replace", "replaceBranch", "attach"].includes(mode))
    throw new Error("Unknown attachment mode.");
  if (
    !component?.root ||
    !Array.isArray(component.parts) ||
    !component.parts.length
  )
    throw new Error("Choose a component.");
  const root = component.parts.find((p) => p.id === component.root);
  if (!root) throw new Error("Component root is missing.");
  const remove =
    mode === "replaceBranch"
      ? g.descendants(target)
      : new Set(mode === "replace" ? [target] : []);
  const retained = form.parts.filter((p) => !remove.has(p.id));
  if (retained.length + component.parts.length > 128)
    throw new Error("The assembled form exceeds 128 parts.");
  const used = new Set(retained.map((p) => p.id)),
    rename = new Map();
  for (const p of [root, ...component.parts.filter((p) => p.id !== root.id)]) {
    const base = (p === root && mode !== "attach" ? target : p.id).slice(0, 56);
    let name = base,
      i = 2;
    while (used.has(name)) name = base + " " + i++;
    used.add(name);
    rename.set(p.id, name);
  }
  const src = new Box3(v(component.bounds[0]), v(component.bounds[1])),
    dest = bounds([selected], g.world);
  const extent = src.getSize(new Vector3()),
    targetExtent = dest.getSize(new Vector3());
  const ratio = fit
    ? MathUtils.clamp(targetExtent.y / Math.max(0.005, extent.y), 0.075, 10)
    : 1;
  const to = dest.getCenter(new Vector3()),
    from = src.getCenter(new Vector3()).multiplyScalar(ratio);
  if (mode === "attach") {
    const direction = {
      above: [0, 1, 0],
      below: [0, -1, 0],
      front: [0, 0, 1],
      back: [0, 0, -1],
      left: [1, 0, 0],
      right: [-1, 0, 0],
    }[socket];
    if (!direction) throw new Error("Choose an attachment side.");
    to.add(
      targetExtent
        .clone()
        .addScaledVector(extent, ratio)
        .multiply(v(direction))
        .multiplyScalar(0.47),
    );
  }
  const shift = to.sub(from),
    world = new Matrix4().makeScale(ratio, ratio, ratio);
  world.setPosition(shift);
  world.multiply(local(root));
  const parent = mode === "attach" ? target : selected.parent;
  const pose = fields(g.mount(parent).invert().multiply(world));
  const childWorld = world.clone();
  if (root.frameSize) childWorld.scale(v(root.frameSize.map((x) => 1 / x)));
  const preserved = retained.map((p) =>
    mode === "replace" && p.parent === target
      ? { ...p, ...fields(childWorld.clone().invert().multiply(g.world(p.id))) }
      : p,
  );
  const incoming = component.parts.map((p) => {
    const copy = structuredClone(p);
    copy.id = rename.get(p.id);
    if (p.id === root.id) {
      Object.assign(copy, pose);
      if (parent) copy.parent = parent;
      else delete copy.parent;
    } else copy.parent = rename.get(p.parent);
    return copy;
  });
  return {
    id: rename.get(root.id),
    form: retainPaintSources(
      {
        ...form,
        parts: [...preserved, ...incoming],
        ...(component.artwork
          ? { artwork: { ...form.artwork, ...component.artwork } }
          : {}),
      },
      [...paintSources(form), ...(component.occluders ?? [])],
    ),
  };
}
