import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Raycaster, Vector2, Vector3 } from "three";

export function createMask(triangles) {
  return { hidden: new Uint8Array(triangles), steps: [], count: 0 };
}
const fewest = 12;

function hide(mask, indices, wanted, centre) {
  const n = mask.hidden.length,
    found = [];
  for (let f = 0; f < n; f++) {
    if (mask.hidden[f]) continue;
    if (wanted(centre(f))) found.push(f);
  }
  if (!found.length) return 0;
  if (n - mask.count - found.length < fewest)
    throw new Error("That would hide the whole reference. Hide a smaller part.");
  for (const f of found) mask.hidden[f] = 1;
  mask.steps.push(Uint32Array.from(found));
  mask.count += found.length;
  return found.length;
}
function middles(positions, indices) {
  const c = [0, 0, 0];
  return (f) => {
    for (let d = 0; d < 3; d++)
      c[d] =
        (positions[indices[f * 3] * 3 + d] +
          positions[indices[f * 3 + 1] * 3 + d] +
          positions[indices[f * 3 + 2] * 3 + d]) /
        3;
    return c;
  };
}
export function hidePatch(mask, positions, indices, point, radius) {
  const r = radius * radius;
  return hide(
    mask,
    indices,
    (c) => (c[0] - point[0]) ** 2 + (c[1] - point[1]) ** 2 + (c[2] - point[2]) ** 2 < r,
    middles(positions, indices),
  );
}
export function hideBeyond(mask, positions, indices, point, direction) {
  const level = point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2];
  return hide(
    mask,
    indices,
    (c) => c[0] * direction[0] + c[1] * direction[1] + c[2] * direction[2] > level,
    middles(positions, indices),
  );
}
export function undoMask(mask) {
  const last = mask.steps.pop();
  if (!last) return 0;
  for (const f of last) mask.hidden[f] = 0;
  mask.count -= last.length;
  return last.length;
}
export function clearMask(mask) {
  const shown = mask.count;
  mask.hidden.fill(0);
  mask.steps.length = 0;
  mask.count = 0;
  return shown;
}
export function maskedIndices(mask, indices) {
  const n = mask.hidden.length,
    shown = new Uint32Array((n - mask.count) * 3),
    hidden = new Uint32Array(mask.count * 3),
    kept = new Uint32Array(n - mask.count);
  let s = 0,
    h = 0;
  for (let f = 0; f < n; f++) {
    const to = mask.hidden[f] ? hidden : shown,
      at = mask.hidden[f] ? h++ : s++;
    if (!mask.hidden[f]) kept[at] = f;
    for (let k = 0; k < 3; k++) to[at * 3 + k] = indices[f * 3 + k];
  }
  return { shown, hidden, kept };
}
export function maskSummary(mask, positions, indices) {
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  let all = 0,
    gone = 0;
  for (let f = 0; f < mask.hidden.length; f++) {
    a.fromArray(positions, indices[f * 3] * 3);
    b.fromArray(positions, indices[f * 3 + 1] * 3).sub(a);
    c.fromArray(positions, indices[f * 3 + 2] * 3).sub(a);
    const area = b.cross(c).length() / 2;
    all += area;
    if (mask.hidden[f]) gone += area;
  }
  return {
    triangles: mask.hidden.length,
    hiddenTriangles: mask.count,
    hiddenArea: all ? gone / all : 0,
    steps: mask.steps.length,
  };
}
export const underMask = (hidden) => (point, shown) =>
  Math.abs(hidden(point)) < Math.abs(shown);

export function vertexAreas(positions, indices = null) {
  const areas = new Float32Array(positions.length / 3),
    corners = indices ? indices.length : positions.length / 3,
    at = (k) => (indices ? indices[k] : k) * 3;
  for (let f = 0; f + 2 < corners; f += 3) {
    const a = at(f),
      b = at(f + 1),
      c = at(f + 2),
      ux = positions[b] - positions[a],
      uy = positions[b + 1] - positions[a + 1],
      uz = positions[b + 2] - positions[a + 2],
      vx = positions[c] - positions[a],
      vy = positions[c + 1] - positions[a + 1],
      vz = positions[c + 2] - positions[a + 2],
      third = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6;
    areas[a / 3] += third;
    areas[b / 3] += third;
    areas[c / 3] += third;
  }
  return areas;
}

const count = (n) => n.toLocaleString("en");
export function maskText({ triangles, hiddenTriangles, hiddenArea }) {
  return (
    count(hiddenTriangles) + " of " + count(triangles) + " triangles hidden, " +
    (hiddenArea * 100).toFixed(hiddenArea < 0.1 ? 1 : 0) + "% of the reference's surface"
  );
}

export function referenceMasker({
  canvas,
  camera,
  scene,
  offered,
  ready,
  raw,
  mesh,
  changed,
  starting,
  sideBySide,
  note,
  render,
}) {
  const $ = (id) => document.getElementById(id),
    masks = new WeakMap(),
    ray = new Raycaster(),
    up = new Vector3(),
    ghost = new Mesh(
      new BufferGeometry(),
      new MeshStandardMaterial({
        color: 0xc6452d,
        roughness: 0.9,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
  ghost.visible = false;
  ghost.renderOrder = 5;
  scene.add(ghost);
  let on = false,
    pointing = false,
    down = null,
    placed = null;
  const maskOf = (reference) => {
    if (!reference) return null;
    if (!masks.has(reference)) masks.set(reference, createMask(reference.indices.length / 3));
    return masks.get(reference);
  };
  const current = () => (placed && placed.reference === raw() ? placed : null);
  const paired = () =>
    $("hfit-views").querySelector('[aria-pressed="true"]')?.dataset.view === "side";
  function summary() {
    const now = current();
    if (!now?.mask.count) return null;
    now.summary ??= maskSummary(now.mask, now.positions, now.reference.indices);
    return now.summary;
  }
  function sync() {
    const shown = offered(),
      ok = shown && ready();
    if (on && !(ok && paired())) on = false;
    const kind = $("hfit-mask-kind").value,
      state = summary();
    $("hfit-mask-tools").hidden = !shown;
    const button = $("hfit-mask");
    button.disabled = !ok;
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Stop hiding parts" : "Hide parts that are not skin";
    $("hfit-mask-settings").hidden = !on;
    $("hfit-mask-size-field").hidden = kind !== "patch";
    $("hfit-mask-size-reading").textContent = $("hfit-mask-size").value + " mm";
    $("hfit-mask-undo").disabled = $("hfit-mask-clear").disabled = !ok || !state;
    if (on) canvas.style.cursor = "crosshair";
    else if (pointing) canvas.style.cursor = "";
    pointing = on;
    $("hfit-mask-reading").textContent =
      (state
        ? maskText(state) + ". The fit and the distances use only what is on show. "
        : "") +
      (!on
        ? ""
        : kind === "patch"
          ? "Click hair, a beard, closed eyelids or clothing on the reference in the left pane to hide a patch."
          : "Click the reference in the left pane. Everything " + kind + " that point, as this view shows it, is hidden.");
  }
  function apply(message) {
    const cleared = changed();
    note(
      message +
        (cleared
          ? " Fit steps were cleared because they were measured on the earlier surface."
          : ""),
    );
  }
  $("hfit-mask").onclick = () => {
    if (on) on = false;
    else if (offered() && ready()) {
      starting();
      on = true;
      sideBySide();
    }
    sync();
    render();
  };
  $("hfit-mask-kind").onchange = $("hfit-mask-size").oninput = sync;
  $("hfit-mask-undo").onclick = () => {
    const now = current();
    if (!now || !undoMask(now.mask)) return;
    apply("The last hidden part is back on show.");
  };
  $("hfit-mask-clear").onclick = () => {
    const now = current();
    if (!now || !clearMask(now.mask)) return;
    apply("The whole reference is on show again.");
  };
  $("hfit-room").addEventListener("close", () => {
    on = false;
  });
  canvas.addEventListener("pointerdown", (e) => {
    down = on && e.button === 0 ? [e.clientX, e.clientY] : null;
  });
  canvas.addEventListener("pointerup", (e) => {
    const start = down;
    down = null;
    if (!on || !start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
    const now = current();
    if (!now || !ready() || !paired()) {
      on = false;
      sync();
      return render();
    }
    const box = canvas.getBoundingClientRect(),
      half = box.width / 2,
      x = e.clientX - box.left,
      y = e.clientY - box.top;
    if (x >= half)
      return note("Parts are hidden on the reference. Click it in the left pane.");
    ray.setFromCamera(new Vector2((2 * x) / half - 1, 1 - (2 * y) / box.height), camera);
    const hit = ray.intersectObject(mesh(), false)[0];
    if (!hit)
      return note(
        ray.intersectObject(ghost, false).length
          ? "That part is already hidden. Click a part that is still on show."
          : "That click missed the reference. Click directly on its surface.",
      );
    const kind = $("hfit-mask-kind").value,
      point = hit.point.toArray(),
      { mask, positions, reference } = now;
    let hidden;
    try {
      if (kind === "patch")
        hidden = hidePatch(mask, positions, reference.indices, point, Number($("hfit-mask-size").value) / 1000);
      else {
        up.set(0, kind === "above" ? 1 : -1, 0).transformDirection(camera.matrixWorld);
        hidden = hideBeyond(mask, positions, reference.indices, point, up.toArray());
      }
    } catch (error) {
      return note(error.message);
    }
    if (!hidden) return note("Nothing new was hidden there.");
    apply(count(hidden) + " triangles hidden.");
  });

  return {
    sync,
    active: () => on,
    stop() {
      on = false;
    },
    place(reference, positions) {
      const mask = maskOf(reference);
      placed = { reference, positions, mask, summary: null };
      ghost.geometry.dispose();
      ghost.geometry = new BufferGeometry();
      if (!mask.count) return null;
      const lists = maskedIndices(mask, reference.indices);
      ghost.geometry.setAttribute("position", new BufferAttribute(positions, 3));
      ghost.geometry.setIndex(new BufferAttribute(lists.hidden, 1));
      ghost.geometry.computeVertexNormals();
      return lists;
    },
    clear() {
      placed = null;
      ghost.geometry.dispose();
      ghost.geometry = new BufferGeometry();
    },
    pane(isReference) {
      ghost.visible = on && isReference && Boolean(current()?.mask.count);
    },
    summary,
  };
}
