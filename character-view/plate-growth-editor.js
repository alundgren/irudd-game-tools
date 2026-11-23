import { growPlateField } from "./plate-growth.js";

export function plateGrowthEditor({ current, selected, commit, status }) {
  const byId = (id) => document.getElementById(id);
  const panel = byId("plate-field");
  function carrierFor(form, part) {
    if (part?.shape === "sweep") return part;
    if (part?.plateSite)
      return form.parts.find((p) => p.id === part.parent && p.plateGrowth);
    return null;
  }
  const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const steps = {
    rows: { step: 1, min: 2, max: 12 },
    columns: { step: 2, min: 1, max: 7 },
    crest: { step: 0.1, min: 0, max: 1 },
    overlap: { step: 0.1, min: 0, max: 0.8 },
    wrap: { step: 10, min: 20, max: 165 },
  };
  const buttons = [...panel.querySelectorAll("button[data-growth]")];
  for (const button of buttons) {
    button.onclick = () => {
      try {
        const form = current();
        const part = form.parts.find((p) => p.id === selected());
        const carrier = carrierFor(form, part);
        if (!carrier) return;
        const settings = carrier.plateGrowth;
        const key = button.dataset.growth;
        let patch,
          id = carrier.id;
        if (key === "create") {
          if (settings) return;
          patch = {
            seed: seed(),
            tipSeed: seed(),
            face: byId("growth-face").value,
            direction: byId("growth-direction").value,
            rows: byId("growth-rows").valueAsNumber,
            columns: Number(byId("growth-columns").value),
            color: byId("growth-color").value,
          };
        } else if (!settings) return;
        else if (key === "one-tip" || key === "release-tip") {
          if (!part.plateSite) return;
          id = part.id;
          patch = { tipSeed: key === "one-tip" ? seed() : null };
        } else if (key === "refit") patch = {};
        else if (key === "tips") patch = { tipSeed: seed() };
        else if (key === "layout") patch = { seed: seed() };
        else {
          const { step, min, max } = steps[key];
          const value = settings[key] + Number(button.dataset.sign) * step;
          patch = {
            [key]: Math.min(max, Math.max(min, Number(value.toFixed(3)))),
          };
        }
        const next = growPlateField(form, id, patch);
        commit(next.form, button.dataset.result + " on " + id);
      } catch (error) {
        status(error.message);
      }
    };
  }
  return (form, part, locked) => {
    const carrier = carrierFor(form, part);
    panel.hidden = !carrier || locked;
    if (panel.hidden) return;
    const settings = carrier.plateGrowth;
    byId("growth-new").hidden = Boolean(settings);
    byId("growth-edit").hidden = !settings;
    if (!settings) return;
    byId("growth-single").hidden = !part.plateSite;
    panel.querySelector("[data-growth=release-tip]").disabled =
      part.plateSite?.tipSeed === undefined;
    const percent = (value) => Math.round(value * 100) + "%";
    byId("growth-reading").textContent = [
      carrier.id,
      settings.rows + " rows x " + settings.columns + " columns",
      "crest " + percent(settings.crest),
      "overlap " + percent(settings.overlap),
      "wrap " + settings.wrap + " degrees",
    ].join(" | ");
    for (const button of buttons) {
      const key = button.dataset.growth;
      if (!steps[key]) continue;
      button.disabled =
        Number(button.dataset.sign) < 0
          ? settings[key] <= steps[key].min
          : settings[key] >= steps[key].max;
    }
  };
}
