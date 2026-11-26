import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import {
  CatalogId,
  canonicalJson,
  Digest,
  isJson,
  isJsonArray,
  isJsonObject,
  journalJson,
  type Json,
  type JsonObject,
} from "@irudd/document";
import { Schema } from "effect";
import { createProject, openProject } from "@irudd/workshop";
import { readZipDirectory, readZipEntry, writeZip } from "../src/service/zip.js";
import {
  docId,
  failure,
  generate,
  human,
  pngBytes,
  registry,
  request,
  rename,
  run,
  tempDir,
} from "./support/fixtures.js";

const catalogId = Schema.decodeUnknownSync(CatalogId)("irudd.parts");
const digestOf = (hex: string) => Schema.decodeUnknownSync(Digest)(`sha256:${hex.repeat(64)}`);
const catalogDigest = digestOf("c");
const catalog: ReadonlyArray<readonly [CatalogId, Digest]> = [[catalogId, catalogDigest]];

async function character(dir: string) {
  return run(
    Effect.gen(function* () {
      const project = yield* createProject({ path: dir, label: "Studio", registry, catalog });
      const session = yield* project.session({ actor: human });
      const commit = function* (body: Parameters<typeof session.apply>[0]) {
        const result = yield* session.apply(body);
        assert.equal(result.kind, "committed", JSON.stringify(result));
      };
      yield* commit(generate());
      const parts = (yield* project.current(docId)).document?.parts ?? [];
      const [first, second] = parts;
      assert.ok(first && second);
      const pictures: Array<{ digest: string; byteLength: number }> = [];
      for (let i = 0; i < 9; i++) {
        const put = yield* session.putBlob({
          bytes: pngBytes(200 + i * 37),
          mediaType: "image/png",
        });
        pictures.push({ digest: put.digest, byteLength: put.byteLength });
      }
      yield* commit(
        request(1, {
          type: "edit",
          ops: pictures.map((p, i) => ({
            op: "asset.add",
            asset: {
              digest: p.digest,
              mediaType: "image/png",
              byteLength: p.byteLength,
              role: i === 0 ? "paint-atlas" : "reference",
            },
          })),
        }),
      );
      yield* commit(
        request(2, {
          type: "edit",
          ops: [
            {
              op: "part.set",
              part: first.id,
              set: { paint: { atlas: pictures[0]?.digest ?? "" } },
            },
          ],
        }),
      );
      yield* commit(rename(3, first.id, "Carried trunk"));
      yield* commit(
        request(4, {
          type: "edit",
          ops: [
            {
              op: "pose.set",
              pose: {
                id: "pose-wave",
                label: "Wave",
                joints: [{ part: second.id, rotation: [0, 0, 0.6, 0.8] }],
              },
            },
          ],
        }),
      );
      yield* commit(
        request(5, {
          type: "edit",
          ops: [{ op: "catalog.set", dependency: { id: catalogId, digest: catalogDigest } }],
        }),
      );
      yield* commit(
        request(6, {
          type: "edit",
          ops: [
            { op: "extension.set", namespace: "com.example.notes", value: { mood: "curious" } },
          ],
        }),
      );
      yield* commit(rename(7, second.id, "Oops"));
      yield* commit(request(8, { type: "undo", target: 8 }));
      const journal = yield* project.journal(docId);
      return {
        first: first.id,
        second: second.id,
        pictures,
        bytes: journal.map((e) => canonicalJson(journalJson(e))),
      };
    }),
  );
}

function entries(file: string): Map<string, Uint8Array> {
  const bytes = new Uint8Array(fs.readFileSync(file));
  return new Map(readZipDirectory(bytes).map((e) => [e.name, readZipEntry(bytes, e)] as const));
}

type Mutable = Record<string, Json>;
function json(bytes: Uint8Array | undefined): Mutable {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  assert.ok(isJson(value) && isJsonObject(value));
  return { ...value };
}
function objects(parent: Mutable, key: string): Mutable[] {
  const list = parent[key];
  assert.ok(isJsonArray(list));
  const copies = list.map((item): Mutable => {
    assert.ok(isJsonObject(item));
    return { ...item };
  });
  parent[key] = copies;
  return copies;
}
const member = (parent: JsonObject, key: string): JsonObject => {
  const value = parent[key];
  assert.ok(isJsonObject(value));
  return value;
};
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + "\n");

function repack(
  source: string,
  change: (files: Map<string, Uint8Array>) => void,
  name: string,
): string {
  const files = entries(source);
  change(files);
  const target = path.join(tempDir("repack"), `${name}.irudd-character`);
  fs.writeFileSync(
    target,
    writeZip(
      [...files].map(([n, bytes]) => ({ name: n, bytes, deflate: !n.startsWith("assets/") })),
    ),
  );
  return target;
}

async function save(dir: string): Promise<string> {
  const target = path.join(tempDir("pkg-out"), "Marsh walker.irudd-character");
  const report = await run(
    Effect.flatMap(openProject({ path: dir, registry, catalog }), (p) =>
      p.saveCharacter(docId, target),
    ),
  );
  assert.equal(report.path, target);
  assert.equal(report.revision, 9);
  assert.equal(report.assets, 9);
  assert.equal(report.bytes, fs.statSync(target).size);
  return target;
}

async function openFresh(
  file: string,
  installed: ReadonlyArray<readonly [CatalogId, Digest]> = catalog,
) {
  const dir = tempDir("pkg-into");
  const outcome = await run(
    Effect.gen(function* () {
      const project = yield* createProject({
        path: dir,
        label: "Fresh",
        registry,
        catalog: installed,
      });
      const session = yield* project.session({ actor: human });
      return yield* session.openCharacter(file).pipe(
        Effect.map((report) => ({ ok: true as const, report })),
        Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
      );
    }),
  );
  const after = await run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: dir, registry, catalog: installed });
      return { documents: (yield* project.documents).length, verify: yield* project.verify };
    }),
  );
  return { dir, outcome, after };
}

test("a saved character opens offline in a fresh project with history, artwork and undo", async () => {
  const sourceDir = tempDir("pkg-source");
  const made = await character(sourceDir);
  const file = await save(sourceDir);

  const files = entries(file);
  assert.deepEqual(
    [...files.keys()].filter((n) => !n.startsWith("assets/")),
    ["manifest.json", "document.json", "history.jsonl"],
  );
  assert.equal([...files.keys()].filter((n) => /^assets\/[0-9a-f]{64}\.png$/.test(n)).length, 9);
  const manifest = json(files.get("manifest.json"));
  assert.equal(manifest["format"], "irudd.character-package");
  assert.deepEqual(manifest["catalog"], [{ id: catalogId, digest: catalogDigest }]);
  assert.deepEqual(manifest["metadata"], ["com.example.notes"]);
  assert.equal(member(manifest, "history")["entries"], made.bytes.length);
  for (const picture of made.pictures) {
    const stored = files.get(`assets/${picture.digest.slice(7)}.png`);
    assert.equal(stored?.length, picture.byteLength);
  }
  const again = await failure(
    Effect.flatMap(openProject({ path: sourceDir, registry, catalog }), (p) =>
      p.saveCharacter(docId, file),
    ),
  );
  assert.equal(again._tag, "InvalidArgument");

  const opened = await openFresh(file);
  assert.ok(opened.outcome.ok, JSON.stringify(opened.outcome));
  assert.equal(opened.outcome.report.format, "irudd.character-package");
  assert.equal(opened.outcome.report.revision, 9);
  assert.equal(opened.outcome.report.label, "Marsh walker");
  assert.deepEqual(opened.outcome.report.blobs, { added: 9, existing: 0 });
  assert.equal(opened.after.verify.ok, true);

  await run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: opened.dir, registry, catalog });
      const journal = yield* project.journal(docId);
      assert.deepEqual(
        journal.map((e) => canonicalJson(journalJson(e))),
        made.bytes,
      );
      const head = yield* project.current(docId);
      const doc = head.document;
      assert.equal(head.access.mode, "writable");
      assert.equal(doc?.parts.find((p) => p.id === made.first)?.label, "Carried trunk");
      assert.notEqual(doc?.parts.find((p) => p.id === made.second)?.label, "Oops");
      assert.equal(
        doc?.parts.find((p) => p.id === made.first)?.paint?.atlas,
        made.pictures[0]?.digest,
      );
      assert.deepEqual(
        doc?.poses.map((p) => p.id),
        ["pose-wave"],
      );
      assert.deepEqual(doc?.extensions, { "com.example.notes": { mood: "curious" } });
      for (const picture of made.pictures)
        assert.equal((yield* project.blob(picture.digest)).byteLength, picture.byteLength);
      const inspect = yield* project.inspect(docId);
      assert.equal(inspect.history.find((h) => h.revision === 8)?.undone, true);
      const session = yield* project.session({ actor: human });
      const redo = yield* session.apply(request(9, { type: "undo", target: 9 }));
      assert.equal(redo.kind, "committed");
      assert.equal(
        (yield* project.current(docId)).document?.parts.find((p) => p.id === made.second)?.label,
        "Oops",
      );
      const next = yield* session.apply(rename(10, made.second, "Tail"));
      assert.ok(next.kind === "committed" && next.entry.sequence === made.bytes.length + 2);
      assert.equal((yield* Effect.flip(session.openCharacter(file)))._tag, "DocumentExists");
    }),
  );
});

type Installed = ReadonlyArray<readonly [CatalogId, Digest]>;

test("a damaged or incompatible character file is refused with diagnostics before anything is written", async () => {
  const sourceDir = tempDir("pkg-bad-source");
  const made = await character(sourceDir);
  const file = await save(sourceDir);
  const firstAsset = `assets/${made.pictures[0]?.digest.slice(7) ?? ""}.png`;
  const editDocument =
    (change: (doc: Record<string, Json>) => void) => (files: Map<string, Uint8Array>) => {
      const doc = json(files.get("document.json"));
      change(doc);
      files.set("document.json", text(doc));
    };
  const cases: Array<[string, string, string[], Installed?]> = [
    [
      repack(file, (f) => f.delete(firstAsset), "missing-art"),
      "missing artwork",
      ["missing-asset"],
    ],
    [
      repack(
        file,
        (f) => {
          const bytes = new Uint8Array(f.get(firstAsset) ?? []);
          bytes[100] = (bytes[100] ?? 0) ^ 0xff;
          f.set(firstAsset, bytes);
        },
        "damaged-art",
      ),
      "damaged artwork",
      ["asset-mismatch"],
    ],
    [
      repack(
        file,
        editDocument((doc) => {
          const pose = objects(doc, "poses")[0];
          if (pose) pose["joints"] = [{ part: "p-missing", rotation: [0, 0, 0, 1] }];
        }),
        "bad-pose",
      ),
      "pose naming a missing part",
      ["missing-reference"],
    ],
    [
      repack(
        file,
        editDocument((doc) => {
          const part = objects(doc, "parts").find((p) => p["id"] === made.first);
          if (part) part["paint"] = { atlas: `sha256:${"d".repeat(64)}` };
        }),
        "bad-layer",
      ),
      "paint layer naming undeclared artwork",
      ["missing-reference"],
    ],
    [
      repack(
        file,
        editDocument((doc) => {
          const requires = doc["requires"];
          assert.ok(isJsonArray(requires));
          doc["requires"] = [...requires, { feature: "com.future.wings", version: 1 }];
        }),
        "unknown-feature",
      ),
      "a feature this build lacks",
      ["unknown-feature"],
    ],
    [file, "catalog not installed", ["catalog-missing"], []],
    [file, "different catalog installed", ["catalog-mismatch"], [[catalogId, digestOf("e")]]],
    [
      repack(
        file,
        editDocument((doc) => {
          doc["label"] = "Renamed outside the app";
        }),
        "edited-head",
      ),
      "document.json edited without history",
      ["journal-integrity"],
    ],
    [
      repack(
        file,
        (f) => {
          const lines = new TextDecoder().decode(f.get("history.jsonl")).trimEnd().split("\n");
          f.set("history.jsonl", new TextEncoder().encode(lines.slice(0, -1).join("\n") + "\n"));
        },
        "short-history",
      ),
      "history cut short",
      ["journal-integrity"],
    ],
    [
      repack(
        file,
        (f) => f.set("manifest.json", text({ ...json(f.get("manifest.json")), version: 2 })),
        "newer",
      ),
      "a newer package version",
      ["unsupported-format"],
    ],
    [
      repack(file, (f) => f.set("notes.txt", new TextEncoder().encode("hi")), "extra-file"),
      "an unexpected file",
      ["schema"],
    ],
  ];
  const truncated = path.join(tempDir("pkg-truncated"), "cut.irudd-character");
  const whole = fs.readFileSync(file);
  fs.writeFileSync(truncated, whole.subarray(0, whole.length - 40));
  cases.push([truncated, "a truncated file", ["schema"]]);

  for (const [target, name, codes, installed] of cases) {
    const { outcome, after } = await openFresh(target, installed ?? catalog);
    assert.ok(!outcome.ok, `${name}: refused`);
    assert.equal(outcome.error._tag, "ArchiveRejected", `${name}: ${outcome.error.message}`);
    const found =
      outcome.error._tag === "ArchiveRejected" ? outcome.error.diagnostics.map((d) => d.code) : [];
    for (const code of codes)
      assert.ok(
        found.some((c) => c === code),
        `${name}: ${code} in ${found.join(", ")}`,
      );
    assert.equal(after.documents, 0, `${name}: no document written`);
    assert.equal(after.verify.blobs.count, 0, `${name}: no artwork written`);
    console.log(`# ${name}: ${outcome.error.message.slice(0, 160)}`);
  }
});
