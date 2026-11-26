import { button, el } from "../dom.js";
import { choices, colour, field } from "./garment-fields.js";

export const seed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
export type Edit = (
  summary: string,
  make: () => readonly object[],
  select?: () => string | null,
) => void;

export function surfaceFields(title: string, open: Set<string>) {
  const box = el("details"),
    rows = el("div", { className: "surface-fields" });
  box.open = open.has(title);
  box.ontoggle = () => {
    if (!box.isConnected) return;
    if (box.open) open.add(title);
    else open.delete(title);
  };
  box.append(el("summary", { text: title }), rows);
  function choose<T extends string>(name: string, values: readonly T[], value: T) {
    const select = choices(values, value);
    rows.append(field(name, select.input));
    return select.read;
  }
  function numeric(name: string, value: number, min: number, max: number, step = 0.01) {
    const input = el("input");
    Object.assign(input, {
      type: "number",
      min: String(min),
      max: String(max),
      step: step === 1 ? "1" : "any",
      value: String(value),
    });
    rows.append(field(name, input));
    return () => {
      if (!input.value || !input.checkValidity())
        throw new Error(name + " must be between " + min + " and " + max + ".");
      return input.valueAsNumber;
    };
  }
  function color(name: string, value: string) {
    const input = colour(value);
    rows.append(field(name, input));
    return () => input.value;
  }
  function check(name: string, value: boolean) {
    const input = el("input");
    input.type = "checkbox";
    input.checked = value;
    rows.append(field(name, input));
    return () => input.checked;
  }
  function action(name: string, run: () => void, enabled = true) {
    const b = button(name, run);
    b.disabled = !enabled;
    rows.append(b);
  }
  return { box, rows, choose, numeric, color, check, action };
}
export type Fields = ReturnType<typeof surfaceFields>;
