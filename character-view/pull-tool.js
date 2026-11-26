import {
  Matrix3,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
  Box3,
  MathUtils,
} from "three";
import { pullSurface } from "./surface-pull.js";

export function pullTool(
  canvas,
  camera,
  orbit,
  { active, figure, settings, finish, render },
) {
  const ray = new Raycaster(),
    pointer = new Vector2(),
    normal = new Vector3(),
    plane = new Plane();
  let stroke = null;
  function aim(e) {
    const b = canvas.getBoundingClientRect();
    pointer.set(
      (2 * (e.clientX - b.left)) / b.width - 1,
      1 - (2 * (e.clientY - b.top)) / b.height,
    );
    ray.setFromCamera(pointer, camera);
  }
  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || !active() || stroke || !figure()) return;
      aim(e);
      for (const hit of ray.intersectObject(figure(), true)) {
        let part = null,
          visible = true;
        for (let o = hit.object; o && o !== figure(); o = o.parent) {
          if (!o.visible) visible = false;
          if (!part && o.userData.partId) part = o;
        }
        if (!part || !visible || !hit.face) continue;
        stop(e);
        const { radius, mirror, direction } = settings(),
          scale = part.getWorldScale(new Vector3());
        const at = part.worldToLocal(hit.point.clone()),
          start = hit.point.clone(),
          z = camera.getWorldDirection(new Vector3());
        normal
          .copy(hit.face.normal)
          .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .normalize();
        plane.setFromNormalAndCoplanarPoint(z, start);
        const field = {
          at: at.toArray(),
          reach: scale
            .toArray()
            .map((v) => MathUtils.clamp(radius / Math.abs(v), 0.001, 20)),
          offset: [0, 0, 0],
        };
        if (mirror) {
          const bounds = new Box3().makeEmpty();
          const v = new Vector3();
          function collect(o) {
            if (o !== part && o.userData.partId) return;
            if (o.isMesh)
              for (let i = 0; i < o.geometry.attributes.position.count; i++)
                bounds.expandByPoint(
                  part.worldToLocal(
                    o.localToWorld(
                      v.fromBufferAttribute(o.geometry.attributes.position, i),
                    ),
                  ),
                );
            o.children.forEach(collect);
          }
          collect(part);
          field.mirrorX = bounds.getCenter(v).x;
        }
        stroke = {
          part,
          field,
          start,
          at,
          normal: normal.clone(),
          surface: pullSurface(part),
          y: e.clientY,
          dx: 0,
          mode: direction,
          eid: e.pointerId,
        };
        canvas.setPointerCapture(e.pointerId);
        orbit.enabled = false;
        return;
      }
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (!stroke || e.pointerId !== stroke.eid) return;
      stop(e);
      aim(e);
      const hit = new Vector3();
      if (stroke.mode === "Normal") {
        const units =
          (camera.top - camera.bottom) / camera.zoom / canvas.clientHeight;
        hit
          .copy(stroke.start)
          .addScaledVector(stroke.normal, (stroke.y - e.clientY) * units);
      } else if (!ray.ray.intersectPlane(plane, hit)) return;
      const delta = stroke.part.worldToLocal(hit).sub(stroke.at);
      stroke.field.offset = delta
        .toArray()
        .map((v) => MathUtils.clamp(v, -4, 4));
      stroke.dx = delta.length();
      stroke.surface.apply([stroke.field]);
      render();
    },
    true,
  );
  function end(e, accept) {
    if (!stroke || e.pointerId !== stroke.eid) return;
    stop(e);
    const done = stroke;
    stroke = null;
    done.surface.restore();
    orbit.enabled = true;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    if (accept && done.dx > 0.0001)
      finish(done.part.userData.partId, done.field);
    render();
  }
  canvas.addEventListener("pointerup", (e) => end(e, true), true);
  canvas.addEventListener("pointercancel", (e) => end(e, false), true);
}
