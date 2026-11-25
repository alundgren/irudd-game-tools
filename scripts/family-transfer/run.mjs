// Register a mesh family against the editable adult and transfer its members.
//
//   node scripts/family-transfer/run.mjs WORK --neutral NEUTRAL.glb --members A.glb,B.glb
//        [--generator FOLDER] [--region head] [--compare FITS.json] [--only id,id]
//
// WORK is a local folder under .reference-cache/. It receives the registered
// base, the transferred recipes and binary surfaces for score.py. NEUTRAL and
// the members share one topology. --generator names a frozen copy of
// character-view/ so a long study measures one version; the two transfer
// modules are copied into it. --compare names recipes from the ordinary
// reference fit, keyed by member id, to score beside the transfer.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const args = process.argv.slice(2), work = resolve(args[0] ?? "");
const option = (name, fallback) => { const i = args.indexOf("--" + name); return i < 0 ? fallback : args[i + 1]; };
if (!args[0] || !option("neutral") || !option("members")) {
  console.error("Usage: node scripts/family-transfer/run.mjs WORK --neutral NEUTRAL.glb --members A.glb,B.glb");
  process.exit(2);
}
const live = resolve("character-view"), folder = resolve(option("generator", live));
if (folder !== live)
  for (const name of ["family-transfer.js", "human-family-transfer.js", "human-family-editor.js"]) copyFileSync(join(live, name), join(folder, name));
const load = (name) => import(pathToFileURL(join(folder, name)).href);
const { evaluateHuman, smoothHumanSurface, validHumanFit } = await load("human-surface.js");
const { humanForm } = await load("human-form.js");
const { bakeScene } = await load("human-reference-align.js");
const { transferHumanIdentity } = await load("human-family-transfer.js");
const { fitPlainAdult, registerFamilyNeutral, transferFamilyHead } = await load("human-family-editor.js");
const { alignPoints, foldedTriangles, transformPoints } = await load("family-transfer.js");

mkdirSync(work, { recursive: true });
const region = option("region", "head");
async function mesh(path) {
  const data = readFileSync(path);
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
  return bakeScene(gltf.scene);
}
const save = (name, array) => writeFileSync(join(work, name), Buffer.from(array.buffer, array.byteOffset, array.byteLength));

// The ordinary reference fit of the editable adult to the neutral, as the editor does it. Done once and kept.
const neutral = await mesh(option("neutral"));
const basePath = join(work, "registered-base.json");
const registration = registerFamilyNeutral(neutral, {}, { base: existsSync(basePath) ? JSON.parse(readFileSync(basePath, "utf8")) : undefined });
const base = registration.recipe, placedNeutral = registration.neutral;
writeFileSync(basePath, JSON.stringify(base) + "\n");
console.log("registered base", JSON.stringify(base.fit));
console.log("registration", JSON.stringify(registration.report));

const compare = option("compare") ? JSON.parse(readFileSync(option("compare"), "utf8")).fits : {};
const only = option("only")?.split(",");
const smooth = (form) => smoothHumanSurface(evaluateHuman(form.human, form.humanFit, form.humanDetail));
const keepOffset = Number(option("keep-offset", 0));
const variants = Object.fromEntries(Object.entries({
  measurements: { measurements: true, controls: false },
  controls: { measurements: false, controls: true },
  transfer: { measurements: true, controls: true },
  detail: { measurements: true, controls: false, detail: true },
  full: { measurements: true, controls: true, detail: true },
  // The editor's own path. "plain": onto a plain adult that never saw the family.
  // "fitted": the ordinary whole-body fit to the member first, then its head.
  plain: { editor: "plain" },
  fitted: { editor: "fitted" },
}).filter(([name]) => option("variants", "measurements,transfer,detail,full,plain,fitted").split(",").includes(name)));
// Paired cage vertices on the upper and lower inner lip rims, as character-view/lip-fit.js lists them.
const rims = [[425, 426], [416, 438], [469, 475], [470, 481], [472, 487], [474, 523], [7228, 7242], [7226, 7236], [7225, 7230], [7176, 7198], [7185, 7186]];
const lipGap = (s) => {
  const gaps = rims.map(([a, b]) => 1000 * Math.hypot(s.positions[a * 3] - s.positions[b * 3], s.positions[a * 3 + 1] - s.positions[b * 3 + 1], s.positions[a * 3 + 2] - s.positions[b * 3 + 2]));
  return { meanMm: gaps.reduce((x, y) => x + y, 0) / gaps.length, maxMm: Math.max(...gaps) };
};
const baseCage = evaluateHuman(registration.human, registration.humanFit), baseSmooth = smoothHumanSurface(baseCage);
const headBone = baseSmooth.names.indexOf("head");
const smoothHead = (t) => [0, 1, 2].every((k) => baseSmooth.boneIndices[baseSmooth.indices[t * 3 + k] * 4] === headBone);
// The variant that places the member for pictures and gives the per-vertex upper bound.
const placedBy = ["transfer", "detail", "measurements"].find((name) => variants[name]);
const read = (name, fallback) => (existsSync(join(work, name)) ? JSON.parse(readFileSync(join(work, name), "utf8")) : fallback);
const results = read("results.json", { members: {} }), fits = read("fits.json", {});
results.region = region;
results.keepOffset = keepOffset;
results.registration = registration.report;
results.registeredBase = base.fit;
save("smooth.idx", baseSmooth.indices);
save("base.xyz", baseSmooth.positions);
save("neutral.xyz", placedNeutral);
save("family.idx", neutral.indices);
save("helpers.idx", Uint32Array.from(baseCage.indices.subarray(baseCage.bodyTriangles * 3)));
save("base-cage.xyz", baseCage.positions);
for (const path of option("members").split(",")) {
  const id = basename(path).replace(/[.]glb$/, "").replace(/^mhr-/, "");
  if (only && !only.includes(id)) continue;
  const member = await mesh(path), started = Date.now(), entry = { variants: {} };
  for (const [name, options] of Object.entries(variants)) {
    let result, started;
    if (options.editor) {
      let onto = humanForm({ height: 1.72 }, 1);
      if (options.editor === "fitted") {
        // The ordinary fit is kept beside the results, so a repeated run starts from the same adult.
        const ordinary = ((fits[id] ??= {}).ordinary ??= fitPlainAdult(member).base);
        onto = { ...humanForm(ordinary.human, 1), humanFit: ordinary.humanFit };
        entry.ordinaryFit = ordinary.fit;
        save(id + "-ordinary.xyz", smooth(onto).positions);
      }
      started = evaluateHuman(onto.human, onto.humanFit);
      const made = transferFamilyHead(registration, member, onto);
      const kept = { human: made.form.human, ...(made.form.humanFit ? { humanFit: made.form.humanFit } : {}) };
      result = { form: kept, detail: made.form.humanDetail, metrics: made.metrics, surface: evaluateHuman(kept.human, kept.humanFit, made.form.humanDetail) };
    } else result = transferHumanIdentity(registration, member, { region, keepOffset, ...(option("strain") ? { detailStrain: Number(option("strain")) } : {}), ...options });
    if (result.form.humanFit && !validHumanFit(result.form.humanFit)) throw new Error("Invalid transferred recipe for " + id);
    const shown = smoothHumanSurface(result.surface);
    // Lips are read against the adult the transfer started from.
    result.metrics.lipRimGap = { base: lipGap(options.editor ? started : baseCage), result: lipGap(result.surface) };
    if (!options.editor)
      result.metrics.renderedFolds = foldedTriangles(baseSmooth.positions, shown.positions, shown.indices, shown.indices.length / 3, smoothHead).folded.length;
    entry.variants[name] = { metrics: result.metrics };
    (fits[id] ??= {})[name] = { ...result.form, ...(result.detail ? { humanDetail: result.detail } : {}) };
    save(id + "-" + name + ".xyz", shown.positions);
    save(id + "-" + name + "-cage.xyz", result.surface.positions);
    if (name === placedBy) {
      // Every registered cage vertex placed on its own goal: the most a per-vertex layer could reach.
      const positions = result.surface.positions.slice();
      result.rows.forEach((v, i) => positions.set(result.target.subarray(i * 3, i * 3 + 3), v * 3));
      save(id + "-dense.xyz", smoothHumanSurface({ ...result.surface, positions }).positions);
      // The member itself where the transferred head stands, for pictures.
      const here = alignPoints(sample(member, registration, result.rows), result.target);
      save(id + "-member.xyz", transformPoints(member.positions, here.matrix));
    }
    console.log(id, name, JSON.stringify(result.metrics, (k, v) => (k === "measurementKeys" ? v.length : typeof v === "number" ? +v.toFixed(3) : v)));
  }
  if (compare[id]) save(id + "-reference-fit.xyz", smooth(compare[id]).positions);
  entry.seconds = (Date.now() - started) / 1000;
  results.members[id] = entry;
  writeFileSync(join(work, "results.json"), JSON.stringify(results) + "\n");
  writeFileSync(join(work, "fits.json"), JSON.stringify(fits) + "\n");
}

// The member's own surface points for the transferred rows, to place it beside the result.
function sample(member, registration, rows) {
  const index = new Map(Array.from(registration.vertex, (v, i) => [v, i])), out = new Float32Array(rows.length * 3);
  rows.forEach((v, r) => {
    const i = index.get(v), f = registration.face[i];
    for (let k = 0; k < 3; k++) {
      const p = member.indices[f * 3 + k] * 3, w = registration.weights[i * 3 + k];
      for (let d = 0; d < 3; d++) out[r * 3 + d] += w * member.positions[p + d];
    }
  });
  return out;
}
