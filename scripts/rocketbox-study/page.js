// Side-by-side orbit of two Microsoft Rocketbox avatars and the editable adults made to match them.
// Both panes share one orthographic camera, so a metre is the same number of pixels in each.
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCharacter, disposeCharacter } from "../../character-view/model.js";
import { loadHumanLibraryMaps } from "../../character-view/human-library.js";
import { loadComplexions } from "../../character-view/human-complexion.js";
import { loadSurfaces } from "../../character-view/materials.js";
import { loadFacePaint } from "../../character-view/face.js";
import { rocketboxStudies } from "../../.reference-cache/rocketbox/studies.js";
// Front-to-back placement of each adult, measured by compare.mjs.
import placement from "../../.reference-cache/rocketbox/placement.json";
import femaleTarget from "../../.reference-cache/rocketbox/targets/female-adult-04.glb";
import gardenerTarget from "../../.reference-cache/rocketbox/targets/gardener-male-01.glb";

const targets = {
  "rocketbox-female-adult-04": femaleTarget,
  "rocketbox-gardener-male-01": gardenerTarget,
};
// Centre height and visible height in metres, then the least visible width of one pane.
const frames = {
  whole: [0.96, 2.06, 1.5],
  torso: [1.2, 0.95, 0.8],
  head: [1.62, 0.42, 0.36],
  legs: [0.5, 1.08, 0.8],
};
const get = (id) => document.getElementById(id);

// Hair cards carry their shape in the texture's alpha. Keep that cut in clay and silhouette.
function cutout(material, texture) {
  material.map = texture;
  material.alphaTest = 0.4;
  material.side = T.DoubleSide;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      "diffuseColor.a *= texture2D( map, vMapUv ).a;",
    );
  };
  return material;
}
function ruler() {
  const group = new T.Group(),
    points = [];
  for (let i = 0; i <= 20; i++) {
    const y = i / 10,
      reach = i % 10 === 0 ? 0.09 : i % 5 === 0 ? 0.06 : 0.03;
    points.push(0, y, 0, reach, y, 0);
  }
  points.push(0, 0, 0, 0, 2, 0);
  const lines = new T.LineSegments(
    new T.BufferGeometry().setAttribute("position", new T.Float32BufferAttribute(points, 3)),
    new T.LineBasicMaterial({ color: 0x41584c }),
  );
  group.add(lines);
  for (const metres of [0, 0.5, 1, 1.5, 2]) {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 64;
    const c = canvas.getContext("2d");
    c.font = "600 40px system-ui, sans-serif";
    c.fillStyle = "#2c4337";
    c.textBaseline = "middle";
    c.fillText(metres.toFixed(1) + " m", 4, 34);
    const label = new T.Sprite(
      new T.SpriteMaterial({ map: new T.CanvasTexture(canvas), depthTest: false }),
    );
    label.scale.set(0.2, 0.08, 1);
    label.center.set(0, 0.5);
    label.position.set(0.1, metres, 0);
    group.add(label);
  }
  return group;
}
function lights(scene) {
  scene.add(new T.HemisphereLight(0xf2f6ff, 0x8f948f, 1.15));
  const key = new T.DirectionalLight(0xfff3dd, 2.3),
    back = new T.DirectionalLight(0xd8e9ff, 1.2);
  scene.add(key, key.target, back, back.target);
  return { key, back };
}

async function start() {
  const stage = get("stage"),
    renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setScissorTest(true);
  stage.append(renderer.domElement);
  await Promise.all([loadHumanLibraryMaps(), loadComplexions(), loadSurfaces(), loadFacePaint()]);

  const panes = ["target", "result"].map(() => {
    const scene = new T.Scene();
    scene.background = new T.Color(0xdfe5df);
    const rig = lights(scene),
      scale = ruler(),
      floor = new T.GridHelper(2, 20, 0x93a297, 0xc3ccc3);
    scene.add(scale, floor);
    return { scene, rig, scale, actor: null };
  });
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 40),
    orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enablePan = false;
  orbit.minZoom = 0.6;
  orbit.maxZoom = 8;
  const state = { study: rocketboxStudies[0].id, mode: "Colour", frame: "whole", stage: "final" },
    loaded = new Map();

  async function target(id) {
    if (!loaded.has(id)) {
      const scene = (await new GLTFLoader().loadAsync(targets[id])).scene,
        looks = new Map();
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const hair = o.material.transparent || o.material.alphaTest > 0;
        o.material.transparent = false;
        o.material.depthWrite = true;
        o.material.roughness = 0.82;
        if (hair) {
          o.material.alphaTest = 0.4;
          o.material.side = T.DoubleSide;
        }
        looks.set(o, {
          Colour: o.material,
          Clay: hair
            ? cutout(new T.MeshStandardMaterial({ color: 0xadb4ad, roughness: 0.86 }), o.material.map)
            : new T.MeshStandardMaterial({ color: 0xadb4ad, roughness: 0.86 }),
          Silhouette: hair
            ? cutout(new T.MeshBasicMaterial({ color: 0x203733 }), o.material.map)
            : new T.MeshBasicMaterial({ color: 0x203733 }),
        });
      });
      loaded.set(id, { scene, looks });
    }
    return loaded.get(id);
  }
  async function build() {
    const study = rocketboxStudies.find((s) => s.id === state.study),
      [left, right] = panes;
    if (left.actor) left.scene.remove(left.actor);
    const source = await target(study.id);
    for (const [mesh, look] of source.looks) mesh.material = look[state.mode];
    left.actor = source.scene;
    left.scene.add(left.actor);
    if (right.actor) {
      right.scene.remove(right.actor);
      disposeCharacter(right.actor);
    }
    const form = study.stages[state.stage] ?? study.stages.final;
    right.actor = createCharacter(form(), state.mode === "Silhouette", state.mode === "Clay");
    right.scene.add(right.actor);
    // Stand the adult on its soles, as the original stands on its own.
    right.actor.updateMatrixWorld(true);
    right.actor.position.y -= new T.Box3().setFromObject(right.actor, true).min.y;
    // And where its outlines best cover the original's front to back, so a different origin is not counted as a difference in shape.
    right.actor.position.z = placement[study.id.replace("rocketbox-", "") + (state.stage === "final" ? "" : "-" + state.stage)] ?? 0;
    for (const pane of panes) pane.scene.background.set(state.mode === "Silhouette" ? 0xf4f6f4 : 0xdfe5df);
    get("credit").textContent = study.credit;
    get("source").href = study.source;
    get("note").textContent = study.stageNotes?.[state.stage] ?? "";
    get("form").textContent = ".reference-cache/rocketbox/forms/" + study.id + ".form.json";
    size();
  }
  function size() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const [, high, wide] = frames[state.frame],
      extent = Math.max(high, (wide * h * 2) / w);
    camera.top = extent / 2;
    camera.bottom = -camera.top;
    camera.right = (camera.top * w) / 2 / h;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    get("scale").textContent =
      "Both panes: " + (h / extent / camera.zoom ** -1).toFixed(0) + " screen pixels per metre";
    render();
  }
  function look(degrees, pitch = 0) {
    const a = (degrees * Math.PI) / 180,
      p = (pitch * Math.PI) / 180,
      y = frames[state.frame][0];
    orbit.target.set(0, y, 0);
    camera.position.set(8 * Math.sin(a) * Math.cos(p), y + 8 * Math.sin(p), 8 * Math.cos(a) * Math.cos(p));
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    orbit.update();
    size();
  }
  function render() {
    const w = stage.clientWidth,
      h = stage.clientHeight,
      turn = orbit.getAzimuthalAngle();
    panes.forEach((pane, i) => {
      const left = Math.round((i * w) / 2),
        width = Math.round(((i + 1) * w) / 2) - left;
      // The ruler stays square to the camera beside the figure, lights follow the view.
      pane.scale.rotation.y = turn;
      pane.scale.position.set(-0.66 * Math.cos(turn), 0, 0.66 * Math.sin(turn));
      pane.scale.visible = state.ruler !== false && (state.frame === "whole" || state.frame === "legs");
      pane.rig.key.position.set(-2.4, 2.6, 3).applyQuaternion(camera.quaternion).add(orbit.target);
      pane.rig.key.target.position.copy(orbit.target);
      pane.rig.back.position.set(2.5, 1.5, -3).applyQuaternion(camera.quaternion).add(orbit.target);
      pane.rig.back.target.position.copy(orbit.target);
      pane.scene.updateMatrixWorld(true);
      renderer.setViewport(left, 0, width, h);
      renderer.setScissor(left, 0, width, h);
      renderer.render(pane.scene, camera);
    });
  }
  orbit.addEventListener("change", render);
  new ResizeObserver(size).observe(stage);

  get("study").replaceChildren(...rocketboxStudies.map((s) => new Option(s.title, s.id)));
  const stageNames = () =>
    Object.keys(rocketboxStudies.find((s) => s.id === state.study).stages);
  const stages = () =>
    get("stages").replaceChildren(...stageNames().map((s) => new Option(s, s, false, s === state.stage)));
  stages();
  get("study").onchange = async () => {
    state.study = get("study").value;
    if (!stageNames().includes(state.stage)) state.stage = "final";
    stages();
    await build();
  };
  get("stages").onchange = async () => {
    state.stage = get("stages").value;
    await build();
  };
  for (const button of get("modes").children)
    button.onclick = async () => {
      state.mode = button.dataset.mode;
      for (const b of get("modes").children) b.setAttribute("aria-pressed", b === button);
      await build();
    };
  get("frame").onchange = () => {
    state.frame = get("frame").value;
    look((orbit.getAzimuthalAngle() * 180) / Math.PI);
  };
  for (const button of get("angles").children)
    button.onclick = () => look(Number(button.dataset.angle));
  await build();
  look(25);
  get("status").textContent = "";
  // Scripted captures use the same controls as a visitor.
  window.rocketboxStudy = {
    // `ruler: false` leaves the ruler out, so an outline measurement counts the figures only.
    async show({ study, mode, frame, stage: wanted, angle = 0, pitch = 0, ruler = true }) {
      const rebuild =
        (study && study !== state.study) || (mode && mode !== state.mode) || (wanted && wanted !== state.stage);
      Object.assign(state, {
        study: study ?? state.study,
        mode: mode ?? state.mode,
        frame: frame ?? state.frame,
        stage: wanted ?? state.stage,
        ruler,
      });
      if (rebuild) await build();
      look(angle, pitch);
      render();
      return { width: stage.clientWidth, height: stage.clientHeight, metres: camera.top * 2 };
    },
    studies: rocketboxStudies.map((s) => ({ id: s.id, stages: Object.keys(s.stages) })),
  };
}
start().catch((error) => {
  get("status").textContent = error.message;
  console.error(error);
});
