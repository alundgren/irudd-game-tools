import { measureReferenceView } from "./reference-depth.js";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createCharacter } from "./model.js";
import { evaluateHuman, humanRange } from "./human-surface.js";
import { changeHuman, humanForm } from "./human-form.js";
import * as fitting from "./human-fit.js";
import {
  alignReference,
  bakeScene,
  bodyColumn,
  poseReadings,
  referenceGeometry,
  summarise,
  surfaceIndex,
  unitChoices,
} from "./human-reference-align.js";
import { fitLandmarks, placeHeadScan } from "./head-registration.js";
import { style, template } from "./human-reference-view.js";
import { featureMatcher, featureText } from "./human-feature-match.js";
import { proportionMatcher } from "./human-proportion-match.js";
import { proportionText } from "./human-proportions.js";
import { humanControlNames } from "./human-editor.js";
import { maskText, referenceMasker, underMask, vertexAreas } from "./reference-mask.js";
import { familyPanel, familyText, headKeeper, headKeptText } from "./human-family-editor.js";
import { rigs } from "../examples/local-references.js";

const mhr =
  "Momentum Human Rig v1.0.1 © Meta Platforms, Inc. and affiliates, Apache License 2.0. ";
export const referenceSources = [
  {
    id: "mhr-rest",
    label: "Momentum Human Rig · neutral, rest pose",
    file: "examples/mhr-reference.glb",
    licence: mhr + "Modified conversion of the neutral mesh and skeleton.",
  },
  ...[
    ["f1", "female-typical 1"],
    ["f2", "female-typical 2"],
    ["f3", "female-typical 3"],
    ["m1", "male-typical 1"],
    ["m2", "male-typical 2"],
    ["m3", "male-typical 3"],
  ].map(([id, name]) => ({
    id: "mhr-" + id,
    label: "MHR benchmark adult · " + name,
    file: "examples/human-targets/mhr-" + id + ".glb",
    licence: mhr + "One sampled identity in the editor's pose, without rig.",
  })),
];
const regions = {
  whole: "Whole body",
  head: "Head",
  trunk: "Trunk",
  arms: "Arms",
  legs: "Legs",
};
function regionOf(bone) {
  if (bone === "head" || bone.startsWith("neck")) return "head";
  if (/thigh|calf|foot|ball/.test(bone)) return "legs";
  if (/arm|hand|thumb|index|middle|ring|pinky/.test(bone)) return "arms";
  return "trunk";
}
const frames = {
  whole: [0.5, 1.1, 0.84],
  head: [0.937, 0.174, 0.142],
  trunk: [0.66, 0.52, 0.46],
  arms: [0.68, 0.56, 0.9],
  legs: [0.27, 0.62, 0.5],
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mm = (x) => (x < 99.5 ? x.toFixed(1) : x.toFixed(0));
const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
function neutral(form) {
  const base = humanForm(form.human, form.origin?.seed ?? 0);
  return {
    human: base.human,
    ...(form.humanFit ? { humanFit: form.humanFit } : {}),
    ...(form.humanDetail ? { humanDetail: form.humanDetail } : {}),
    origin: base.origin,
    outfit: "Anatomy",
    appearance: base.appearance,
    parts: base.parts.filter((p) => p.shape === "human region"),
  };
}
function skin(form) {
  const s = evaluateHuman(form.human, form.humanFit, form.humanDetail);
  return s.positions.subarray(0, s.bodyVertices * 3);
}

export function humanReferenceEditor(getForm, commit, status = () => {}) {
  const $ = (id) => document.getElementById(id);
  let dialog, stage, renderer, camera, orbit, scene, key, refMesh;
  let reference = null,
    aligned = null,
    original = null,
    prepared = null,
    working = null,
    steps = [],
    log = [],
    actors = {},
    stats = {},
    view = "side",
    busy = false,
    loads = 0;
  let registration = null, picks = null;
  let feature = null;
  let masker = null;
  let proportion = null;
  let family = null;
  const headOnly = () => $("hfit-kind").value === "head";
  const landmarkNames = ["right outer eye corner", "left outer eye corner", "centre of the chin"];
  const headHint = () => {
    if (!picks) return registration
      ? "Three landmarks matched. RMS placement error " + mm(registration.rmsMm) + " mm."
      : "Match both eye corners and the chin to align the scan in three dimensions.";
    const n = picks.length;
    return "Click the " + landmarkNames[Math.floor(n/2)] + " on the " +
      (n % 2 ? "editable head (right pane)." : "reference (left pane).");
  };
  const materials = {
    human: new T.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.9 }),
    reference: new T.MeshStandardMaterial({ color: 0x9fb0bb, roughness: 0.9 }),
    ghost: new T.MeshStandardMaterial({
      color: 0x3f7fb5,
      roughness: 0.85,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
    heat: new T.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      vertexColors: true,
    }),
  };
  const cold = new T.Color(0x2f6fb3),
    even = new T.Color(0xe9e6dc),
    warm = new T.Color(0xc6452d),
    unmeasured = new T.Color(0x8f918a),
    shade = new T.Color();
  const note = (text) => ($("hfit-note").textContent = text);

  function build() {
    document.head.append(
      Object.assign(document.createElement("style"), { textContent: style }),
    );
    document.body.insertAdjacentHTML("beforeend", template);
    dialog = $("hfit-room");
    stage = $("hfit-stage");
    renderer = new T.WebGLRenderer({ canvas: $("hfit-canvas"), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setScissorTest(true);
    scene = new T.Scene();
    scene.background = new T.Color(0xdfe5df);
    scene.add(new T.HemisphereLight(0xffffff, 0x737a72, 1.05));
    key = new T.DirectionalLight(0xfffaf0, 2.1);
    scene.add(key, key.target);
    const floor = new T.GridHelper(3, 30, 0x93a297, 0xc3ccc3);
    scene.add(floor);
    refMesh = new T.Mesh(new T.BufferGeometry(), materials.reference);
    refMesh.visible = false;
    scene.add(refMesh);
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.minZoom = 0.5;
    orbit.maxZoom = 14;
    orbit.screenSpacePanning = true;
    orbit.addEventListener("change", render);
    new ResizeObserver(() => {
      size();
      render();
    }).observe(stage);

    const installed = referenceSources.filter((s) => rigs.includes(s.id));
    $("hfit-source").replaceChildren(
      new Option(installed.length ? "Choose a reference…" : "No file chosen", ""),
      ...installed.map((s) => new Option(s.label, s.id)),
    );
    $("hfit-source").onchange = () => {
      const source = referenceSources.find((s) => s.id === $("hfit-source").value);
      if (source) load(source.label, () => fetchExample(source), source);
    };
    $("hfit-browse").onclick = () => $("hfit-file").click();
    $("hfit-file").onchange = () => {
      const file = $("hfit-file").files[0];
      $("hfit-file").value = "";
      if (file) load(file.name, () => file.arrayBuffer());
    };
    stage.addEventListener("dragover", (event) => {
      event.preventDefault();
      stage.classList.add("hfit-drop");
    });
    stage.addEventListener("dragleave", () => stage.classList.remove("hfit-drop"));
    dialog.addEventListener("dragover", (event) => event.preventDefault());
    dialog.addEventListener("drop", (event) => event.preventDefault());
    stage.addEventListener("drop", (event) => {
      event.preventDefault();
      stage.classList.remove("hfit-drop");
      const file = event.dataTransfer.files[0];
      if (file && !busy) load(file.name, () => file.arrayBuffer());
    });
    for (const button of $("hfit-views").children)
      button.onclick = () => {
        view = button.dataset.view;
        size();
        refresh();
      };
    for (const button of $("hfit-angles").children)
      button.onclick = () => look(Number(button.dataset.angle));
    $("hfit-frame").onchange = () => frame();
    $("hfit-region").onchange = () => {
      $("hfit-frame").value = $("hfit-region").value;
      lock(busy);
      frame();
    };
    $("hfit-original").onchange = refresh;
    $("hfit-opacity").oninput = render;
    $("hfit-wipe").oninput = render;
    for (const id of ["units", "up", "turn", "nudge-x", "nudge-y", "nudge-z", "match-stature", "match-arms"])
      $("hfit-" + id).onchange = () => {
        if (!reference) return;
        const redo = steps.length;
        if (["units", "up", "turn"].includes(id)) registration = null;
        picks = null;
        restart();
        note(
          redo
            ? "Alignment changed. Fit steps were cleared because they belonged to the earlier placement."
            : "Alignment updated.",
        );
      };
    $("hfit-run").onclick = run;
    $("hfit-undo").onclick = () => {
      ({ form: working, log } = steps.pop());
      show();
      note("Last fit step undone.");
    };
    $("hfit-view-score").onclick = () => {
      if (!aligned || busy) return;
      const reading = $("hfit-view-reading");
      try {
        const sample = measureReferenceView(renderer,camera,refMesh,actors.original.group,actors.now.group);
        const label = r => !r.sharedPixels ? "no shared surface pixels" :
          (r.overlap*100).toFixed(1) + "% outline overlap, " + mm(r.meanMm) +
          " mm mean depth difference (" + mm(r.p95Mm) + " mm at 95%)" +
          (r.contours ? ", surface normals differ by " + r.contours.normalMeanDeg.toFixed(1) +
            "° on average and local relief by " + mm(r.contours.reliefErrorP95Mm) +
            " mm at 95% across " + r.contours.pixels.toLocaleString() + " continuous pixels" : "");
        reading.textContent = "Original: " + label(sample.original) + ". Current: " + label(sample.fitted) +
          ". Depth uses shared pixels in this " + sample.width + " by " + sample.height + " view.";
        reading.dataset.result = JSON.stringify(sample);
      } catch (error) { reading.textContent = error.message; }
    };
    $("hfit-reset").onclick = () => {
      restart();
      note("Back to the aligned starting shape.");
    };
    $("hfit-apply").onclick = () => {
      try {
        commit(
          reference?.id ? {...working,referenceRigs:[...new Set([...(working.referenceRigs??[]),reference.id])]} : working,
          "Fitted the adult human to " + (reference?.name ?? "the reference") + ".",
        );
        dialog.close();
      } catch (error) {
        note("The fit could not be applied. " + error.message);
      }
    };
    $("hfit-kind").onchange = () => {
      registration = picks = null;
      $("hfit-region").value = $("hfit-frame").value = headOnly() ? "head" : "whole";
      restart(); frame(0);
    };
    $("hfit-landmarks").onclick = () => {
      if (picks) picks = null;
      else {
        picks = [];
        view = "side";
        $("hfit-original").checked = true;
        $("hfit-frame").value = "head";
        frame(0);
      }
      refresh();
    };
    let down;
    renderer.domElement.addEventListener("pointerdown", e => {
      down = [e.clientX, e.clientY];
    });
    renderer.domElement.addEventListener("pointerup", e => {
      if (!picks || !down || Math.hypot(e.clientX-down[0],e.clientY-down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const half = rect.width/2, x = e.clientX-rect.left, y = e.clientY-rect.top;
      const side = x < half ? 0 : 1;
      if (side !== picks.length%2) return;
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(2*(x-side*half)/half-1,1-2*y/rect.height),camera);
      const surfaces = side ? actors.original.skins.filter(([,region])=>region==="head").map(([mesh])=>mesh) : [refMesh];
      const hit = ray.intersectObjects(surfaces,false)[0];
      if (!hit) { note("Click directly on the surface at that landmark."); return; }
      const shift = new T.Vector3(...options().nudge);
      const pt = hit.point.clone().sub(shift);
      if (!side && registration) pt.applyMatrix4(registration.transform.clone().invert());
      picks.push(pt.toArray());
      if (picks.length === 6) {
        try {
          const pairs = fitLandmarks([picks[0],picks[2],picks[4]], [picks[1],picks[3],picks[5]]);
          picks = null; registration = pairs;
          $("hfit-original").checked = false;
          restart();
          note("Head aligned. Inspect the profile or fit the head.");
        } catch (error) { picks = null; note(error.message); }
      }
      refresh();
    });
    dialog.addEventListener("close", () => { picks = null; });
    feature = featureMatcher({
      canvas: renderer.domElement,
      camera,
      scene,
      ready: () => Boolean(aligned) && !busy && !picks && (!headOnly() || Boolean(registration)),
      reference: () => refMesh,
      figure: () => actors.now,
      form: () => working,
      accept(next, entry) {
        steps.push({ form: working, log: [...log] });
        working = next;
        log.push(entry);
        show();
      },
      sideBySide() {
        view = "side";
        $("hfit-original").checked = false;
        size();
        refresh();
      },
      note,
      render,
      toggled: () => { masker?.sync(); proportion?.sync(); },
    });
    masker = referenceMasker({
      canvas: renderer.domElement,
      camera,
      scene,
      offered: () => Boolean(aligned) && headOnly(),
      ready: () => !busy && !picks && !feature.active(),
      raw: () => reference?.raw,
      mesh: () => refMesh,
      changed() {
        const cleared = steps.length;
        restart();
        return cleared;
      },
      starting: () => { feature.cancel(); proportion?.cancel(); },
      sideBySide() {
        view = "side";
        size();
        refresh();
      },
      note,
      render,
    });
    proportion = proportionMatcher({
      slot: $("hfit-prop-slot"),
      names: humanControlNames,
      canvas: renderer.domElement,
      camera,
      ready: () => Boolean(aligned) && !busy && !picks && (!headOnly() || Boolean(registration)) && !feature.active() && !masker.active(),
      raw: () => reference?.raw,
      placement: () => aligned,
      reference: () => refMesh,
      figure: () => actors.now,
      form: () => working,
      hold: () => (aligned?.under ? (point) => aligned.under(point, aligned.distance(point)) : null),
      accept(next, entry) {
        steps.push({ form: working, log: [...log] });
        working = next;
        log.push(entry);
        show();
      },
      sideBySide() {
        view = "side";
        $("hfit-original").checked = false;
        size();
        refresh();
      },
      note,
      render,
    });
    family = familyPanel({
      $,
      async read(file) {
        const loader = new GLTFLoader();
        loader.setMeshoptDecoder(MeshoptDecoder);
        return bakeScene((await loader.parseAsync(await file.arrayBuffer(), "")).scene);
      },
      raw: () => reference?.raw,
      settings: options,
      form: () => working,
      busy: () => busy,
      lock,
      note,
      accept(next, entry) {
        steps.push({ form: working, log: [...log] });
        working = next;
        log.push(entry);
        show();
      },
    });
    $("hfit-close").onclick = () => dialog.close();
    if (!fitting.optimizeHumanMeasurements) {
      $("hfit-measure").checked = false;
      $("hfit-measure-field").hidden = true;
    }
  }

  async function fetchExample(source) {
    const base =
      location.protocol === "file:" ? new URL("../", location.href) : location.origin + "/";
    let reply;
    try {
      reply = await fetch(new URL(source.file, base));
    } catch {
      reply = null;
    }
    if (!reply?.ok)
      throw new Error(
        "This example is not served here. Choose " + source.file + " from your local copy with “Choose a GLB file”.",
      );
    return reply.arrayBuffer();
  }
  async function load(name, read, source) {
    const turn = ++loads;
    lock(true);
    note("Reading " + name + "…");
    try {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(await read(), "");
      const raw = bakeScene(gltf.scene);
      if (turn !== loads) return;
      const triangles = raw.indices.length / 3;
      if (triangles > 750000)
        throw new Error(
          "This reference has " + triangles.toLocaleString("en") + " triangles. Use one with at most 750,000.",
        );
      const previous = reference, previousRegistration = registration;
      picks = registration = null;
      reference = {
        name,
        raw,
        triangles,
        id: source?.id ?? "",
        licence: source?.licence ?? gltf.asset?.copyright ?? "",
      };
      await nextFrame();
      try {
        restart();
      } catch (error) {
        reference = previous; registration = previousRegistration;
        restart();
        throw error;
      }
      frame();
      note(
        "Reference aligned. Compare the views, then fit a region. Your character stays as it is until you apply.",
      );
    } catch (error) {
      if (turn !== loads) return;
      note(
        /DRACO|KHR_draco/i.test(error.message)
          ? "Draco-compressed files are not supported. Export the GLB without Draco compression."
          : /JSON|Unexpected|token|Invalid typed array/i.test(error.message)
            ? "This is not a readable single-file GLB."
            : error.message,
      );
    } finally {
      if (turn === loads) {
        lock(false);
        sources();
      }
    }
  }
  function sources() {
    const select = $("hfit-source");
    select.querySelector("[data-local]")?.remove();
    if (reference && !reference.id) {
      const local = new Option("Your file · " + reference.name, "local");
      local.dataset.local = "";
      select.append(local);
    }
    select.value = reference ? reference.id || "local" : "";
    $("hfit-licence").textContent = reference?.licence
      ? reference.licence
      : "A file you choose stays in this browser session. It is not uploaded or saved with the character.";
  }

  function options() {
    return {
      units: $("hfit-units").value,
      up: $("hfit-up").value,
      turn: $("hfit-turn").value,
      nudge: ["x", "y", "z"].map((a) => (Number($("hfit-nudge-" + a).value) || 0) / 1000),
    };
  }
  function prealign(form, pose) {
    const patch = {},
      changes = [],
      [lo, hi] = humanRange("height"),
      height = form.human.height ?? 1.72;
    if ($("hfit-match-stature").checked) {
      const h = +clamp(pose.stature, lo, hi).toFixed(3);
      if (Math.abs(h - height) > 0.0005) {
        patch.height = h;
        changes.push("stature " + height.toFixed(3) + " → " + h.toFixed(3) + " m");
      }
    }
    const want = pose.armsBelowHorizontal;
    if ($("hfit-match-arms").checked && want !== null) {
      const read = (stance) =>
        poseReadings(skin({ ...form, human: { ...form.human, ...patch, stance } }))
          .armsBelowHorizontal;
      let a = 0,
        fa = read(0),
        b = 1,
        fb = read(1),
        best = null;
      for (let i = 0; i < 4 && fa !== null && fb !== null && fa !== fb; i++) {
        best = clamp(a + ((want - fa) * (b - a)) / (fb - fa), -1, 1);
        const f = read(best);
        if (f === null || Math.abs(f - want) < 0.25 || best === b) break;
        [a, fa, b, fb] = [b, fb, best, f];
      }
      const stance = form.human.stance ?? 0;
      if (best !== null && Math.abs(best - stance) > 0.005) {
        patch.stance = +best.toFixed(2);
        changes.push("arm rest angle " + stance.toFixed(2) + " → " + patch.stance.toFixed(2));
      }
    }
    return {
      form: Object.keys(patch).length ? changeHuman(form, patch) : form,
      changes,
    };
  }
  function restart() {
    feature?.reset();
    steps = [];
    log = [];
    stats = {};
    if (reference) {
      const settings = options(),
        stature = original.human.height ?? 1.72;
      let placed, pose;
      if (headOnly()) {
        prepared = { form: original, changes: [] };
        placed = placeHeadScan(reference.raw, settings, evaluateHuman(original.human,original.humanFit,original.humanDetail), registration);
      } else {
        const first = alignReference(reference.raw, settings, { stature });
        pose = poseReadings(first.positions);
        prepared = prealign(original, pose);
        placed = alignReference(reference.raw, settings, {
          stature, column: bodyColumn(skin(prepared.form)),
        });
      }
      const cut = headOnly() ? masker?.place(reference.raw, placed.positions) : (masker?.clear(), null),
        skinIndices = cut?.shown ?? reference.raw.indices;
      refMesh.geometry.dispose();
      refMesh.geometry = referenceGeometry(placed.positions, skinIndices);
      aligned = {
        geometry: refMesh.geometry,
        distance: surfaceIndex(placed.positions, skinIndices),
        under: cut ? underMask(surfaceIndex(placed.positions, cut.hidden)) : null,
        report: placed.report,
        pose,
      };
    } else {
      prepared = { form: original, changes: [] };
      aligned = null;
      masker?.clear();
    }
    working = prepared.form;
    show();
  }

  function actor(form) {
    const flat = neutral(form),
      group = createCharacter(flat, false, true),
      bones = new Map(flat.parts.map((p) => [p.id, p.humanBone])),
      skins = [];
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.material = materials.human;
      o.castShadow = false;
      if (!o.humanWeights) return;
      let owner = o;
      while (owner && !owner.userData.partId) owner = owner.parent;
      const bone = bones.get(owner?.userData.partId) ?? "";
      skins.push([o, regionOf(bone), bone]);
    });
    scene.add(group);
    return { group, skins };
  }
  function release(name) {
    const old = actors[name];
    if (!old) return;
    old.group.removeFromParent();
    old.group.traverse((o) => o.isMesh && o.geometry.dispose());
    delete actors[name];
  }
  function measure({ skins }) {
    const v = new T.Vector3(),
      lists = Object.fromEntries(Object.keys(regions).map((k) => [k, []]));
    let under = 0,
      measured = 0;
    for (const [mesh, region, bone] of skins) {
      if (headOnly() && bone !== "head") continue;
      const p = mesh.geometry.attributes.position,
        colour = new Float32Array(p.count * 3),
        areas = aligned.under ? vertexAreas(p.array, mesh.geometry.index?.array) : null;
      for (let i = 0; i < p.count; i++) {
        const d = aligned.distance(v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld));
        if (aligned.under?.(v, d)) {
          under += areas[i];
          unmeasured.toArray(colour, i * 3);
          continue;
        }
        if (areas) measured += areas[i];
        lists.whole.push(d);
        lists[region].push(d);
        shade
          .lerpColors(even, d < 0 ? cold : warm, Math.min(1, Math.abs(d) / 0.02))
          .toArray(colour, i * 3);
      }
      mesh.geometry.setAttribute("color", new T.BufferAttribute(colour, 3));
    }
    const result = Object.fromEntries(Object.entries(lists).filter(([k,list]) => list.length && (!headOnly() || k === "head")).map(([k, list]) => [k, summarise(list)]));
    result.underMask = under / Math.max(1e-12, under + measured);
    return result;
  }
  function show() {
    release("now");
    actors.now = actor(working);
    actors.original ??= actor(original);
    if (aligned) {
      stats.now = measure(actors.now);
      stats.original ??= measure(actors.original);
    }
    refresh();
  }

  function facts() {
    const rows = [],
      height = (form) => (form.human.height ?? 1.72).toFixed(3) + " m";
    if (reference) {
      const r = aligned.report,
        unit = unitChoices[r.unit]?.[0];
      rows.push([
        "Model",
        reference.name + " · " + reference.triangles.toLocaleString("en") + " triangles" +
          (reference.raw.meshes > 1 ? " in " + reference.raw.meshes + " meshes" : ""),
      ]);
      if (r.headOnly) {
        rows.push(["Scan", r.stature.toFixed(3) + " m tall after placement"]);
      } else {
      rows.push([
        "Scale",
        (r.unit === "m"
          ? "In metres as supplied"
          : unit
            ? r.sourceHeight.toFixed(1) + " " + unit + " tall, converted to metres"
            : "Unknown units, scaled ×" + r.factor.toPrecision(3) + " to the template") +
          (r.unitAuto && unit ? " (detected)" : "") + " · " + r.stature.toFixed(3) + " m tall",
      ]);
      rows.push([
        "Facing",
        r.up + " up" + (r.upAuto && r.up === "Z" ? " (detected)" : "") + " · " +
          (r.turn ? "turned " + r.turn + "° to face front" : "already facing front") +
          (r.turnReason === "feet" ? " (read from the feet)" : ""),
      ]);
      }
    }
    const hidden = headOnly() && masker?.summary();
    if (hidden)
      rows.push([
        "Hidden",
        maskText(hidden) + " · " + ((stats.now?.underMask ?? 0) * 100).toFixed(0) +
          "% of the head's skin area lies under hidden parts and is left out of the fit and the distances (grey in the deviation map)",
      ]);
    const fitted = working.humanFit?.controls?.length;
    rows.push([
      "Template",
      "Adult human · " + height(working) +
        (prepared.changes.length ? " · prealigned: " + prepared.changes.join(", ") : "") +
        (fitted ? " · " + fitted + " surface corrections" : "") +
        (working.humanDetail ? " · fine head layer on " + working.humanDetail.vertices.length + " vertices" : ""),
    ]);
    if (reference && !headOnly()) {
      const mine = poseReadings(skin(working)),
        ref = aligned.pose,
        deg = (x) => (x === null ? "unreadable" : x.toFixed(0) + "°"),
        cm = (x) => (x === null ? "unreadable" : (x * 100).toFixed(0) + " cm");
      rows.push([
        "Pose",
        "Arms below level: reference " + deg(ref.armsBelowHorizontal) + ", template " + deg(mine.armsBelowHorizontal) +
          " · feet apart: reference " + cm(ref.footSpacing) + ", template " + cm(mine.footSpacing),
      ]);
      return { rows, mine, ref };
    }
    return { rows };
  }
  function warnings(mine, ref) {
    if (headOnly()) return [];
    const list = [...aligned.report.notes],
      [lo, hi] = humanRange("height");
    if (ref.stature < lo - 0.005 || ref.stature > hi + 0.005)
      list.push(
        "The reference is " + ref.stature.toFixed(2) + " m tall. The template covers " + lo + " to " + hi +
          " m, so heights will not meet.",
      );
    else if (Math.abs(ref.stature - (working.human.height ?? 1.72)) > 0.02)
      list.push(
        "Stature differs by " + (Math.abs(ref.stature - (working.human.height ?? 1.72)) * 100).toFixed(0) +
          " cm. Match it under Alignment or fit measurements first.",
      );
    if (ref.armsBelowHorizontal === null)
      list.push("The arm angle could not be read. Check that the arms are clear of the body.");
    else if (mine.armsBelowHorizontal !== null) {
      const gap = ref.armsBelowHorizontal - mine.armsBelowHorizontal;
      if (Math.abs(gap) > 6)
        list.push(
          "The reference arms rest " + Math.abs(gap).toFixed(0) + "° " + (gap < 0 ? "higher" : "lower") +
            " than the template. Fit measurements first, or fit head, trunk and legs only.",
        );
      if (ref.armDifference > 10)
        list.push("The reference's left and right arms are posed differently. Expect a loose arm fit.");
    }
    if (ref.footSpacing !== null && mine.footSpacing !== null && Math.abs(ref.footSpacing - mine.footSpacing) > 0.06)
      list.push(
        "The feet are " + (Math.abs(ref.footSpacing - mine.footSpacing) * 100).toFixed(0) + " cm " +
          (ref.footSpacing > mine.footSpacing ? "wider" : "narrower") +
          " apart than the template's. Fit measurements first to move the legs.",
      );
    if (reference.triangles < 3000)
      list.push("This is a coarse reference. Distances follow its flat facets.");
    return list;
  }
  function stepText(entry) {
    if (entry.feature) return featureText(entry.feature);
    if (entry.proportions) return proportionText(entry.proportions, humanControlNames);
    if (entry.family !== undefined) return entry.family ? familyText(entry.family) : "Fine head layer removed";
    const change = (m) => mm(m.before.meanMm) + " → " + mm(m.after.meanMm) + " mm";
    return (
      regions[entry.region] +
      (entry.measure ? " · measurements " + change(entry.measure) : "") +
      (entry.surface
        ? " · surface " + change(entry.surface) + " mean, " + mm(entry.surface.after.p95Mm) + " mm at 95%, " +
          entry.surface.fittedAnchors + " of " + entry.surface.eligibleAnchors + " anchors" +
          (entry.surface.heldAnchors ? ", " + entry.surface.heldAnchors + (entry.headKept ? " held on the kept head or under hidden parts" : " held under hidden parts") : "")
        : "") +
      (entry.surface?.refinedFacialContours ? " · facial contours refined" : "") +
      (entry.eyesKept ? " · eye openings kept" : "") +
      (entry.headKept ? " · " + headKeptText(entry.headKept) : "") +
      (entry.surface?.observedSurfaceOnly ? " · one-sided reference, surface error on the observed side" : "") +
      (entry.surface?.headDistortion
        ? " · head triangles turned ≥90° from the measured base shape: " + entry.surface.headDistortion.pastPerpendicular + " of " + entry.surface.headDistortion.triangles
        : "") +
      (entry.problem ? " · " + entry.problem : "")
    );
  }
  function refresh() {
    const has = Boolean(aligned),
      before = $("hfit-original").checked;
    for (const button of $("hfit-views").children)
      button.setAttribute("aria-pressed", button.dataset.view === view);
    $("hfit-opacity-field").hidden = view !== "overlay" || !has;
    $("hfit-wipe-field").hidden = $("hfit-wipe-line").hidden = view !== "wipe" || !has;
    $("hfit-legend").hidden = view !== "deviation" || !has;
    $("hfit-empty").hidden = has;
    $("hfit-head-tools").hidden = !headOnly() || !has;
    $("hfit-landmarks").textContent = picks ? "Cancel landmark placement" : "Match three landmarks";
    $("hfit-landmark-instruction").textContent = headHint();
    if (picks) view = "side";
    const state = before
        ? "original"
        : log.length
          ? "fitted"
          : prepared.changes.length
            ? "prealigned"
            : "unchanged",
      human = "Editable human · " + state,
      labels = !has
        ? [human]
        : view === "side" || view === "wipe"
          ? ["Reference · " + aligned.report.stature.toFixed(3) + " m", human]
          : view === "overlay"
            ? ["Reference in blue over " + human.toLowerCase()]
            : [human + " · coloured by distance to the reference"];
    $("hfit-labels").replaceChildren(
      ...labels.map((text) => Object.assign(document.createElement("span"), { textContent: text })),
    );
    const { rows, mine, ref } = facts();
    $("hfit-facts").replaceChildren(
      ...rows.flatMap(([term, text]) => [
        Object.assign(document.createElement("dt"), { textContent: term }),
        Object.assign(document.createElement("dd"), { textContent: text }),
      ]),
    );
    $("hfit-warnings").replaceChildren(
      ...(has ? warnings(mine, ref) : []).map((text) =>
        Object.assign(document.createElement("li"), { textContent: text }),
      ),
    );
    $("hfit-steps").replaceChildren(
      ...log.map((entry) => Object.assign(document.createElement("li"), { textContent: stepText(entry) })),
    );
    $("hfit-table").tBodies[0].replaceChildren(
      ...Object.entries(regions).map(([id, label]) => {
        const row = document.createElement("tr"),
          cell = (s) => (s ? mm(s.meanMm) + " / " + mm(s.p95Mm) : "–"),
          now = stats.now?.[id];
        row.append(Object.assign(document.createElement("th"), { scope: "row", textContent: label }));
        for (const text of [
          cell(stats.original?.[id]),
          cell(now),
          now ? (now.biasMm > 0 ? "+" : "") + now.biasMm.toFixed(1) : "–",
        ])
          row.append(Object.assign(document.createElement("td"), { textContent: text }));
        return row;
      }),
    );
    lock(busy);
    render();
  }
  function lock(value) {
    busy = value;
    for (const item of dialog.querySelectorAll("button,select,input"))
      item.disabled = busy && item.id !== "hfit-close";
    if (busy) return;
    $("hfit-view-score").disabled = !aligned;
    $("hfit-run").disabled = !aligned || (headOnly() && (!registration || Boolean(picks)));
    $("hfit-region").disabled = headOnly();
    $("hfit-contour-field").hidden = !["whole","head"].includes($("hfit-region").value);
    $("hfit-eyes-field").hidden = !headOnly();
    $("hfit-match-stature").disabled = $("hfit-match-arms").disabled = headOnly();
    $("hfit-original").disabled = Boolean(picks);
    for (const button of $("hfit-views").children) button.disabled = Boolean(picks);
    for (const id of ["units","up","turn"]) $("hfit-"+id).disabled = Boolean(picks);
    $("hfit-undo").disabled = !steps.length;
    $("hfit-reset").disabled = !steps.length;
    $("hfit-apply").disabled = !log.length;
    feature?.sync();
    masker?.sync();
    proportion?.sync();
    family?.sync();
  }

  async function run() {
    if (!aligned || busy) return;
    const region = $("hfit-region").value,
      entry = { region };
    lock(true);
    note("Fitting " + regions[region].toLowerCase() + "…");
    await nextFrame();
    await nextFrame();
    let next = working;
    const hidden = aligned.under ? (point) => aligned.under(point, aligned.distance(point)) : null;
    const keeper = working.humanDetail && region !== "head" && !headOnly() ? headKeeper(working) : null;
    const hold = keeper ? (point) => Boolean(keeper.hold(point) || hidden?.(point)) : hidden;
    const keepEyeOpenings = headOnly() && $("hfit-eyes").checked;
    if (keepEyeOpenings) entry.eyesKept = true;
    try {
      if ($("hfit-measure").checked && fitting.optimizeHumanMeasurements) {
        const coarse = fitting.optimizeHumanMeasurements(next, aligned.geometry, { region, isolatedHead: headOnly(), hold: hidden, keepEyeOpenings });
        next = coarse.form;
        entry.measure = coarse.metrics;
      }
      try {
        const denseHead = $("hfit-contour").checked && !$("hfit-contour-field").hidden;
        const fine = fitting.fitHumanReference(next, aligned.geometry, { region, isolatedHead: headOnly(), hold, keepEyeOpenings, denseHead });
        next = { ...next, humanFit: fine.fit };
        entry.surface = fine.metrics;
      } catch (error) {
        if (!entry.measure) throw error;
        entry.problem = "surface step skipped: " + error.message;
      }
      if (keeper) {
        const kept = keeper.rebuild(next);
        next = kept.form;
        entry.headKept = kept.metrics;
      }
      steps.push({ form: working, log: [...log] });
      working = next;
      log.push(entry);
      busy = false;
      show();
      const scored = headOnly() ? "head" : "whole";
      const whole = stats.now[scored], start = stats.original[scored];
      note(
        regions[region] + " fitted. " + regions[scored] + " now " + mm(whole.meanMm) + " mm from the reference on average, " +
          mm(start.meanMm) + " mm in your original. Apply to keep it." +
          (entry.problem ? " The " + entry.problem : ""),
      );
    } catch (error) {
      note("No fit was made. " + error.message);
    } finally {
      lock(false);
    }
  }

  function size() {
    if (!dialog?.open) return;
    const w = stage.clientWidth,
      h = stage.clientHeight,
      panes = view === "side" && aligned ? 2 : 1,
      [, high, wide] = frames[$("hfit-frame").value],
      tall = stature(),
      reach = $("hfit-frame").value === "whole" && aligned
        ? Math.max(wide * tall, aligned.geometry.boundingBox.getSize(new T.Vector3()).x * 1.06)
        : wide * tall;
    if (!w || !h) return;
    const extent = Math.max(high * tall, (reach * h * panes) / w);
    camera.top = extent / 2;
    camera.bottom = -camera.top;
    camera.right = (camera.top * w) / panes / h;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  const stature = () =>
    Math.max(aligned?.report.stature ?? 0, working?.human.height ?? 1.72);
  function look(angle) {
    const t = orbit.target;
    camera.position.set(t.x + 6 * Math.sin(angle), t.y, t.z + 6 * Math.cos(angle));
    orbit.update();
    render();
  }
  function frame(angle = orbit.getAzimuthalAngle()) {
    const region = $("hfit-frame").value;
    orbit.target.set(0, frames[region][0] * stature(), 0);
    if (region === "head" && working) {
      const s = evaluateHuman(working.human,working.humanFit,working.humanDetail), head = s.names.indexOf("head");
      let back = Infinity, front = -Infinity;
      for (let i=0; i<s.bodyVertices; i++) {
        if (s.boneIndices[i*4] !== head) continue;
        const z = s.positions[i*3+2];
        back = Math.min(back,z); front = Math.max(front,z);
      }
      orbit.target.z = (back+front)/2;
    }
    camera.zoom = 1;
    size();
    look(angle);
  }
  function render() {
    if (!dialog?.open || !actors.now) return;
    const reading = $("hfit-view-reading");
    if (reading.textContent) { reading.textContent = ""; delete reading.dataset.result; }
    const w = stage.clientWidth,
      h = stage.clientHeight,
      has = Boolean(aligned),
      shown = $("hfit-original").checked ? actors.original : actors.now,
      wipe = view === "wipe" && has,
      panes = (view === "side" || wipe) && has ? ["reference", "human"] : ["both"];
    const boundary = Math.round(w * $("hfit-wipe").valueAsNumber / 100);
    if (wipe) $("hfit-wipe-line").style.left = boundary + "px";
    key.position.set(-2.2, 2.4, 3).applyQuaternion(camera.quaternion).add(orbit.target);
    key.target.position.copy(orbit.target);
    key.target.updateMatrixWorld();
    materials.ghost.opacity = Number($("hfit-opacity").value) / 100;
    materials.ghost.transparent = materials.ghost.opacity < 1;
    materials.ghost.depthWrite = !materials.ghost.transparent;
    refMesh.material = view === "overlay" ? materials.ghost : materials.human;
    for (const [mesh] of shown.skins)
      mesh.material = view === "deviation" && has && mesh.geometry.attributes.color ? materials.heat : materials.human;
    panes.forEach((pane, i) => {
      const left = wipe ? (i === 0 ? 0 : boundary) : Math.round((i * w) / panes.length);
      const right = wipe ? (i === 0 ? boundary : w) : Math.round(((i + 1) * w) / panes.length);
      const width = right - left;
      if (!width) return;
      renderer.setViewport(wipe ? 0 : left, 0, wipe ? w : width, h);
      renderer.setScissor(left, 0, width, h);
      refMesh.visible = has && (pane === "reference" || (pane === "both" && view === "overlay"));
      for (const a of Object.values(actors)) a.group.visible = a === shown && pane !== "reference";
      masker?.pane(pane === "reference");
      renderer.render(scene, camera);
    });
  }

  return function open() {
    const form = getForm();
    if (!form?.human) {
      status("Open an adult human to fit it to a 3D reference.");
      return;
    }
    if (!dialog) build();
    release("original");
    if (original !== form) registration = null;
    const changedForm = original !== form;
    original = form;
    $("hfit-original").checked = false;
    dialog.showModal();
    restart();
    sources();
    frame(0.35);
    note(
      reference
        ? "Compare the views, then fit a region. Your character stays as it is until you apply."
        : "Choose a reference model to compare it with your adult human.",
    );
    if (changedForm || !reference) {
      const linked = [...(form.referenceRigs ?? [])].reverse().find(id => rigs.includes(id));
      const source = referenceSources.find(entry => entry.id === linked);
      if (source && source.id !== reference?.id) {
        $("hfit-kind").value = "body";
        $("hfit-frame").value = $("hfit-region").value = "whole";
        for (const id of ["units", "up", "turn"])
          $("hfit-" + id).selectedIndex = 0;
        for (const axis of ["x", "y", "z"]) $("hfit-nudge-" + axis).value = "0";
        $("hfit-source").value = source.id;
        load(source.label, () => fetchExample(source), source);
      }
    }
  };
}
