import { button, el } from "../dom.js";
import { field } from "./garment-fields.js";
import type { Mark } from "@irudd/character";

export function pictureMarks(label: string, importable: boolean, maximum = 96) {
  const node = el("div"),
    canvas = el("canvas"),
    source = el("canvas");
  canvas.className = "mark-picture";
  canvas.hidden = true;
  const marks: Mark[] = [];
  const context = canvas.getContext("2d");
  const status = el("span");
  function redraw() {
    if (!context) return;
    context.drawImage(source, 0, 0);
    context.fillStyle = "#ffdc44";
    context.strokeStyle = "#171410";
    context.lineWidth = Math.max(1, canvas.width / 320);
    for (const [u, v] of marks) {
      context.beginPath();
      context.arc(u * canvas.width, v * canvas.height, canvas.width * 0.009, 0, 2 * Math.PI);
      context.fill();
      context.stroke();
    }
    status.textContent = marks.length + " marks";
  }
  function set(image: CanvasImageSource, w: number, h: number) {
    const ratio = Math.min(1, 1024 / Math.max(w, h));
    source.width = canvas.width = Math.max(1, Math.round(w * ratio));
    source.height = canvas.height = Math.max(1, Math.round(h * ratio));
    source.getContext("2d")?.drawImage(image, 0, 0, source.width, source.height);
    marks.length = 0;
    canvas.hidden = false;
    redraw();
  }
  if (importable) {
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.onchange = async () => {
      const selected = file.files?.[0];
      canvas.hidden = true;
      marks.length = 0;
      status.textContent = "";
      if (!selected) return;
      try {
        const im = await createImageBitmap(selected);
        if (file.files?.[0] === selected) set(im, im.width, im.height);
        im.close();
      } catch {
        status.textContent = "Could not open the picture.";
      }
    };
    node.append(field(label, file));
  } else node.append(el("p", { text: label }));
  canvas.setAttribute("aria-label", label + " marks");
  canvas.onclick = (e) => {
    if (marks.length >= maximum) return;
    const box = canvas.getBoundingClientRect();
    marks.push([(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height]);
    redraw();
  };
  node.append(
    canvas,
    button("Undo mark", () => {
      marks.pop();
      redraw();
    }),
    status,
  );
  return {
    node,
    marks,
    source,
    set,
    pixels() {
      const ctx = source.getContext("2d");
      if (!ctx) throw new Error("Cannot read this picture.");
      return ctx.getImageData(0, 0, source.width, source.height);
    },
    get loaded() {
      return !canvas.hidden;
    },
    get aspect() {
      return source.width / source.height;
    },
  };
}
