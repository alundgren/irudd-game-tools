import { Mesh, MeshBasicMaterial, Raycaster, SphereGeometry, Vector2 } from "three";
import {
  applyHumanControls,
  applyHumanDetail,
  controlVectors,
  smoothHumanSurface,
} from "./human-surface.js";
import { brushBody, brushStroke, fitFromVectors } from "./human-brush.js";

// Two clicked points farther apart than this are not the same feature.
export const farthestPair = 0.05;

// Shares of a triangle's corners at the point of the triangle nearest to `point`.
function cornerShares(positions, corners, point) {
  const [a, b, c] = corners.map((v) => positions.subarray(v * 3, v * 3 + 3)),
    u = [0, 1, 2].map((d) => b[d] - a[d]),
    w = [0, 1, 2].map((d) => c[d] - a[d]),
    q = [0, 1, 2].map((d) => point[d] - a[d]),
    dot = (m, n) => m[0] * n[0] + m[1] * n[1] + m[2] * n[2],
    uu = dot(u, u),
    uw = dot(u, w),
    ww = dot(w, w),
    size = uu * ww - uw * uw || 1;
  let s = (ww * dot(q, u) - uw * dot(q, w)) / size,
    t = (uu * dot(q, w) - uw * dot(q, u)) / size;
  s = Math.min(1, Math.max(0, s));
  t = Math.min(1 - s, Math.max(0, t));
  return [1 - s - t, s, t];
}
const blend = (positions, corners, shares) =>
  [0, 1, 2].map((d) =>
    corners.reduce((sum, v, k) => sum + shares[k] * positions[v * 3 + d], 0),
  );

/* Brings one clicked spot of the skin of `form` toward `target`, a point on a reference
   placed in the same rest space. `touch` is the face of the smooth surface under the
   click and the clicked point. The move is one brush stroke, so it stays local and is
   held to the brush's own limit. Distances in the result are millimetres measured at
   the clicked spot of the stored recipe. */
export function matchFeature(
  form,
  touch,
  target,
  { reach = 0.05, mirror = false } = {},
  body = brushBody(form),
) {
  const before = smoothHumanSurface(body.fitted);
  if (!Number.isInteger(touch?.face) || touch.face < 0 || touch.face >= before.bodyTriangles)
    throw new Error("The touched face is not part of this body's skin.");
  if (![...touch.point, ...target].every(Number.isFinite) || target.length !== 3)
    throw new Error("Both points need three finite coordinates.");
  const corners = Array.from(before.indices.subarray(touch.face * 3, touch.face * 3 + 3)),
    shares = cornerShares(before.positions, corners, touch.point),
    from = blend(before.positions, corners, shares),
    quad = before.parentFaces[touch.face],
    stroke = brushStroke(
      form,
      {
        vertices: Array.from(before.quadIds.subarray(quad * 4, quad * 4 + 4)),
        point: from,
      },
      { reach, mirror },
      body,
    );
  const want = target.map((x, d) => x - from[d]),
    requested = Math.hypot(...want),
    // The stroke follows a drag no longer than its limit.
    hold = requested > stroke.limit ? stroke.limit / requested : 1,
    aim = want.map((x) => x * hold),
    // What a saved recipe keeps: tenths of a millimetre for each anchor.
    stored = (vectors) => controlVectors(fitFromVectors(vectors)),
    place = (vectors) =>
      blend(
        smoothHumanSurface(applyHumanDetail(applyHumanControls(body.bare, vectors), body.detail)).positions,
        corners,
        shares,
      );
  let offset = aim.slice(),
    vectors = body.start,
    moved = [0, 0, 0];
  // Anchors are coarse, so the clicked skin can trail the stroke: ask again for the shortfall.
  for (let turn = 0; requested > 0 && turn < 4; turn++) {
    const tried = stored(stroke.vectors(offset)),
      now = place(tried).map((x, d) => x - from[d]),
      better =
        Math.hypot(...now.map((x, d) => x - aim[d])) <
        Math.hypot(...moved.map((x, d) => x - aim[d]));
    if (!better) break;
    vectors = tried;
    moved = now;
    const short = aim.map((x, d) => x - now[d]);
    if (Math.hypot(...short) < 0.00005) break;
    offset = offset.map((x, d) => x + short[d]);
  }
  const changed = stroke.changes(vectors);
  return {
    form: changed ? stroke.form(vectors) : form,
    changed,
    requestedMm: requested * 1000,
    achievedMm: Math.hypot(...moved) * 1000,
    // What still separates the two clicked points.
    leftMm: Math.hypot(...want.map((x, d) => x - moved[d])) * 1000,
    limitMm: stroke.limit * 1000,
    areaMm: stroke.used * 1000,
    held: hold < 1,
    from,
    moved,
  };
}

const one = (x) => x.toFixed(1);
// One line for the dialog's list of steps and its reading.
export function featureText({ part, requestedMm, achievedMm, leftMm, held, limitMm }) {
  return (
    "Feature on the " + part + " · asked " + one(requestedMm) + " mm, moved " +
    one(achievedMm) + " mm at the clicked skin, " + one(leftMm) + " mm apart now" +
    (held ? " · held to " + one(limitMm) + " mm by the size of the area" : "")
  );
}

/* The gesture in the reference dialog: click a feature on the reference in the left
   pane, then the same feature on the current editable skin in the right pane.
   `ready` says whether an aligned reference is on show and nothing else is picking,
   `figure` returns the current body's { group, skins }, `form` its recipe, and
   `accept` stores the next recipe as one step of the dialog. */
export function featureMatcher({
  canvas,
  camera,
  scene,
  ready,
  reference,
  figure,
  form,
  accept,
  sideBySide,
  note,
  render,
  toggled = () => {},
}) {
  const $ = (id) => document.getElementById(id),
    ray = new Raycaster(),
    marker = new Mesh(
      new SphereGeometry(0.0022, 16, 10),
      new MeshBasicMaterial({ color: 0xc6452d, depthTest: false }),
    );
  marker.renderOrder = 20;
  marker.visible = false;
  scene.add(marker);
  let on = false,
    wanted = null,
    last = "",
    down = null;
  const reach = () => Number($("hfit-feature-reach").value) / 100;
  const paired = () =>
    $("hfit-views").querySelector('[aria-pressed="true"]')?.dataset.view === "side" &&
    !$("hfit-original").checked;
  function sync() {
    const ok = ready();
    if (on && !(ok && paired())) stop();
    const button = $("hfit-feature");
    button.disabled = !ok;
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Stop matching features" : "Match a feature";
    $("hfit-feature-settings").hidden = !on;
    $("hfit-feature-size").textContent = $("hfit-feature-reach").value + " cm";
    marker.visible = on && Boolean(wanted);
    canvas.style.cursor = on ? "crosshair" : "";
    $("hfit-feature-reading").textContent =
      (last ? last + ". " : "") +
      (!on
        ? ""
        : wanted
          ? "Now click the same feature on your editable skin in the right pane."
          : "Click a feature, such as the tip of the nose or a corner of the mouth, on the reference in the left pane.");
  }
  function stop() {
    on = false;
    wanted = null;
    last = "";
    delete $("hfit-feature-reading").dataset.result;
  }
  // Leaves the gesture when the reference, the placement or the view changed under it.
  function cancel() {
    if (!on && !last) return;
    stop();
    sync();
    toggled();
    render();
  }
  $("hfit-feature").onclick = () => {
    if (on) stop();
    else if (ready()) {
      on = true;
      wanted = null;
      last = "";
      sideBySide();
    }
    sync();
    // Other picking tools share the pointer and follow this one's state.
    toggled();
    render();
  };
  $("hfit-feature-reach").oninput = sync;
  // The dialog calls sync whenever its state changes, which ends the gesture when
  // landmarks are being placed or the two panes are no longer on show. A step back
  // also drops a half-made pair and the reading of the step that was undone.
  $("hfit-undo").addEventListener("click", () => {
    wanted = null;
    last = "";
    delete $("hfit-feature-reading").dataset.result;
    sync();
    render();
  });
  $("hfit-room").addEventListener("close", cancel);

  canvas.addEventListener("pointerdown", (e) => {
    down = on && e.button === 0 ? [e.clientX, e.clientY] : null;
  });
  canvas.addEventListener("pointerup", (e) => {
    const start = down;
    down = null;
    // A drag turns the view; only a click picks.
    if (!on || !start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
    if (!ready() || !paired()) return cancel();
    const box = canvas.getBoundingClientRect(),
      half = box.width / 2,
      x = e.clientX - box.left,
      y = e.clientY - box.top,
      side = x < half ? 0 : 1;
    if (side !== (wanted ? 1 : 0))
      return note(
        wanted
          ? "The reference point is set. Click the same feature on your editable skin in the right pane."
          : "Start on the reference in the left pane, then click your own skin on the right.",
      );
    ray.setFromCamera(
      new Vector2((2 * (x - side * half)) / half - 1, 1 - (2 * y) / box.height),
      camera,
    );
    if (!side) {
      const hit = ray.intersectObject(reference(), false)[0];
      if (!hit) return note("That click missed the reference. Click directly on its surface.");
      wanted = hit.point.clone();
      marker.position.copy(wanted);
      last = "";
      sync();
      render();
      return note("Reference point set. The red dot shows it in both panes.");
    }
    const body = figure(),
      hit = ray.intersectObject(body.group, true).find((h) => h.object.isMesh && h.face),
      skin = hit && body.skins.find(([mesh]) => mesh === hit.object);
    if (!skin || !hit.object.humanSkin)
      return note(
        hit
          ? "That is not bare skin of this body. Click the skin itself."
          : "That click missed your character. Click directly on its skin.",
      );
    const mesh = hit.object,
      tag = mesh.humanSkin,
      rest = (world) =>
        mesh.worldToLocal(world.clone()).toArray().map((v, d) => v + tag.origin[d]),
      gap = hit.point.distanceTo(wanted);
    if (gap > farthestPair)
      return note(
        "Those two points are " + (gap * 1000).toFixed(0) + " mm apart, too far for one feature. " +
          "Click the same feature in both panes, or improve the alignment first.",
      );
    let result;
    try {
      result = matchFeature(
        form(),
        { face: tag.faces[hit.faceIndex * 3] / 3, point: rest(hit.point) },
        rest(wanted),
        { reach: reach(), mirror: $("hfit-feature-mirror").checked },
      );
    } catch (error) {
      return note("The feature could not be matched. " + error.message);
    }
    wanted = null;
    const part = skin[2].replace(/_/g, " "),
      entry = { region: skin[1], feature: { part, ...result, form: undefined } };
    if (!result.changed) {
      last = "";
      sync();
      render();
      return note(
        result.requestedMm < 0.1
          ? "Those points already meet."
          : "This skin is already at the limit of a correction.",
      );
    }
    last = featureText(entry.feature);
    $("hfit-feature-reading").dataset.result = JSON.stringify(entry.feature);
    accept(result.form, entry);
    note(last + ". Undo step takes it back; Apply keeps it.");
  });

  // `reset` is for the dialog's own restart, which redraws everything afterwards.
  return { sync, cancel, reset: stop, active: () => on };
}
