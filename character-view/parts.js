import { shapes, anchors } from "./recipe.js";
const nextId = (used, name) => {
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(name + " " + n)) n++;
  return name + " " + n;
};
export function appendPart(form, parent, shape) {
  if (!shapes.includes(shape) || Object.hasOwn(anchors, shape))
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
  if (parent) part.parent = parent;
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
  return { ...form, parts };
}
export function copyBranch(form, id, mirror) {
  const parts = branch(form, id),
    used = new Set(form.parts.map((p) => p.id));
  const ids = new Map(
    parts.map((p) => {
      const next = nextId(used, p.id + (mirror ? " mirrored" : " copy"));
      used.add(next);
      return [p.id, next];
    }),
  );
  const additions = parts.map((p) => {
    const copy = structuredClone(p);
    copy.id = ids.get(p.id);
    if (ids.has(p.parent)) copy.parent = ids.get(p.parent);
    if (mirror) {
      copy.position[0] *= -1;
      copy.rotation[1] *= -1;
      copy.rotation[2] *= -1;
      if (p.knots) for (const knot of copy.knots) knot[0] *= -1;
      if (p.shape.startsWith("left "))
        copy.shape = p.shape.replace("left ", "right ");
      if (p.shape.startsWith("right "))
        copy.shape = p.shape.replace("right ", "left ");
    } else if (p.id === id) copy.position[0] += 0.08;
    return copy;
  });
  return {
    id: ids.get(id),
    form: { ...form, parts: [...form.parts, ...additions] },
  };
}
