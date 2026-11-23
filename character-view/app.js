import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCharacter, disposeCharacter } from "./model.js";
import { initial, outfits, values, reroll } from "./recipe.js";

const $ = (selector) => document.querySelector(selector);
const recipes = initial.map((recipe) => ({ ...recipe }));
const history = [[], []];
let active = 0,
  silhouette = false;
const scene = new T.Scene();
scene.background = new T.Color("#dbe2d8");
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.05, 50);
const figures = [];
const stage = $("#stage");
const canvas = $("#viewport");
const compare = $("#compare");
const views = {
  "3/4": [2.1, 1.36, 4.25],
  Front: [0, 0.7, 4.8],
  Side: [4.8, 0.7, 0],
  Back: [0, 0.7, -4.8],
};
const labels = {
  height: "Stature",
  build: "Build",
  hair: "Hair",
  palette: "Palette",
};
let renderer, controls;

function button(label, handler) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", handler);
  return element;
}
function pressed(element, state) {
  element.setAttribute("aria-pressed", String(state));
}
function applyEdit(next, message) {
  history[active].push(recipes[active]);
  recipes[active] = next;
  update();
  $("#status").textContent = message;
}
function chooseAngle(name, resetZoom = false) {
  controls.target.set(0, 0.87, 0);
  camera.position.copy(controls.target).add(new T.Vector3(...views[name]));
  if (resetZoom) {
    camera.zoom = 1;
    camera.updateProjectionMatrix();
  }
  controls.update();
  for (const el of $("#angles").children)
    pressed(el, el.dataset.angle === name);
  render();
}
function bindControls() {
  recipes.forEach((recipe, index) =>
    $("#characters").append(
      button(recipe.name, () => {
        active = index;
        update();
      }),
    ),
  );
  outfits.forEach((outfit) => {
    const el = button(outfit, () => {
      if (recipes[active].outfit !== outfit)
        applyEdit({ ...recipes[active], outfit }, outfit + " equipped.");
    });
    el.className = "outfit";
    $("#outfits").append(el);
  });
  for (const key of Object.keys(values)) {
    const row = document.createElement("div");
    row.className = "feature";
    const name = document.createElement("b");
    name.textContent = labels[key];
    const value = document.createElement("span");
    value.id = "value-" + key;
    const description = document.createElement("div");
    description.append(name, value);
    const roll = button("Reroll", () => {
      const entropy = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
      const next = reroll(recipes[active], key, entropy);
      applyEdit(next, labels[key] + " changed to " + next[key] + ".");
    });
    roll.className = "roll";
    roll.setAttribute("aria-label", "Reroll " + labels[key].toLowerCase());
    row.append(description, roll);
    $("#features").append(row);
  }
  $("#undo").addEventListener("click", () => {
    if (history[active].length) {
      recipes[active] = history[active].pop();
      update();
      $("#status").textContent = "Last character edit undone.";
    }
  });
  compare.addEventListener("change", () => {
    update();
    resize();
  });
  for (const el of $("#angles").children)
    el.addEventListener("click", () => chooseAngle(el.dataset.angle));
  $("#reset").addEventListener("click", () => chooseAngle("3/4", true));
  for (const el of $("#display").children)
    el.addEventListener("click", () => {
      silhouette = el.dataset.mode === "Silhouette";
      update();
    });
}
function update() {
  const recipe = recipes[active];
  $("#name").textContent = recipe.name;
  $("#look").textContent = recipe.outfit;
  $("#compare-key").textContent = compare.checked
    ? "Left  " + recipe.name + "   /   Right  " + recipes[1 - active].name
    : "";
  $("#undo").disabled = !history[active].length;
  Array.from($("#characters").children).forEach((el, i) =>
    pressed(el, i === active),
  );
  for (const el of $("#outfits").children)
    pressed(el, el.textContent === recipe.outfit);
  for (const el of $("#display").children)
    pressed(el, (el.dataset.mode === "Silhouette") === silhouette);
  for (const key of Object.keys(values))
    $("#value-" + key).textContent =
      key === "height" ? recipe.height.toFixed(2) + " m" : recipe[key];
  for (const old of figures) {
    scene.remove(old);
    disposeCharacter(old);
  }
  figures.length = 0;
  const visible = compare.checked ? [recipe, recipes[1 - active]] : [recipe];
  for (const item of visible) {
    const figure = createCharacter(item, silhouette);
    figures.push(figure);
    scene.add(figure);
  }
  render();
}
function render() {
  if (!renderer) return;
  // Line up the feet in the camera's horizontal direction so a side view
  // still shows both characters at equal depth and at the same world scale.
  const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  figures.forEach((figure, i) =>
    figure.position
      .copy(right)
      .multiplyScalar(figures.length === 2 ? (i - 0.5) * 0.96 : 0),
  );
  renderer.render(scene, camera);
  for (let h = 0; h <= 2; h++) {
    const pos = new T.Vector3(0, h, 0).project(camera);
    $("#tick" + h).style.top = (1 - pos.y) * 50 + "%";
  }
}
function resize() {
  const width = stage.clientWidth,
    height = stage.clientHeight,
    aspect = width / height;
  const frame = Math.max(2.65, (compare.checked ? 2.25 : 1.65) / aspect);
  Object.assign(camera, {
    top: frame / 2,
    bottom: -frame / 2,
    left: (-frame * aspect) / 2,
    right: (frame * aspect) / 2,
  });
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  render();
}
function setup() {
  renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  scene.fog = new T.FogExp2("#dbe2d8", 0.073);
  const ground = new T.Mesh(
    new T.PlaneGeometry(80, 80),
    new T.MeshStandardMaterial({ color: "#becdbf", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new T.GridHelper(10, 40, "#9aafa2", "#aabbaf");
  grid.position.y = -0.011;
  grid.material.transparent = true;
  grid.material.opacity = 0.54;
  scene.add(grid);
  const rim = new T.Mesh(
    new T.RingGeometry(1.27, 1.278, 96),
    new T.MeshBasicMaterial({ color: "#8da195" }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.008;
  scene.add(rim);
  scene.add(new T.HemisphereLight("#fff2dc", "#b1c4bb", 1.9));
  const key = new T.DirectionalLight("#fff0da", 2.15);
  key.position.set(-3.2, 5, 4.5);
  key.castShadow = true;
  Object.assign(key.shadow.camera, {
    left: -2.4,
    right: 2.4,
    top: 2.5,
    bottom: -2.5,
    near: 0.1,
    far: 12,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.009;
  key.shadow.bias = -0.0003;
  scene.add(key);
  const back = new T.DirectionalLight("#d5ece7", 1.2);
  back.position.set(2.5, 3, -3);
  scene.add(back);
  controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 3;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2 - 0.024;
  controls.rotateSpeed = 0.75;
  controls.addEventListener("change", () => {
    for (const el of $("#angles").children) pressed(el, false);
    render();
  });
  bindControls();
  chooseAngle("3/4");
  resize();
  update();
  new ResizeObserver(resize).observe(stage);
}
try {
  setup();
} catch (error) {
  console.error(error);
  $("#failure").hidden = false;
  $("#failure").textContent =
    "The 3D view could not start. Open this file in a browser with WebGL 2 hardware acceleration enabled.";
  document
    .querySelectorAll("button,input")
    .forEach((el) => (el.disabled = true));
}
