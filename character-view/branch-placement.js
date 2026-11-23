import { pickSurface } from "./surface-pick.js";
import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  MathUtils,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
} from "three";
import { placeBranch } from "./graft.js";

export function branchPlacement(
  canvas,
  camera,
  scene,
  { figure, current, settings, accept, note, render },
) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
  const dot = new Points(
    geometry,
    new PointsMaterial({
      color: 0xf19544,
      size: 12,
      sizeAttenuation: false,
      depthTest: false,
    }),
  );
  dot.renderOrder = 35;
  dot.visible = false;
  scene.add(dot);
  let enabled = false,
    source = null,
    pin = null,
    down = null;
  function message(text) {
    document.getElementById("place-hint").textContent = text;
    note(text);
  }
  function cancel() {
    enabled = false;
    source = null;
    pin = null;
    down = null;
    dot.visible = false;
  }
  function start(id) {
    cancel();
    enabled = true;
    source = id;
    message(
      id
        ? "Click the attachment point on " + id + " or one of its children."
        : "Click the attachment point on the branch you want to place.",
    );
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (enabled && e.isPrimary && e.button === 0)
        down = { id: e.pointerId, x: e.clientX, y: e.clientY };
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
      if (!enabled || !down || down.id !== e.pointerId) return;
      const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
      down = null;
      if (!click) return;
      const form = current(),
        root = figure();
      if (!form || !root) return;
      const hit = pickSurface(e, canvas, camera, root);
      if (!hit) {
        message("Pick a visible surface. Drag empty space to orbit.");
        return;
      }
      const id = hit.id;
      if (!pin) {
        let part = form.parts.find((p) => p.id === id);
        source ??= id;
        while (part && part.id !== source)
          part = form.parts.find((p) => p.id === part.parent);
        if (!part) {
          message("Click a point on " + source + " or one of its children.");
          return;
        }
        pin = hit.point.clone();
        dot.position.copy(pin);
        dot.visible = true;
        render();
        message(
          "Marked " +
            source +
            ". Orbit if needed, then click the receiving surface.",
        );
        return;
      }
      const { copy, scale, twist, depth, axis } = settings();
      if (
        !Number.isFinite(depth) ||
        depth < 0 ||
        depth > 0.1 ||
        !Number.isFinite(twist) ||
        Math.abs(twist) > 360
      ) {
        message("Use a seating depth of 0–100 mm and a turn within ±360°. ");
        return;
      }
      const normal = hit.normal;
      const turn = new Euler().setFromQuaternion(
        new Quaternion().setFromAxisAngle(
          axis === "view"
            ? camera.getWorldDirection(new Vector3()).negate()
            : normal,
          MathUtils.degToRad(twist),
        ),
      );
      const point = hit.point.clone().addScaledVector(normal, -depth);
      try {
        const result = placeBranch(form, source, {
          parent: id,
          anchor: pin.toArray(),
          point: point.toArray(),
          copy,
          scale,
          turn: [turn.x, turn.y, turn.z].map(MathUtils.radToDeg),
        });
        accept(result, id, copy);
      } catch (error) {
        message(error.message);
      }
    },
    true,
  );
  return {
    start,
    cancel,
    get active() {
      return enabled;
    },
  };
}
