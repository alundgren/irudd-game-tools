import { evaluateHuman, humanRange } from "./human-surface.js";
import { changeHuman, humanForm } from "./human-form.js";
import * as fitting from "./human-fit.js";
import { alignReference, bodyColumn, poseReadings, referenceGeometry } from "./human-reference-align.js";
import { keepHumanHead, registerHumanFamily, transferHumanIdentity } from "./human-family-transfer.js";


const skin = (human) => {
  const s = evaluateHuman(human);
  return s.positions.subarray(0, s.bodyVertices * 3);
};

export function fitPlainAdult(raw, settings = {}, base) {
  if (!raw?.positions?.length || !raw?.indices?.length) throw new Error("This mesh has no surface.");
  const pose = poseReadings(alignReference(raw, settings, { stature: 1.72 }).positions);
  if (!base) {
    const [lo, hi] = humanRange("height"), height = +Math.min(hi, Math.max(lo, pose.stature)).toFixed(3);
    const angle = (stance) => poseReadings(skin({ height, stance })).armsBelowHorizontal;
    let a = 0, b = 1, fa = angle(a), fb = angle(b), best = 0;
    for (let i = 0; i < 4 && pose.armsBelowHorizontal !== null && fa !== null && fb !== null && fa !== fb; i++) {
      best = Math.min(1, Math.max(-1, a + ((pose.armsBelowHorizontal - fa) * (b - a)) / (fb - fa)));
      const f = angle(best);
      if (f === null || Math.abs(f - pose.armsBelowHorizontal) < 0.25 || best === b) break;
      [a, fa, b, fb] = [b, fb, best, f];
    }
    base = { start: { height, stance: +best.toFixed(2) } };
  }
  const placed = alignReference(raw, settings, { stature: 1.72, column: bodyColumn(skin(base.start)) });
  if (!base.human) {
    const geometry = referenceGeometry(placed.positions, raw.indices);
    const coarse = fitting.optimizeHumanMeasurements(humanForm(base.start, 1776), geometry);
    const fine = fitting.fitHumanReference(coarse.form, geometry);
    geometry.dispose?.();
    base = { ...base, human: coarse.form.human, humanFit: fine.fit,
      fit: { measurementsMm: fine.metrics.before.meanMm, surfaceMm: fine.metrics.after.meanMm, p95Mm: fine.metrics.after.p95Mm } };
  }
  return { base, placed };
}

export function registerFamilyNeutral(raw, settings = {}, { base: known } = {}) {
  const { base, placed } = fitPlainAdult(raw, settings, known);
  const registration = registerHumanFamily(base, { positions: placed.positions, indices: raw.indices });
  return { ...registration, recipe: base, factor: placed.report.factor, neutral: placed.positions, indices: raw.indices };
}

export function familyMember(registration, raw) {
  if (raw.positions.length / 3 !== registration.familyVertices || raw.indices.length / 3 !== registration.familyTriangles)
    throw new Error(
      "This reference has " + (raw.positions.length / 3).toLocaleString("en") + " vertices and the neutral has " +
        registration.familyVertices.toLocaleString("en") + ". A family transfer needs two meshes with the same vertex order.",
    );
  for (let i = 0; i < raw.indices.length; i++)
    if (raw.indices[i] !== registration.indices[i])
      throw new Error("This reference and the neutral list their triangles differently. A family transfer needs two meshes with the same vertex order.");
  return { positions: Float32Array.from(raw.positions, (x) => x * registration.factor), indices: raw.indices };
}

export function transferFamilyHead(registration, raw, form, { measurements = true, detail = true } = {}) {
  if (!form?.human) throw new Error("Open an adult human first.");
  if (!measurements && !detail) throw new Error("Choose head measurements, the fine head layer, or both.");
  const member = familyMember(registration, raw);
  const start = { human: form.human, ...(form.humanFit ? { humanFit: form.humanFit } : {}) };
  const result = transferHumanIdentity(registration, member, { region: "head", form: start, measurements, controls: false, detail });
  const patch = {};
  for (const [key, value] of Object.entries(result.form.human)) if (form.human[key] !== value) patch[key] = value;
  let next = { ...form };
  if (detail && result.detail) next.humanDetail = result.detail;
  else delete next.humanDetail;
  if (Object.keys(patch).length) next = changeHuman(next, patch);
  if (form.humanFit) next.humanFit = form.humanFit;
  return { form: next, metrics: result.metrics };
}

export function headKeeper(form) {
  const s = evaluateHuman(form.human, form.humanFit, form.humanDetail), head = s.names.indexOf("head");
  let floor = Infinity;
  for (let v = 0; v < s.bodyVertices; v++) if (s.boneIndices[v * 4] === head) floor = Math.min(floor, s.positions[v * 3 + 1]);
  return {
    hold: (point) => point.y >= floor,
    rebuild(next) {
      const kept = keepHumanHead(form, next), out = { ...next };
      if (kept.detail) out.humanDetail = kept.detail;
      else delete out.humanDetail;
      return { form: out, metrics: kept.metrics };
    },
  };
}

export function headKeptText(metrics) {
  const mm = (x) => x.toFixed(1);
  return (
    "head kept under its fine layer: " + mm(metrics.carried.meanMm) + " → " + mm(metrics.kept.meanMm) + " mm from where it stood" +
    (metrics.detail.limited ? ", " + metrics.detail.limited + " vertices at the layer's limit" : "") +
    (metrics.folds || metrics.drawnFolds ? ", " + (metrics.folds + metrics.drawnFolds) + " triangles turned over" : "")
  );
}

export function familyText(metrics) {
  const mm = (x) => (x < 99.5 ? x.toFixed(1) : x.toFixed(0)), last = metrics.afterDetail ?? metrics.afterMeasurements;
  return (
    "Head from the family · matched points " + mm(metrics.start.meanMm) + " → " + mm(last.meanMm) + " mm mean, " +
    mm(last.p95Mm) + " mm at 95%" +
    (metrics.measurementKeys ? " · " + metrics.measurementKeys.length + " head measurements" : "") +
    (metrics.detail ? " · fine layer on " + metrics.detail.vertices + " vertices, " + mm(metrics.detail.meanMm) + " mm mean, " + mm(metrics.detail.maxMm) + " mm longest" : "") +
    (metrics.detail?.limited
      ? " · " + metrics.detail.limited + " vertices reached the layer's limit: fit the whole body to this reference first so weight and frame carry the large differences"
      : "") +
    (metrics.outsideFromStart?.maxMm >= 0.05 ? " · skin outside the head moved at most " + mm(metrics.outsideFromStart.maxMm) + " mm with the head measurements" : "") +
    (metrics.contacts ? " · touching skin at most " + mm(metrics.contacts.afterMaxMm) + " mm apart (" + mm(metrics.contacts.beforeMaxMm) + " before)" : "") +
    (metrics.folds || metrics.drawnFolds ? " · " + (metrics.folds + metrics.drawnFolds) + " triangles turned over" : " · no skin turned over")
  );
}

export function familyPanel(hooks) {
  const { $ } = hooks, nextFrame = () => new Promise((done) => requestAnimationFrame(done));
  let neutral = null, registration = null, registeredWith = "";
  const reading = (text) => ($("hfit-family-reading").textContent = text);
  const describe = () => {
    if (!neutral) return "No neutral chosen. It stays in this browser session and is not uploaded or saved with the character.";
    const raw = hooks.raw(), count = neutral.raw.positions.length / 3;
    const same = raw && raw.positions.length === neutral.raw.positions.length && raw.indices.length === neutral.raw.indices.length;
    return (
      neutral.name + " · " + count.toLocaleString("en") + " vertices" +
      (registration ? " · registered, head " + registration.report.coverage.head.registered + " of " + registration.report.coverage.head.vertices + " vertices" : "") +
      (!raw ? ". Choose the family member as the reference above." : same ? ". The reference has the same vertex count." : ". The reference has another vertex count: it is not a member of this family.")
    );
  };
  function sync() {
    const raw = hooks.raw(), busy = hooks.busy();
    const same = Boolean(neutral && raw && raw.positions.length === neutral.raw.positions.length && raw.indices.length === neutral.raw.indices.length);
    $("hfit-family-browse").disabled = busy;
    $("hfit-family-run").disabled = busy || !same || !($("hfit-family-measure").checked || $("hfit-family-detail").checked);
    $("hfit-family-clear").disabled = busy || !hooks.form()?.humanDetail;
    reading(describe());
  }
  $("hfit-family-browse").onclick = () => $("hfit-family-file").click();
  $("hfit-family-file").onchange = async () => {
    const file = $("hfit-family-file").files[0];
    $("hfit-family-file").value = "";
    if (!file || hooks.busy()) return;
    hooks.lock(true);
    hooks.note("Reading " + file.name + "…");
    try {
      neutral = { name: file.name, raw: await hooks.read(file) };
      registration = null;
      hooks.note("Neutral read. Choose a member of the same family as the reference, then transfer the head.");
    } catch (error) {
      hooks.note("The neutral could not be read. " + error.message);
    } finally {
      hooks.lock(false);
    }
  };
  for (const id of ["hfit-family-measure", "hfit-family-detail"]) $(id).onchange = sync;
  $("hfit-family-run").onclick = async () => {
    const raw = hooks.raw();
    if (!neutral || !raw || hooks.busy()) return;
    hooks.lock(true);
    try {
      const settings = hooks.settings(), key = JSON.stringify([settings.units, settings.up, settings.turn]);
      if (!registration || registeredWith !== key) {
        hooks.note("Fitting the editable adult to the neutral and registering the family. This is done once and can take a minute…");
        await nextFrame();
        await nextFrame();
        registration = registerFamilyNeutral(neutral.raw, { units: settings.units, up: settings.up, turn: settings.turn });
        registeredWith = key;
      }
      hooks.note("Transferring the head…");
      await nextFrame();
      await nextFrame();
      const result = transferFamilyHead(registration, raw, hooks.form(), {
        measurements: $("hfit-family-measure").checked,
        detail: $("hfit-family-detail").checked,
      });
      hooks.accept(result.form, { family: result.metrics });
      hooks.note(familyText(result.metrics) + ". Apply to keep it.");
    } catch (error) {
      hooks.note("No head was transferred. " + error.message);
    } finally {
      hooks.lock(false);
    }
  };
  $("hfit-family-clear").onclick = () => {
    const form = hooks.form();
    if (!form?.humanDetail || hooks.busy()) return;
    const next = { ...form };
    delete next.humanDetail;
    hooks.accept(next, { family: null });
    hooks.note("Fine head layer removed. Measurements and surface corrections are unchanged. Apply to keep it.");
  };
  return { sync };
}
