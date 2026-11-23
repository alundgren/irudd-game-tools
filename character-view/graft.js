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
      delete q.wearFit;
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
  const wearable = mode === "wear";
  const attach = mode === "attach" || wearable;
  if (!["replace", "replaceBranch", "attach", "wear"].includes(mode))
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
    const base = (p === root && !attach ? target : p.id).slice(0, 56);
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
  const scale = new Vector3(ratio, ratio, ratio);
  if (wearable && fit) {
    for (const axis of ["x", "y", "z"]) {
      const allowance = axis === "y" ? 1.015 : 1.12;
      scale[axis] = MathUtils.clamp(
        (allowance * targetExtent[axis]) / Math.max(0.005, extent[axis]),
        0.075,
        10,
      );
    }
  }
  const to = dest.getCenter(new Vector3()),
    from = src.getCenter(new Vector3()).multiply(scale);
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
    world = new Matrix4().makeScale(scale.x, scale.y, scale.z);
  world.setPosition(shift);
  world.multiply(local(root));
  const parent = attach ? target : selected.parent;
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
    if (wearable) {
      delete copy.outfitRole;
      copy.motionRole = "rigid";
      copy.visibleIn = [form.outfit];
      if (p.id === root.id) copy.wearFit = true;
    }
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

/** Attach a metric, world-oriented shape at its drawn world pivot. */
export function attachAt(form, part, parent, pivot) {
  if (!form.parts.some((p) => p.id === parent))
    throw new Error("Choose a visible attachment region.");
  const relative = graph(form.parts)
    .mount(parent)
    .invert()
    .multiply(new Matrix4().makeTranslation(...pivot));
  const pose = fields(relative);
  return { ...form, parts: [...form.parts, { ...part, ...pose, parent }] };
}
export function fitHand(form, id, color = form.appearance.skin) {
  const g = graph(form.parts),
    p = g.byId.get(id);
  if (p?.shape !== "sweep" || p.outfitRole !== "hand")
    throw new Error("Select a hand with editable cross sections.");
  const t = local(p),
    ends = [p.knots[0], p.knots.at(-1)].map((k) =>
      v(k.slice(0, 3)).applyMatrix4(t),
    );
  const parent = g.byId.get(p.parent),
    parentFrame = g.mount(p.parent);
  const nearest = parent
    ? bounds([parent], g.world)
        .getCenter(new Vector3())
        .applyMatrix4(parentFrame.clone().invert())
    : new Vector3(0, Infinity, 0);
  const reverse = parent
    ? ends[0].distanceToSquared(nearest) > ends[1].distanceToSquared(nearest)
    : ends[0].y < ends[1].y;
  const [wrist, tip] = reverse ? ends.reverse() : ends;
  const towards = tip.clone().sub(wrist),
    side = wrist.clone().applyMatrix4(parentFrame).x >= 0 ? 1 : -1;
  const h = p.paint?.height ?? Math.max(0.1, towards.length() * 10);
  const span = MathUtils.clamp(towards.length() * 1.08, 0.076 * h, 0.125 * h);
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, -1, 0),
    towards.normalize(),
  );
  q.multiply(
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), side * 0.82),
  );
  const e = new Euler().setFromQuaternion(q),
    size = [span * 0.46, span, span * 0.225];
  const hand = {
    id,
    shape: "hand",
    position: wrist.toArray(),
    rotation: [e.x, e.y, e.z].map(MathUtils.radToDeg),
    size,
    frameSize: [...size],
    color,
    outfitRole: "hand",
    motionRole: "hand",
    grip: { fingers: 4, side, curl: 0.18, spread: 0.27 },
  };
  if (p.parent) hand.parent = p.parent;
  if (p.visibleIn) hand.visibleIn = [...p.visibleIn];
  const mount = parentFrame
    .clone()
    .multiply(local(hand))
    .scale(v(size.map((n) => 1 / n)));
  const inverse = mount.invert();
  const parts = form.parts.map((existing) =>
    existing === p
      ? hand
      : existing.parent === id
        ? {
            ...existing,
            ...fields(inverse.clone().multiply(g.world(existing.id))),
          }
        : existing,
  );
  return retainPaintSources({ ...form, parts }, paintSources(form));
}
