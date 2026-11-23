import * as T from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { sweepGeometry } from "./surface.js";

export function manipulator(
  scene,
  camera,
  canvas,
  orbit,
  { pick, finish, render },
) {
  const tool = new TransformControls(camera, canvas);
  tool.setSize(0.69);
  tool.setSpace("local");
  scene.add(tool.getHelper());
  const point = new T.Object3D(),
    ray = new T.Raycaster(),
    pointer = new T.Vector2();
  let root = null,
    target = null,
    part = null,
    active = false,
    editing = false,
    knot = null,
    handle = null;
  let dragOrigin = null;
  let start = null,
    lastDrag = 0;
  function detach() {
    tool.detach();
    point.removeFromParent();
    handle = null;
    target = null;
    part = null;
  }
  function attach(figure, recipe, id, mode, enabled, selectedKnot) {
    detach();
    root = figure;
    active = enabled;
    if (!enabled || !id) return;
    part = recipe.parts.find((p) => p.id === id);
    target = findPart(figure, id);
    if (!part || !target || !target.visible) return;
    knot = part.shape === "sweep" ? selectedKnot : null;
    handle = target;
    if (knot !== null) {
      point.position.fromArray(part.knots[knot]);
      target.add(point);
      handle = point;
    }
    tool.setMode(
      knot !== null
        ? "translate"
        : mode === "shape"
          ? "scale"
          : mode === "turn"
            ? "rotate"
            : "translate",
    );
    tool.attach(handle);
  }
  tool.addEventListener("change", render);
  tool.addEventListener("dragging-changed", (e) => {
    orbit.enabled = !e.value;
    editing = e.value;
    if (!handle) return;
    if (e.value) {
      dragOrigin = {
        position: handle.position.clone(),
        scale: handle.scale.clone(),
        rotation: handle.quaternion.clone(),
      };
      return;
    }
    if (!dragOrigin) return;
    lastDrag = performance.now();
    if (knot !== null) {
      const knots = part.knots.map((row, i) =>
        i === knot ? [...point.position.toArray(), ...row.slice(3)] : row,
      );
      finish({ ...part, knots });
    } else {
      const base = new T.Quaternion().setFromEuler(
        new T.Euler(...part.rotation.map(T.MathUtils.degToRad)),
      );
      const delta = dragOrigin.rotation
        .clone()
        .invert()
        .multiply(target.quaternion);
      const euler = new T.Euler().setFromQuaternion(base.multiply(delta));
      finish({
        ...part,
        position: part.position.map(
          (v, i) =>
            v +
            target.position.getComponent(i) -
            dragOrigin.position.getComponent(i),
        ),
        size: part.size.map(
          (v, i) =>
            (v * target.scale.getComponent(i)) /
            dragOrigin.scale.getComponent(i),
        ),
        rotation: [euler.x, euler.y, euler.z].map(T.MathUtils.radToDeg),
      });
    }
  });
  tool.addEventListener("objectChange", () => {
    if (knot !== null && target?.isMesh) {
      const rows = part.knots.map((row, i) =>
        i === knot ? [...point.position.toArray(), ...row.slice(3)] : row,
      );
      if (
        rows.every(
          (v, i) =>
            i === 0 ||
            v.slice(0, 3).some((n, k) => Math.abs(n - rows[i - 1][k]) > 0.0001),
        )
      ) {
        target.geometry.dispose();
        target.geometry = sweepGeometry(rows, Boolean(part.paint));
      }
    }
    render();
  });
  canvas.addEventListener("pointerdown", (e) => {
    start = [e.clientX, e.clientY];
  });
  canvas.addEventListener("pointerup", (e) => {
    if (
      !active ||
      !root ||
      !start ||
      editing ||
      tool.axis ||
      performance.now() - lastDrag < 150 ||
      Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4
    )
      return;
    const box = canvas.getBoundingClientRect();
    pointer.set(
      ((e.clientX - box.left) / box.width) * 2 - 1,
      1 - ((e.clientY - box.top) / box.height) * 2,
    );
    ray.setFromCamera(pointer, camera);
    for (const hit of ray.intersectObject(root, true)) {
      let object = hit.object,
        id = null,
        visible = true;
      while (object && object !== root) {
        if (!object.visible) visible = false;
        if (!id && object.userData.partId) id = object.userData.partId;
        object = object.parent;
      }
      if (visible && id) {
        pick(id);
        break;
      }
    }
  });
  return { attach, detach };
}
export function findPart(root, id) {
  let result;
  root?.traverse((o) => {
    if (o.userData.partId === id) result = o;
  });
  return result;
}
