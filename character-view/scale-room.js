import * as T from "three";
import { createCharacter, disposeCharacter } from "./model.js";
import { measureFigure, resizeInMetres } from "./dimensions.js";
import { restoreArtwork } from "./turnaround.js";
import { validateForm } from "./recipe.js";
const $ = (id) => document.getElementById(id);
const metres = (v) => v.toFixed(3) + " m";
export function scaleRoom(current, apply, locked) {
  const dialog = $("scale-room"),
    stage = $("scale-view"),
    canvas = $("scale-canvas"),
    ruler = $("scale-ruler");
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  scene.background = new T.Color("#e4e9e5");
  scene.add(new T.HemisphereLight(0xffffff, 0xb3b0a4, 2.1));
  const sun = new T.DirectionalLight(0xfff1d9, 2.4);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  let upload = 0;
  let renderer,
    pinned = null,
    pinnedLabel = "Pinned form",
    figures = [],
    floor = null;
  function release() {
    for (const item of figures) {
      scene.remove(item.display);
      disposeCharacter(item.root);
    }
    figures = [];
    if (floor) {
      scene.remove(floor);
      floor.dispose();
      floor = null;
    }
  }
  function specimen(form) {
    const root = createCharacter(form, false, $("scale-clay").checked),
      metrics = measureFigure(root, form);
    if (metrics.box.isEmpty()) {
      disposeCharacter(root);
      throw new Error("This form has no visible surface.");
    }
    const center = metrics.box.getCenter(new T.Vector3()),
      size = metrics.box.getSize(new T.Vector3());
    const turn = new T.Group(),
      display = new T.Group();
    root.position.set(-center.x, -metrics.box.min.y, -center.z);
    turn.add(root);
    display.add(turn);
    scene.add(display);
    return {
      root,
      display,
      turn,
      metrics,
      span: Math.max(0.02, Math.hypot(size.x, size.z)),
    };
  }
  function paint() {
    if (!renderer || !dialog.open || !figures.length) return;
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const aspect = w / h,
      tall = Math.max(...figures.map((s) => s.metrics.overall), 0.1);
    const gap = Math.max(0.045, Math.min(0.34, tall * 0.16)),
      width =
        figures.reduce((n, s) => n + s.span, 0) + gap * (figures.length - 1);
    const worldH = Math.max(tall * 1.16, width / Math.max(0.1, aspect * 0.84)),
      worldW = worldH * aspect;
    camera.left = -worldW / 2;
    camera.right = worldW / 2;
    camera.top = worldH * 0.9;
    camera.bottom = -worldH * 0.1;
    camera.position.set(0, 0, Math.max(20, worldW * 2));
    camera.far = Math.max(200, camera.position.z + worldW * 3);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    let x = -width / 2 + worldW * 0.035;
    const yaw = (Number($("scale-yaw").value) * Math.PI) / 180;
    for (const item of figures) {
      item.turn.rotation.y = yaw;
      item.display.position.x = x + item.span / 2;
      x += item.span + gap;
    }
    renderer.setSize(w, h, false);
    renderer.render(scene, camera);
    const rough = worldH / 5,
      power = 10 ** Math.floor(Math.log10(rough)),
      step = ([1, 2, 5, 10].find((s) => s * power >= rough) ?? 10) * power;
    ruler.replaceChildren();
    for (let n = 0; n * step <= camera.top; n++) {
      const tick = document.createElement("span");
      tick.textContent = Number((n * step).toFixed(4)) + " m";
      tick.style.bottom = (0.1 + (n * step) / worldH) * 100 + "%";
      ruler.append(tick);
    }
  }
  function update() {
    release();
    if (pinned) figures.push(specimen(pinned));
    figures.push(specimen(current()));
    const extent = Math.max(
      ...figures.map((s) => Math.max(s.span, s.metrics.overall)),
      1,
    );
    floor = new T.GridHelper(
      Math.ceil(extent * 5),
      Math.min(100, Math.ceil(extent * 5) * 4),
      0xa3b7af,
      0xc4d0ca,
    );
    scene.add(floor);
    const now = figures.at(-1).metrics,
      ref = pinned ? figures[0].metrics : null;
    function reading(m) {
      return (
        metres(m.overall) +
        " overall" +
        (m.head === null ? "" : " · " + metres(m.head) + " to top of head")
      );
    }
    $("scale-reference-reading").hidden = !ref;
    $("scale-reference-reading").textContent = ref
      ? pinnedLabel + " · " + reading(ref)
      : "";
    $("scale-current-reading").textContent = "Current form · " + reading(now);
    $("scale-forget").disabled = !pinned;
    $("scale-metric").querySelector('[value="head"]').disabled =
      now.head === null;
    if (now.head === null) $("scale-metric").value = "overall";
    $("scale-metres").value = now[$("scale-metric").value].toFixed(3);
    $("scale-apply").disabled = locked();
    paint();
  }
  $("show-scale-room").onclick = () => {
    dialog.showModal();
    try {
      if (!renderer) {
        renderer = new T.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      }
      $("scale-note").textContent = "";
      update();
    } catch (e) {
      $("scale-note").textContent = e.message;
    }
  };
  $("scale-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    upload++;
    release();
  });
  $("scale-pin").onclick = () => {
    upload++;
    pinned = structuredClone(current());
    pinnedLabel = "Pinned form";
    update();
  };
  $("scale-forget").onclick = () => {
    upload++;
    pinned = null;
    update();
  };
  $("scale-open").onclick = () => $("scale-reference-file").click();
  $("scale-reference-file").onchange = async () => {
    const ticket = ++upload;
    const file = $("scale-reference-file").files[0];
    $("scale-reference-file").value = "";
    if (!file) return;
    try {
      if (file.size > 8000000) throw new Error("This form exceeds 8 MB.");
      const raw = JSON.parse(await file.text());
      if (raw.format !== "irudd.form.v1")
        throw new Error("Choose a saved workshop form.");
      validateForm(raw.form);
      await restoreArtwork(raw.form);
      if (ticket !== upload || !dialog.open) return;
      pinned = raw.form;
      pinnedLabel = file.name.replace(/\.form\.json$/i, "").slice(0, 50);
      update();
      $("scale-note").textContent = "";
    } catch (error) {
      $("scale-note").textContent = error.message;
    }
  };
  $("scale-clay").onchange = update;
  $("scale-yaw").oninput = paint;
  $("scale-metric").onchange = () => {
    $("scale-metres").value = figures
      .at(-1)
      .metrics[$("scale-metric").value].toFixed(3);
  };
  $("scale-apply").onclick = () => {
    try {
      const key = $("scale-metric").value,
        next = resizeInMetres(
          current(),
          figures.at(-1).metrics[key],
          $("scale-metres").valueAsNumber,
        );
      apply(next);
      update();
      $("scale-note").textContent =
        "Current form resized. Undo is available in Sculpt.";
    } catch (error) {
      $("scale-note").textContent = error.message;
    }
  };
  new ResizeObserver(paint).observe(stage);
}
