import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { skinCharacter } from "./skin.js";
import { applyJointPose, captureJoints, validPoses } from "./poses.js";
const $ = (id) => document.getElementById(id);
export function poseEditor(current, save) {
  const dialog = $("pose-room"),
    stage = $("pose-view"),
    canvas = $("pose-canvas");
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  scene.background = new T.Color("#e4e9e5");
  scene.add(new T.HemisphereLight(0xfff7e8, 0xbac1b5, 1.9));
  const sun = new T.DirectionalLight(0xfff8ee, 2.6);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  let renderer,
    orbit,
    tool,
    rig,
    base,
    start,
    markers,
    selected,
    entries = [],
    history = [],
    dragStart = null;
  const markerMat = new T.PointsMaterial({
    color: 0x387c6f,
    size: 7,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
  });
  const bounds = new T.Box3(),
    center = new T.Vector3(),
    size = new T.Vector3(),
    point = new T.Vector3();
  const axis = new T.Vector3(),
    frameDirection = new T.Vector3(0.28, 0.12, 1).normalize();
  let span = 2;
  function render() {
    if (!rig || !dialog.open || !renderer) return;
    rig.actor.updateMatrixWorld(true);
    const attr = markers.geometry.attributes.position;
    entries.forEach(([, b], i) => {
      b.bone.getWorldPosition(point);
      attr.setXYZ(i, point.x, point.y, point.z);
    });
    attr.needsUpdate = true;
    markers.visible = $("pose-dots").checked;
    renderer.render(scene, camera);
  }
  function sizeView() {
    if (!dialog.open || !renderer) return;
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const ratio = w / h,
      tall =
        Math.max(
          size.y,
          Math.max(size.x, size.z) / Math.max(0.2, ratio),
          0.08,
        ) * 1.34;
    camera.top = tall / 2;
    camera.bottom = -tall / 2;
    camera.right = (tall * ratio) / 2;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    render();
  }
  function choose(value) {
    selected = rig.bindings.get(value);
    if (!selected) return;
    $("pose-joint").value = value;
    if ($("pose-dots").checked) tool.attach(selected.bone);
    else tool.detach();
    render();
  }
  function snapshot() {
    return captureJoints(rig.bindings, start.joints);
  }
  function remember(before) {
    if (JSON.stringify(before) === JSON.stringify(snapshot())) return;
    history.push(before);
    if (history.length > 48) history.shift();
    $("pose-undo").disabled = false;
  }
  function edit(f) {
    const before = snapshot();
    f();
    remember(before);
    render();
  }
  function pick(event) {
    if (!rig || !markers.visible) return;
    const rect = canvas.getBoundingClientRect();
    let closest = null,
      best = 11 ** 2;
    for (const [id, b] of entries) {
      b.bone.getWorldPosition(point).project(camera);
      const x = rect.left + ((point.x + 1) * rect.width) / 2,
        y = rect.top + ((1 - point.y) * rect.height) / 2;
      const distance = (x - event.clientX) ** 2 + (y - event.clientY) ** 2;
      if (distance < best) {
        best = distance;
        closest = id;
      }
    }
    if (closest !== null) choose(closest);
  }
  function init() {
    if (renderer) return;
    renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    orbit = new OrbitControls(camera, canvas);
    orbit.addEventListener("change", render);
    tool = new TransformControls(camera, canvas);
    tool.setSpace("local");
    tool.setSize(0.63);
    scene.add(tool.getHelper());
    tool.addEventListener("change", render);
    tool.addEventListener("dragging-changed", (e) => {
      orbit.enabled = !e.value;
      if (e.value) {
        dragStart = snapshot();
      } else if (dragStart) {
        remember(dragStart);
        dragStart = null;
      }
    });
    let down,
      dragged = false;
    canvas.addEventListener("pointerdown", (e) => {
      down = [e.clientX, e.clientY];
      dragged = Boolean(tool.axis);
    });
    canvas.addEventListener("pointerup", (e) => {
      if (
        down &&
        !dragged &&
        Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4
      )
        pick(e);
      down = null;
    });
    new ResizeObserver(sizeView).observe(stage);
  }
  function note(message) {
    $("pose-note").textContent = message;
  }
  function finish() {
    const old = rig;
    rig = null;
    dragStart = null;
    tool?.detach();
    if (markers) {
      markers.removeFromParent();
      markers.geometry.dispose();
      markers = null;
    }
    if (old) {
      old.actor.removeFromParent();
      old.dispose();
    }
    selected = null;
    history = [];
    entries = [];
    start?.resume?.();
    start = null;
  }
  dialog.addEventListener("close", finish);
  $("pose-open").onclick = () => {
    const source = current();
    if (!source) return;
    try {
      init();
      base = source.form;
      start = source.capture();
      rig = skinCharacter(base, source.figure);
      scene.add(rig.actor);
      bounds.setFromObject(rig.actor);
      if (bounds.isEmpty())
        throw new Error("Select an outfit with a visible character surface.");
      bounds.getCenter(center);
      bounds.getSize(size);
      span = Math.max(0.1, size.x, size.y, size.z);
      applyJointPose(rig.bindings, start.joints);
      entries = [...rig.bindings];
      history = [];
      dragStart = null;
      $("pose-joint").replaceChildren(
        ...entries.map(([value, b]) => {
          const a = b.address;
          const label = a.part
            ? a.part +
              " · " +
              (a.digit ? a.digit + " " + a.station : "joint " + (a.station + 1))
            : "Whole skeleton";
          return new Option(label, value);
        }),
      );
      const g = new T.BufferGeometry();
      g.setAttribute(
        "position",
        new T.Float32BufferAttribute(new Float32Array(entries.length * 3), 3),
      );
      markers = new T.Points(g, markerMat);
      markers.frustumCulled = false;
      markers.renderOrder = 2;
      scene.add(markers);
      let n = 1;
      while (base.poses?.some((p) => p.name === "Pose " + n)) n++;
      $("pose-name").value = start.name || "Pose " + n;
      $("pose-undo").disabled = true;
      note("");
      dialog.showModal();
      camera.zoom = 1;
      camera.position
        .copy(center)
        .addScaledVector(frameDirection, span * 2.8 + 1);
      camera.far = Math.max(200, span * 10);
      orbit.target.copy(center);
      orbit.update();
      tool.setMode($("pose-mode").value);
      choose(
        (entries.find(([, b]) => b.address.part === source.target) ??
          entries.find(([, b]) => b.address.part) ??
          entries[0])[0],
      );
      sizeView();
    } catch (e) {
      if (dialog.open) dialog.close();
      finish();
      source.error(e.message);
    }
  };
  $("pose-cancel").onclick = () => dialog.close();
  $("pose-joint").onchange = (e) => choose(e.target.value);
  $("pose-dots").onchange = () => choose($("pose-joint").value);
  $("pose-mode").onchange = (e) => {
    const rotate = e.target.value === "rotate";
    tool.setMode(e.target.value);
    $("pose-unit").textContent = rotate ? "Step in degrees" : "Step in metres";
    Object.assign($("pose-step"), {
      value: rotate ? "15" : ".025",
      min: rotate ? ".1" : ".001",
      max: rotate ? "180" : "3",
    });
    render();
  };
  $("pose-front").onclick = () => {
    camera.position
      .copy(center)
      .addScaledVector(new T.Vector3(0, 0, 1), span * 2.8 + 1);
    orbit.target.copy(center);
    orbit.update();
    render();
  };
  for (const [id, sign] of [
    ["pose-minus", -1],
    ["pose-plus", 1],
  ]) {
    $(id).onclick = () => {
      const step = $("pose-step");
      if (!selected || !step.checkValidity() || !Number(step.value)) return;
      axis.set(0, 0, 0);
      axis[$("pose-axis").value.toLowerCase()] = 1;
      const amount = sign * Number(step.value);
      edit(() => {
        if (tool.getMode() === "rotate")
          selected.bone.rotateOnAxis(axis, T.MathUtils.degToRad(amount));
        else selected.bone.translateOnAxis(axis, amount);
      });
    };
  }
  $("pose-reset").onclick = () =>
    edit(() => {
      selected.bone.position.copy(selected.position);
      selected.bone.quaternion.copy(selected.rotation);
    });
  $("pose-undo").onclick = () => {
    const before = history.pop();
    if (before) applyJointPose(rig.bindings, before);
    $("pose-undo").disabled = !history.length;
    render();
  };
  $("pose-save").onclick = () => {
    const name = $("pose-name").value.trim(),
      poses = [...(base.poses ?? [])],
      i = poses.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (i !== -1 && poses[i].name !== start.name) {
      note(
        "A pose already has that name. Choose a new name or open the existing pose.",
      );
      return;
    }
    const pose = { name, joints: snapshot() };
    if (i < 0) poses.push(pose);
    else poses[i] = pose;
    if (!validPoses(poses)) {
      note("Use a pose name of 1–60 characters and up to 32 poses per form.");
      return;
    }
    try {
      save({ ...base, poses }, name);
      start.resume = null;
      dialog.close();
    } catch (e) {
      note(e.message);
    }
  };
}
