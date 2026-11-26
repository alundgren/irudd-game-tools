import { Vector3, Matrix4, MathUtils } from "three";
import { reshapeSpine } from "./spine-edit.js";

export function spineHandles(
  stage,
  camera,
  { preview, finish, cancel, choose },
) {
  const overlay = document.createElement("div");
  overlay.className = "face-handles";
  overlay.hidden = true;
  stage.append(overlay);
  let drag = null,
    part = null,
    form = null,
    object = null,
    buttons = [],
    frame = null;
  function geometry(event) {
    const box = stage.getBoundingClientRect(),
      d = new Vector3(
        (2 * (event.clientX - drag.x)) / box.width,
        (-2 * (event.clientY - drag.y)) / box.height,
        0,
      );
    const local = drag.clip
      .clone()
      .add(d)
      .unproject(camera)
      .applyMatrix4(drag.inverse);
    const index = drag.index,
      old = drag.part.knots;
    if (drag.part.paint && drag.part.paint.frame !== "path")
      local.y = MathUtils.clamp(
        local.y,
        (old[index - 1]?.[1] ?? -12) + 0.0002,
        (old[index + 1]?.[1] ?? 12) - 0.0002,
      );
    const rows = old.map((r, j) =>
      index === j ? [...local.toArray(), ...r.slice(3)] : r,
    );
    if (
      rows.some(
        (r, j) =>
          j > 0 &&
          Math.hypot(...r.slice(0, 3).map((v, k) => v - rows[j - 1][k])) <
            0.0002,
      )
    )
      return;
    drag.next = reshapeSpine(drag.form, drag.part.id, rows);
  }
  function addButton() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "face-handle spine-handle";
    overlay.append(el);
    el.onpointerdown = (e) => {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      e.stopPropagation();
      const index = Number(el.dataset.index),
        clip = new Vector3(...part.knots[index].slice(0, 3))
          .applyMatrix4(object.matrixWorld)
          .project(camera);
      drag = {
        id: e.pointerId,
        index,
        form,
        part,
        clip,
        inverse: new Matrix4().copy(object.matrixWorld).invert(),
        x: e.clientX,
        y: e.clientY,
        next: null,
      };
      el.setPointerCapture(e.pointerId);
    };
    el.onpointermove = (e) => {
      if (
        e.pointerId !== drag?.id ||
        (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 2 && !drag.next)
      )
        return;
      geometry(e);
      if (frame === null)
        frame = requestAnimationFrame(() => {
          frame = null;
          if (drag?.next) preview(drag.next);
        });
    };
    el.onpointerup = (e) => {
      if (e.pointerId !== drag?.id) return;
      if (drag.next) geometry(e);
      const { next, index } = drag;
      drag = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      el.releasePointerCapture(e.pointerId);
      if (next) finish(next, index);
      else choose(index);
    };
    el.onpointercancel = () => {
      if (!drag) return;
      drag = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      cancel();
    };
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(Number(el.dataset.index));
      }
    };
    return el;
  }
  return function position(current, selected, mesh, selection, enabled) {
    overlay.hidden = !enabled || !mesh || !selected?.knots;
    if (overlay.hidden) return;
    form = current;
    part = selected;
    object = mesh;
    const last = part.knots.length - 1,
      indices = new Set();
    for (let j = 0; j <= Math.min(last, 14); j++)
      indices.add(Math.round((j * last) / Math.min(last, 14)));
    if (selection !== null) indices.add(selection);
    const ordered = [...indices].sort((a, b) => a - b);
    mesh.updateWorldMatrix(true, false);
    while (buttons.length < ordered.length) buttons.push(addButton());
    buttons.forEach((button, n) => {
      button.hidden = n >= ordered.length;
      if (button.hidden) return;
      const i = ordered[n],
        p = new Vector3(...part.knots[i].slice(0, 3))
          .applyMatrix4(mesh.matrixWorld)
          .project(camera);
      button.dataset.index = i;
      button.title = "Spine point " + (i + 1);
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(i === selection));
      button.style.left = (1 + p.x) * 50 + "%";
      button.style.top = (1 - p.y) * 50 + "%";
    });
  };
}
