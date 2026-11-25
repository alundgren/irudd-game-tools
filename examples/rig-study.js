import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCharacter } from "../character-view/model.js";
import { triangles, section } from "../character-view/mesh-sections.js";
import { mhrStudy } from "./mhr-study.js";
import report from "../docs/media/mhr-surface-errors.json" with { type: "json" };

async function show(data) {
  const get = (id) => document.getElementById(id);
  const stage = get("stage"),
    renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  stage.append(renderer.domElement);
  const ref = (await new GLTFLoader().loadAsync(data)).scene;
  const bodies = [
    ref,
    createCharacter(mhrStudy(null), false, true),
    createCharacter(mhrStudy(), false, true),
  ];
  const clay = new T.MeshStandardMaterial({ color: 0xb4b4ad, roughness: 0.93 });
  const scenes = bodies.map((body) => {
    body.traverse((o) => {
      if (o.isMesh) o.material = clay;
    });
    const scene = new T.Scene();
    scene.background = new T.Color(0xd5dad4);
    scene.add(body, new T.HemisphereLight(0xffffff, 0x737a72, 0.95));
    const key = new T.DirectionalLight(0xfffaf0, 2.25);
    key.position.set(-2.5, 2.6, 3);
    scene.add(key);
    return scene;
  });
  const surfaces = bodies.map(triangles);
  const paths = [...get("cut").querySelectorAll("path")];
  const cutLines = scenes.map((scene) => {
    const line = new T.LineLoop(
      new T.BufferGeometry(),
      new T.LineBasicMaterial({ color: 0x496e72 }),
    );
    scene.add(line);
    return line;
  });
  function slice() {
    const height = Number(get("slice").value) / 1000;
    get("height").textContent = height.toFixed(3) + " m";
    const curves = surfaces.map((s) => section(s, height, 96, 0));
    curves.forEach((row, k) => {
      const points = row.map((r, i) => {
        const a = (i * 2 * Math.PI) / row.length;
        return new T.Vector3(r * Math.sin(a), height, r * Math.cos(a));
      });
      paths[[2, 0, 1][k]].setAttribute(
        "d",
        points
          .map(
            (v, i) =>
              (i ? "L" : "M") +
              (v.x * 1000).toFixed(1) +
              "," +
              (-v.z * 1000).toFixed(1),
          )
          .join(" ") + "Z",
      );
      cutLines[k].geometry.dispose();
      cutLines[k].geometry = new T.BufferGeometry().setFromPoints(
        points.map((v) => new T.Vector3(v.x * 1.012, v.y, v.z * 1.012)),
      );
    });
    const err = (k) =>
      (curves[k].reduce((sum, v, i) => sum + Math.abs(v - curves[0][i]), 0) *
        1000) /
      96;
    get("error").textContent =
      "Mean radial error at this height: " +
      err(1).toFixed(1) +
      " mm before, " +
      err(2).toFixed(1) +
      " mm after.";
  }
  get("slice").oninput = slice;
  slice();
  const cam = new T.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 20);
  const orbit = new OrbitControls(cam, renderer.domElement);
  orbit.enablePan = false;
  orbit.minZoom = 0.5;
  orbit.maxZoom = 3;
  let focus = true,
    angle = 0.35;
  function frame() {
    const y = focus ? 1.14 : 0.86;
    orbit.target.set(0, y, 0);
    cam.position.set(3 * Math.sin(angle), y, 3 * Math.cos(angle));
    cam.zoom = 1;
    orbit.update();
  }
  function aspect() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    const extent = Math.max(
      focus ? 0.72 : 1.91,
      ((focus ? 0.56 : 1.45) * h) / (w / 3),
    );
    cam.top = extent / 2;
    cam.bottom = -cam.top;
    cam.right = (cam.top * w) / 3 / h;
    cam.left = -cam.right;
    cam.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  for (const [id, value] of [
    ["front", 0],
    ["side", Math.PI / 2],
    ["oblique", 0.62],
  ])
    get(id).onclick = () => {
      angle = value;
      frame();
      aspect();
    };
  get("focus").onclick = () => {
    angle = orbit.getAzimuthalAngle();
    focus = !focus;
    get("focus").setAttribute("aria-pressed", focus);
    frame();
    aspect();
  };
  frame();
  aspect();
  new ResizeObserver(aspect).observe(stage);
  renderer.setScissorTest(true);
  function render() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    scenes.forEach((scene, i) => {
      const left = Math.round((i * w) / 3),
        width = Math.round(((i + 1) * w) / 3) - left;
      renderer.setViewport(left, 0, width, h);
      renderer.setScissor(left, 0, width, h);
      renderer.render(scene, cam);
    });
  }
  orbit.addEventListener("change", render);
  get("slice").addEventListener("input", render);
  new ResizeObserver(render).observe(stage);
  for (const id of ["front", "side", "oblique", "focus"])
    get(id).addEventListener("click", render);
  get("result").textContent =
    "Across " +
    report.after.rays +
    " interleaved test rays, mean radial error fell from " +
    report.before.meanMm.toFixed(1) +
    " to " +
    report.after.meanMm.toFixed(1) +
    " mm.";
  if (location.protocol.startsWith("http"))
    get("editor").href = "/#study=mhr-torso";
  get("result").textContent +=
    " Mean surface-normal error on the interior grid changed from " +
    report.before.meanNormalDegrees.toFixed(1) +
    "? to " +
    report.after.meanNormalDegrees.toFixed(1) +
    "?.";
  get("status").textContent = "";
  render();
}
export function startRigStudy(data) {
  return show(data).catch(
    (error) => (document.getElementById("status").textContent = error.message),
  );
}
