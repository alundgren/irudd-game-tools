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
export function repaintRegions(form, ids, atlas) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 128 || !atlas)
    throw new Error("Choose a turnaround and at least one painted region.");
  const selected = new Set(ids);
  const parts = form.parts.filter((p) => selected.has(p.id));
  const oldAtlas = (parts[0]?.paint ?? parts[0]?.hull)?.atlas;
  if (
    parts.length !== selected.size ||
    !oldAtlas ||
    parts.some((p) => (p.paint ?? p.hull)?.atlas !== oldAtlas)
  )
    throw new Error("Choose regions painted from the same source sheet.");
  const prior = paintSources(form);
  return retainPaintSources(
    {
      ...form,
      parts: form.parts.map((p) => {
        if (!selected.has(p.id)) return p;
        const key = p.paint ? "paint" : "hull";
        return { ...p, [key]: { ...p[key], atlas } };
      }),
    },
    [
      ...prior,
      ...prior
        .filter((binding) => binding.atlas === oldAtlas)
        .map((binding) => ({ ...binding, atlas })),
    ],
  );
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
