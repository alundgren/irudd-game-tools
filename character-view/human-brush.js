import {
  BufferAttribute,
  BufferGeometry,
  Matrix3,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import {
  applyHumanControls,
  applyHumanDetail,
  controlVectors,
  evaluateHuman,
  humanControls,
  smoothHumanSurface,
} from "./human-surface.js";

const longest = 0.0649,
  strokeLimit = 0.05,
  steepest = 0.22,
  detour = 1.2,
  rest = 5;

let graph, neutral;
function cageGraph(surface) {
  if (graph) return graph;
  const n = surface.bodyVertices,
    sets = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = surface.indices[i + k],
        b = surface.indices[i + ((k + 1) % 3)];
      if (a >= n || b >= n) continue;
      sets[a].add(b);
      sets[b].add(a);
    }
  const start = new Uint32Array(n + 1);
  sets.forEach((set, i) => (start[i + 1] = start[i] + set.size));
  const next = new Uint16Array(start[n]);
  sets.forEach((set, i) => next.set([...set], start[i]));
  return (graph = { start, next });
}
const twins = new Map();
function twinVertex(vertex) {
  if (!twins.has(vertex)) {
    neutral ??= evaluateHuman({});
    const p = neutral.positions,
      x = -p[vertex * 3],
      y = p[vertex * 3 + 1],
      z = p[vertex * 3 + 2];
    let best = vertex,
      gap = Infinity;
    for (let v = 0; v < neutral.bodyVertices; v++) {
      const d = (p[v * 3] - x) ** 2 + (p[v * 3 + 1] - y) ** 2 + (p[v * 3 + 2] - z) ** 2;
      if (d < gap) {
        gap = d;
        best = v;
      }
    }
    twins.set(vertex, best);
  }
  return twins.get(vertex);
}

export function skinDistances(surface, seeds, reach) {
  const { start, next } = cageGraph(surface),
    p = surface.positions,
    best = new Map(),
    heap = [];
  const push = (d, v) => {
    let i = heap.push([d, v]) - 1;
    while (i) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= d) break;
      [heap[i], heap[up]] = [heap[up], heap[i]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let low = i;
        for (const child of [2 * i + 1, 2 * i + 2])
          if (child < heap.length && heap[child][0] < heap[low][0]) low = child;
        if (low === i) break;
        [heap[i], heap[low]] = [heap[low], heap[i]];
        i = low;
      }
    }
    return top;
  };
  for (const { vertex, distance } of seeds)
    if (distance < reach && distance < (best.get(vertex) ?? Infinity)) {
      best.set(vertex, distance);
      push(distance, vertex);
    }
  while (heap.length) {
    const [d, v] = pop();
    if (d > best.get(v)) continue;
    for (let e = start[v]; e < start[v + 1]; e++) {
      const u = next[e],
        step = Math.hypot(
          p[u * 3] - p[v * 3],
          p[u * 3 + 1] - p[v * 3 + 1],
          p[u * 3 + 2] - p[v * 3 + 2],
        ),
        through = d + step;
      if (through < reach && through < (best.get(u) ?? Infinity)) {
        best.set(u, through);
        push(through, u);
      }
    }
  }
  return best;
}

function follow(vertex, weights, controls) {
  let sum = 0,
    total = 0;
  for (let j = vertex * 4; j < vertex * 4 + 4; j++) {
    sum += weights[controls.refs[j]] * controls.weights[j];
    total += controls.weights[j];
  }
  return total ? sum / total : 0;
}
export function brushWeights(surface, seeds, centre, reach, widen = true) {
  const controls = humanControls(),
    p = surface.positions,
    weights = new Float32Array(controls.ids.length);
  let response = 0,
    used = reach;
  for (let tries = 0; ; tries++, used *= 1.1) {
    const field = skinDistances(surface, seeds, used * detour);
    let mass = 0;
    weights.fill(0);
    controls.ids.forEach((vertex, i) => {
      const along = field.get(vertex);
      if (along === undefined) return;
      const d = Math.max(
        Math.hypot(
          p[vertex * 3] - centre[0],
          p[vertex * 3 + 1] - centre[1],
          p[vertex * 3 + 2] - centre[2],
        ),
        along / detour,
      );
      if (d < used) mass += weights[i] = (1 - (d / used) ** 2) ** 2;
    });
    response =
      seeds.reduce((sum, s) => sum + follow(s.vertex, weights, controls), 0) /
      seeds.length;
    if (!widen || tries === 24 || (mass >= rest && response >= 0.65)) break;
  }
  if (response > 0) {
    const gain = 1 / Math.max(response, 0.5);
    for (let i = 0; i < weights.length; i++)
      weights[i] = Math.min(1, weights[i] * gain);
  }
  return { weights, used };
}

export function fitFromVectors(vectors) {
  const controls = [];
  for (let i = 0; i < vectors.length / 3; i++) {
    const row = [0, 1, 2].map((d) => Math.round(vectors[i * 3 + d] * 10000));
    if (row.some(Boolean)) controls.push([i, ...row]);
  }
  return controls.length ? { version: 1, strength: 1, controls } : undefined;
}

export function brushBody(form) {
  if (!form?.human) throw new Error("Open an adult human before sculpting.");
  const bare = evaluateHuman(form.human),
    start = controlVectors(form.humanFit);
  return { bare, start, detail: form.humanDetail, fitted: applyHumanDetail(applyHumanControls(bare, start), form.humanDetail) };
}
export function brushStroke(
  form,
  touch,
  { reach = 0.06, mirror = false } = {},
  body = brushBody(form),
) {
  const { bare, start, fitted } = body,
    scale = bare.height / 1.72,
    p = fitted.positions;
  const seeds = touch.vertices.map((vertex) => ({
    vertex,
    distance: Math.hypot(
      p[vertex * 3] - touch.point[0],
      p[vertex * 3 + 1] - touch.point[1],
      p[vertex * 3 + 2] - touch.point[2],
    ),
  }));
  const { weights: primary, used } = brushWeights(fitted, seeds, touch.point, reach);
  let twin = null;
  if (mirror) {
    const other = seeds.map((s) => ({ ...s, vertex: twinVertex(s.vertex) })),
      middle = (list, d) =>
        list.reduce((sum, s) => sum + p[s.vertex * 3 + d], 0) / list.length,
      centre = [0, 1, 2].map(
        (d) =>
          middle(other, d) + (d ? 1 : -1) * (touch.point[d] - middle(seeds, d)),
      );
    twin = brushWeights(fitted, other, centre, used, false).weights;
  }
  const limit = Math.min(strokeLimit, (steepest * used) / scale);
  return {
    bare,
    start,
    detail: body.detail,
    fitted,
    primary,
    twin,
    used,
    limit: limit * scale,
    vectors(offset, mode = "move") {
      const out = start.slice(),
        v = new Vector3();
      const move =
        mode === "soften"
          ? null
          : new Vector3(...offset).divideScalar(scale).clampLength(0, limit);
      for (let i = 0; i < primary.length; i++) {
        const a = primary[i],
          b = twin ? twin[i] : 0,
          share = Math.max(a, b);
        if (!share) continue;
        v.fromArray(out, i * 3);
        if (move) {
          const side = twin ? (a - b) / (a + b) : 1;
          v.x += share * side * move.x;
          v.y += share * move.y;
          v.z += share * move.z;
          v.clampLength(0, longest);
        } else v.multiplyScalar(1 - Math.min(1, share) * Math.min(1, Math.max(0, offset)));
        v.toArray(out, i * 3);
      }
      return out;
    },
    changes(vectors) {
      return vectors.some((x, i) => Math.round(x * 10000) !== Math.round(start[i] * 10000));
    },
    form(vectors) {
      const next = { ...form },
        fit = fitFromVectors(vectors);
      if (fit) next.humanFit = fit;
      else delete next.humanFit;
      return next;
    },
  };
}

const markup = `
<div class="actions"><button id="human-brush" aria-pressed="false">Sculpt skin</button></div>
<div id="human-brush-settings" hidden>
  <label class="field">Drag<select id="human-brush-mode">
    <option value="move">Move with the pointer</option>
    <option value="normal">Raise or sink</option>
    <option value="soften">Soften corrections</option>
  </select></label>
  <label class="field">Reach <output id="human-brush-reading"></output><input id="human-brush-size" type="range" min="2" max="16" step="1" value="6"></label>
  <label class="check"><input type="checkbox" id="human-brush-mirror" checked>Mirror left and right</label>
  <p class="micro" id="human-brush-help"></p>
  <div class="actions"><button id="human-brush-clear">Remove surface corrections</button></div>
</div>`;
const help = {
  move: "Drag a spot on bare skin and it follows the pointer in the plane of the view, by up to a fifth of the brush size. Orbit to push in another direction.",
  normal: "Drag up on bare skin to raise it, or down to sink it.",
  soften: "Drag across bare skin to ease earlier corrections back toward the measured shape.",
};
const others = ["pull-tool", "branch-tool", "place-branch", "direct"];

export function humanBrush(
  canvas,
  camera,
  orbit,
  { idle, figure, form, release, commit, status, render },
) {
  const $ = (id) => document.getElementById(id),
    ray = new Raycaster(),
    pointer = new Vector2(),
    plane = new Plane(),
    hit = new Vector3();
  $("human-fit-open").insertAdjacentHTML("afterend", markup);
  const ring = document.createElement("div");
  ring.hidden = true;
  ring.style.cssText =
    "position:absolute;border:1.5px solid #214a3fcc;box-shadow:0 0 0 1px #f4f4eca8;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%)";
  canvas.parentElement.append(ring);
  let on = false,
    stroke = null,
    switching = false,
    pending = null,
    queued = 0;
  const reach = () => Number($("human-brush-size").value) / 100;
  const active = () =>
    on && idle() && Boolean(form()?.human) && !$("human-controls").hidden;
  function sync() {
    $("human-brush").setAttribute("aria-pressed", String(on));
    $("human-brush").style.cssText = on
      ? "background:#2c5144;color:#fff;border-color:#2c5144"
      : "";
    $("human-brush-settings").hidden = !on;
    $("human-brush-reading").textContent = $("human-brush-size").value + " cm";
    $("human-brush-help").textContent =
      help[$("human-brush-mode").value] +
      " The ring grows where the body has few control points. Clothing, hair and attached parts are left alone and follow the body. Each drag is one undo step.";
    canvas.style.cursor = on ? "crosshair" : "";
    if (!on) ring.hidden = true;
  }
  function set(value) {
    if (on === value) return;
    on = value;
    if (on) {
      switching = true;
      for (const id of others)
        if ($(id)?.getAttribute("aria-pressed") === "true") $(id).click();
      switching = false;
      release();
    }
    sync();
    render();
  }
  $("human-brush").onclick = () => set(!on);
  for (const id of others)
    $(id)?.addEventListener("click", () => switching || set(false));
  for (const tab of document.querySelectorAll("[data-tab]"))
    tab.addEventListener("click", () => tab.dataset.tab === "sculpt" || set(false));
  $("human-brush-size").oninput = sync;
  $("human-brush-mode").onchange = sync;
  $("human-brush-clear").onclick = () => {
    const current = form();
    if (!current?.humanFit) return status("This body has no surface corrections.");
    const next = { ...current };
    delete next.humanFit;
    commit(next, "Surface corrections removed. Measurements are unchanged.");
  };
  sync();

  function aim(e) {
    const b = canvas.getBoundingClientRect();
    pointer.set(
      (2 * (e.clientX - b.left)) / b.width - 1,
      1 - (2 * (e.clientY - b.top)) / b.height,
    );
    ray.setFromCamera(pointer, camera);
    return b;
  }
  const native = (mesh, parts) => {
    if (!mesh.humanSkin) return null;
    let owner = mesh;
    while (owner && !owner.userData.partId) owner = owner.parent;
    const part = parts.get(owner?.userData.partId);
    return part?.shape === "human region" && !part.humanSource ? part : null;
  };
  function pick(e) {
    const root = figure(),
      current = form();
    if (!root || !current?.human) return null;
    aim(e);
    const parts = new Map(current.parts.map((p) => [p.id, p]));
    for (const found of ray.intersectObject(root, true)) {
      if (!found.object.isMesh || !found.face) continue;
      let visible = true;
      for (let o = found.object; o && o !== root; o = o.parent)
        if (!o.visible) visible = false;
      if (!visible) continue;
      const part = native(found.object, parts);
      return part && { ...found, part, parts, form: current };
    }
    return null;
  }
  const unit = () => (camera.top - camera.bottom) / camera.zoom / canvas.clientHeight;
  function mark(point, radius) {
    const b = canvas.getBoundingClientRect(),
      s = point.clone().project(camera),
      size = (2 * radius) / unit();
    ring.style.left = ((s.x + 1) / 2) * b.width + "px";
    ring.style.top = ((1 - s.y) / 2) * b.height + "px";
    ring.style.width = ring.style.height = size + "px";
    ring.hidden = false;
  }
  const halt = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0 || stroke || !active()) return;
      const found = pick(e);
      if (!found) return;
      halt(e);
      const mesh = found.object,
        tag = mesh.humanSkin,
        root = figure();
      root.updateWorldMatrix(true, true);
      const local = mesh.worldToLocal(found.point.clone()),
        radius = reach(),
        mirror = $("human-brush-mirror").checked;
      const body = brushBody(found.form),
        smooth = smoothHumanSurface(body.fitted),
        quad = smooth.parentFaces[tag.faces[found.faceIndex * 3] / 3];
      const touch = {
        vertices: Array.from(smooth.quadIds.subarray(quad * 4, quad * 4 + 4)),
        point: local.toArray().map((x, d) => x + tag.origin[d]),
      };
      const targets = [];
      root.traverse((o) => {
        if (!o.isMesh || !native(o, found.parts)) return;
        const g = o.geometry;
        targets.push({
          mesh: o,
          position: g.attributes.position.array.slice(),
          normal: g.attributes.normal.array.slice(),
        });
      });
      const whole = new BufferGeometry();
      whole.setAttribute("position", new BufferAttribute(smooth.positions.slice(), 3));
      whole.setIndex(new BufferAttribute(smooth.indices, 1));
      const work = brushStroke(found.form, touch, { reach: radius, mirror }, body);
      stroke = {
        eid: e.pointerId,
        work,
        mode: $("human-brush-mode").value,
        smooth: smooth.positions,
        whole,
        targets,
        start: found.point.clone(),
        x: e.clientX,
        y: e.clientY,
        id: found.part.id,
        normal: found.face.normal
          .clone()
          .applyMatrix3(new Matrix3().getNormalMatrix(mesh.matrixWorld))
          .normalize(),
        rest: new Matrix3().setFromMatrix4(mesh.matrixWorld).invert(),
        vectors: null,
      };
      plane.setFromNormalAndCoplanarPoint(
        camera.getWorldDirection(new Vector3()),
        stroke.start,
      );
      mark(stroke.start, work.used);
      canvas.setPointerCapture(e.pointerId);
      orbit.enabled = false;
    },
    true,
  );
  function preview(vectors) {
    const { work, smooth, whole, targets } = stroke,
      next = smoothHumanSurface(applyHumanDetail(applyHumanControls(work.bare, vectors), work.detail)).positions;
    whole.attributes.position.array.set(next);
    whole.attributes.position.needsUpdate = true;
    whole.computeVertexNormals();
    const normals = whole.attributes.normal.array;
    for (const { mesh, position, normal } of targets) {
      const ids = mesh.humanSkin.vertices,
        p = mesh.geometry.attributes.position,
        n = mesh.geometry.attributes.normal;
      for (let i = 0; i < ids.length; i++) {
        const v = ids[i] * 3,
          dx = next[v] - smooth[v],
          dy = next[v + 1] - smooth[v + 1],
          dz = next[v + 2] - smooth[v + 2],
          moved = dx || dy || dz;
        p.array[i * 3] = position[i * 3] + dx;
        p.array[i * 3 + 1] = position[i * 3 + 1] + dy;
        p.array[i * 3 + 2] = position[i * 3 + 2] + dz;
        for (let d = 0; d < 3; d++)
          n.array[i * 3 + d] = moved ? normals[v + d] : normal[i * 3 + d];
      }
      p.needsUpdate = n.needsUpdate = true;
    }
  }
  function drag(e) {
    aim(e);
    const s = stroke;
    if (s.mode === "soften") {
      const share = Math.min(1, Math.hypot(e.clientX - s.x, e.clientY - s.y) / 140);
      s.vectors = share > 0.02 ? s.work.vectors(share, "soften") : null;
    } else {
      if (s.mode === "normal")
        hit.copy(s.normal).multiplyScalar((s.y - e.clientY) * unit());
      else if (ray.ray.intersectPlane(plane, hit)) hit.sub(s.start);
      else return;
      s.vectors =
        hit.length() > 0.0005
          ? s.work.vectors(hit.applyMatrix3(s.rest).toArray())
          : null;
    }
    preview(s.vectors ?? s.work.start);
    render();
  }
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (stroke) {
        if (e.pointerId !== stroke.eid) return;
        halt(e);
      } else if (!active()) {
        ring.hidden = true;
        return;
      }
      pending = e;
      queued ||= requestAnimationFrame(() => {
        queued = 0;
        if (stroke) drag(pending);
        else if (active()) {
          const found = pick(pending);
          if (found) mark(found.point, reach());
          else ring.hidden = true;
        }
      });
    },
    true,
  );
  function end(e, accept) {
    if (!stroke || e.pointerId !== stroke.eid) return;
    halt(e);
    if (accept) drag(e);
    const done = stroke;
    stroke = null;
    for (const { mesh, position, normal } of done.targets) {
      mesh.geometry.attributes.position.array.set(position);
      mesh.geometry.attributes.normal.array.set(normal);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.attributes.normal.needsUpdate = true;
    }
    done.whole.dispose();
    ring.hidden = true;
    orbit.enabled = true;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (accept && done.vectors && !done.work.changes(done.vectors))
      status(
        done.mode === "soften"
          ? "There are no corrections to soften here."
          : "This skin is already at the limit of a correction.",
      );
    else if (accept && done.vectors) {
      try {
        commit(
          done.work.form(done.vectors),
          (done.mode === "soften" ? "Softened the " : "Sculpted the ") + done.id + ".",
        );
      } catch (error) {
        status("The sculpt could not be kept. " + error.message);
      }
    }
    render();
  }
  canvas.addEventListener("pointerup", (e) => end(e, true), true);
  canvas.addEventListener("pointercancel", (e) => end(e, false), true);
  canvas.addEventListener("pointerleave", () => stroke || (ring.hidden = true));
}
