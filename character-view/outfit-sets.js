const hex = (v) => typeof v === "string" && /^#[a-f\d]{6}$/i.test(v);
const isRecord = (v) => v && typeof v === "object" && !Array.isArray(v);

export function validLayerStyles(layers) {
  return (
    isRecord(layers) &&
    Object.entries(layers).length <= 128 &&
    Object.entries(layers).every(
      ([id, s]) =>
        id.length > 0 &&
        id.length <= 64 &&
        isRecord(s) &&
        (s.show === undefined || typeof s.show === "boolean") &&
        (s.dye === undefined || hex(s.dye)) &&
        (s.order === undefined ||
          (Number.isInteger(s.order) && s.order >= 0 && s.order <= 15)),
    )
  );
}
export function validOutfitSets(sets, outfits) {
  return (
    Array.isArray(sets) &&
    sets.length <= 32 &&
    new Set(sets.map((s) => s?.name)).size === sets.length &&
    sets.every(
      (s) =>
        isRecord(s) &&
        typeof s.name === "string" &&
        s.name.trim().length > 0 &&
        s.name.length <= 64 &&
        outfits.includes(s.base) &&
        validLayerStyles(s.layers) &&
        (s.suitTint === undefined || hex(s.suitTint)) &&
        (s.tones === undefined ||
          (isRecord(s.tones) && Object.values(s.tones).every(hex))),
    )
  );
}
export const fittedLayers = (form) => form.parts.filter((p) => p.wearFit);
export function setLayer(form, id, style) {
  if (!form.parts.some((p) => p.id === id && p.wearFit))
    throw new Error("Choose a fitted garment.");
  const layers = { ...form.layerStyles, [id]: style };
  if (!validLayerStyles(layers)) throw new Error("Invalid garment settings.");
  if (!Object.keys(style).length) delete layers[id];
  return { ...form, layerStyles: layers };
}
export function saveOutfit(form, name, replace = false) {
  name = name.trim();
  if (!name || name.length > 64)
    throw new Error("Give this outfit a name of up to 64 characters.");
  const sets = form.outfitSets ?? [],
    existing = sets.find((s) => s.name === name);
  if (existing && !replace)
    throw new Error(
      "An outfit with this name already exists. Choose Update to replace it.",
    );
  if (!existing && sets.length >= 32)
    throw new Error("A form can hold up to 32 saved outfits.");
  const layers = Object.fromEntries(
    fittedLayers(form).map((p) => [
      p.id,
      {
        ...form.layerStyles?.[p.id],
        show:
          form.layerStyles?.[p.id]?.show ??
          (!p.visibleIn || p.visibleIn.includes(form.outfit)),
      },
    ]),
  );
  const look = structuredClone({
    name,
    base: form.outfit,
    layers,
    ...(form.appearance.tones ? { tones: form.appearance.tones } : {}),
    ...(form.appearance.suitTint ? { suitTint: form.appearance.suitTint } : {}),
  });
  return {
    ...form,
    outfitSets: existing
      ? sets.map((s) => (s === existing ? look : s))
      : [...sets, look],
  };
}
export function wearOutfit(form, name) {
  const set = form.outfitSets?.find((s) => s.name === name);
  if (!set) throw new Error("Choose a saved outfit.");
  const appearance = { ...form.appearance };
  delete appearance.tones;
  delete appearance.suitTint;
  if (set.tones) appearance.tones = { ...set.tones };
  if (set.suitTint) appearance.suitTint = set.suitTint;
  const layers = Object.fromEntries(
    fittedLayers(form).map((p) => [
      p.id,
      Object.hasOwn(set.layers, p.id)
        ? { ...set.layers[p.id] }
        : { show: false },
    ]),
  );
  return { ...form, appearance, outfit: set.base, layerStyles: layers };
}
export function garmentOwners(form) {
  const byId = new Map(form.parts.map((p) => [p.id, p])),
    owners = new Map();
  for (const part of form.parts) {
    let p = part;
    while (p && !p.wearFit) p = byId.get(p.parent);
    if (p) owners.set(part.id, p.id);
  }
  return owners;
}
