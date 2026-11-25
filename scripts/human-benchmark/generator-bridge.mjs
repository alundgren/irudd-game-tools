// Serves the editable human generator to the Python benchmark over stdio.
// Usage: node generator-bridge.mjs [folder holding human-surface.js]
// Requests are single JSON lines:
//   {"describe":true}
//   {"recipes":[{...}, ...], "fits":[fit or null, ...]}     surfaces for recipes
//   {"refine":{"human":{...}, "positions":base64 f32, "indices":base64 u32, "region":"whole"}}
// Replies are one JSON line. A recipes reply is followed by the raw little-endian
// float32 positions of every surface back to back.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const base = process.argv[2] ? pathToFileURL(process.argv[2] + "/") : new URL("../../character-view/", import.meta.url);
const { evaluateHuman, humanRange, ...surface } = await import(new URL("human-surface.js", base));
// The benchmark searches the measurements it was recorded with; later identity controls stay out.
const humanAxes = surface.humanFitAxes ?? surface.humanAxes;

function describe() {
  const neutral = evaluateHuman({});
  return {
    axes: humanAxes.map(name => { const [min, max, initial] = humanRange(name); return { name, min, max, initial }; }),
    vertices: neutral.positions.length / 3,
    indices: Array.from(neutral.indices),
    jointNames: neutral.names,
  };
}

async function refine({ human, positions, indices, region = "whole" }) {
  const { BufferAttribute, BufferGeometry } = await import("three");
  const { fitHumanReference } = await import(new URL("human-fit.js", base));
  const bytes = Buffer.from(positions, "base64"), index = Buffer.from(indices, "base64");
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4).slice(), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(index.buffer, index.byteOffset, index.length / 4).slice(), 1));
  return fitHumanReference({ human }, geometry, { region });
}

function write(chunk) {
  return new Promise(resolve => process.stdout.write(chunk, resolve));
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  try {
    if (request.describe) {
      await write(JSON.stringify(describe()) + "\n");
    } else if (request.refine) {
      await write(JSON.stringify(await refine(request.refine)) + "\n");
    } else {
      const surfaces = request.recipes.map((recipe, i) => evaluateHuman(recipe, request.fits?.[i] ?? undefined).positions);
      const bytes = Buffer.alloc(surfaces.reduce((n, s) => n + s.byteLength, 0));
      let offset = 0;
      for (const s of surfaces) {
        Buffer.from(s.buffer, s.byteOffset, s.byteLength).copy(bytes, offset);
        offset += s.byteLength;
      }
      await write(JSON.stringify({ count: surfaces.length, bytes: bytes.length }) + "\n");
      await write(bytes);
    }
  } catch (error) {
    await write(JSON.stringify({ error: String(error.message ?? error) }) + "\n");
  }
}
