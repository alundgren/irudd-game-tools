import { Vector3 } from "three";

const handles = [
  { label: "Brow height", x: -0.38, y: 0.67, vertical: "brow" },
  {
    label: "Eye spacing and size",
    x: 0.38,
    y: 0.56,
    horizontal: "eyes",
    vertical: "eye size",
  },
  { label: "Nose projection", x: 0, y: 0.43, vertical: "nose" },
  { label: "Cheek fullness", x: -0.58, y: 0.42, horizontal: "cheek", sign: -1 },
  {
    label: "Mouth width and smile",
    x: 0.25,
    y: 0.25,
    horizontal: "mouth",
    vertical: "smile",
  },
  { label: "Lip fullness", x: 0, y: 0.245, vertical: "lips" },
  { label: "Jaw width", x: -0.65, y: 0.18, horizontal: "jaw", sign: -1 },
  { label: "Chin length", x: 0, y: 0.045, vertical: "chin", down: true },
];
export function faceHandles(stage, { start, move, finish, cancel }) {
  const overlay = document.createElement("div");
  overlay.className = "face-handles";
  stage.append(overlay);
  let drag = null,
    screenWidth = 120;
  const buttons = handles.map((h) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "face-handle";
    el.title = h.label;
    el.setAttribute("aria-label", h.label);
    overlay.append(el);
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        h,
        el,
        base: start(),
        moved: false,
      };
      el.setPointerCapture(e.pointerId);
    };
    el.onpointermove = (e) => {
      if (!drag || drag.el !== el || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) < 2 && !drag.moved) return;
      drag.moved = true;
      const delta = { ...drag.base };
      const set = (key, amount) => {
        if (key)
          delta[key] = Math.min(
            40,
            Math.max(-40, Math.round((drag.base[key] ?? 0) + amount)),
          );
      };
      set(h.horizontal, (dx / screenWidth) * 130 * (h.sign ?? 1));
      set(h.vertical, (dy / screenWidth) * 130 * (h.down ? 1 : -1));
      move(delta);
    };
    el.onpointerup = (e) => {
      if (drag?.el !== el) return;
      const changed = drag.moved;
      drag = null;
      el.releasePointerCapture(e.pointerId);
      if (changed) finish();
    };
    el.onpointercancel = () => {
      if (drag) {
        const base = drag.base;
        drag = null;
        cancel(base);
      }
    };
    return el;
  });
  return function position(object, painted, camera, enabled) {
    overlay.hidden = !enabled || !object;
    if (overlay.hidden) return;
    let mesh = painted ? object : null;
    if (!mesh)
      object.traverse((o) => {
        if (o.userData.faceSurface) mesh = o;
      });
    if (!mesh?.geometry) {
      overlay.hidden = true;
      return;
    }
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const b = geo.boundingBox,
      span = b.getSize(new Vector3()),
      centre = b.getCenter(new Vector3());
    const origin = painted ? 0.24 : 0,
      chin = b.min.y + span.y * origin;
    const project = (x, y, z) =>
      mesh.localToWorld(new Vector3(x, y, z)).project(camera);
    const a = project(b.min.x, centre.y, b.max.z),
      c = project(b.max.x, centre.y, b.max.z);
    screenWidth = Math.max(40, Math.abs(c.x - a.x) * stage.clientWidth * 0.5);
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i],
        at = project(
          centre.x + span.x * 0.5 * h.x,
          chin + span.y * (1 - origin) * h.y,
          centre.z + span.z * 0.54 * Math.sqrt(1 - h.x * h.x),
        );
      const el = buttons[i];
      el.style.left = (at.x + 1) * 50 + "%";
      el.style.top = (1 - at.y) * 50 + "%";
    }
  };
}
