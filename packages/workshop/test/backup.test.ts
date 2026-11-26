// Backups, restores and portable document archives, with their artwork.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { canonicalJson, journalJson } from "@irudd/document";
import { createProject, openProject, projectFileName, restoreProject } from "@irudd/workshop";
import {
  docId,
  failure,
  generate,
  human,
  pngBytes,
  registry,
  rename,
  request,
  run,
  tempDir,
} from "./support/fixtures.js";

/** A project with two documents, an edit, a policy entry and referenced artwork. */
async function populated(dir: string) {
  return run(
    Effect.gen(function* () {
      const project = yield* createProject({ path: dir, label: "Backed up", registry });
      const session = yield* project.session({ actor: human });
      yield* session.apply(generate());
      yield* session.apply(generate(undefined, "doc-other01"));
      const part = (yield* project.current(docId)).document?.parts[0]?.id ?? "";
      const art = yield* session.putBlob({ bytes: pngBytes(8192), mediaType: "image/png" });
      yield* session.putBlob({ bytes: pngBytes(512), mediaType: "image/png" }); // staged, never referenced
      yield* session.apply(
        request(1, {
          type: "edit",
          ops: [
            {
              op: "asset.add",
              asset: {
                digest: art.digest,
                mediaType: "image/png",
                byteLength: art.byteLength,
                role: "reference",
              },
            },
          ],
        }),
      );
      yield* session.apply(rename(2, part, "Backed-up trunk"));
      yield* session.apply(request(3, { type: "policy.set", agentDirectEdit: true }));
      const journal = yield* project.journal(docId);
      return { art: art.digest, bytes: journal.map((e) => canonicalJson(journalJson(e))) };
    }),
  );
}

test("backup writes one verified file; restore rebuilds the project with history and artwork", async () => {
  const dir = tempDir("backup");
  const { art, bytes } = await populated(dir);
  const out = tempDir("backup-out");
  const target = path.join(out, "copy.irudd-backup");

  const report = await run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: dir, registry });
      const started = performance.now();
      const result = yield* project.backup(target);
      const ms = performance.now() - started;
      // Writes continue after a backup.
      const session = yield* project.session({ actor: human });
      const after = yield* session.apply(
        request(3, { type: "policy.set", agentDirectEdit: false }),
      );
      assert.equal(after.kind, "committed");
      const again = yield* Effect.flip(project.backup(target));
      assert.equal(again._tag, "InvalidArgument", "a backup never overwrites");
      return { result, ms };
    }),
  );
  assert.equal(report.result.verify.ok, true);
  assert.equal(report.result.verify.blobs.count, 2);
  assert.equal(report.result.verify.blobs.unreferenced, 1);
  assert.deepEqual(fs.readdirSync(out), ["copy.irudd-backup"], "one file, no WAL or partial left");
  assert.equal(report.result.bytes, fs.statSync(target).size);

  const restored = path.join(tempDir("restore"), "project");
  const verify = await run(restoreProject({ backup: target, path: restored, registry }));
  assert.equal(verify.ok, true);
  await run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: restored, registry });
      const journal = yield* project.journal(docId);
      // The backup was taken before the last policy entry.
      assert.deepEqual(
        journal.map((e) => canonicalJson(journalJson(e))),
        bytes,
      );
      const blob = yield* project.blob(art);
      assert.equal(blob.byteLength, 8192);
      assert.equal((yield* project.documents).length, 2);
      assert.equal((yield* project.current(docId)).policy.agentDirectEdit, true);
    }),
  );
  assert.equal(
    (await failure(restoreProject({ backup: target, path: restored, registry })))._tag,
    "ProjectExists",
  );
  console.log(`# backup of ${report.result.bytes} bytes took ${report.ms.toFixed(1)} ms`);
});

test("a damaged backup is refused and the restore leaves nothing behind", async () => {
  const dir = tempDir("bad-backup");
  await populated(dir);
  const target = path.join(tempDir("bad-backup-out"), "copy.irudd-backup");
  await run(Effect.flatMap(openProject({ path: dir, registry }), (p) => p.backup(target)));
  const db = new DatabaseSync(target);
  db.exec(`DELETE FROM journal WHERE document_id = '${docId}' AND sequence = 3`);
  db.close();
  const restored = path.join(tempDir("bad-restore"), "project");
  const error = await failure(restoreProject({ backup: target, path: restored, registry }));
  assert.equal(error._tag, "ArchiveRejected");
  assert.ok(!fs.existsSync(restored));
  assert.ok(!fs.existsSync(path.join(restored, projectFileName)));
});

/** The JSON `irudd.document-archive` v1 an earlier build wrote; it must keep opening. */
async function legacyArchive(dir: string, art: string): Promise<Uint8Array> {
  return run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: dir, registry });
      const journal = yield* project.journal(docId);
      const last = journal[journal.length - 1];
      const blob = yield* project.blob(art);
      return new TextEncoder().encode(
        canonicalJson({
          format: "irudd.document-archive",
          version: 1,
          documentId: docId,
          last: last ? { sequence: last.sequence, digest: last.digest } : null,
          journal: journal.map(journalJson),
          blobs: [
            {
              digest: art,
              mediaType: blob.mediaType,
              byteLength: blob.byteLength,
              data: Buffer.from(blob.bytes).toString("base64"),
            },
          ],
        }),
      );
    }),
  );
}

test("a JSON document archive from an earlier build still carries its journal and artwork", async () => {
  const dir = tempDir("archive");
  const { art, bytes } = await populated(dir);
  const archive = await legacyArchive(dir, art);

  const other = tempDir("archive-into");
  await run(
    Effect.gen(function* () {
      const project = yield* createProject({ path: other, label: "Receiver", registry });
      const session = yield* project.session({ actor: human });
      const report = yield* session.importArchive(archive);
      assert.equal(report.format, "irudd.document-archive");
      assert.equal(report.revision, 3);
      assert.equal(report.journal.sequence, 4);
      assert.deepEqual(report.blobs, { added: 1, existing: 0 });
      const journal = yield* project.journal(docId);
      assert.deepEqual(
        journal.map((e) => canonicalJson(journalJson(e))),
        bytes,
      );
      assert.equal((yield* project.blob(art)).byteLength, 8192);
      // The imported document keeps working: the next edit appends at sequence 5.
      const next = yield* session.apply(request(3, { type: "policy.set", agentDirectEdit: false }));
      assert.ok(next.kind === "committed" && next.entry.sequence === 5);
      assert.equal((yield* Effect.flip(session.importArchive(archive)))._tag, "DocumentExists");
    }),
  );
  await run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: other, registry });
      assert.equal((yield* project.verify).ok, true);
    }),
  );

  // Tampering anywhere is refused before anything is written.
  const text = new TextDecoder().decode(archive);
  const cases: Array<[string, string]> = [
    ["journal", text.replace("Backed-up trunk", "Backed-up trunc")],
    ["blob", text.replace(/"data":"(.)/, (_m, c: string) => `"data":"${c === "A" ? "B" : "A"}`)],
    ["format", text.replace(/"version":1}$/, '"version":9}')],
    ["json", text.slice(0, -10)],
  ];
  for (const [name, tampered] of cases) {
    const fresh = tempDir("archive-bad");
    const error = await failure(
      Effect.gen(function* () {
        const project = yield* createProject({ path: fresh, label: "Receiver", registry });
        const session = yield* project.session({ actor: human });
        return yield* session.importArchive(new TextEncoder().encode(tampered));
      }),
    );
    assert.equal(error._tag, "ArchiveRejected", name);
    const left = await run(
      Effect.flatMap(openProject({ path: fresh, registry }), (p) => p.documents),
    );
    assert.equal(left.length, 0, `${name}: nothing was imported`);
  }
});
