import { cutGarment } from "./graft.js";
import {
  fittedLayers,
  setLayer,
  saveOutfit,
  wearOutfit,
} from "./outfit-sets.js";

export function wardrobeEditor({ getForm, getTarget, commit, status }) {
  const $ = (id) => document.getElementById(id);
  let previousForm,
    previousTarget,
    layerId = "",
    setName = "";
  function whenClicked(id, fn) {
    $(id).onclick = () => {
      try {
        fn();
      } catch (error) {
        status(error.message);
      }
    };
  }
  const host = (form, id) =>
    form.parts.find((p) => p.id === id && !p.wearFit)?.id ??
    form.parts.find((p) => p.outfitRole === "torso" || p.shape === "torso")
      ?.id ??
    form.parts.find((p) => !p.parent)?.id;
  whenClicked("cut-garment", () => {
    const form = getForm(),
      part = host(form, getTarget()),
      cut = cutGarment(
        form,
        part,
        $("garment-cut").value,
        $("cut-color").value,
      );
    layerId = cut.id;
    commit(cut.form, "Cut " + cut.id + " to fit " + part + ".");
  });
  whenClicked("layer-apply", () => {
    const form = getForm(),
      style = {};
    if ($("layer-show").value !== "auto")
      style.show = $("layer-show").value === "on";
    if ($("layer-dye").value !== "#ffffff") style.dye = $("layer-dye").value;
    const order = Number($("layer-order").value);
    if (order) style.order = order;
    commit(setLayer(form, layerId, style), "Updated garment layer.");
  });
  whenClicked("adjust-cut", () => {
    const form = getForm(),
      part = form.parts.find((p) => p.id === layerId);
    if (!part?.cut) throw new Error("Select a cut garment.");
    const cut = {
      ...part.cut,
      drop: Number($("cut-drop").value) / 100,
      opening: Number($("cut-opening").value),
      flare: Number($("cut-flare").value) / 100,
      folds: Number($("cut-folds").value),
    };
    commit(
      {
        ...form,
        parts: form.parts.map((p) => (p === part ? { ...part, cut } : p)),
      },
      "Adjusted the cut of " + part.id + ".",
    );
  });
  for (const [id, replace] of [
    ["save-outfit", false],
    ["update-outfit", true],
  ])
    whenClicked(id, () => {
      const name = replace ? setName : $("outfit-name").value.trim(),
        next = saveOutfit(getForm(), name, replace);
      setName = name;
      commit(next, "Saved outfit “" + name + "”.");
    });
  whenClicked("wear-outfit", () => {
    commit(wearOutfit(getForm(), setName), "Wearing “" + setName + "”.");
  });
  function layerFields(form) {
    const p = form.parts.find((p) => p.id === layerId),
      s = form.layerStyles?.[layerId];
    $("layer-show").value =
      s?.show === undefined ? "auto" : s.show ? "on" : "off";
    $("layer-dye").value = s?.dye ?? "#ffffff";
    $("layer-order").value = s?.order ?? 0;
    $("cut-fit").hidden = !p?.cut;
    if (p?.cut) {
      $("cut-drop").value = +(p.cut.drop * 100).toFixed(1);
      $("cut-opening").value = p.cut.opening;
      $("cut-flare").value = Math.round(p.cut.flare * 100);
      $("cut-folds").value = p.cut.folds;
    }
  }
  $("layer-list").onchange = () => {
    layerId = $("layer-list").value;
    layerFields(previousForm);
  };
  $("outfit-list").onchange = () => {
    setName = $("outfit-list").value;
  };
  return (form, target, locked) => {
    $("garment-controls").disabled = locked;
    if (form === previousForm && target === previousTarget) return;
    previousForm = form;
    previousTarget = target;
    const layers = fittedLayers(form),
      sets = form.outfitSets ?? [];
    if (!layers.some((p) => p.id === layerId))
      layerId = layers.at(-1)?.id ?? "";
    if (!sets.some((s) => s.name === setName)) setName = sets[0]?.name ?? "";
    $("cut-host").textContent = "Fit to " + (host(form, target) ?? "body");
    $("layer-controls").hidden = !layers.length;
    $("outfit-saved").hidden = !sets.length;
    $("layer-list").replaceChildren(
      ...layers.map((p) => new Option(p.id, p.id)),
    );
    $("layer-list").value = layerId;
    $("outfit-list").replaceChildren(
      ...sets.map((s) => new Option(s.name, s.name)),
    );
    $("outfit-list").value = setName;
    layerFields(form);
  };
}
