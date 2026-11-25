import {
  readCreaturePlan,
  rebuildCreature,
  spineFrame,
} from "./creature-plan.js";
import {
  creatureHandles,
  girthAxis,
  girthNames,
  girthPoint,
  girthReadout,
  girthRing,
  limbCentre,
  limbNames,
  limbRail,
  limbReadout,
  limbRoot,
  limbSides,
  limbStations,
  lineLength,
  moveLimbs,
  nearestAlong,
  pullGirth,
  setGirth,
  viewOf,
} from "./creature-handles.js";

// Handles drawn over the creature. A round handle slides a limb group along
// the spine and a diamond changes the thickness of the trunk at its station.
// They sit above the canvas, so a drag that starts anywhere else still orbits.
// While a handle is held, the creature follows the pointer on every frame:
// `preview` warps the meshes that are on screen, and once the pointer rests
// it builds them again exactly. Letting go stores one change; Escape drops
// the drag.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fixed = (points) =>
  points.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");

export function creatureHandleOverlay(
  stage,
  camera,
  { read, idle, preview, finish, cancel, note },
) {
  const overlay = document.createElement("div");
  overlay.className = "creature-handles";
  overlay.hidden = true;
  const guide = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  guide.setAttribute("class", "creature-guide");
  guide.setAttribute("aria-hidden", "true");
  const readout = document.createElement("div");
  readout.className = "creature-readout";
  readout.hidden = true;
  overlay.append(guide, readout);
  stage.append(overlay);

  let on = true,
    source = null,
    plan = null,
    drag = null,
    hot = null,
    frame = null,
    timer = null,
    slow = false,
    cost = 100;
  const buttons = new Map();

  function px(point) {
    const p = point.clone().project(camera);
    return [
      ((1 + p.x) / 2) * stage.clientWidth,
      ((1 - p.y) / 2) * stage.clientHeight,
    ];
  }
  const pointer = (e) => {
    const box = stage.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  // The dragged handle keeps the side of the body it was picked up on.
  function handlesOf(shown) {
    const found = creatureHandles(shown, viewOf(camera));
    for (const h of found.handles) {
      if (h.key !== drag?.key) continue;
      if (h.kind === "girth")
        Object.assign(
          h,
          { direction: drag.direction },
          girthPoint(found.frame, h.station, drag.direction),
        );
      else {
        h.side = drag.side;
        h.point = limbRoot(
          found.frame,
          shown.limbs[h.index].kind,
          h.station,
          h.side,
        );
      }
    }
    return found;
  }

  function sketch(shown, held, frameNow) {
    const marks = [];
    if (held.kind === "girth") {
      if (drag)
        marks.push(
          '<polygon class="was" points="' +
            fixed(girthRing(spineFrame(drag.start), held.station).map(px)) +
            '"/>',
        );
      marks.push(
        '<polygon class="now" points="' +
          fixed(girthRing(frameNow, held.station).map(px)) +
          '"/>',
      );
    } else {
      const limb = shown.limbs[held.index],
        sides = limbSides(limb);
      for (const side of sides)
        marks.push(
          '<polyline class="rail" points="' +
            fixed(limbRail(frameNow, limb.kind, side, px, 32)) +
            '"/>',
        );
      const dots = (group, frameOf, name) => {
        for (const station of limbStations(group))
          for (const side of sides) {
            const [x, y] = px(limbRoot(frameOf, group.kind, station, side));
            marks.push(
              '<circle class="' +
                name +
                '" r="5" cx="' +
                x.toFixed(1) +
                '" cy="' +
                y.toFixed(1) +
                '"/>',
            );
          }
      };
      if (drag) dots(drag.start.limbs[held.index], spineFrame(drag.start), "was");
      dots(limb, frameNow, "now");
    }
    guide.innerHTML = marks.join("");
  }

  function draw(shown) {
    const { frame: frameNow, handles } = handlesOf(shown);
    const keys = new Set(handles.map((h) => h.key));
    for (const [key, el] of buttons) el.hidden = !keys.has(key);
    let held = null;
    for (const h of handles) {
      const el = buttons.get(h.key) ?? button(h.key);
      const [x, y] = px(h.point);
      el.className =
        "creature-handle " + h.kind + (drag?.key === h.key ? " held" : "");
      el.title = h.label;
      el.setAttribute("aria-label", h.label);
      el.style.left = x.toFixed(1) + "px";
      el.style.top = y.toFixed(1) + "px";
      if (h.key === (drag?.key ?? hot)) held = { ...h, x, y };
    }
    readout.hidden = !held;
    if (!held) {
      guide.innerHTML = "";
      return;
    }
    sketch(shown, held, frameNow);
    readout.textContent =
      held.kind === "girth"
        ? girthReadout(shown, held.index)
        : limbReadout(shown, held.index);
    readout.style.left =
      Math.min(Math.max(held.x, 90), stage.clientWidth - 90).toFixed(0) + "px";
    readout.style.top = (held.y < 56 ? held.y + 26 : held.y - 40).toFixed(0) + "px";
  }
  function place() {
    const raw = read()?.origin?.plan;
    const free = Boolean(raw) && idle();
    if (drag && !free) abort();
    overlay.hidden = !(on && free);
    if (overlay.hidden) {
      hot = null;
      return;
    }
    if (raw !== source) {
      source = raw;
      plan = readCreaturePlan(raw);
    }
    draw(drag?.plan ?? plan);
  }

  // Show the plan under the pointer. `preview` answers whether the picture
  // it drew is the exact build. A warp costs a few milliseconds, so it runs
  // on every frame, and the exact build follows once the pointer has rested.
  // A change a warp cannot show is built exactly at once, and waits for the
  // pointer to rest only where that build takes more than a few frames.
  function push() {
    frame = null;
    clearTimeout(timer);
    timer = null;
    if (!drag || drag.shown === drag.plan) return;
    const began = performance.now();
    drag.shown = drag.plan;
    drag.exact = false;
    try {
      drag.form = rebuildCreature(read(), drag.plan);
      drag.exact = preview(drag.form, false);
    } catch (error) {
      drag.form = null;
      note(error.message);
      return;
    }
    if (drag.exact) {
      cost = performance.now() - began;
      slow = cost > (slow ? 30 : 50);
    } else {
      slow = false;
      rest();
    }
  }
  // The exact build freezes the picture while it runs, so it waits until the
  // pointer has been still for about half the time the build takes. Every
  // movement of the pointer starts the wait again, also one too small to
  // change the plan.
  function rest() {
    if (!drag?.form || drag.exact || slow || drag.shown !== drag.plan) return;
    clearTimeout(timer);
    timer = setTimeout(settle, Math.min(250, Math.max(60, cost / 2)));
  }
  function settle() {
    timer = null;
    if (!drag?.form || drag.exact || drag.shown !== drag.plan) return;
    const began = performance.now();
    try {
      preview(drag.form, true);
      drag.exact = true;
      cost = performance.now() - began;
    } catch (error) {
      note(error.message);
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (slow) timer = setTimeout(push, Math.min(400, Math.max(90, cost)));
    else if (frame === null) frame = requestAnimationFrame(push);
  }
  function release() {
    const { el, id } = drag;
    drag = null;
    if (frame !== null) cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = null;
    window.removeEventListener("keydown", escape, true);
    if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
  }
  function abort(message = "Drag cancelled. Nothing changed.") {
    const held = drag;
    release();
    if (held.shown) cancel();
    else place();
    note(message);
  }
  function escape(e) {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    abort();
  }
  const message = (next, kind, index) =>
    kind === "girth"
      ? girthReadout(next, index) + "."
      : "Moved the " +
        limbNames[next.limbs[index].kind] +
        ": " +
        limbReadout(next, index).toLowerCase() +
        ".";
  function store(next, kind, index, ready) {
    try {
      finish(ready ?? rebuildCreature(read(), next), message(next, kind, index));
    } catch (error) {
      cancel();
      note(error.message);
    }
  }

  function begin(e, el) {
    if (e.button !== 0 || e.isPrimary === false || drag || !plan) return;
    e.preventDefault();
    e.stopPropagation();
    const key = el.dataset.key,
      { frame: frameNow, handles } = handlesOf(plan),
      h = handles.find((x) => x.key === key);
    if (!h) return;
    const at = pointer(e),
      spot = px(h.point);
    const held = {
      id: e.pointerId,
      el,
      key,
      kind: h.kind,
      index: h.index,
      station: h.station,
      start: plan,
      plan,
      x: e.clientX,
      y: e.clientY,
      grab: [at[0] - spot[0], at[1] - spot[1]],
      slack: e.pointerType === "mouse" ? 3 : 7,
      moved: false,
      shown: null,
      form: null,
      exact: false,
    };
    if (h.kind === "girth") {
      held.direction = h.direction;
      held.axis = girthAxis(h, px);
    } else {
      held.side = h.side;
      held.rail = limbRail(frameNow, plan.limbs[h.index].kind, h.side, px);
      if (lineLength(held.rail) < 24) {
        note("Turn the view until the body is seen from its side, then move these limbs.");
        return;
      }
    }
    drag = held;
    hot = key;
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    window.addEventListener("keydown", escape, true);
    draw(plan);
  }
  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (
      !drag.moved &&
      Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < drag.slack
    )
      return;
    drag.moved = true;
    const at = pointer(e),
      goal = [at[0] - drag.grab[0], at[1] - drag.grab[1]];
    const next =
      drag.kind === "girth"
        ? pullGirth(drag.start, drag, drag.axis, goal, px)
        : moveLimbs(drag.start, drag.index, nearestAlong(drag.rail, goal));
    if (same(next, drag.plan)) {
      rest();
      return;
    }
    drag.plan = next;
    draw(next);
    schedule();
  }
  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const held = drag;
    release();
    if (!held.moved || same(held.plan, held.start)) {
      if (held.shown) cancel();
      else place();
      const limbs =
        held.kind === "limb" && limbNames[held.start.limbs[held.index].kind];
      note(
        !held.moved
          ? limbs
            ? "Drag this handle along the body to move the " + limbs + "."
            : "Drag this handle away from the body to thicken the " +
              girthNames[held.index] +
              ", or toward it to slim them."
          : limbs
            ? "The " + limbs + " are where they were. A group that spans the whole trunk has no room to move."
            : "The thickness at the " + girthNames[held.index] + " is unchanged.",
      );
      return;
    }
    store(
      held.plan,
      held.kind,
      held.index,
      held.exact && held.shown === held.plan ? held.form : null,
    );
  }
  // Arrow keys step a focused handle. Each press is one change.
  function keys(e, el) {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[
      e.key
    ];
    if (!step || drag || !plan) return;
    e.preventDefault();
    const [kind, number] = el.dataset.key.split(" "),
      index = Number(number);
    const next =
      kind === "girth"
        ? setGirth(
            plan,
            index,
            plan.spine.bulge[index] * (step > 0 ? 1.05 : 1 / 1.05),
          )
        : moveLimbs(plan, index, limbCentre(plan.limbs[index]) + step * 0.02);
    if (!same(next, plan)) store(next, kind, index);
  }
  function button(key) {
    const el = document.createElement("button");
    el.type = "button";
    el.dataset.key = key;
    el.onpointerdown = (e) => begin(e, el);
    el.onpointermove = move;
    el.onpointerup = end;
    el.onpointercancel = el.onlostpointercapture = (e) => {
      if (drag && e.pointerId === drag.id) abort();
    };
    const light = (state) => {
      if (state) hot = key;
      else if (hot === key && !drag) hot = null;
      if (!drag && !overlay.hidden && plan) draw(plan);
    };
    // A handle reached with the keyboard stays lit; one reached with the
    // pointer is lit only while the pointer is over it.
    const keyed = () => el.matches(":focus-visible");
    el.onpointerenter = () => light(true);
    el.onpointerleave = () => light(keyed());
    el.onfocus = () => light(keyed() || hot === key);
    el.onblur = () => light(false);
    el.onkeydown = (e) => keys(e, el);
    el.oncontextmenu = (e) => e.preventDefault();
    // The wheel still zooms the view with the pointer over a handle.
    el.onwheel = (e) => {
      e.preventDefault();
      stage.querySelector("canvas")?.dispatchEvent(new WheelEvent("wheel", e));
    };
    buttons.set(key, el);
    overlay.append(el);
    return el;
  }

  return {
    place,
    get enabled() {
      return on;
    },
    set enabled(state) {
      on = Boolean(state);
      if (!on && drag) abort();
      place();
    },
    get dragging() {
      return Boolean(drag);
    },
  };
}
