import assert from "node:assert/strict";
import { test } from "node:test";
import { exportCharacter } from "@irudd/character";
import {
  depthFromPixels,
  depthOperations,
  depthRefusal,
  pairDepth,
  panelFromPixels,
  registerFace,
  traceFitOperations,
  type PanelFrame,
} from "@irudd/character/art-fit";
import {
  figureAnatomy,
  figurePaint,
  figurePortraitDepth,
  type CharacterDocument,
  type Part,
} from "@irudd/document";
import { applyChecked } from "../src/apply.js";
import { accessorValues, parseGlb, records } from "../src/glb.js";
import { installNodeExporter } from "../src/node-exporter.js";
import { readFixture } from "../src/fixtures.js";

installNodeExporter();
function depthPass(size: number): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x - size * 0.52) / (size * 0.3);
      const v = (y - size * 0.55) / (size * 0.4);
      const r = u * u + v * v;
      const i = 4 * (y * size + x);
      rgba[i + 3] = 255;
      if (r > 1) continue;
      const g = Math.round(70 + 175 * Math.sqrt(1 - r) - 12 * Math.max(0, v));
      rgba.set([g, g, g], i);
      if (x % 37 === 0 && y % 23 === 0) rgba.set([g, 30, 30], i);
    }
  return rgba;
}

test("depthFromPixels registers a depth pass and refuses a blank image", () => {
  const size = 384;
  const ported = depthFromPixels(depthPass(size), size, size);
  assert.equal(ported.mix, 0.88);
  assert.throws(
    () => depthFromPixels(new Uint8ClampedArray(size * size * 4), size, size),
    /grayscale depth pass/,
  );
});

const frames: readonly [PanelFrame, PanelFrame] = [
  { size: 640, mid: 321.5, feet: 611, span: 578 },
  { size: 640, mid: 318, feet: 609, span: 575 },
];
const marks: ReadonlyArray<readonly [number, number]> = [
  [0.385, 0.4],
  [0.617, 0.402],
  [0.503, 0.536],
  [0.5, 0.636],
  [0.501, 0.78],
];
const pairs: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0.5, 0.53, 0.3, 0.531, 0.1],
  [0.36, 0.48, 0.42, 0.482, 0.08],
  [0.62, 0.62, 0.44, 0.623, 0.12],
];

const fixture = readFixture("fitted-portrait");
const head = (doc: CharacterDocument): Part => {
  const part = doc.parts.find((p) => p.id === "p-head-and-neck");
  assert.ok(part);
  return part;
};
const binding = (doc: CharacterDocument) => {
  const b = figurePaint.read(head(doc).features);
  assert.ok(b);
  return b;
};

test("face marks and depth pairs register on the head's binding", () => {
  const b = binding(fixture);
  assert.ok(registerFace(b, marks, frames[0]));
  const pins = pairs.map((p) => pairDepth(b, frames[0], frames[1], p));
  assert.equal(pins.length, pairs.length);
  for (const pin of pins) assert.ok(pin);
  assert.throws(
    () => pairDepth(b, frames[0], frames[1], [0.5, 0.3, 0.5, 0.5, 0.1]),
    /matching height/,
  );
});

test("a sheet panel's frame is measured from its pixels", () => {
  const size = 640;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) pixels.set([255, 0, 255, 255], 4 * i);
  for (let y = 100; y <= 600; y++)
    for (let x = 250; x <= 400; x++) pixels.set([120, 100, 90, 255], 4 * (y * size + x));
  const panel = panelFromPixels(pixels, size);
  assert.deepEqual([panel.mid, panel.feet, panel.span], [325, 598, 496]);
});

async function positions(doc: CharacterDocument): Promise<Map<string, Float64Array>> {
  const result = await exportCharacter(doc, { preset: "clay", revision: 1, build: "art-fit" });
  const glb = parseGlb(result.bytes);
  const meshes = records(glb.json["meshes"]);
  const out = new Map<string, Float64Array>();
  for (const node of records(glb.json["nodes"])) {
    const mesh = typeof node["mesh"] === "number" ? meshes[node["mesh"]] : undefined;
    if (!mesh) continue;
    const values = records(mesh["primitives"]).flatMap((p) => {
      const attributes = p["attributes"];
      const at =
        typeof attributes === "object" && attributes !== null && "POSITION" in attributes
          ? attributes.POSITION
          : undefined;
      return typeof at === "number" ? [...accessorValues(glb, at)] : [];
    });
    out.set(String(node["name"]), Float64Array.from(values));
  }
  return out;
}

let base: Promise<Map<string, Float64Array>> | undefined;
const basePositions = () => (base ??= positions(fixture));

function moved(a: Map<string, Float64Array>, b: Map<string, Float64Array>): Map<string, number> {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  const out = new Map<string, number>();
  for (const [name, before] of a) {
    const after = b.get(name);
    assert.ok(after && after.length === before.length, name);
    let most = 0;
    for (let i = 0; i < before.length; i++)
      most = Math.max(most, Math.abs((after[i] ?? 0) - (before[i] ?? 0)));
    if (most > 1e-7) out.set(name, most);
  }
  return out;
}

test("a depth pass reshapes the portrait's exported face and nothing else", async () => {
  const part = head(fixture);
  assert.equal(depthRefusal(part), undefined);
  const body = fixture.parts.find((p) => p.id === "p-body");
  assert.ok(body);
  assert.match(depthRefusal(body) ?? "", /not a painted portrait/);
  const field = depthFromPixels(depthPass(384), 384, 384);
  const fitted = applyChecked(fixture, depthOperations(fixture, part.id, field));
  assert.deepEqual(figurePortraitDepth.read(head(fitted).features), {
    ...figurePortraitDepth.read(part.features),
    field,
  });
  const changes = moved(await basePositions(), await positions(fitted));
  assert.deepEqual([...changes.keys()], ["Face_head_and_neck_1"]);
  for (const [name, most] of changes) {
    assert.ok(most > 0.005 && most < 0.05, `${name} moved ${most} m`);
  }
});

test("a trace region's face marks and depth pairs fit onto the selected head", async () => {
  const part = head(fixture);
  const prior = figurePortraitDepth.read(part.features);
  const fit = traceFitOperations(
    fixture,
    part.id,
    [
      {
        id: "head-and-neck",
        method: "loft",
        front: [],
        side: [],
        faceLandmarks: marks,
        depthPairs: [...pairs, [0.5, 0.3, 0.5, 0.5, 0.1]],
      },
      { id: "body", method: "loft", front: [], side: [] },
      { id: "hat", parent: "head-and-neck", method: "volume", front: [], side: [] },
    ],
    frames[0],
    frames[1],
  );
  assert.equal(fit.region, "head-and-neck");
  assert.equal(fit.landmarks, true);
  assert.equal(fit.pins, 3);
  assert.deepEqual(fit.notes, [
    "Not built: body, hat (this brief fits one part; a trace brief that builds adds regions as parts).",
    "Depth pairs 4 did not match at the same height in both views and were left out.",
  ]);
  const fitted = applyChecked(fixture, fit.operations);
  const b = binding(fitted);
  assert.deepEqual(b.portrait, registerFace(binding(fixture), marks, frames[0]));
  assert.deepEqual(b.rest, binding(fixture).rest, "the traced cross sections stay");
  assert.equal(figureAnatomy.read(head(fitted).features)?.region, "face");
  const depth = figurePortraitDepth.read(head(fitted).features);
  assert.deepEqual(depth?.field, prior?.field, "the depth field stays");
  assert.equal(depth?.pins?.length, (prior?.pins?.length ?? 0) + 3);
  const changes = moved(await basePositions(), await positions(fitted));
  assert.deepEqual([...changes.keys()], ["Face_head_and_neck_1"]);
  for (const [name, most] of changes)
    assert.ok(most > 0.005 && most < 0.08, `${name} moved ${most} m`);

  assert.throws(
    () =>
      traceFitOperations(
        fixture,
        part.id,
        [
          {
            id: "p-head-and-neck",
            method: "loft",
            front: [],
            side: [],
            depthPairs: [[0.5, 0.3, 0.5, 0.5, 0.1]],
          },
        ],
        frames[0],
        frames[1],
      ),
    /fits nothing onto p-head-and-neck/,
  );
  assert.throws(
    () =>
      traceFitOperations(
        fixture,
        "p-left-foot",
        [{ id: "x", method: "path" }],
        frames[0],
        frames[1],
      ),
    /Name the trace region/,
  );
});
