import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Triangle,
  Vector2,
  Vector3,
} from "three";
import {
  fitProportions,
  measureProportions,
  proportionControls,
  proportionEnds,
  proportionFitted,
  proportionNamed,
  proportionReading,
  proportions,
  proportionText,
  suggestControls,
} from "./human-proportions.js";

const style = `
#hfit-prop-panel { margin-top: 6px; }
#hfit-prop-list { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 0.76rem; font-variant-numeric: tabular-nums; }
#hfit-prop-list th, #hfit-prop-list td { padding: 2px 4px; text-align: right; border-bottom: 1px solid #d9ddd2; font-weight: 450; }
#hfit-prop-list th:first-child { text-align: left; }
#hfit-prop-list thead th { font-weight: 650; color: #40584e; }
#hfit-prop-list tr[aria-current="true"] th { font-weight: 650; }
#hfit-prop-list button { min-height: 0; padding: 0 6px; font: inherit; line-height: 1.3; }
#hfit-prop-controls { display: flex; flex-wrap: wrap; gap: 3px 12px; margin: 4px 0 6px; font-size: 0.76rem; }
#hfit-prop-controls label { display: inline-flex; gap: 4px; align-items: center; }
`;
const markup = `
<div class="actions"><button id="hfit-prop" aria-pressed="false">Match proportions</button></div>
<div id="hfit-prop-panel" hidden>
  <label class="field">Proportion to mark
    <select id="hfit-prop-pick"></select>
  </label>
  <p class="micro" id="hfit-prop-hint" aria-live="polite"></p>
  <table id="hfit-prop-list" hidden>
    <thead><tr><th>Marked</th><th>Reference</th><th>Yours</th><th>Apart</th><th></th></tr></thead>
    <tbody></tbody>
  </table>
  <div id="hfit-prop-choice" hidden>
    <p class="micro">Controls to move. Untick one to keep it as it is.</p>
    <div id="hfit-prop-controls"></div>
    <p class="micro" id="hfit-prop-kept"></p>
    <div class="actions"><button id="hfit-prop-fit" class="solid">Fit controls to the marks</button></div>
  </div>
</div>
<p class="micro" id="hfit-prop-reading" aria-live="polite"></p>
`;
const mm = (x) => x.toFixed(1),
  signed = (x) => (x < 0 ? "−" : "+") + Math.abs(x).toFixed(1);

export function proportionMatcher({
  slot,
  names = {},
  canvas,
  camera,
  ready,
  raw,
  placement,
  reference,
  figure,
  form,
  hold,
  accept,
  sideBySide,
  note,
  render,
  starting = () => {},
}) {
  if (!document.getElementById("hfit-prop-style"))
    document.head.append(Object.assign(document.createElement("style"), { id: "hfit-prop-style", textContent: style }));
  slot.innerHTML = markup;
  const $ = (id) => document.getElementById(id),
    named = (key) => names[key] ?? key,
    ray = new Raycaster(),
    ball = new SphereGeometry(1, 14, 10),
    paint = (color) => new MeshBasicMaterial({ color, depthTest: false }),
    strong = paint(0x1f5fbf),
    faint = paint(0x7d9cc4),
    thread = new LineBasicMaterial({ color: 0x1f5fbf, depthTest: false }),
    onReference = new Group(),
    onHead = new Group();
  for (const item of proportions) $("hfit-prop-pick").append(new Option(item.name, item.id));
  let on = false,
    pointing = false,
    chosen = proportions[0].id,
    pending = null,
    source = null,
    last = "",
    down = null;
  const marks = new Map(),
    off = new Set(),
    extra = new Set(),
    readings = new WeakMap();
  const paired = () =>
    $("hfit-views").querySelector('[aria-pressed="true"]')?.dataset.view === "side" &&
    !$("hfit-original").checked;
  const keepEyes = () => !$("hfit-eyes-field").hidden && $("hfit-eyes").checked;
  const headSkin = () => figure()?.skins.find(([mesh, region]) => region === "head" && mesh.humanSkin)?.[0];
  function markAt(hit) {
    const mesh = hit.object,
      position = mesh.geometry.attributes.position,
      corners = [hit.face.a, hit.face.b, hit.face.c],
      [a, b, c] = corners.map((v) => new Vector3().fromBufferAttribute(position, v)),
      shares = Triangle.getBarycoord(mesh.worldToLocal(hit.point.clone()), a, b, c, new Vector3());
    return { corners, shares: shares ? shares.toArray() : [1, 0, 0] };
  }
  function localOf(mark) {
    const position = reference().geometry.attributes.position,
      point = new Vector3(),
      corner = new Vector3();
    if (!position || mark.corners.some((v) => v >= position.count)) return null;
    mark.corners.forEach((v, k) => point.addScaledVector(corner.fromBufferAttribute(position, v), mark.shares[k]));
    return point;
  }
  function restOf(mark) {
    const local = localOf(mark);
    if (!local) return null;
    const world = reference().localToWorld(local),
      skin = headSkin();
    return skin ? skin.worldToLocal(world).toArray().map((x, d) => x + skin.humanSkin.origin[d]) : world.toArray();
  }
  function referenceReading(id) {
    const pair = marks.get(id)?.map(restOf);
    return pair?.every(Boolean) ? proportionReading(id, pair[0], pair[1]) : null;
  }
  function mine() {
    const recipe = form();
    if (!readings.has(recipe)) readings.set(recipe, measureProportions(recipe));
    return readings.get(recipe);
  }
  const marked = () => proportions.map((p) => p.id).filter((id) => referenceReading(id) !== null);
  let planned = null;
  function plan() {
    const recipe = form(),
      ids = marked(),
      fitted = ids.filter(proportionFitted),
      eyes = keepEyes(),
      placed = placement(),
      key = ids.join();
    if (planned && planned.recipe === recipe && planned.key === key && planned.eyes === eyes && planned.placed === placed)
      return planned;
    const options = { hold: hold(), keepEyeOpenings: eyes },
      suggested = fitted.length ? suggestControls(recipe, fitted, options) : Object.assign([], { able: [] }),
      kept = fitted.length
        ? proportionControls(recipe, options).filter(
            (c) => !c.free && fitted.some((id) => Math.max(Math.abs(c.rates[id]), Math.abs(c.ratesDown[id])) >= 0.5),
          )
        : [];
    return (planned = { recipe, key, eyes, placed, ids, fitted, options, suggested, able: suggested.able, kept });
  }
  const ticked = (now) => now.able.filter((key) => (now.suggested.includes(key) ? !off.has(key) : extra.has(key)));

  function dot(parent, point, material, radius) {
    const mesh = new Mesh(ball, material);
    mesh.position.copy(point);
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 21;
    parent.add(mesh);
  }
  function link(parent, a, b) {
    const line = new Line(
      new BufferGeometry().setAttribute("position", new Float32BufferAttribute([...a.toArray(), ...b.toArray()], 3)),
      thread,
    );
    line.renderOrder = 20;
    parent.add(line);
  }
  function clear(group) {
    for (const child of [...group.children]) {
      if (child.isLine) child.geometry.dispose();
      group.remove(child);
    }
  }
  function draw() {
    clear(onReference);
    clear(onHead);
    onReference.removeFromParent();
    onHead.removeFromParent();
    if (!on) return;
    reference().add(onReference);
    for (const [id, pair] of marks) {
      const points = pair.map(localOf);
      if (!points.every(Boolean)) continue;
      for (const point of points) dot(onReference, point, id === chosen ? strong : faint, id === chosen ? 0.0012 : 0.0009);
      if (id === chosen) link(onReference, ...points);
    }
    const first = pending && localOf(pending);
    if (first) dot(onReference, first, strong, 0.0012);
    const skin = headSkin();
    if (!skin) return;
    skin.add(onHead);
    const origin = skin.humanSkin.origin,
      ends = proportionEnds(form(), chosen).map((p) => new Vector3(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]));
    for (const point of ends) dot(onHead, point, strong, 0.0012);
    link(onHead, ...ends);
  }

  function sync() {
    const ok = ready();
    if (on && !(ok && paired())) stop();
    if (source !== raw()) {
      source = raw();
      marks.clear();
      pending = null;
      last = "";
    }
    const button = $("hfit-prop");
    button.disabled = !ok;
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Stop matching proportions" : "Match proportions";
    $("hfit-prop-panel").hidden = !on;
    if (on) canvas.style.cursor = "crosshair";
    else if (pointing) canvas.style.cursor = "";
    pointing = on;
    $("hfit-prop-reading").textContent = last;
    draw();
    if (!on) return;
    const now = plan(),
      own = mine(),
      item = proportionNamed(chosen);
    for (const option of $("hfit-prop-pick").options)
      option.textContent = proportionNamed(option.value).name + (now.ids.includes(option.value) ? " ✓" : "");
    $("hfit-prop-pick").value = chosen;
    $("hfit-prop-hint").textContent = pending
      ? "One end is marked. Click the other end on the reference."
      : (now.ids.includes(chosen) ? "Marked. Click two points to mark it again. " : "") +
        "Click its two ends on the reference in the left pane, in either order: " +
        item.ends[0] + ", and " + item.ends[1] +
        ". The dots on your own head on the right show where the same proportion is read. " +
        "Readings are taken as the face is seen from the front." +
        (proportionFitted(chosen) ? "" : " This one is a reading: it is listed and followed through every fit, and set by hand.");
    $("hfit-prop-list").hidden = !now.ids.length;
    $("hfit-prop-list").tBodies[0].replaceChildren(
      ...now.ids.map((id) => {
        const row = document.createElement("tr"),
          wanted = referenceReading(id),
          cell = (tag, text) => Object.assign(document.createElement(tag), { textContent: text }),
          remove = Object.assign(document.createElement("button"), { textContent: "×", title: "Remove this mark" });
        remove.setAttribute("aria-label", "Remove the mark for " + proportionNamed(id).name);
        remove.onclick = () => {
          marks.delete(id);
          sync();
          render();
        };
        if (id === chosen) row.setAttribute("aria-current", "true");
        const end = document.createElement("td");
        end.append(remove);
        row.append(
          cell("th", proportionNamed(id).name + (proportionFitted(id) ? "" : " (reading)")),
          cell("td", mm(wanted)),
          cell("td", mm(own[id])),
          cell("td", signed(own[id] - wanted)),
          end,
        );
        return row;
      }),
    );
    $("hfit-prop-choice").hidden = !now.fitted.length;
    $("hfit-prop-controls").replaceChildren(
      ...now.able.map((key) => {
        const label = document.createElement("label"),
          box = Object.assign(document.createElement("input"), { type: "checkbox", checked: ticked(now).includes(key) });
        box.onchange = () => {
          const set = now.suggested.includes(key) ? off : extra;
          if (box.checked === now.suggested.includes(key)) set.delete(key);
          else set.add(key);
          sync();
        };
        label.append(box, named(key));
        return label;
      }),
    );
    $("hfit-prop-kept").textContent = now.kept.length
      ? "Left as " + (now.kept.length > 1 ? "they are" : "it is") + ": " +
        now.kept.map((c) => named(c.key) + " (" + c.why + ")").join(", ") + "."
      : !now.able.length
        ? "No free control changes these proportions."
        : now.suggested.length
          ? ""
          : "No control made for these features can change them here. The ones listed reshape more of the head; tick one to use it.";
    $("hfit-prop-fit").disabled = !ticked(now).length;
  }
  function stop() {
    on = false;
    pending = null;
  }
  function cancel() {
    if (!on) return;
    stop();
    sync();
    render();
  }
  $("hfit-prop").onclick = () => {
    if (on) stop();
    else if (ready()) {
      starting();
      on = true;
      sideBySide();
    }
    sync();
    render();
  };
  $("hfit-prop-pick").onchange = () => {
    chosen = $("hfit-prop-pick").value;
    pending = null;
    sync();
    render();
  };
  $("hfit-prop-fit").onclick = () => {
    const now = plan(),
      targets = Object.fromEntries(now.fitted.map((id) => [id, referenceReading(id)]));
    let result;
    try {
      result = fitProportions(form(), targets, { ...now.options, controls: ticked(now) });
    } catch (error) {
      return note("The proportions could not be fitted. " + error.message);
    }
    if (!result.changed) {
      last = "";
      sync();
      return note("The chosen controls cannot bring these proportions closer than they are.");
    }
    const step = {
      proportions: result.proportions,
      controls: result.controls,
      others: result.others.filter((o) => Math.abs(o.afterMm - o.beforeMm) >= 0.3),
      skinMovedMm: result.skinMovedMm,
    };
    last = proportionText(step, names) + ".";
    $("hfit-prop-reading").dataset.result = JSON.stringify(step);
    accept(result.form, { region: "head", proportions: step });
    note("Proportions fitted. Undo step takes it back; Apply keeps it.");
  };
  $("hfit-undo").addEventListener("click", () => {
    last = "";
    delete $("hfit-prop-reading").dataset.result;
    sync();
    render();
  });
  $("hfit-room").addEventListener("close", cancel);
  $("hfit-eyes").addEventListener("change", () => {
    if (on) sync();
  });

  canvas.addEventListener("pointerdown", (e) => {
    down = on && e.button === 0 ? [e.clientX, e.clientY] : null;
  });
  canvas.addEventListener("pointerup", (e) => {
    const start = down;
    down = null;
    if (!on || !start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
    if (!ready() || !paired()) return cancel();
    const box = canvas.getBoundingClientRect(),
      half = box.width / 2,
      x = e.clientX - box.left,
      y = e.clientY - box.top;
    if (x >= half)
      return note("Mark the reference in the left pane. The dots on your own head show where this proportion is read.");
    ray.setFromCamera(new Vector2((2 * x) / half - 1, 1 - (2 * y) / box.height), camera);
    const hit = ray.intersectObject(reference(), false)[0];
    if (!hit?.face) return note("That click missed the reference. Click directly on its surface.");
    const mark = markAt(hit);
    if (!pending) {
      pending = mark;
      sync();
      render();
      return note("One end marked. Click the other end.");
    }
    const pair = [pending, mark],
      [a, b] = pair.map(restOf);
    pending = null;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.001) {
      sync();
      render();
      return note("Those two marks are in the same place. Mark the two ends of the proportion.");
    }
    marks.set(chosen, pair);
    sync();
    render();
    const wanted = referenceReading(chosen),
      own = mine()[chosen];
    note(
      proportionNamed(chosen).name + ": " + mm(wanted) + " mm on the reference, " + mm(own) + " mm on your head. " +
        (proportionFitted(chosen) ? "Mark another proportion or fit the controls." : "It is listed as a reading."),
    );
  });

  return { sync, cancel, active: () => on };
}
