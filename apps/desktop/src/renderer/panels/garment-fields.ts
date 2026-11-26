import {
  armAccess,
  armAccessOptions,
  finishes,
  type Finish,
  type MantleCut,
} from "@irudd/document";
import { traceSkirt } from "@irudd/character";
import { button, el } from "../dom.js";

export const field = (name: string, control: HTMLElement) => el("label", {}, name, control);

export function choices<T extends string>(
  values: readonly T[],
  value: T,
  label: (v: T) => string = (v) => v,
) {
  const input = el("select");
  for (const v of values) input.add(new Option(label(v), v));
  input.value = value;
  return { input, read: () => values.find((v) => v === input.value) ?? value };
}

export function colour(value: string) {
  const input = el("input");
  input.type = "color";
  input.value = value;
  return input;
}

function traceControl(apply: (outline: ReturnType<typeof traceSkirt>) => void) {
  const box = el("details", {}, el("summary", { text: "Trace waist to hem" }));
  const file = el("input");
  file.type = "file";
  file.accept = "image/*";
  const canvas = el("canvas");
  canvas.width = 360;
  canvas.height = 420;
  canvas.tabIndex = 0;
  const ctx = canvas.getContext("2d");
  const points: [number, number][] = [];
  let picture: ImageBitmap | undefined;
  const note = el("p", {
    text: "Mark the waist centre, waist edge and points down one side to the hem.",
  });
  function draw() {
    if (!ctx) return;
    ctx.fillStyle = "#333a3b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (picture) {
      const scale = Math.min(canvas.width / picture.width, canvas.height / picture.height);
      ctx.drawImage(picture, 0, 0, picture.width * scale, picture.height * scale);
    }
    ctx.beginPath();
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.strokeStyle = "#ffcc62";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffcc62";
    for (const [x, y] of points) ctx.fillRect(x - 2, y - 2, 5, 5);
  }
  file.onchange = async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      const image = await createImageBitmap(selected);
      if (file.files?.[0] !== selected) {
        image.close();
        return;
      }
      picture?.close();
      picture = image;
      points.length = 0;
      draw();
    } catch {
      note.textContent = "The reference image could not be opened.";
    }
  };
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    points.push([
      ((e.clientX - rect.left) * canvas.width) / rect.width,
      ((e.clientY - rect.top) * canvas.height) / rect.height,
    ]);
    draw();
  };
  draw();
  box.append(
    field("Pattern reference", file),
    note,
    canvas,
    button("Undo point", () => {
      points.pop();
      draw();
    }),
    button("Apply outline", () => {
      try {
        apply(traceSkirt(points));
      } catch (error) {
        note.textContent = String(error);
      }
    }),
  );
  return box;
}

export function cutFields(
  cut: MantleCut,
  color: string,
  surface: Finish,
  apply: (next: MantleCut, color: string, finish: Finish) => void,
) {
  const form = el("form");
  const fabric = colour(color),
    finish = choices(finishes, surface);
  form.append(field("Fabric colour", fabric), field("Finish", finish.input));
  function amount(label: string, value: number, min: number, max: number, step: number) {
    const input = el("input");
    input.type = "number";
    input.required = true;
    input.min = String(min);
    input.max = String(max);
    input.step = "any";
    input.value = String(value);
    if (step === 1) input.step = "1";
    form.append(field(label, input));
    return () => input.valueAsNumber;
  }
  const drop = amount("Drop (m)", cut.drop, 0.025, 8, 0.01),
    flare = amount("Flare", cut.flare, 0.65, 2.2, 0.01),
    folds = amount("Folds", cut.folds, 0, 24, 1);
  let shape: () => MantleCut;
  if (cut.kind === "Skirt") {
    const pleats = amount("Pleats", cut.pleats ?? 0, 0, 24, 1),
      depth = amount("Pleat depth", cut.pleatDepth ?? 0.14, 0, 0.35, 0.01);
    const clearance = amount(
      "Waist clearance (mm)",
      (cut.waistClearance ?? 0.007) * 1000,
      0,
      60,
      0.1,
    );
    const bias = amount("Bias", cut.bias, -1, 1, 0.01),
      gather = amount("Gather", cut.gather, 0, 0.3, 0.01);
    const tiers = amount("Tiers", cut.tiers, 0, 6, 1),
      train = amount("Train (m)", cut.train, 0, 2, 0.01);
    shape = () => ({
      ...cut,
      pleats: pleats(),
      pleatDepth: depth(),
      waistClearance: clearance() / 1000,
      bias: bias(),
      gather: gather(),
      tiers: tiers(),
      train: train(),
    });
    form.append(traceControl((outline) => apply({ ...cut, outline }, color, surface)));
  } else {
    const opening = amount("Front opening (degrees)", cut.opening, 2, 150, 1);
    const access = choices(armAccessOptions, armAccess(cut));
    form.append(field("Arm access", access.input));
    shape = () => ({ ...cut, opening: opening(), armAccess: access.read() });
  }
  const submit = el("button", { text: "Adjust cut" });
  form.append(submit);
  form.onsubmit = (e) => {
    e.preventDefault();
    apply(
      { ...shape(), drop: drop(), flare: flare(), folds: folds() },
      fabric.value,
      finish.read(),
    );
  };
  return form;
}
