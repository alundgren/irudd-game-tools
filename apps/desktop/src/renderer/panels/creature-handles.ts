import { creatureHandles, moveHandle } from "@irudd/character/creature";
import type { CreaturePlan, Vec3 } from "@irudd/document";
import { byId, el } from "../dom.js";

export function planHandles(project: (p: Vec3) => readonly [number, number]) {
  const host = byId("viewport", HTMLDivElement);
  let positions: (() => void)[] = [];
  function show(p?: CreaturePlan, commit?: (next: CreaturePlan, label: string) => void) {
    for (const node of host.querySelectorAll(".creature-handle")) node.remove();
    positions = [];
    if (!p || !commit) return;
    for (const h of creatureHandles(p)) {
      let value = h.value;
      const node = el("button", { className: "creature-handle " + h.kind });
      node.setAttribute("aria-label", h.label);
      node.title = h.label;
      const place = () => {
        const [x, y] = project(h.point(value));
        node.style.left = x + "px";
        node.style.top = y + "px";
      };
      positions.push(place);
      host.append(node);
      place();
      node.onpointerdown = (event) => {
        event.preventDefault();
        node.setPointerCapture(event.pointerId);
      };
      node.onpointermove = (event) => {
        if (!node.hasPointerCapture(event.pointerId)) return;
        const rect = host.getBoundingClientRect(),
          x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        let best = Infinity;
        for (let i = 0; i <= 100; i++) {
          const n = h.min + ((h.max - h.min) * i) / 100,
            [px, py] = project(h.point(n)),
            distance = Math.hypot(x - px, y - py);
          if (distance < best) {
            best = distance;
            value = n;
          }
        }
        place();
      };
      node.onpointerup = (event) => {
        if (!node.hasPointerCapture(event.pointerId)) return;
        node.releasePointerCapture(event.pointerId);
        if (value !== h.value) commit(moveHandle(p, h, value), h.label);
      };
      node.onpointercancel = () => {
        value = h.value;
        place();
      };
      node.onkeydown = (event) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? 0.05 : -0.05;
        commit(moveHandle(p, h, h.value + delta), h.label);
      };
    }
  }
  return { show, place: () => positions.forEach((place) => place()) };
}
