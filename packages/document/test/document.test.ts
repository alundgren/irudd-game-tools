// The single document validator against committed valid and invalid fixtures,
// plus the family-extension mechanism: payload schemas, upgrade codecs,
// reference fields and capability errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import {
  canonicalJson,
  createRegistry,
  defineFeature,
  documentDigest,
  emptyState,
  frameCreature,
  isJsonObject,
  readDocument,
  reduce,
  sha256Digest,
  sha256Hex,
  utf8Encode,
  verifyAssetBytes,
  type Environment,
  type Json,
} from "@irudd/document";
import {
  blob,
  docId,
  envelope,
  environment,
  human,
  manualDocument,
  registry,
  rejected,
} from "./support/fixtures.js";

const dir = new URL("./fixtures/documents/", import.meta.url);
const load = (file: string): unknown => JSON.parse(readFileSync(new URL(file, dir), "utf8"));

const atlas = blob("atlas");
const occluder = blob("occluder");
const catalog = blob("catalog").digest;
const stores: Record<string, Environment | undefined> = {
  none: undefined,
  full: environment([atlas, occluder], [["irudd.parts", catalog]]),
  "no-occluder-blob": environment([atlas], [["irudd.parts", catalog]]),
  "changed-catalog": environment([atlas, occluder], [["irudd.parts", blob("changed").digest]]),
};

const Manifest = Schema.Struct({
  note: Schema.String,
  fixtures: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      store: Schema.String,
      expect: Schema.String,
      path: Schema.optionalKey(Schema.Array(Schema.Union([Schema.String, Schema.Number]))),
      canonicalEquals: Schema.optionalKey(Schema.String),
    }),
  ),
});
const manifest = Schema.decodeUnknownSync(Manifest)(load("manifest.json"));

test("sha256 and UTF-8 match the FIPS 180-4 and Unicode test vectors", () => {
  assert.equal(
    sha256Hex(utf8Encode("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex(utf8Encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256Hex(utf8Encode("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
  assert.equal(
    sha256Hex(new Uint8Array(1_000_000).fill(0x61)),
    "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
  );
  const lone = String.fromCharCode(0xd800);
  assert.deepEqual(
    [...utf8Encode("é😀" + lone)],
    [0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80, 0xef, 0xbf, 0xbd],
  );
});

for (const f of manifest.fixtures)
  test(`fixture ${f.file} with ${f.store} store → ${f.expect}`, () => {
    const environment = stores[f.store];
    const result = readDocument(
      load(f.file),
      environment ? { registry, environment } : { registry },
    );
    if (f.expect === "valid") {
      assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.diagnostics));
      if (f.canonicalEquals) {
        const other = readDocument(load(f.canonicalEquals), { registry });
        assert.ok(other.ok);
        assert.equal(canonicalJson(result.value), canonicalJson(other.value));
        assert.equal(documentDigest(result.value), documentDigest(other.value));
      }
      return;
    }
    assert.equal(result.ok, false, "expected a diagnostic");
    if (result.ok) return;
    const match = result.diagnostics.find((d) => d.code === f.expect);
    assert.ok(match, `expected ${f.expect}, got ${JSON.stringify(result.diagnostics)}`);
    if (f.path) assert.deepEqual(match.path, f.path);
  });

test("an invalid document is refused before any revision is written", () => {
  for (const file of [
    "invalid-unknown-required-feature.json",
    "invalid-missing-pose-target.json",
  ]) {
    const step = reduce(
      emptyState(docId),
      envelope(human, 0, { type: "document.create", document: load(file) }),
      stores["full"] ?? environment(),
    );
    rejected(step.outcome);
    assert.equal(step.state.head, 0);
    assert.equal(step.state.journal.length, 0);
  }
});

test("corrupt or truncated blob bytes are detected against the declaration", () => {
  const entry = {
    digest: atlas.digest,
    mediaType: "image/webp",
    byteLength: atlas.bytes.length,
    role: "paint-atlas",
  } as const;
  assert.deepEqual(verifyAssetBytes(entry, atlas.bytes), []);
  const corrupt = new Uint8Array(atlas.bytes);
  corrupt[3] = (corrupt[3] ?? 0) ^ 1;
  assert.deepEqual(
    verifyAssetBytes(entry, corrupt).map((d) => d.code),
    ["asset-mismatch"],
  );
  assert.deepEqual(
    verifyAssetBytes(entry, atlas.bytes.subarray(1)).map((d) => d.path[0]),
    ["byteLength", "digest"],
  );
  assert.equal(sha256Digest(atlas.bytes), atlas.digest);
});

// A family feature exercising the extension mechanism: version 2 renamed a
// field, version 1 payloads upgrade on read, and the payload names a layer
// target part that reference integrity checks.
const Layer = Schema.Struct({
  target: Schema.String,
  opacity: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
});
const layers = defineFeature({
  id: "test.layers",
  version: 2,
  scope: "document",
  schema: Schema.Struct({ layers: Schema.Array(Layer) }),
  toJson: (v) => v,
  upgrades: [
    (old) => {
      const list = isJsonObject(old) ? old["layers"] : undefined;
      return {
        layers: Array.isArray(list)
          ? list.map((l: Json) =>
              isJsonObject(l) ? { target: l["part"] ?? null, opacity: l["alpha"] ?? 1 } : l,
            )
          : [],
      };
    },
  ],
  references: (v) =>
    v.layers.map((l, i) => ({
      kind: "part" as const,
      id: l.target,
      path: ["layers", i, "target"],
    })),
});
const familyRegistry = createRegistry({ features: [layers], generators: [frameCreature] });

function withLayers(version: number, payload: unknown): Record<string, unknown> {
  const doc = manualDocument(atlas, occluder, catalog);
  const requires: unknown = doc["requires"];
  const existing: ReadonlyArray<unknown> = Array.isArray(requires) ? requires : [];
  return {
    ...doc,
    requires: [...existing, { feature: "test.layers", version }],
    features: { "test.layers": payload },
  };
}

test("a version 1 family payload upgrades through its codec on read", () => {
  const read = readDocument(withLayers(1, { layers: [{ part: "p-lamp", alpha: 0.5 }] }), {
    registry: familyRegistry,
  });
  assert.ok(read.ok, read.ok ? "" : JSON.stringify(read.diagnostics));
  assert.deepEqual(read.value.features["test.layers"], {
    layers: [{ target: "p-lamp", opacity: 0.5 }],
  });
  assert.equal(read.value.requires.find((r) => r.feature === "test.layers")?.version, 2);
});

test("family references, unknown versions and unregistered families give explicit diagnostics", () => {
  const missingTarget = readDocument(
    withLayers(2, { layers: [{ target: "p-ghost", opacity: 1 }] }),
    { registry: familyRegistry },
  );
  assert.equal(missingTarget.ok, false);
  assert.deepEqual(missingTarget.ok ? null : missingTarget.diagnostics[0]?.path, [
    "features",
    "test.layers",
    "layers",
    0,
    "target",
  ]);
  const tooNew = readDocument(withLayers(3, { layers: [] }), { registry: familyRegistry });
  assert.equal(tooNew.ok ? null : tooNew.diagnostics[0]?.code, "unsupported-feature-version");
  const unregistered = readDocument(withLayers(2, { layers: [] }), { registry });
  assert.equal(unregistered.ok ? null : unregistered.diagnostics[0]?.code, "unknown-feature");
  const badPayload = readDocument(withLayers(2, { layers: [{ target: "p-lamp", opacity: 4 }] }), {
    registry: familyRegistry,
  });
  assert.deepEqual(badPayload.ok ? null : badPayload.diagnostics[0]?.path, [
    "features",
    "test.layers",
    "layers",
    0,
    "opacity",
  ]);
});

test("namespaced extensions survive an edit and its undo untouched", () => {
  const env = stores["full"] ?? environment();
  let s = emptyState(docId);
  let step = reduce(
    s,
    envelope(human, 0, { type: "document.create", document: load("valid-manual.json") }),
    env,
  );
  s = step.state;
  step = reduce(
    s,
    envelope(human, 1, {
      type: "edit",
      ops: [{ op: "part.rename", part: "p-body", label: "Torso" }],
    }),
    env,
  );
  s = step.state;
  step = reduce(s, envelope(human, 2, { type: "undo", target: 2 }), env);
  s = step.state;
  assert.equal(s.head, 3);
  assert.deepEqual(s.document?.extensions, { "org.example.notes": { mood: "curious" } });
  assert.equal(s.history[2]?.digest, s.history[0]?.digest);
});
