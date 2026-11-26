import {
  defaultTailor,
  readTailor,
  tailorAdult,
  tailorLayer,
  tailorLimit,
  tailorPieces,
  type HumanAdultParams,
  type TailorLayer,
} from "@irudd/character/human";
import { button, el } from "../dom.js";
import { choices, colour, field } from "./garment-fields.js";

export function tailorControls(
  params: HumanAdultParams,
  index: number,
  select: (i: number) => void,
  save: (next: HumanAdultParams, message: string) => void,
) {
  if (params.style.cast)
    return [
      el("p", { text: "Choose Individual styling under Outfit and hairstyle to tailor pieces." }),
    ];
  const layers = readTailor(params.style.tailor)?.layers ?? [];
  const set = (next: readonly TailorLayer[], message: string) =>
    save(tailorAdult(params, next), message);
  const selected = Math.min(index, layers.length - 1),
    layer = layers[selected];
  if (!layer)
    return [
      button("Tailor this outfit", () => {
        select(0);
        set(defaultTailor(params.style.clothColor).layers, "Tailor outfit");
      }),
    ];
  const piece = tailorPieces[layer.piece];
  if (!piece) return [];
  const list = choices(
    layers.map((_, i) => String(i)),
    String(selected),
    (v) => {
      const name = layers[Number(v)]?.piece ?? "";
      return Number(v) + 1 + ". " + (tailorPieces[name]?.label ?? name);
    },
  );
  list.input.onchange = () => select(Number(list.read()));
  const controls: HTMLElement[] = [field("Tailored layer", list.input)];
  for (const [key, spec] of Object.entries(piece.fields)) {
    const value = layer[key] ?? spec.value;
    const input =
      spec.type === "choice"
        ? choices(spec.options, String(value)).input
        : spec.type === "colour"
          ? colour(String(value))
          : el("input");
    if (spec.type === "range" && input instanceof HTMLInputElement) {
      input.type = "number";
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = spec.step === 1 ? "1" : "any";
      input.value = String(value);
    }
    input.onchange = () => {
      if (!input.reportValidity() || !input.value) return;
      set(
        layers.map((l, i) =>
          i === selected
            ? { ...l, [key]: spec.type === "range" ? Number(input.value) : input.value }
            : l,
        ),
        "Change " + piece.label + " " + spec.label,
      );
    };
    controls.push(field(spec.label, input));
  }
  function move(offset: number) {
    const next = [...layers],
      to = selected + offset;
    next.splice(to, 0, ...next.splice(selected, 1));
    select(to);
    set(next, "Reorder tailored layers");
  }
  const earlier = button("Wear earlier", () => move(-1)),
    later = button("Wear later", () => move(1));
  earlier.disabled = selected === 0;
  later.disabled = selected === layers.length - 1;
  const kind = choices(Object.keys(tailorPieces), "top", (k) => tailorPieces[k]?.label ?? k);
  const add = button("Add piece", () => {
    select(layers.length);
    set([...layers, tailorLayer(kind.read())], "Add " + kind.read());
  });
  add.disabled = layers.length >= tailorLimit;
  controls.push(
    el(
      "div",
      { className: "row-actions" },
      earlier,
      later,
      button("Remove piece", () =>
        set(
          layers.filter((_, i) => i !== selected),
          "Remove " + piece.label,
        ),
      ),
    ),
    field("Piece to add", kind.input),
    add,
    button("Remove tailored pieces", () => set([], "Remove tailored pieces")),
  );
  return controls;
}
