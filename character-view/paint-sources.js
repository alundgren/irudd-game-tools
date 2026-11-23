// Source-space masks represent original occlusion even after an arm, coat
// or head is moved or replaced in the editable graph.
export function paintSources(form) {
  const regions = new Map();
  for (const p of [
    ...(form.occluders ?? []),
    ...form.parts.map((p) => p.paint).filter(Boolean),
  ]) {
    if (p.region) regions.set(p.atlas + "\u001f" + p.region, p);
  }
  return [...regions.values()];
}
export function retainPaintSources(form, sources) {
  const active = new Set(
    form.parts.filter((p) => p.paint?.region).map((p) => p.paint.atlas),
  );
  const visible = new Set(
    form.parts
      .filter((p) => p.paint?.region)
      .map((p) => p.paint.atlas + "\u001f" + p.paint.region),
  );
  const hidden = new Map();
  for (const p of [...(form.occluders ?? []), ...sources]) {
    const key = p.atlas + "\u001f" + p.region;
    if (active.has(p.atlas) && !visible.has(key)) hidden.set(key, p);
  }
  const out = { ...form };
  if (hidden.size) out.occluders = [...hidden.values()];
  else delete out.occluders;
  return out;
}
