import { copyBranch } from "./parts.js";
import { skirtOutline } from "./skirt-pattern.js";
import { sweepGeometry } from "./surface.js";
import { headSpace } from "./portrait-frame.js";
import { Box3, Vector3, Matrix4, Euler, Quaternion, MathUtils } from "three";

import { paintSources, retainPaintSources } from "./paint-sources.js";
import { mantleGeometry, garmentCuts } from "./mantle.js";
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
    if (p.shape === "cage") {
      for (const vertex of p.cage.vertices)
        box.expandByPoint(pnt.fromArray(vertex).applyMatrix4(transform));
    } else if (p.shape === "mantle") {
      const g = mantleGeometry(p.cut);
      box.union(g.boundingBox.applyMatrix4(transform));
      g.dispose();
    } else if (p.shape === "sweep") {
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
// Derive sculpt coordinates from the original carrier geometry. Clothing meshes
// and their visibility can change independently of the wearer's body.
export function bodyFrame(form) {
  const candidates = form.parts.filter(
    (p) =>
      !p.wearFit &&
      !p.sourceHairOnly &&
      !p.headLayer &&
      !p.visibleIn &&
      p.shape !== "mantle" &&
      !["skirt", "accessory"].includes(p.outfitRole),
  );
  const primary = candidates.filter(
    (p) =>
      Object.hasOwn(anatomyBoxes, p.shape) ||
      p.anatomy === "face" ||
      p.outfitRole ||
      p.motionRole === "torso" ||
      p.motionRole === "axial spine",
  );
  const carriers = primary.length
    ? primary
    : candidates.filter((p) => !p.parent);
  const source = carriers.length
    ? carriers
    : form.parts.filter((p) => !p.parent);
  const { world } = graph(form.parts),
    box = bounds(
      source.filter((p) => p.shape !== "sweep"),
      world,
    );
  // A horizontal trunk has vertical thickness, even when every knot shares one Y.
  for (const p of source)
    if (p.shape === "sweep") {
      const geom = sweepGeometry(
        p.knots,
        Boolean(p.paint && p.paint.frame !== "path"),
        12,
      );
      geom.applyMatrix4(world(p.id));
      geom.computeBoundingBox();
      box.union(geom.boundingBox);
      geom.dispose();
    }
  return box;
}
function garmentBlock(form, id, kind) {
  const g = graph(form.parts),
    host = g.byId.get(id);
  if (!host || !garmentCuts.includes(kind))
    throw new Error("Select the body region the garment should cover.");
  const box = bounds([host], g.world),
    size = box.getSize(new Vector3()),
    pivot = box.getCenter(new Vector3());
  const width = MathUtils.clamp(size.x * 1.06, 0.035, 6),
    depth = MathUtils.clamp(size.z * 1.05, 0.035, 6),
    drop = MathUtils.clamp(
      size.y * (kind === "Cape" ? 1.42 : kind === "Tabard" ? 1.28 : 1.02),
      0.07,
      7,
    );
  const cut = {
    kind,
    width,
    depth,
    drop,
    flare: kind === "Poncho" ? 1.35 : 1,
    opening: kind === "Cape" ? 65 : kind === "Tabard" ? 15 : 4,
    folds: kind === "Tabard" ? 5 : 12,
  };
  pivot.y = box.max.y - 0.016 * size.y;
  if (kind === "Skirt") {
    pivot.y = box.min.y + size.y * 0.42;
    const floor = bodyFrame(form).min.y;
    cut.drop = MathUtils.clamp((pivot.y - floor) * 0.965, 0.025, 8);
    cut.width = MathUtils.clamp(size.x * 0.86, 0.025, 8);
    cut.depth = MathUtils.clamp(size.z * 0.91, 0.025, 8);
    Object.assign(cut, {
      outline: structuredClone(skirtOutline),
      bias: 0.65,
      gather: 0.12,
      tiers: 2,
      train: 0,
      folds: 7,
    });
    delete cut.opening;
  }
  return { cut, pivot };
}
export function cutGarment(form, id, kind, color = "#405d59", pattern) {
  const { cut, pivot } = garmentBlock(form, id, kind);
  if (pattern) {
    const dimensions = {};
    for (const axis of ["width", "depth", "drop"])
      dimensions[axis] = MathUtils.clamp(
        cut[axis] * pattern.ease[axis],
        0.025,
        8,
      );
    Object.assign(cut, structuredClone(pattern.cut), dimensions);
  }
  const used = new Set(form.parts.map((p) => p.id));
  let key = kind.toLowerCase(),
    n = 2;
  while (used.has(key)) key = kind.toLowerCase() + " " + n++;
  const part = {
    id: key,
    shape: "mantle",
    color,
    surface: pattern?.surface ?? (kind === "Skirt" ? "satin" : "canvas"),
    wearFit: true,
    cut,
    motionRole: "skirt",
    visibleIn: [form.outfit],
  };
  return { id: key, form: attachAt(form, part, id, pivot.toArray()) };
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
  for (const p of partList) {
    for (const id of [
      p.paint?.atlas,
      p.hull?.atlas,
      p.profileFit?.paint?.atlas,
      ...(p.frontFits ?? []).map((pass) => pass.overlay),
    ]) {
      if (id && form.artwork?.[id]) artwork[id] = form.artwork[id];
    }
  }
  const sources = retainPaintSources(
    { parts: partList },
    paintSources(form),
  ).occluders;
  let pattern;
  if (root.shape === "mantle" && root.parent) {
    const block = garmentBlock(form, root.parent, root.cut.kind);
    const size = fields(g.world(id)).size;
    const ease = {};
    for (const [axis, scale] of [
      ["width", size[0]],
      ["depth", size[2]],
      ["drop", size[1]],
    ])
      ease[axis] = (root.cut[axis] * Math.abs(scale)) / block.cut[axis];
    pattern = {
      cut: structuredClone(root.cut),
      ease,
      surface: root.surface,
      color: root.color,
      dye: form.layerStyles?.[id]?.dye,
    };
  }
  return {
    root: id,
    ...(pattern ? { pattern } : {}),
    parts: partList,
    ...(sources ? { occluders: sources } : {}),
    bounds: [box.min.toArray(), box.max.toArray()],
    ...(Object.keys(artwork).length ? { artwork } : {}),
  };
}
export function placeComponent(
  form,
  component,
  {
    target,
    mode = "replace",
    fit = true,
    socket = "above",
    sourceBounds = component?.bounds,
    destinationBounds,
  } = {},
) {
  const g = graph(form.parts),
    selected = g.byId.get(target);
  if (!selected)
    throw new Error("Select the region that will receive the part.");
  if (mode === "pattern") {
    const p = component?.pattern;
    if (!p) throw new Error("Choose a cut garment from a saved form.");
    const made = cutGarment(form, target, p.cut.kind, p.color, p);
    if (p.dye)
      made.form = {
        ...made.form,
        layerStyles: { ...made.form.layerStyles, [made.id]: { dye: p.dye } },
      };
    return made;
  }
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
  const src = new Box3(v(sourceBounds[0]), v(sourceBounds[1])),
    dest = destinationBounds
      ? new Box3(v(destinationBounds[0]), v(destinationBounds[1]))
      : bounds([selected], g.world);
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

/** Match two points in world metres, carrying the entire local hierarchy. */
export function placeBranch(
  form,
  id,
  {
    parent,
    fromWorld,
    toWorld,
    anchor = fromWorld,
    point = toWorld,
    copy = false,
    scale = 1,
    turn = [0, 0, 0],
  },
) {
  const g = graph(form.parts),
    source = g.byId.get(id);
  const vector = (p, limit) =>
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((n) => Number.isFinite(n) && Math.abs(n) <= limit);
  if (
    !source ||
    !g.byId.has(parent) ||
    (anchor !== undefined && !vector(anchor, Infinity)) ||
    !vector(point, Infinity) ||
    !vector(turn, 360) ||
    typeof copy !== "boolean" ||
    !Number.isFinite(scale) ||
    scale < 0.1 ||
    scale > 4
  )
    throw new Error(
      "Choose a branch, a destination and two finite points on the model.",
    );
  const branch = g.descendants(id);
  if (!copy && branch.has(parent))
    throw new Error(
      "Move this branch onto a different part outside its own branch.",
    );
  if (copy && form.parts.length + branch.size > 128)
    throw new Error("This copy would exceed the 128-part limit.");
  const before = g.world(id),
    parentInverse = g.mount(parent).invert();
  const localPin = anchor
    ? v(anchor).applyMatrix4(before.clone().invert())
    : new Vector3();
  const rotation = new Quaternion().setFromEuler(
    new Euler(...turn.map(MathUtils.degToRad)),
  );
  const transform = new Matrix4().compose(
    new Vector3(),
    rotation,
    new Vector3(scale, scale, scale),
  );
  const relative = parentInverse.clone().multiply(transform).multiply(before);
  const pose = fields(relative);
  // A rotated non-uniform parent can introduce shear. Match the marked point
  // with the actual TRS that will be saved, including on those hierarchies.
  pose.position = [0, 0, 0];
  const targetLocal = v(point).applyMatrix4(parentInverse);
  pose.position = targetLocal.sub(localPin.applyMatrix4(local(pose))).toArray();
  const placed = copy ? copyBranch(form, id, false) : { form, id };
  const parts = placed.form.parts.map((p) =>
    p.id === placed.id
      ? {
          ...p,
          ...pose,
          parent,
          ...(p.mount ? { mount: structuredClone(pose) } : {}),
        }
      : p,
  );
  const result = { ...placed.form, parts };
  if (copy) {
    function copiedLayers(layers) {
      const next = { ...layers };
      for (const [oldId, newId] of placed.renamed)
        if (Object.hasOwn(layers, oldId))
          next[newId] = structuredClone(layers[oldId]);
      return next;
    }
    if (form.layerStyles) result.layerStyles = copiedLayers(form.layerStyles);
    if (form.outfitSets)
      result.outfitSets = form.outfitSets.map((s) => ({
        ...s,
        layers: copiedLayers(s.layers),
      }));
    if (form.poses)
      result.poses = form.poses.map((p) => ({
        ...p,
        joints: [
          ...p.joints,
          ...p.joints
            .filter((j) => placed.renamed.has(j.part))
            .map((j) => ({ ...j, part: placed.renamed.get(j.part) })),
        ],
      }));
  }
  return { id: placed.id, form: result };
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
export function keepSourceHairstyle(base, target, component) {
  const oldGraph = graph(base.parts),
    original = oldGraph.byId.get(target),
    newFace = component.parts.find((p) => p.id === component.root);
  if (!original?.hairCap || !newFace?.paint?.portrait)
    throw new Error(
      "The scalp fit needs an isolated calibrated face and a fitted source hairstyle.",
    );
  const assembled = placeComponent(base, component, {
    target,
    mode: "replace",
    fit: false,
  }).form;
  const newPart = assembled.parts.find((p) => p.id === target);
  function eyeFrame(part) {
    const b = headSpace(part.paint),
      f = b.portrait;
    const y = f.eyes * b.height - b.offset[1],
      x = f.center * b.height - b.offset[0];
    const rows = part.knots;
    let i = 1;
    while (i < rows.length - 1 && rows[i][1] < y) i++;
    const a = rows[i - 1],
      z = rows[i],
      t = MathUtils.clamp((y - a[1]) / (z[1] - a[1] || 1), 0, 1);
    const pupilDepth = MathUtils.lerp(
      a[2] + a[4] * 0.89,
      z[2] + z[4] * 0.89,
      t,
    );
    return {
      p: new Vector3(x, y, pupilDepth),
      metric: f.width * b.height,
      lower: (f.eyes - f.chin) * b.height,
    };
  }
  const a = eyeFrame(original),
    b = eyeFrame(newPart),
    oldWorld = oldGraph.world(target);
  const ratio = MathUtils.clamp(
    Math.sqrt(((a.metric / b.metric) * a.lower) / b.lower),
    0.35,
    3,
  );
  const transform = oldWorld
    .clone()
    .multiply(new Matrix4().makeTranslation(a.p.x, a.p.y, a.p.z))
    .multiply(new Matrix4().makeScale(ratio, ratio, ratio))
    .multiply(new Matrix4().makeTranslation(-b.p.x, -b.p.y, -b.p.z));
  const placement = fields(
    oldGraph.mount(original.parent).invert().multiply(transform),
  );
  const current = { ...newPart, ...placement };
  delete current.hairCap;
  delete current.groom;
  delete current.hideSourceHair;
  const newMount = transform.clone();
  if (current.frameSize) newMount.scale(v(current.frameSize.map((n) => 1 / n)));
  const inverse = newMount.invert(),
    ids = new Set(assembled.parts.map((p) => p.id));
  let name = target.slice(0, 59) + " hair",
    suffix = 2;
  while (ids.has(name)) name = target.slice(0, 48) + " hair " + suffix++;
  const hair = {
    ...original,
    ...fields(inverse.clone().multiply(oldWorld)),
    id: name,
    parent: target,
    headLayer: "hair",
    sourceHairOnly: true,
    motionRole: "rigid",
  };
  for (const key of [
    "anatomy",
    "outfitRole",
    "groom",
    "hideSourceHair",
    "frameSize",
    "pulls",
    "wearFit",
  ])
    delete hair[key];
  const parts = assembled.parts.map((p) =>
    p.id === target
      ? current
      : p.parent === target && oldGraph.byId.has(p.id)
        ? { ...p, ...fields(inverse.clone().multiply(oldGraph.world(p.id))) }
        : p,
  );
  parts.push(hair);
  return {
    ...assembled,
    parts,
    artwork: { ...base.artwork, ...assembled.artwork },
  };
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
