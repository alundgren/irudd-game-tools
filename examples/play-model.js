import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// A separate consumer. This scene only knows glTF and metres.
const $ = (id) => document.getElementById(id);
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0xe8eae6);
$("stage").append(renderer.domElement);
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(34, 1, 0.01, 250);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
scene.add(new T.HemisphereLight(0xfff7eb, 0xb1bdb5, 2.1));
const light = new T.DirectionalLight(0xfffaf0, 2.4);
light.position.set(3, 5, 4);
scene.add(light);
const fill = new T.DirectionalLight(0xc1d8eb, 1.1);
fill.position.set(-3, 2, -4);
scene.add(fill);
const grid = new T.GridHelper(18, 36, 0x71857c, 0xc3ccc6);
scene.add(grid);
let model,
  mixer,
  clips = [],
  action,
  previous = performance.now(),
  generation = 0;
let lastBounds = new T.Box3(),
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
  side: [1, 0, 0],
  back: [0, 0, -1],
};
function frameModel() {
  const direction = directions[$("camera-angle").value];
  if (!direction || lastBounds.isEmpty()) return;
  const center = lastBounds.getCenter(new T.Vector3()),
    size = lastBounds.getSize(new T.Vector3());
  orbit.target.copy(center);
  camera.position
    .copy(center)
    .add(
      new T.Vector3(...direction)
        .normalize()
        .multiplyScalar(Math.max(size.x, size.y, size.z) * 2.55),
    );
  orbit.update();
}
$("camera-angle").onchange = frameModel;
orbit.addEventListener("start", () => {
  $("camera-angle").value = "";
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
$("surface").onchange = setSurface;
function expression(value) {
  for (const m of meshes)
    if (m.morphTargetDictionary)
      for (const [key, id] of Object.entries(m.morphTargetDictionary))
        m.morphTargetInfluences[id] = key === value ? 1 : 0;
}
$("expression").onchange = () => expression($("expression").value);
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
function release(group) {
  if (!group) return;
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    skeletons = new Set();
  group.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.skeleton) skeletons.add(o.skeleton);
    for (const m of (Array.isArray(o.material)
      ? o.material
      : [o.material]
    ).filter(Boolean)) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  for (const v of [...geometries, ...materials, ...textures, ...skeletons])
    v.dispose();
  group.removeFromParent();
}
function selectClip() {
  mixer.stopAllAction();
  action = null;
  const clip = clips.find((c) => c.name === $("clip").value);
  if (clip) action = mixer.clipAction(clip).reset().play();
  mixer.update(0);
  $("time").value = 0;
}
async function load(file) {
  if (!file) return;
  const ticket = ++generation;
  $("status").textContent = "Loading " + file.name + "…";
  try {
    const gltf = await new GLTFLoader().parseAsync(
      await file.arrayBuffer(),
      "",
    );
    if (ticket !== generation) {
      release(gltf.scene);
      return;
    }
    mixer?.stopAllAction();
    for (const m of meshes) m.material = m.userData.sourceMaterial;
    release(model);
    model = gltf.scene;
    scene.add(model);
    meshes = [];
    model.traverse((o) => {
      if (o.isMesh) {
        o.userData.sourceMaterial = o.material;
        meshes.push(o);
      }
    });
    if (!meshes.length) throw new Error("This file contains no mesh.");
    const targets = [
      ...new Set(
        meshes.flatMap((m) => Object.keys(m.morphTargetDictionary ?? {})),
      ),
    ];
    $("expression-field").hidden = !targets.length;
    $("expression").replaceChildren(
      new Option("Rest", ""),
      ...targets.map(
        (k) => new Option(k === "BrowLift" ? "Raise brows" : k, k),
      ),
    );
    mixer = new T.AnimationMixer(model);
    clips = gltf.animations;
    const neutral = pose();
    restPositions = neutral.all;
    lastBounds = neutral.box;
    const size = lastBounds.getSize(new T.Vector3());
    if (!$("camera-angle").value) $("camera-angle").value = "threequarter";
    frameModel();
    $("clip").replaceChildren(
      new Option("Rest pose", ""),
      ...clips.map((c) => new Option(c.name, c.name)),
    );
    $("clip").disabled = !clips.length;
    $("check").disabled = !clips.length;
    $("report").textContent = "";
    $("status").textContent =
      file.name +
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
        n +
        (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3,
      0,
    );
    const surfaces = new Set(
      meshes.flatMap((m) =>
        Array.isArray(m.material) ? m.material : [m.material],
      ),
    );
    $("stats").textContent =
      triangles.toLocaleString() +
      " triangles · " +
      surfaces.size +
      " materials";
    setSurface();
    selectClip();
  } catch (e) {
    if (ticket === generation) $("status").textContent = e.message;
  }
}
$("file").onchange = (e) => load(e.target.files[0]);
async function openExample() {
  const key = new URLSearchParams(location.hash.slice(1)).get("model");
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
    if (ticket === generation) await load(new File([blob], key + ".glb"));
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
  }
};
$("check").onclick = async () => {
  if (!model || locked) return;
  locked = true;
  $("check").disabled = true;
  const selected = $("clip").value,
    oldTime = action?.time ?? 0,
    lines = [];
  try {
    for (const clip of clips) {
      $("report").textContent = "Sampling " + clip.name + "…";
      await new Promise(requestAnimationFrame);
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
    $("clip").value = selected;
    selectClip();
    if (action) {
      action.time = oldTime;
      mixer.update(0);
    }
    locked = false;
    $("check").disabled = false;
  }
};
new ResizeObserver(() => {
  const r = $("stage").getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}).observe($("stage"));
camera.position.set(2, 1.5, 3);
orbit.target.set(0, 0.7, 0);
renderer.setAnimationLoop((t) => {
  if (action && !locked && $("playing").checked) {
    mixer.update(Math.min((t - previous) / 1000, 0.08));
    if ($("expression").value) expression($("expression").value);
    $("time").value = action.time / action.getClip().duration;
  }
  previous = t;
  orbit.update();
  renderer.render(scene, camera);
});
