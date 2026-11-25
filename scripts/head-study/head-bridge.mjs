// Serves the editable human's head to the Python head study over stdio.
// Usage: node head-bridge.mjs [folder holding human-surface.js]
// Requests are single JSON lines, replies are single JSON lines with base64 arrays:
//   {"describe":true}
//   {"evaluate":{"recipes":[...], "fits":[fit|null,...], "blink":0..1}}       cage vertices
//   {"smooth":{"recipe":{...}, "fit":fit|null, "blink":0..1}}                  rendered (subdivided) vertices
//   {"refine":{"human":{...}, "humanFit":fit|null, "positions":b64 f32, "indices":b64 u32, "region":"head"}}
//   {"measure":{"human":{...}, "positions":b64 f32, "indices":b64 u32, "region":"head"}}
// The generator modules are imported unchanged. `blink` adds the generator's own Blink
// expression, because evaluateHuman has no expression argument and both scans have closed eyes.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const base = process.argv[2] ? pathToFileURL(process.argv[2] + "/") : new URL("../../character-view/", import.meta.url);
const S = await import(new URL("human-surface.js", base));
const { evaluateHuman, smoothHumanSurface, expressionDisplacements, humanRange, humanControls } = S;
// The study fits the measurements it was recorded with; later identity controls stay out.
const humanAxes = S.humanFitAxes ?? S.humanAxes;

const b64 = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");
function typed(text, Type) {
  const bytes = Buffer.from(text, "base64");
  return new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

function cage(recipe, fit, blink = 0) {
  const surface = evaluateHuman(recipe, fit ?? undefined);
  if (!blink) return surface;
  // Same scaling as the expression morph targets in human-mesh.js.
  const delta = expressionDisplacements("Blink"), positions = surface.positions.slice();
  const amount = blink * surface.height / 1.72;
  for (let i = 0; i < positions.length; i++) positions[i] += amount * delta[i];
  return { ...surface, positions };
}

function headWeight(surface, vertices) {
  const head = surface.names.map(name => name === "head"), neck = surface.names.map(name => name.startsWith("neck"));
  const out = new Float32Array(vertices * 2);
  for (let v = 0; v < vertices; v++)
    for (let k = v * 4; k < v * 4 + 4; k++) {
      if (head[surface.boneIndices[k]]) out[v * 2] += surface.weights[k];
      if (neck[surface.boneIndices[k]]) out[v * 2 + 1] += surface.weights[k];
    }
  return out;
}

function describe() {
  const neutral = evaluateHuman({}), smooth = smoothHumanSurface(neutral), controls = humanControls();
  // Lip, eyelid, mouth-interior and nail paint per smooth vertex, taken from any corner that uses it.
  const pigments = new Uint8Array(smooth.positions.length / 3 * 4);
  for (let corner = 0; corner < smooth.indices.length; corner++)
    pigments.set(smooth.pigments.subarray(smooth.uvFaces[corner] * 4, smooth.uvFaces[corner] * 4 + 4), smooth.indices[corner] * 4);
  return {
    axes: humanAxes.map(name => { const [min, max, initial] = humanRange(name); return { name, min, max, initial }; }),
    bodyVertices: neutral.bodyVertices,
    cage: {
      vertices: neutral.positions.length / 3,
      faces: b64(Uint32Array.from(neutral.indices.subarray(0, neutral.bodyTriangles * 3))),
      headWeight: b64(headWeight(neutral, neutral.positions.length / 3)),
    },
    smooth: {
      vertices: smooth.positions.length / 3,
      faces: b64(Uint32Array.from(smooth.indices)),
      headWeight: b64(headWeight(smooth, smooth.positions.length / 3)),
      pigments: b64(pigments),
    },
    controlIds: Array.from(controls.ids),
    eyeGroups: neutral.eyeGroups,
  };
}

async function reference({ positions, indices }) {
  const { BufferAttribute, BufferGeometry } = await import("three");
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(typed(positions, Float32Array), 3));
  geometry.setIndex(new BufferAttribute(typed(indices, Uint32Array), 1));
  return geometry;
}

async function answer(request) {
  if (request.describe) return describe();
  if (request.evaluate) {
    const { recipes, fits, blink } = request.evaluate;
    const surfaces = recipes.map((recipe, i) => cage(recipe, fits?.[i], blink).positions);
    const all = new Float32Array(surfaces.reduce((n, s) => n + s.length, 0));
    surfaces.reduce((offset, s) => (all.set(s, offset), offset + s.length), 0);
    return { count: surfaces.length, positions: b64(all) };
  }
  if (request.smooth) {
    const { recipe, fit, blink } = request.smooth;
    return { positions: b64(smoothHumanSurface(cage(recipe, fit, blink)).positions) };
  }
  if (request.refine) {
    const { fitHumanReference } = await import(new URL("human-fit.js", base));
    const { human, humanFit, region = "head" } = request.refine;
    return fitHumanReference({ human, ...(humanFit ? { humanFit } : {}) }, await reference(request.refine), { region });
  }
  if (request.measure) {
    const { optimizeHumanMeasurements } = await import(new URL("human-fit.js", base));
    const { humanForm } = await import(new URL("human-form.js", base));
    const { human, region = "head" } = request.measure;
    const result = optimizeHumanMeasurements(humanForm(human), await reference(request.measure), { region });
    return { human: result.form.human, metrics: result.metrics };
  }
  throw new Error("Unknown request.");
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let reply;
  try {
    reply = await answer(JSON.parse(line));
  } catch (error) {
    reply = { error: String(error.message ?? error) };
  }
  await new Promise(resolve => process.stdout.write(JSON.stringify(reply) + "\n", resolve));
}
