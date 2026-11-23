import { acceptsFibres, fibreDefaults } from "./guide-fibres.js";

export function fibreEditor(getForm, commit, status) {
  const $ = (id) => document.getElementById(id),
    list = $("fibre-guides");
  const ids = () => new Set(Array.from(list.selectedOptions, (o) => o.value));
  let shown = null;
  function fields(style) {
    $("fibre-count").value = style.count;
    for (const key of ["wave", "fall", "grey"])
      $("fibre-" + key).value = Math.round(100 * style[key]);
    $("fibre-root").checked = style.rooted;
  }
  function syncFields() {
    const set = ids(),
      first = shown?.parts.find((p) => set.has(p.id));
    fields(first?.fibres ?? fibreDefaults);
  }
  list.onchange = syncFields;
  function change(mode) {
    const selected = ids();
    if (!selected.size) return status("Select at least one curve.");
    const form = getForm(),
      style = {
        count: Number($("fibre-count").value),
        rooted: $("fibre-root").checked,
      };
    for (const key of ["wave", "fall", "grey"])
      style[key] = Number($("fibre-" + key).value) / 100;
    const next = form.parts.map((p) => {
      if (!selected.has(p.id)) return p;
      const { fibres, ...guide } = p;
      if (mode === "remove") return guide;
      const seed =
        mode === "reroll" || !fibres
          ? crypto.getRandomValues(new Uint32Array(1))[0]
          : fibres.seed;
      return {
        ...p,
        fibres: { ...(mode === "reroll" && fibres ? fibres : style), seed },
      };
    });
    commit(
      { ...form, parts: next },
      mode === "remove"
        ? "Restored the selected guide surfaces."
        : "Grew strands along the selected curves.",
    );
  }
  for (const [id, mode] of [
    ["fibre-apply", "apply"],
    ["fibre-reroll", "reroll"],
    ["fibre-remove", "remove"],
  ])
    $(id).onclick = () => {
      try {
        change(mode);
      } catch (e) {
        status(e.message);
      }
    };
  let lastTarget = null;
  return (form, target, locked) => {
    const guides = target
      ? form.parts.filter(
          (p) => (p.id === target || p.parent === target) && acceptsFibres(p),
        )
      : [];
    $("fibre-tools").hidden = !guides.length || locked;
    if (!guides.length) return;
    if (shown === form && lastTarget === target) return;
    const previous = lastTarget === target ? ids() : new Set();
    shown = form;
    lastTarget = target;
    list.replaceChildren(
      ...guides.map(
        (p) =>
          new Option(
            p.id,
            p.id,
            false,
            previous.has(p.id) ||
              (!previous.size && (p.id === target || guides.length === 1)),
          ),
      ),
    );
    syncFields();
  };
}
