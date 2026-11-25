import { cubeCage } from "./control-cage.js";
import { paintSources, retainPaintSources } from "./paint-sources.js";
import { shapes, anchors } from "./recipe.js";
const nextId = (used, name) => {
  const base = name.slice(0, 64);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = " " + n,
      candidate = base.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
};
export function appendPart(form, parent, shape) {
  if (
    shape === "volume" ||
    shape === "wing" ||
    !shapes.includes(shape) ||
    Object.hasOwn(anchors, shape)
  )
    throw new Error("Choose a geometric shape.");
  const id = nextId(new Set(form.parts.map((p) => p.id)), shape);
  const part = {
    id,
    shape,
    position: parent ? [0, 0.14, 0.06] : [0, 0.9, 0.25],
    size: [0.14, 0.24, 0.14],
    color: "#c99563",
    rotation: [0, 0, 0],
  };
  if (shape === "cage") part.cage = cubeCage();
  if (parent) part.parent = parent;
  if (shape !== "sweep") part.frameSize = [...part.size];
  if (shape === "sweep") {
    part.size = [1, 1, 1];
    part.knots = [
      [0, 0, 0, 0.05, 0.045],
      [0, 0.13, 0.025, 0.039, 0.035],
      [0.04, 0.22, 0, 0.012, 0.011],
    ];
  }
  return { form: { ...form, parts: [...form.parts, part] }, id };
}
function branch(form, id) {
  const ids = new Set([id]);
  let previous;
  do {
    previous = ids.size;
    for (const p of form.parts) if (ids.has(p.parent)) ids.add(p.id);
  } while (previous !== ids.size);
  return form.parts.filter((p) => ids.has(p.id));
}
export function removePart(form, id) {
  const removing = new Set(branch(form, id).map((p) => p.id));
  const parts = form.parts.filter((p) => !removing.has(p.id));
  if (!parts.length)
    throw new Error("Add another part before removing the whole form.");
  return retainPaintSources({ ...form, parts }, paintSources(form));
}
export function copyBranch(form, id, mirror) {
  const parts = branch(form, id),
    used = new Set(form.parts.map((p) => p.id));
  const ids = new Map(
    parts.map((p) => {
      const suffix = mirror ? " mirrored" : " copy";
      const next = nextId(used, p.id.slice(0, 64 - suffix.length) + suffix);
      used.add(next);
      return [p.id, next];
    }),
  );
  const additions = parts.map((p) => {
    const copy = structuredClone(p);
    copy.id = ids.get(p.id);
    if (ids.has(p.parent)) copy.parent = ids.get(p.parent);
    else delete copy.plateSite;
    if (mirror) {
      if (copy.cage) {
        for (const vertex of copy.cage.vertices) vertex[0] *= -1;
        for (const face of copy.cage.faces) face.reverse();
      }
      if (copy.plateGrowth) {
        const growth = copy.plateGrowth;
        growth.mirrored = !growth.mirrored;
        if (growth.face === "Left") growth.face = "Right";
        else if (growth.face === "Right") growth.face = "Left";
      }
      if (copy.hull) copy.hull.mirrored = !copy.hull.mirrored;
      if (copy.grip) copy.grip.side *= -1;
      for (const f of copy.pulls ?? []) {
        f.at[0] *= -1;
        f.offset[0] *= -1;
        if (f.mirrorX !== undefined) f.mirrorX *= -1;
      }
      copy.position[0] *= -1;
      copy.rotation[1] *= -1;
      copy.rotation[2] *= -1;
      if (p.knots) for (const knot of copy.knots) knot[0] *= -1;
      if (p.humanBone) copy.humanBone=p.humanBone.replace(/_([lr])$/,(_,side)=>side==="l"?"_r":"_l");
      if (p.shape.startsWith("left "))
        copy.shape = p.shape.replace("left ", "right ");
      if (p.shape.startsWith("right "))
        copy.shape = p.shape.replace("right ", "left ");
    } else if (p.id === id) copy.position[0] += 0.08;
    return copy;
  });
  return {
    id: ids.get(id),
    renamed: ids,
    form: { ...form, parts: [...form.parts, ...additions] },
  };
}
