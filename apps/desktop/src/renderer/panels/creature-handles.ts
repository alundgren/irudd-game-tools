import { creatureHandles, handleValue, moveHandle, type Handle } from "@irudd/character/creature";
import type { CreaturePlan, Vec3 } from "@irudd/document";
import { byId, el } from "../dom.js";

export function planHandles(
  project: (p: Vec3) => readonly [number, number],
  axes: () => { forward: Vec3; up: Vec3 },
  preview: (plan?: CreaturePlan) => void,
  note: (text: string) => void,
) {
  const host = byId("viewport", HTMLDivElement),
    svgNS = "http://www.w3.org/2000/svg";
  const overlay = el("div", { className: "plan-guides" }),
    guide = document.createElementNS(svgNS, "svg"),
    reading = el("output");
  overlay.append(guide, reading);
  host.append(overlay);
  let place = () => {},
    cancel = () => {};
  function show(p?: CreaturePlan, commit?: (next: CreaturePlan, label: string) => void) {
    cancel();
    place = () => {};
    for (const node of host.querySelectorAll(".creature-handle")) node.remove();
    overlay.hidden = true;
    if (!p || !commit) return;
    let frame = 0,
      shown = false,
      hot = -1,
      held:
        | {
            index: number;
            h: Handle;
            id: number;
            x: number;
            y: number;
            at: readonly [number, number];
            node: HTMLButtonElement;
            value: number;
            moved: boolean;
          }
        | undefined;
    const get = () => {
      const a = axes();
      return creatureHandles(p, a.forward, a.up);
    };
    const nodes = get().map((h) =>
      el("button", { className: "creature-handle " + h.kind, title: h.label }),
    );
    function release() {
      cancelAnimationFrame(frame);
      frame = 0;
      const drag = held;
      held = undefined;
      if (drag?.node.hasPointerCapture(drag.id)) drag.node.releasePointerCapture(drag.id);
      if (shown) {
        shown = false;
        preview();
      }
      window.removeEventListener("keydown", escape, true);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape" && held) {
        e.preventDefault();
        e.stopImmediatePropagation();
        release();
        place();
        note("Drag cancelled.");
      }
    }
    cancel = release;
    function draw(h: Handle, v: number, old: boolean) {
      const g = h.guides(v);
      for (const path of g.lines) {
        const line = document.createElementNS(svgNS, "polyline");
        line.setAttribute("points", path.map((p) => project(p).join(",")).join(" "));
        line.setAttribute("class", old ? "was" : "now");
        guide.append(line);
      }
      for (const dot of g.dots) {
        const circle = document.createElementNS(svgNS, "circle"),
          [x, y] = project(dot);
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("r", "4");
        circle.setAttribute("class", old ? "was" : "now");
        guide.append(circle);
      }
    }
    place = () => {
      guide.replaceChildren();
      overlay.hidden = hot < 0 && !held;
      for (const [i, h] of get().entries()) {
        const node = nodes[i];
        if (!node) continue;
        const v = held?.index === i ? held.value : h.value,
          [x, y] = project(h.point(v));
        node.style.left = x + "px";
        node.style.top = y + "px";
        if ((held?.index ?? hot) !== i) continue;
        if (held) draw(h, h.value, true);
        draw(h, v, false);
        reading.textContent = h.readout(v);
        reading.style.left = Math.min(Math.max(x, 98), host.clientWidth - 98) + "px";
        reading.style.top = (y < 54 ? y + 20 : y - 36) + "px";
      }
    };
    nodes.forEach((node, index) => {
      const initial = get()[index];
      if (!initial) return;
      node.setAttribute("aria-label", initial.label);
      host.append(node);
      node.onpointerenter = node.onfocus = () => {
        hot = index;
        place();
      };
      node.onpointerleave = node.onblur = () => {
        hot = -1;
        place();
      };
      node.onwheel = (e) => {
        e.preventDefault();
        host.querySelector("canvas")?.dispatchEvent(new WheelEvent("wheel", e));
      };
      node.onkeydown = (e) => {
        const sign = ["ArrowUp", "ArrowRight"].includes(e.key)
          ? 1
          : ["ArrowDown", "ArrowLeft"].includes(e.key)
            ? -1
            : 0;
        if (!sign || held) return;
        e.preventDefault();
        const h = get()[index];
        if (!h) return;
        const next = moveHandle(
          p,
          h,
          h.kind === "girth" ? h.value * 1.05 ** sign : h.value + sign * 0.02,
        );
        if (JSON.stringify(next) !== JSON.stringify(p)) commit(next, h.label);
      };
      node.onpointerdown = (e) => {
        if (e.button !== 0 || !e.isPrimary || held) return;
        e.preventDefault();
        const h = get()[index];
        if (!h) return;
        if (h.kind === "limb") {
          const rail = h.guides(h.value).lines[0]?.map(project) ?? [];
          if (
            rail.reduce((n, a, i) => {
              const b = rail[i - 1];
              return n + (b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0);
            }, 0) < 24
          ) {
            note("Turn the view to see the body from its side.");
            return;
          }
        }
        held = {
          index,
          h,
          id: e.pointerId,
          node,
          at: project(h.point(h.value)),
          x: e.clientX,
          y: e.clientY,
          value: h.value,
          moved: false,
        };
        node.setPointerCapture(e.pointerId);
        node.focus({ preventScroll: true });
        window.addEventListener("keydown", escape, true);
        place();
      };
      node.onpointermove = (e) => {
        const drag = held;
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < (e.pointerType === "mouse" ? 3 : 7)) return;
        drag.moved = true;
        const v = handleValue(drag.h, project, [drag.at[0] + dx, drag.at[1] + dy]);
        if (v === drag.value) return;
        drag.value = v;
        place();
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (held === drag) {
              shown = true;
              preview(moveHandle(p, drag.h, drag.value));
            }
          });
      };
      node.onpointerup = (e) => {
        const drag = held;
        if (!drag || drag.id !== e.pointerId) return;
        const next = moveHandle(p, drag.h, drag.value);
        release();
        place();
        if (drag.moved && JSON.stringify(next) !== JSON.stringify(p)) commit(next, drag.h.label);
        else note("Drag the handle to change " + drag.h.label.toLowerCase() + ".");
      };
      node.onpointercancel = node.onlostpointercapture = (e) => {
        if (held?.id === e.pointerId) {
          release();
          place();
        }
      };
    });
    place();
  }
  return { show, place: () => place() };
}
