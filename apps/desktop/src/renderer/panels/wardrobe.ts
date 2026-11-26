import {
  adultWardrobeParams,
  chooseWardrobe,
  fittedGarments,
  saveLook,
  savedLooks,
  styleGarment,
  wearLook,
  wornOutfit,
} from "@irudd/character";
import {
  characterAppearance,
  figureFinish,
  figureMantle,
  mantleCuts,
  outfitLayers,
  outfitLooks,
  outfitWardrobe,
  outfitWear,
  outfits,
  type CharacterDocument,
  type Json,
  type MantleCut,
  type Part,
} from "@irudd/document";
import { button, byId, el } from "../dom.js";
import { choices, colour, cutFields, field } from "./garment-fields.js";
import { tailorControls } from "./tailor.js";
import { failure, type PanelContext } from "./context.js";

export function mountWardrobe(
  ctx: PanelContext,
  cut: (host: string, kind: MantleCut["kind"], color: string) => Part,
) {
  const panel = byId("wardrobe", HTMLElement);
  const baseBox = byId("wardrobe-base", HTMLDivElement),
    tailor = byId("tailor", HTMLDetailsElement);
  const cutting = byId("cutting", HTMLDivElement),
    layers = byId("garment-layers", HTMLDivElement),
    saved = byId("saved-outfits", HTMLDivElement);
  let layerId = "",
    lookName = "",
    pieceIndex = 0,
    lastDoc = "",
    kind: MantleCut["kind"] = "Cape",
    fabric = "#405d59";
  function render() {
    const { doc, view } = ctx;
    panel.hidden = !doc || !view;
    if (!doc || !view) return;
    if (lastDoc !== doc.id) {
      layerId = "";
      lookName = "";
      pieceIndex = 0;
      lastDoc = doc.id;
    }
    const base = { documentId: doc.id, revision: view.revision };
    const feature = (id: string, value: Json, part?: string) => ({
      op: "feature.set",
      feature: id,
      value,
      ...(part ? { part } : {}),
    });
    function edit(summary: string, make: () => readonly object[]) {
      try {
        const ops = make();
        panel.inert = true;
        void ctx.commit({ type: "edit", ops, summary }, summary, base).finally(() => {
          panel.inert = false;
        });
      } catch (error) {
        ctx.showBanner("error", failure(error));
      }
    }
    function outfitOps(next: CharacterDocument) {
      const ops: object[] = [];
      if (next.generation && doc?.generation?.params !== next.generation.params)
        ops.push({ op: "generation.steer", params: next.generation.params });
      for (const id of [outfitWardrobe.id, outfitLayers.id, characterAppearance.id]) {
        const value = next.features[id];
        if (value !== undefined && value !== doc?.features[id]) ops.push(feature(id, value));
      }
      return ops;
    }
    const bases = choices(outfits, wornOutfit(doc));
    bases.input.onchange = () =>
      edit("Wear " + bases.read(), () => outfitOps(chooseWardrobe(doc, bases.read())));
    baseBox.replaceChildren(field("Base outfit", bases.input));
    const params = adultWardrobeParams(doc);
    tailor.hidden = !params;
    if (params)
      tailor.querySelector("div")?.replaceChildren(
        ...tailorControls(
          params,
          pieceIndex,
          (i) => {
            pieceIndex = i;
            render();
          },
          (next, summary) => edit(summary, () => [{ op: "generation.steer", params: next }]),
        ),
      );
    const garments = fittedGarments(doc);
    const host =
      doc.parts.find((p) => p.id === ctx.selection && !garments.includes(p)) ??
      doc.parts.find((p) => p.slot === (kind === "Skirt" ? "pelvis" : "spine-03")) ??
      doc.parts.find((p) => outfitWear.read(p.features)?.role === "torso") ??
      doc.parts.find((p) => p.parent === null);
    const kinds = choices(mantleCuts, kind),
      color = colour(fabric);
    kinds.input.onchange = () => {
      kind = kinds.read();
      render();
    };
    color.onchange = () => {
      fabric = color.value;
    };
    const cutButton = button("Cut garment", () => {
      if (!host) return;
      edit("Cut " + kind + " to fit " + host.label, () => {
        const part = cut(host.id, kind, color.value);
        layerId = part.id;
        return [{ op: "part.add", part }];
      });
    });
    cutButton.disabled = !host;
    cutting.replaceChildren(
      field("Garment cut", kinds.input),
      field("New fabric colour", color),
      el("p", { className: "muted", text: "Fit to " + (host?.label ?? "a body region") }),
      cutButton,
    );
    const garment = garments.find((p) => p.id === layerId) ?? garments.at(-1);
    layers.replaceChildren();
    if (garment) {
      const list = choices(
        garments.map((p) => String(p.id)),
        String(garment.id),
        (id) => garments.find((p) => p.id === id)?.label ?? id,
      );
      list.input.onchange = () => {
        layerId = list.read();
        render();
      };
      const style = outfitLayers.read(doc.features)?.layers[garment.id];
      const visibility = choices(
        ["Follow outfit", "Show", "Hide"] as const,
        style?.show === undefined ? "Follow outfit" : style.show ? "Show" : "Hide",
      );
      const dye = colour(style?.dye ?? "#ffffff");
      const order = choices(
        Array.from({ length: 16 }, (_, i) => String(i)),
        String(style?.order ?? 0),
      );
      layers.append(
        field("Garment layer", list.input),
        field("Visibility", visibility.input),
        field("Overdye", dye),
        field("Layer order", order.input),
        button("Apply layer", () =>
          edit("Restyle " + garment.label, () => [
            feature(
              outfitLayers.id,
              styleGarment(doc, garment.id, {
                ...(visibility.read() === "Follow outfit"
                  ? {}
                  : { show: visibility.read() === "Show" }),
                ...(dye.value === "#ffffff" ? {} : { dye: dye.value }),
                ...(order.read() === "0" ? {} : { order: Number(order.read()) }),
              }),
            ),
          ]),
        ),
      );
      const mantle = figureMantle.read(garment.features);
      if (mantle)
        layers.append(
          cutFields(
            mantle.cut,
            garment.color,
            figureFinish.read(garment.features)?.surface ?? "plain",
            (next, colour, finish) =>
              edit("Adjust " + garment.label, () => [
                feature(figureMantle.id, figureMantle.json({ cut: next }), garment.id),
                feature(figureFinish.id, figureFinish.json({ surface: finish }), garment.id),
                { op: "part.set", part: garment.id, set: { color: colour } },
              ]),
          ),
        );
    }
    const name = el("input");
    name.maxLength = 64;
    const looks = savedLooks(doc),
      active = looks.find((l) => l.name === lookName) ?? looks[0];
    saved.replaceChildren(
      field("New outfit name", name),
      button("Save outfit", () =>
        edit("Save outfit", () => {
          const value = saveLook(doc, name.value);
          lookName = name.value.trim();
          return [feature(outfitLooks.id, value)];
        }),
      ),
    );
    if (active) {
      const names = choices(
        looks.map((l) => l.name),
        active.name,
      );
      names.input.onchange = () => {
        lookName = names.read();
        render();
      };
      saved.append(
        field("Saved outfit", names.input),
        button("Wear outfit", () =>
          edit("Wear " + active.name, () => outfitOps(wearLook(doc, active))),
        ),
        button("Update outfit", () =>
          edit("Update " + active.name, () => [
            feature(outfitLooks.id, saveLook(doc, active.name, true)),
          ]),
        ),
      );
    }
  }
  return { render };
}
