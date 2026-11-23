import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Matrix3,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";

export function drawTool(
  canvas,
  camera,
  orbit,
  scene,
  { active, figure, settings, finish, render },
) {
  const ray = new Raycaster(),
    pointer = new Vector2(),
    plane = new Plane();
  let stroke;
  function aim(event) {
    const box = canvas.getBoundingClientRect();
    pointer.set(
      (2 * (event.clientX - box.left)) / box.width - 1,
      1 - (2 * (event.clientY - box.top)) / box.height,
    );
    ray.setFromCamera(pointer, camera);
  }
  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function drawLine() {
    stroke.line.geometry.dispose();
    stroke.line.geometry = new BufferGeometry().setFromPoints(stroke.points);
    render();
  }
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!active() || stroke || event.button !== 0) return;
      aim(event);
      for (const hit of ray.intersectObject(figure(), true)) {
        let parent,
          visible = true;
        for (let o = hit.object; o; o = o.parent) {
          if (!o.visible) visible = false;
          parent ??= o.userData.partId;
        }
        if (!visible || !parent || !hit.face) continue;
        consume(event);
        const options = settings(),
          out = hit.face.normal
            .clone()
            .applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld))
            .normalize();
        const first = hit.point
          .clone()
          .addScaledVector(out, -options.radius * 0.35);
        const line = new Line(
          new BufferGeometry(),
          new LineBasicMaterial({ color: 0x16796b, depthTest: false }),
        );
        line.renderOrder = 30;
        scene.add(line);
        plane.setFromNormalAndCoplanarPoint(
          camera.getWorldDirection(new Vector3()),
          hit.point,
        );
        stroke = {
          pointer: event.pointerId,
          parent,
          options,
          points: [first],
          line,
          normal: out,
          origin: hit.point.clone(),
          orbitEnabled: orbit.enabled,
        };
        canvas.setPointerCapture(event.pointerId);
        orbit.enabled = false;
        return;
      }
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!stroke || stroke.pointer !== event.pointerId) return;
      consume(event);
      aim(event);
      const point = new Vector3();
      if (!ray.ray.intersectPlane(plane, point)) return;
      point.addScaledVector(
        stroke.normal,
        Math.min(
          stroke.options.radius * 0.45,
          point.distanceTo(stroke.origin) * 0.4,
        ),
      );
      if (point.distanceTo(stroke.points.at(-1)) < 0.008) return;
      if (stroke.points.length >= 255)
        stroke.points = stroke.points.filter((_, i) => i % 2 === 0);
      stroke.points.push(point);
      drawLine();
    },
    true,
  );
  function end(event, accept) {
    if (!stroke || event.pointerId !== stroke.pointer) return;
    consume(event);
    const s = stroke;
    stroke = null;
    s.line.removeFromParent();
    s.line.geometry.dispose();
    s.line.material.dispose();
    orbit.enabled = s.orbitEnabled;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (accept && s.points.length > 1)
      finish(
        s.parent,
        s.points.map((p) => p.toArray()),
        s.options,
      );
    render();
  }
  canvas.addEventListener("pointerup", (e) => end(e, true), true);
  canvas.addEventListener("pointercancel", (e) => end(e, false), true);
}
