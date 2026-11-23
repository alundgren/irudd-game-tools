import { repaintRegions } from "./paint-sources.js";

export function reusePaintEditor(getForm, commit, status) {
  const source = document.getElementById("reuse-source");
  const regions = document.getElementById("reuse-regions");
  const tool = document.getElementById("reuse-turnaround");
  const apply = document.getElementById("reuse-apply");
  const atlasOf = (p) => (p.paint ?? p.hull)?.atlas;
  let current;

  function showRegions() {
    const chosen = current.parts.find((p) => p.id === source.value);
    const selected = new Set(
      Array.from(regions.selectedOptions, (o) => o.value),
    );
    regions.replaceChildren();
    const sheets = new Map();
    for (const p of current.parts) {
      if (!atlasOf(p) || atlasOf(p) === atlasOf(chosen)) continue;
      const option = new Option(p.id, p.id);
      option.selected = selected.has(p.id);
      const atlas = atlasOf(p);
      if (!sheets.has(atlas)) {
        const group = document.createElement("optgroup");
        group.label = "Same sheet as " + p.id;
        regions.append(group);
        sheets.set(atlas, group);
      }
      sheets.get(atlas).append(option);
    }
    apply.disabled = !regions.selectedOptions.length;
  }
  source.onchange = showRegions;
  regions.onchange = () => {
    apply.disabled = !regions.selectedOptions.length;
  };
  apply.onclick = () => {
    try {
      const form = getForm();
      const chosen = form.parts.find((p) => p.id === source.value);
      const ids = Array.from(regions.selectedOptions, (o) => o.value);
      commit(
        repaintRegions(form, ids, atlasOf(chosen)),
        "Applied the turnaround to " + ids.length + " selected regions.",
      );
    } catch (error) {
      status(error.message);
    }
  };
  return (form, locked) => {
    tool.hidden = locked;
    if (locked) return;
    if (form !== current) {
      current = form;
      const previous = source.value;
      const models = new Map();
      for (const p of form.parts) {
        const atlas = atlasOf(p);
        if (atlas && !models.has(atlas)) models.set(atlas, p);
      }
      source.replaceChildren(
        ...Array.from(models.values(), (p) => new Option(p.id, p.id)),
      );
      if (Array.from(source.options).some((o) => o.value === previous))
        source.value = previous;
      if (source.value) showRegions();
    }
    tool.hidden = source.options.length < 2;
  };
}
