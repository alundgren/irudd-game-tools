import type { SheetPanels } from "@irudd/character/trace-build";
import { button, el } from "../dom.js";
import { pictureMarks } from "./picture-marks.js";

export function traceGuides(getPanels: () => SheetPanels | undefined, method: () => string) {
  const front = pictureMarks("Front outline", false),
    side = pictureMarks("Profile outline", false);
  const views = [front, side] as const;
  let hover: number | undefined;
  let active = front;
  function draw() {
    for (const view of views) if (view.loaded) view.redraw();
  }
  function clear() {
    for (const view of views) view.marks.length = 0;
    hover = undefined;
    draw();
  }
  for (const [index, view] of views.entries()) {
    const { canvas, marks } = view;
    view.node.querySelector("button")?.remove();
    canvas.addEventListener("click", () => {
      active = view;
    });
    canvas.onpointermove = (e) => {
      const panel = getPanels()?.[index];
      if (!panel) return;
      const rect = canvas.getBoundingClientRect();
      hover = (panel.feet - ((e.clientY - rect.top) / rect.height) * panel.size) / panel.span;
      draw();
    };
    canvas.onpointerleave = () => {
      hover = undefined;
      draw();
    };
    view.drawOverlay((ctx) => {
      const size = canvas.width,
        kind = method();
      ctx.save();
      ctx.strokeStyle = "#fffbd8";
      ctx.lineWidth = size / 200;
      if (!["face", "depth"].includes(kind)) {
        ctx.beginPath();
        for (const [u, v] of marks) ctx.lineTo(u * size, v * size);
        if (marks.length > 2 && kind !== "path") {
          ctx.closePath();
          ctx.fillStyle = "#153b4780";
          ctx.fill();
        }
        ctx.stroke();
      } else if (kind === "face") {
        ctx.fillStyle = "#fffbd8";
        ctx.font = "bold 18px system-ui";
        marks.forEach(([u, v], i) => ctx.fillText(String(i + 1), u * size + 9, v * size - 4));
      }
      const panel = getPanels()?.[index];
      if (panel && hover !== undefined) {
        const y = ((panel.feet - hover * panel.span) / panel.size) * size;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
      ctx.restore();
    });
  }
  const node = el("div", { className: "trace-guides" }, front.node, side.node);
  const controls = el(
    "div",
    {},
    button("Undo point", () => {
      const view =
        method() === "depth"
          ? side.marks.length
            ? side
            : front
          : method() === "face"
            ? front
            : active;
      view.marks.pop();
      draw();
    }),
    button("Clear outlines", clear),
  );
  return { front, side, node, controls, clear, draw };
}
