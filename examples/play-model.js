import { releaseGLTFScenes as release } from "../character-view/release-gltf.js";
import { clipsForScene } from "./wardrobe-scenes.js";
import { gazeNames, setGaze } from "../character-view/ocular.js";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// A separate consumer. This scene only knows glTF and metres.
const $ = (id) => document.getElementById(id);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xe8eae6);
renderer.toneMapping = T.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;
$("stage").append(renderer.domElement);
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(34, 1, 0.01, 250);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
// A broad reflection is visible in glass, polished leather and metal. The
// directional key keeps diffuse planes legible on both sides of a portrait.
const room = new RoomEnvironment();
const reflections = new T.PMREMGenerator(renderer);
scene.environment = reflections.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.42;
room.dispose();
reflections.dispose();
scene.add(new T.HemisphereLight(0xf4f6ff, 0xae9f93, 0.76));
const light = new T.DirectionalLight(0xfff0de, 2.65);
const keyDirection = new T.Vector3(-0.75, 1.0, 1.15).normalize();
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
light.shadow.bias = -0.00015;
scene.add(light, light.target);
const fill = new T.DirectionalLight(0xc8dcff, 1.35);
fill.position.set(3, 3, -4);
scene.add(fill);
const shadowFloor = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShadowMaterial({ opacity: 0.11, depthWrite: false }));
shadowFloor.rotation.x = -Math.PI / 2;
shadowFloor.receiveShadow = true;
scene.add(shadowFloor);
const grid = new T.GridHelper(18, 36, 0x71857c, 0xc3ccc6);
scene.add(grid);
let asset,
  fileName,
  model,
  mixer,
  clips = [],
  action,
  previous = null,
  pendingFrame = null,
  generation = 0;
let lastBounds = new T.Box3(),
  faceBounds = new T.Box3(),
  restPositions = [],
  meshes = [],
  locked = false;
const clayMaterial = new T.MeshStandardMaterial({
    color: 0xb6bdb8,
    roughness: 0.9,
  }),
  inkMaterial = new T.MeshBasicMaterial({ color: 0x203733 });
const directions = {
  threequarter: [1.85, 0.56, 3],
  front: [0, 0, 1],
  portrait: [0, 0, 1],
  "portrait-side": [-1, 0, 0],
  "portrait-oblique": [-0.74, 0, 1],
  "portrait-angle": [0, 0, 1],
  side: [1, 0, 0],
  overhead: [0, 1, 0.001],
  back: [0, 0, -1],
};
function frameModel() {
  const view = $("camera-angle").value,
    direction = directions[view];
  $("portrait-orbit").hidden = view !== "portrait-angle";
  const bounds = view.startsWith("portrait") ? faceBounds : lastBounds;
  if (!direction || bounds.isEmpty()) return;
  const center = bounds.getCenter(new T.Vector3()),
    size = bounds.getSize(new T.Vector3());
  const aim = new T.Vector3(...direction);
  if (view === "portrait-angle")
    aim.setFromSphericalCoords(
      1,
      T.MathUtils.degToRad(90 - Number($("portrait-pitch").value)),
      T.MathUtils.degToRad(Number($("portrait-yaw").value)),
    );
  orbit.target.copy(center);
  camera.position
    .copy(center)
    .add(
      aim.normalize().multiplyScalar(Math.max(size.x, size.y, size.z) * 2.55),
    );
  orbit.update();
}
$("camera-angle").onchange = frameModel;
function setAngle(id, value) {
  const el = $(id);
  el.value = String(
    T.MathUtils.clamp(Number(value) || 0, Number(el.min), Number(el.max)),
  );
}
for (const id of ["portrait-yaw", "portrait-pitch"])
  $(id).onchange = () => {
    setAngle(id, $(id).value);
    frameModel();
  };
orbit.addEventListener("start", () => {
  $("camera-angle").value = "";
  $("portrait-orbit").hidden = true;
});
function setSurface() {
  for (const m of meshes) {
    const mat =
      $("surface").value === "clay"
        ? clayMaterial
        : $("surface").value === "ink"
          ? inkMaterial
          : null;
    m.material = mat
      ? Array.isArray(m.userData.sourceMaterial)
        ? m.userData.sourceMaterial.map(() => mat)
        : mat
      : m.userData.sourceMaterial;
  }
}
$("surface").onchange = () => { setSurface(); requestFrame(); };
const pointerRay = new T.Raycaster(),
  cursor = new T.Vector2();
let pressedAt;
renderer.domElement.addEventListener("pointerdown", (e) => {
  pressedAt = [e.clientX, e.clientY];
});
renderer.domElement.addEventListener("pointerup", (e) => {
  if (
    !pressedAt ||
    Math.hypot(e.clientX - pressedAt[0], e.clientY - pressedAt[1]) > 4
  )
    return;
  pressedAt = null;
  const rect = renderer.domElement.getBoundingClientRect();
  cursor.set(
    ((e.clientX - rect.left) * 2) / rect.width - 1,
    1 - ((e.clientY - rect.top) * 2) / rect.height,
  );
  pointerRay.setFromCamera(cursor, camera);
  for (const m of meshes) if (m.isSkinnedMesh) m.computeBoundingSphere();
  const hit = pointerRay.intersectObjects(meshes, false)[0],
    label = $("picked-region");
  label.hidden = true;
  if (!hit) return;
  const attr = hit.object.geometry.attributes._region,
    names = hit.object.userData.regionNames;
  let name;
  if (attr && names && hit.face) {
    const ids = [hit.face.a, hit.face.b, hit.face.c].map((i) => attr.getX(i));
    name = names[ids[1] === ids[2] ? ids[1] : ids[0]];
  } else {
    let n = hit.object;
    while (n && !n.userData.partId) n = n.parent;
    name = n?.userData.partId;
  }
  if (name) {
    label.hidden = false;
    label.textContent =
      name +
      " · (" +
      hit.point
        .toArray()
        .map((n) => n.toFixed(3))
        .join(", ") +
      ") m";
  }
});
function expression(value) {
  for (const m of meshes)
    if (m.morphTargetDictionary)
      for (const [key, id] of Object.entries(m.morphTargetDictionary))
        if (!gazeNames.includes(key))
          m.morphTargetInfluences[id] = key === value ? 1 : 0;
}
function gaze() {
  setGaze(
    model,
    Number($("look-x").value) / 100,
    Number($("look-y").value) / 100,
  );
}
$("look-x").oninput = $("look-y").oninput = () => { gaze(); requestFrame(); };
$("expression").onchange = () => { expression($("expression").value); requestFrame(); };
function pose() {
  model.updateMatrixWorld(true);
  const all = [],
    box = new T.Box3(),
    point = new T.Vector3();
  for (const m of meshes) {
    m.skeleton?.update();
    // Bounds use every baked vertex, including the current skin deformation.
    const values = new Float32Array(m.geometry.attributes.position.count * 3);
    for (let i = 0; i < values.length / 3; i++) {
      m.getVertexPosition(i, point).applyMatrix4(m.matrixWorld);
      box.expandByPoint(point);
      point.toArray(values, i * 3);
    }
    all.push(values);
  }
  return { box, all };
}
function selectClip() {
  mixer.stopAllAction();
  action = null;
  const clip = clips.find((c) => c.name === $("clip").value);
  if (clip) action = mixer.clipAction(clip).reset().play();
  mixer.update(0);
  $("time").value = 0;
  requestFrame();
}
function showScene(index, view, initialClip, preserve = false) {
  const phase = action ? action.time / action.getClip().duration : 0,
    oldExpression = $("expression").value;
  mixer?.stopAllAction();
  if (model) mixer?.uncacheRoot(model);
  if (model) {
    expression("");
    setGaze(model, 0, 0);
  }
  for (const m of meshes) m.material = m.userData.sourceMaterial;
  model?.removeFromParent();
  model = asset.scenes[index];
  scene.add(model);
  meshes = [];
  $("picked-region").hidden = true;
  model.traverse((o) => {
    if (o.isMesh) {
      o.userData.sourceMaterial = o.material;
      o.castShadow = o.receiveShadow = true;
      meshes.push(o);
    }
  });
  if (!meshes.length) throw new Error("This file contains no mesh.");
  const targets = [
    ...new Set(
      meshes.flatMap((m) => Object.keys(m.morphTargetDictionary ?? {})),
    ),
  ];
  const poses = targets.filter((k) => !gazeNames.includes(k));
  $("look-fields").hidden = !targets.includes("LookLeft");
  if (!preserve) $("look-x").value = $("look-y").value = 0;
  $("expression-field").hidden = !poses.length;
  $("expression").replaceChildren(
    new Option("Rest", ""),
    ...poses.map((k) => new Option(k === "BrowLift" ? "Raise brows" : k, k)),
  );
  mixer = new T.AnimationMixer(model);
  clips = clipsForScene(asset, index);
  const neutral = pose();
  restPositions = neutral.all;
  lastBounds = neutral.box;
  faceBounds.makeEmpty();
  const point = new T.Vector3();
  meshes.forEach((mesh, index) => {
    if (!mesh.userData.faceSurface) return;
    const vertices = neutral.all[index];
    for (let i = 0; i < vertices.length; i += 3)
      faceBounds.expandByPoint(point.fromArray(vertices, i));
  });
  for (const option of $("camera-angle").querySelectorAll(
    'option[value^="portrait"]',
  ))
    option.disabled = faceBounds.isEmpty();
  if (faceBounds.isEmpty() && $("camera-angle").value.startsWith("portrait"))
    $("camera-angle").value = "threequarter";
  if (
    Object.hasOwn(directions, view) &&
    (!view.startsWith("portrait") || !faceBounds.isEmpty())
  )
    $("camera-angle").value = view;
  const size = lastBounds.getSize(new T.Vector3());
  const radius = Math.max(size.length() * 0.61, 0.01);
  const centre = lastBounds.getCenter(new T.Vector3());
  light.target.position.copy(centre);
  light.position.copy(centre).addScaledVector(keyDirection, 3 * radius);
  Object.assign(light.shadow.camera, {
    left: -radius, right: radius, top: radius, bottom: -radius,
    near: radius * 0.5, far: radius * 5,
  });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = radius * 0.0008;
  shadowFloor.scale.setScalar(radius * 8);
  shadowFloor.position.set(centre.x, lastBounds.min.y - 0.001 * radius, centre.z);
  if (!preserve) {
    if (!$("camera-angle").value) $("camera-angle").value = "threequarter";
    frameModel();
  }
  $("clip").replaceChildren(
    new Option("Rest pose", ""),
    ...clips.map((c) => new Option(c.name, c.name)),
  );
  if (clips.some((c) => c.name === initialClip)) $("clip").value = initialClip;
  $("clip").disabled = !clips.length;
  $("check").disabled = !clips.length;
  $("report").textContent = "";
  $("status").textContent =
    fileName +
    " · " +
    size.y.toFixed(3) +
    " m tall · " +
    new Set(meshes.filter((m) => m.skeleton).map((m) => m.skeleton.bones[0]))
      .size +
    " skeletons · " +
    clips.length +
    " clips";
  const triangles = meshes.reduce(
    (n, m) =>
      n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
    0,
  );
  const surfaces = new Set(
    meshes.flatMap((m) =>
      Array.isArray(m.material) ? m.material : [m.material],
    ),
  );
  $("stats").textContent =
    triangles.toLocaleString() + " triangles · " + surfaces.size + " materials";
  setSurface();
  selectClip();
  if (preserve) {
    if (action) {
      action.time = phase * action.getClip().duration;
      mixer.update(0);
      $("time").value = phase;
    }
    if (poses.includes(oldExpression)) {
      $("expression").value = oldExpression;
      expression(oldExpression);
    }
    gaze();
  }
}
async function load(file, view, initialClip, initialOutfit) {
  if (!file) return;
  const ticket = ++generation;
  $("status").textContent = "Loading " + file.name + "…";
  try {
    const gltf = await new GLTFLoader().parseAsync(
      await file.arrayBuffer(),
      "",
    );
    if (ticket !== generation) {
      release(gltf.scenes);
      return;
    }
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    for (const m of meshes) m.material = m.userData.sourceMaterial;
    release(asset?.scenes);
    asset = gltf;
    model = mixer = action = null;
    meshes = [];
    fileName = file.name;
    const labels = gltf.scenes.map(
      (s, i) => s.userData.outfitName || s.name || "Scene " + (i + 1),
    );
    const selected = initialOutfit ? labels.indexOf(initialOutfit) : -1;
    const index = selected >= 0 ? selected : gltf.scenes.indexOf(gltf.scene);
    $("wardrobe-look").replaceChildren(
      ...labels.map((name, i) => new Option(name, String(i))),
    );
    $("wardrobe-look").value = String(index);
    $("outfit-field").hidden = labels.length < 2;
    showScene(index, view, initialClip);
  } catch (e) {
    if (ticket === generation) $("status").textContent = e.message;
  }
}
$("wardrobe-look").onchange = () => {
  showScene(Number($("wardrobe-look").value), null, $("clip").value, true);
};
$("file").onchange = (e) => load(e.target.files[0]);
async function openExample() {
  const params = new URLSearchParams(location.hash.slice(1));
  const key = params.get("model");
  if (
    !key ||
    !/^https?:$/.test(location.protocol) ||
    !/^[a-z0-9-]{1,80}$/.test(key)
  )
    return;
  const ticket = ++generation;
  try {
    const response = await fetch("/examples/" + key + ".glb");
    if (!response.ok) throw new Error("This example is unavailable.");
    const blob = await response.blob();
    if (ticket === generation) {
      if (params.get("view") === "portrait-angle") {
        setAngle("portrait-yaw", params.get("yaw") ?? -30);
        setAngle("portrait-pitch", params.get("pitch") ?? 0);
      }
      await load(
        new File([blob], key + ".glb"),
        params.get("view"),
        params.get("clip"),
        params.get("outfit"),
      );
    }
  } catch (e) {
    if (ticket === generation) $("status").textContent = e.message;
  }
}
openExample();
window.addEventListener("hashchange", openExample);
$("clip").onchange = selectClip;
$("time").oninput = () => {
  if (action) {
    $("playing").checked = false;
    action.time = Number($("time").value) * action.getClip().duration;
    mixer.update(0);
    requestFrame();
  }
};
$("check").onclick = async () => {
  if (!model || locked) return;
  locked = true;
  $("check").disabled = true;
  $("wardrobe-look").disabled = true;
  const measured = model,
    selected = $("clip").value,
    oldTime = action?.time ?? 0,
    lines = [];
  try {
    for (const clip of clips) {
      $("report").textContent = "Sampling " + clip.name + "…";
      await new Promise(requestAnimationFrame);
      if (measured !== model) return;
      $("clip").value = clip.name;
      selectClip();
      let floor = Infinity,
        peak = 0;
      for (let i = 0; i < 8; i++) {
        action.time = (clip.duration * i) / 8;
        mixer.update(0);
        const { box, all } = pose();
        floor = Math.min(floor, box.min.y);
        for (let j = 0; j < all.length; j++)
          for (let k = 0; k < all[j].length; k += 3) {
            const p = all[j],
              r = restPositions[j],
              dx = p[k] - r[k],
              dy = p[k + 1] - r[k + 1],
              dz = p[k + 2] - r[k + 2];
            peak = Math.max(peak, dx * dx + dy * dy + dz * dz);
          }
      }
      lines.push(
        clip.name +
          " · movement " +
          Math.sqrt(peak).toFixed(3) +
          " m · lowest vertex " +
          floor.toFixed(3) +
          " m",
      );
    }
    $("report").textContent = lines.join("\n");
  } finally {
    if (measured === model) {
      $("clip").value = selected;
      selectClip();
      if (action) {
        action.time = oldTime;
        mixer.update(0);
        $("time").value = oldTime / action.getClip().duration;
      }
    }
    locked = false;
    $("wardrobe-look").disabled = false;
    $("check").disabled = !clips.length;
  }
};
new ResizeObserver(() => {
  const r = $("stage").getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  requestFrame();
}).observe($("stage"));
camera.position.set(2, 1.5, 3);
orbit.target.set(0, 0.7, 0);
function requestFrame() {
  if (pendingFrame === null) pendingFrame = requestAnimationFrame(drawFrame);
}
function drawFrame(t) {
  pendingFrame = null;
  const playing = action && !locked && $("playing").checked;
  if (playing) {
    mixer.update(previous === null ? 0 : Math.min((t - previous) / 1000, 0.08));
    if ($("expression").value) expression($("expression").value);
    $("time").value = action.time / action.getClip().duration;
  }
  previous = playing ? t : null;
  // Damping emits camera change events until the orbit settles.
  orbit.update();
  renderer.render(scene, camera);
  if (playing) requestFrame();
}
orbit.addEventListener("change", requestFrame);
$("playing").onchange = requestFrame;
requestFrame();
