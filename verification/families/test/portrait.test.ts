// Portrait plates: rasters of the core `portrait-plate` role, bound as a front
// plate on a figure.front-fit pass or a side plate on a finishing
// figure.profile-fit, both at version 2. A previous reader diagnoses the
// versions as a capability, older fixtures read unchanged, each binding
// resolves to a declared raster of its role, exports list the plates of parts
// that show and refuse plates whose bytes are missing, and an edit removing a
// plate undoes and reopens. Texture parity is the slow gate's
// (field-athlete-portrait).

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assetResolver,
  bundledAsset,
  exportArtwork,
  exportCharacter,
  exportPortraitPlates,
  type BundledAsset,
  type PaintAtlases,
  type PortraitPlates,
  type Raster,
} from "@irudd/character";
import {
  createRegistry,
  digestBrand,
  documentDigest,
  documentJson,
  emptyState,
  familyFeatures,
  isJson,
  isJsonObject,
  journalJson,
  canonicalJson,
  memoryEnvironment,
  openJournal,
  readDocument,
  reduce,
  type CharacterDocument,
  type CommandEnvelopeInput,
  type Digest,
  type DocumentState,
  type JsonObject,
  type Outcome,
} from "@irudd/document";
import { installNodeExporter } from "../src/node-exporter.js";
import { blobsDir, fixturesDir, repository } from "../src/paths.js";
import { familyRegistry } from "../src/prepare.js";

installNodeExporter();

type Mutable = { [key: string]: unknown };
const isObject = (v: unknown): v is Mutable => typeof v === "object" && v !== null;

const front: `sha256:${string}` =
  "sha256:656f385b1811fcd2fa8f79d68a9f4b88e1461bfb52eb38ca2a75b1786dfc8f53";
const side: `sha256:${string}` =
  "sha256:7362f0830dceb91b3ab8b3d116fef4cd1f01683d53e2c6965318f45542eb2590";

/** A fixture's raw JSON, with `edit` applied. */
function raw(name: string, edit?: (doc: Mutable) => void): unknown {
  const value: unknown = JSON.parse(readFileSync(join(fixturesDir, name + ".json"), "utf8"));
  assert.ok(isObject(value));
  edit?.(value);
  return value;
}

/** The fields of field-athlete-portrait's head features or of its asset `digest`. */
function head(doc: Mutable): Mutable {
  const parts = doc["parts"];
  assert.ok(Array.isArray(parts));
  const part: unknown = parts.find((p) => isObject(p) && p["id"] === "p-head");
  assert.ok(isObject(part) && isObject(part["features"]));
  return part["features"];
}
function asset(doc: Mutable, digest: string): Mutable {
  const assets = doc["assets"];
  assert.ok(Array.isArray(assets));
  const entry: unknown = assets.find((a) => isObject(a) && a["digest"] === digest);
  assert.ok(isObject(entry));
  return entry;
}
function field(value: unknown, key: string): Mutable {
  assert.ok(isObject(value));
  const inner = value[key];
  assert.ok(isObject(inner));
  return inner;
}
function firstPass(features: Mutable): Mutable {
  const passes = field(features, "figure.front-fit")["passes"];
  assert.ok(Array.isArray(passes));
  const pass: unknown = passes[0];
  assert.ok(isObject(pass));
  return pass;
}

function read(value: unknown): CharacterDocument {
  const result = readDocument(value, { registry: familyRegistry });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}
function codes(value: unknown): string[] {
  const result = readDocument(value, { registry: familyRegistry });
  assert.ok(!result.ok, "the document should not read");
  return result.diagnostics.map((d) => `${d.code} ${d.path.join(".")}`);
}

test("a previous reader diagnoses the plate bindings as a capability", () => {
  const previous = createRegistry({
    features: familyFeatures.map((f) =>
      f.id === "figure.front-fit" || f.id === "figure.profile-fit"
        ? { ...f, version: 1, upgrades: [] }
        : f,
    ),
  });
  const result = readDocument(raw("field-athlete-portrait"), { registry: previous });
  assert.ok(!result.ok);
  assert.deepEqual(result.diagnostics.map((d) => d.code).sort(), [
    "unsupported-feature-version",
    "unsupported-feature-version",
  ]);
});

test("older fit fixtures read unchanged at the new versions", () => {
  const before = raw("landmark-surveyor");
  const doc = read(before);
  const version = (id: string) => doc.requires.find((r) => r.feature === id)?.version;
  assert.equal(version("figure.front-fit"), 2);
  const parts = isObject(before) ? before["parts"] : undefined;
  assert.ok(Array.isArray(parts));
  for (const part of parts) {
    const payload = isObject(part) ? field(part, "features")["figure.front-fit"] : undefined;
    if (payload === undefined || !isObject(part)) continue;
    assert.deepEqual(
      doc.parts.find((p) => p.id === part["id"])?.features["figure.front-fit"],
      payload,
    );
  }
});

test("each plate binding resolves to a declared raster of the portrait-plate role", () => {
  const doc = read(raw("field-athlete-portrait"));
  assert.deepEqual(
    doc.assets.map((a) => a.role),
    ["portrait-plate", "portrait-plate"],
  );
  const at = (list: string[], prefix: string) => list.filter((c) => c.startsWith(prefix));
  const sheet = codes(
    raw("field-athlete-portrait", (d) => (asset(d, front)["role"] = "paint-atlas")),
  );
  assert.ok(
    sheet.some((c) => c.startsWith("asset-mismatch") && c.endsWith("passes.0.plate")),
    sheet.join(),
  );
  const model = codes(
    raw("field-athlete-portrait", (d) => (asset(d, side)["mediaType"] = "model/gltf-binary")),
  );
  assert.ok(
    model.some((c) => c.startsWith("asset-mismatch") && c.endsWith("side.plate")),
    model.join(),
  );
  const undeclared = codes(
    raw("field-athlete-portrait", (d) => {
      const assets = d["assets"];
      assert.ok(Array.isArray(assets));
      d["assets"] = assets.filter((a) => isObject(a) && a["digest"] !== front);
    }),
  );
  assert.ok(
    undeclared.some((c) => c.startsWith("missing-reference") && c.endsWith("passes.0.plate")),
  );
  const unbound = codes(raw("field-athlete-portrait", (d) => delete firstPass(head(d))["plate"]));
  assert.ok(at(unbound, "missing-reference assets").length === 1, unbound.join());
  const early = codes(
    raw("field-athlete-portrait", (d) => delete field(head(d), "figure.profile-fit")["stage"]),
  );
  assert.ok(
    early.some((c) => c.startsWith("schema")),
    early.join(),
  );
});

test("exports list the plates of parts that show, and clay claims none", async () => {
  const doc = read(raw("field-athlete-portrait"));
  assert.deepEqual(exportPortraitPlates(doc), [front, side]);
  const hidden = read(
    raw("field-athlete-portrait", (d) => {
      head(d)["outfit.wear"] = { visibleIn: ["Anatomy"] };
      const requires = d["requires"];
      assert.ok(Array.isArray(requires));
      if (!requires.some((r) => isObject(r) && r["feature"] === "outfit.wear"))
        requires.push({ feature: "outfit.wear", version: 1 });
    }),
  );
  assert.deepEqual(exportPortraitPlates(hidden), []);
  const clay = await exportCharacter(doc, { preset: "clay", revision: 1, build: "test" });
  assert.equal(clay.provenance.artwork, undefined);
});

const noRaster: Raster = {
  canvas: () => {
    throw new Error("No raster in node.");
  },
  image: () => Promise.reject(new Error("No raster in node.")),
};
const noPaint: PaintAtlases = { raster: noRaster, panels: () => undefined, missing: [] };
const bundledBytes = (a: BundledAsset) =>
  new Uint8Array(readFileSync(join(repository, "packages", "character", "assets", a.file)));
const projectBytes = (digest: Digest) => {
  const file = join(blobsDir, digest.replace(":", "-"));
  return existsSync(file)
    ? { bytes: new Uint8Array(readFileSync(file)), mediaType: "image/webp" }
    : undefined;
};

test("a textured export refuses plates whose bytes are missing", () => {
  const doc = read(raw("field-athlete-portrait"));
  const bundledOnly = assetResolver({ bundled: bundledBytes });
  assert.throws(
    () => exportArtwork(doc, { assets: bundledOnly, paint: noPaint }),
    /artwork sha256:656f385b.* is not available/,
  );
  const assets = assetResolver({ bundled: bundledBytes, project: projectBytes });
  assert.throws(
    () => exportArtwork(doc, { assets, paint: noPaint }),
    /Portrait plates did not load: sha256:656f385b.*, sha256:7362f083/,
  );
  const unloaded: PortraitPlates = { raster: noRaster, image: () => undefined, missing: [] };
  assert.throws(
    () => exportArtwork(doc, { assets, paint: noPaint, plates: unloaded }),
    /Portrait plates did not load/,
  );
  assert.equal(bundledAsset(digestBrand(front)), undefined, "plates are project bytes");
});

// ── Undo and reopen ─────────────────────────────────────────────────────────

const human = { kind: "human", id: "user" } as const;
let request = 0;
function envelope(
  doc: CharacterDocument,
  expectedRevision: number,
  command: CommandEnvelopeInput["command"],
): CommandEnvelopeInput {
  request += 1;
  return {
    format: "irudd.command",
    version: 1,
    requestId: `req-${request.toString().padStart(8, "0")}`,
    documentId: doc.id,
    actor: human,
    expectedRevision,
    command,
  };
}
const kind = (outcome: Outcome) =>
  outcome.kind === "rejected" ? `rejected ${JSON.stringify(outcome.diagnostics)}` : outcome.kind;

test("removing a side plate is one undoable edit that reopens", () => {
  const doc = read(raw("field-athlete-portrait"));
  const env = memoryEnvironment(
    familyRegistry,
    doc.assets.map(
      (a) => [a.digest, { byteLength: a.byteLength, mediaType: a.mediaType }] as const,
    ),
  );
  const created = reduce(
    emptyState(doc.id),
    envelope(doc, 0, { type: "document.create", document: documentJson(doc) }),
    env,
  );
  assert.equal(created.outcome.kind, "committed", kind(created.outcome));
  const profile = doc.parts.find((p) => p.id === "p-head")?.features["figure.profile-fit"];
  assert.ok(isJson(profile) && isJsonObject(profile));
  const { side: _side, ...traced } = profile;
  const strip = {
    op: "feature.set" as const,
    feature: "figure.profile-fit",
    part: "p-head",
    value: traced,
  };
  // The plate stays declared only while a fit binds it.
  const dangling = reduce(created.state, envelope(doc, 1, { type: "edit", ops: [strip] }), env);
  assert.equal(dangling.outcome.kind, "rejected");
  const removed = reduce(
    created.state,
    envelope(doc, 1, { type: "edit", ops: [strip, { op: "asset.remove", digest: side }] }),
    env,
  );
  assert.equal(removed.outcome.kind, "committed", kind(removed.outcome));
  const edited = removed.state.document;
  assert.ok(edited);
  assert.deepEqual(exportPortraitPlates(edited), [front]);
  const undone = reduce(removed.state, envelope(doc, 2, { type: "undo", target: 2 }), env);
  assert.equal(undone.outcome.kind, "committed", kind(undone.outcome));
  const restored = undone.state.document;
  assert.ok(restored);
  assert.equal(documentDigest(restored), documentDigest(doc));
  const stored = (s: DocumentState): JsonObject[] =>
    s.journal.map((e) => {
      const parsed: unknown = JSON.parse(canonicalJson(journalJson(e)));
      assert.ok(isJson(parsed) && isJsonObject(parsed));
      return parsed;
    });
  const reopened = openJournal(restored.id, stored(undone.state), env);
  assert.ok(reopened.ok);
  assert.equal(reopened.access.mode, "writable");
  const document = reopened.state.document;
  assert.ok(document);
  assert.equal(documentDigest(document), documentDigest(doc));
  assert.deepEqual(exportPortraitPlates(document), [front, side]);
});
