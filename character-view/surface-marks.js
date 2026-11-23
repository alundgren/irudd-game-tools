import { Matrix3, Vector3 } from "three";
import { pickSurface } from "./surface-pick.js";
import { findPart } from "./manipulator.js";

const byId = (id) => document.getElementById(id);
const vector = (p) =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
export function validSurfaceMarks(marks) {
  return (
    Array.isArray(marks) &&
    marks.length <= 12 &&
    new Set(marks.map((m) => m?.name)).size === marks.length &&
    marks.every(
      (m) =>
        m &&
        typeof m.name === "string" &&
        m.name.trim().length > 0 &&
        m.name.length <= 48 &&
        typeof m.region === "string" &&
        vector(m.local) &&
        vector(m.normal),
    )
  );
}
export function surfaceMarkEditor(
  stage,
  canvas,
  camera,
  { figure, read, write, available, note },
) {
  const toggle = byId("ai-mark-add"),
    name = byId("ai-mark-name"),
    list = byId("ai-mark-list"),
    overlay = document.createElement("div");
  overlay.className = "surface-marks";
  stage.append(overlay);
  let active = false,
    down = null,
    labels = [],
    previous = null;
  function cancel() {
    active = false;
    down = null;
    toggle.setAttribute("aria-pressed", "false");
  }
  toggle.onclick = () => {
    if (active) {
      cancel();
      return;
    }
    const label = name.value.trim();
    if (read().length >= 12 || !label || read().some((m) => m.name === label)) {
      note(
        "Give the new point a unique name. A request can carry up to 12 marks.",
      );
      name.focus();
      return;
    }
    active = true;
    toggle.setAttribute("aria-pressed", "true");
    note(
      "Click the model at " +
        label +
        ". Drag to orbit before placing the mark.",
    );
  };
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (active && e.button === 0 && e.isPrimary)
        down = [e.pointerId, e.clientX, e.clientY];
    },
    true,
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      down = null;
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (!active || !available() || !down || e.pointerId !== down[0]) return;
      const click = Math.hypot(e.clientX - down[1], e.clientY - down[2]) < 5;
      down = null;
      if (!click) return;
      const root = figure(),
        hit = pickSurface(e, canvas, camera, root);
      if (!hit) {
        note("Click a visible part of the character.");
        return;
      }
      const label = name.value.trim(),
        part = findPart(root, hit.id);
      if (!part || !label || read().some((m) => m.name === label)) return;
      const n = new Matrix3().getNormalMatrix(part.matrixWorld);
      const mark = {
        name: label,
        region: hit.id,
        local: part.worldToLocal(hit.point.clone()).toArray(),
        normal: hit.normal.applyMatrix3(n.invert()).normalize().toArray(),
      };
      cancel();
      name.value = "";
      write([...read(), mark]);
      note("Marked " + label + " on " + hit.id + ".");
    },
    true,
  );
  function sync() {
    toggle.disabled = !available();
    if (toggle.disabled) cancel();
    const marks = read();
    if (marks === previous) return;
    previous = marks;
    labels = [];
    list.replaceChildren();
    overlay.replaceChildren();
    for (const m of marks) {
      const row = document.createElement("div"),
        text = document.createElement("span"),
        remove = document.createElement("button"),
        label = document.createElement("span");
      text.textContent = m.name + " · " + m.region;
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove mark " + m.name);
      remove.onclick = () => {
        if (available()) write(read().filter((x) => x !== m));
      };
      row.append(text, remove);
      list.append(row);
      label.textContent = m.name;
      overlay.append(label);
      labels.push(label);
    }
  }
  function resolved() {
    const result = [],
      root = figure();
    if (!root) return result;
    for (const m of read()) {
      const part = findPart(root, m.region);
      if (!part) continue;
      part.updateWorldMatrix(true, false);
      const p = part.localToWorld(new Vector3(...m.local)),
        n = new Vector3(...m.normal)
          .applyMatrix3(new Matrix3().getNormalMatrix(part.matrixWorld))
          .normalize();
      result.push({
        name: m.name,
        region: m.region,
        world: p.toArray(),
        normal: n.toArray(),
      });
    }
    return result;
  }
  function draw() {
    overlay.hidden = !available() || !read().length;
    if (overlay.hidden) return;
    const marks = resolved();
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i],
        m = marks.find((m) => m.name === read()[i].name);
      label.hidden = !m;
      if (!m) continue;
      const p = new Vector3(...m.world).project(camera);
      label.style.left = (p.x * 0.5 + 0.5) * 100 + "%";
      label.style.top = (0.5 - p.y * 0.5) * 100 + "%";
    }
  }
  return { cancel, sync, draw, resolved };
}
