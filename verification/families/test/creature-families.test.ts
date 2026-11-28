import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as T from "three";
import { buildCharacter, clayMaterials } from "@irudd/character";
import { buildCreature, creatureGenerator, randomCreature } from "@irudd/character/creature";
import {
  CharacterDocument,
  createRegistry,
  creatureFamilies,
  decodeWith,
  derivePartId,
  familyFeatures,
  generateParts,
} from "@irudd/document";
import { repository } from "../src/paths.js";
import { prepareForm } from "../src/prepare.js";

interface BrowserCreature {
  readonly seed: number;
  readonly family: string;
  readonly form: unknown;
}

const isMesh = (o: T.Object3D): o is T.Mesh => o instanceof T.Mesh;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function browserCreatures(): BrowserCreature[] {
  const code = `import { buildCreature, randomCreaturePlan } from "./character-view/creature-plan.js";
const out = [];
for (let seed = 0; seed < 30; seed++) {
  const plan = randomCreaturePlan(seed);
  out.push({ seed, family: plan.family, form: buildCreature(plan) });
}
process.stdout.write(JSON.stringify(out));`;
  const parsed: unknown = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    }),
  );
  assert.ok(Array.isArray(parsed));
  return parsed.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry["seed"] === "number" && typeof entry["family"] === "string"
      ? [{ seed: entry["seed"], family: entry["family"], form: entry["form"] }]
      : [],
  );
}

function rounded(value: unknown): unknown {
  if (typeof value === "number") return Number(value.toFixed(6));
  if (Array.isArray(value)) return value.map(rounded);
  if (isRecord(value))
    return Object.fromEntries(
      Object.keys(value)
        .filter((k) => value[k] !== undefined)
        .sort()
        .map((k) => [k, rounded(value[k])]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(rounded(JSON.parse(JSON.stringify(value)))))
    .digest("hex");

function generatedDocument(seed: number): CharacterDocument {
  const registry = createRegistry({ generators: [creatureGenerator], features: familyFeatures });
  const request = { generator: creatureGenerator.id, version: 1, params: randomCreature(seed) };
  const built = generateParts(registry, request, (slot) =>
    derivePartId("doc-creature", "req-family", slot),
  );
  assert.ok(built.ok);
  const doc = decodeWith(CharacterDocument, {
    format: "irudd.character",
    version: 1,
    id: "doc-creature",
    label: "Creature",
    requires: [],
    catalog: [],
    assets: [],
    poses: [],
    features: {},
    extensions: {},
    ...built.value,
  });
  assert.ok(doc.ok);
  return doc.value;
}

function clay(doc: CharacterDocument): CharacterDocument {
  const plan = doc.features["creature.plan"];
  if (!isRecord(plan) || plan["dress"] === undefined) return doc;
  const undressed = Object.fromEntries(Object.entries(plan).filter(([k]) => k !== "dress"));
  const copy = decodeWith(CharacterDocument, {
    ...doc,
    features: { ...doc.features, "creature.plan": undressed },
  });
  assert.ok(copy.ok);
  return copy.value;
}

interface Measure {
  readonly meshes: number;
  readonly vertices: number;
  readonly min: readonly number[];
  readonly max: readonly number[];
}

function measure(doc: CharacterDocument): Measure {
  const { group } = buildCharacter(doc, { materials: clayMaterials() });
  group.updateMatrixWorld(true);
  let meshes = 0,
    vertices = 0;
  group.traverse((o) => {
    if (!isMesh(o) || !o.visible) return;
    meshes++;
    vertices += o.geometry.getAttribute("position").count;
  });
  const box = new T.Box3().setFromObject(group);
  return { meshes, vertices, min: box.min.toArray(), max: box.max.toArray() };
}

const browser = browserCreatures();

for (const family of creatureFamilies)
  test(`the ${family} family builds the browser workshop's creature on the desktop`, () => {
    const dealt = browser.find((b) => b.family === family);
    assert.ok(dealt, `no seed below 30 deals a ${family}`);
    const plan = randomCreature(dealt.seed);
    assert.equal(plan.family, family);
    assert.equal(digest(buildCreature(plan)), digest(dealt.form));
    const desktop = measure(generatedDocument(dealt.seed));
    const workshop = measure(clay(prepareForm(`browser-${family}`, dealt.form).document));
    assert.equal(desktop.meshes, workshop.meshes);
    assert.equal(desktop.vertices, workshop.vertices);
    for (const [i, v] of desktop.min.entries())
      assert.ok(Math.abs(v - (workshop.min[i] ?? NaN)) < 1e-4, `${family} min ${i}`);
    for (const [i, v] of desktop.max.entries())
      assert.ok(Math.abs(v - (workshop.max[i] ?? NaN)) < 1e-4, `${family} max ${i}`);
  });
