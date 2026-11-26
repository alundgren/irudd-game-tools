// The project service through its public entry: sessions, commits, reads,
// idempotent retries, concurrent and stale writers, artwork, the single-owner
// lock, in-process faults and reopening.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import {
  createProject,
  openProject,
  projectFileName,
  type ApplyResult,
  type Project,
  type Session,
} from "@irudd/workshop";
import { openProjectWithHooks } from "../src/service/project.js";
import {
  agent,
  docId,
  failure,
  generate,
  human,
  pngBytes,
  registry,
  rename,
  request,
  requestId,
  retiredRegistry,
  run,
  tempDir,
} from "./support/fixtures.js";

const create = (dir: string) => createProject({ path: dir, label: "Test project", registry });
const reopen = (dir: string, reg = registry) => openProject({ path: dir, registry: reg });

function committed(result: ApplyResult) {
  if (result.kind !== "committed")
    throw new Error("Expected a commit, got " + result.kind + " " + JSON.stringify(result));
  return result;
}
function rejectedCodes(result: ApplyResult): string[] {
  if (result.kind !== "rejected") throw new Error("Expected a rejection, got " + result.kind);
  return result.diagnostics.map((d) => d.code);
}

const firstPart = (project: Project) =>
  Effect.map(project.current(docId), (view) => {
    const id = view.document?.parts[0]?.id;
    assert.ok(id);
    return id;
  });

/** A project with one generated document; returns the session and the first part ID. */
const seeded = (dir: string) =>
  Effect.gen(function* () {
    const project = yield* create(dir);
    const session = yield* project.session({ actor: human });
    committed(yield* session.apply(generate()));
    return { project, session, part: yield* firstPart(project) };
  });

function rawDb(dir: string): DatabaseSync {
  return new DatabaseSync(path.join(dir, projectFileName));
}

// ── Opening ────────────────────────────────────────────────────────────────

test("create, close and reopen a project; missing, existing and foreign files fail typed", async () => {
  const dir = tempDir("open");
  const info = await run(Effect.map(create(dir), (p) => p.info));
  assert.equal(info.format, "irudd.workshop-project");
  assert.equal(info.label, "Test project");
  assert.match(info.sqliteVersion, /^3\./);
  const again = await run(Effect.map(reopen(dir), (p) => p.info));
  assert.equal(again.projectId, info.projectId);

  assert.equal((await failure(create(dir)))._tag, "ProjectExists");
  assert.equal((await failure(reopen(path.join(dir, "nope"))))._tag, "ProjectMissing");
  assert.ok(!fs.existsSync(path.join(dir, "nope")), "opening a missing project creates nothing");

  const junk = tempDir("junk");
  fs.writeFileSync(path.join(junk, projectFileName), "not a database at all, just text".repeat(64));
  const notDb = await failure(reopen(junk));
  assert.equal(notDb._tag, "ProjectUnreadable");

  const foreign = tempDir("foreign");
  const db = new DatabaseSync(path.join(foreign, projectFileName));
  db.exec("CREATE TABLE t (x)");
  db.close();
  const other = await failure(reopen(foreign));
  assert.ok(other._tag === "ProjectUnreadable" && other.reason === "not-a-project");

  const db2 = rawDb(dir);
  db2.exec("UPDATE meta SET value = '2' WHERE key = 'version'");
  db2.close();
  const newer = await failure(reopen(dir));
  assert.ok(newer._tag === "ProjectUnreadable" && newer.reason === "newer-format");
});

test("one service owns a project: a second open in this process fails until the first closes", async () => {
  const dir = tempDir("lock");
  await run(create(dir));
  await run(
    Effect.gen(function* () {
      yield* reopen(dir);
      const second = yield* Effect.flip(
        Effect.scoped(openProject({ path: dir, registry, lockTimeoutMs: 50 })),
      );
      assert.equal(second._tag, "ProjectLocked");
    }),
  );
  await run(reopen(dir));
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(
    files,
    [projectFileName],
    "a closed project is one file: no WAL or shared memory left",
  );
});

// ── Sessions and commits ────────────────────────────────────────────────────

test("a session binds its caller: requests take its actor and cannot name another", async () => {
  const dir = tempDir("session");
  await run(
    Effect.gen(function* () {
      const project = yield* create(dir);
      const person = yield* project.session({ actor: human });
      const created = committed(yield* person.apply(generate()));
      assert.equal(created.receipt.revision, 1);
      const part = yield* firstPart(project);

      // Naming the session's own actor is allowed; naming another is forbidden.
      const own = { ...rename(1, part, "Mine"), actor: human };
      committed(yield* person.apply(own));
      const spoof = { ...rename(2, part, "Spoof"), actor: agent };
      assert.deepEqual(rejectedCodes(yield* person.apply(spoof)), ["forbidden"]);

      // An agent session follows the document's policy.
      const bot = yield* project.session({ actor: agent });
      assert.deepEqual(rejectedCodes(yield* bot.apply(rename(2, part, "Bot"))), [
        "proposal-required",
      ]);

      const inspect = yield* project.inspect(docId);
      assert.equal(inspect.history.length, 2);
      assert.equal(inspect.history[1]?.actor.id, "user");
      assert.equal(inspect.history[1]?.actor.name, "Person");

      assert.equal(
        (yield* Effect.flip(project.session({ actor: { kind: "agent", id: "Not Valid" } })))._tag,
        "InvalidArgument",
      );
      assert.deepEqual(rejectedCodes(yield* person.apply("not an envelope")), ["schema"]);
      assert.deepEqual(
        rejectedCodes(yield* person.apply({ ...rename(2, part, "x"), documentId: "Bad Id" })),
        ["schema"],
      );
    }),
  );
});

test("reads: current, inspect, manual deltas, diff, receipt, journal and drafts", async () => {
  const dir = tempDir("reads");
  await run(
    Effect.gen(function* () {
      const { project, session, part } = yield* seeded(dir);
      const bot = yield* project.session({ actor: agent });
      committed(yield* session.apply(rename(1, part, "Human edit")));
      // A draft from the agent, then a policy change: neither moves the head.
      const draft = committed(
        yield* bot.apply(
          request(2, {
            type: "proposal.create",
            proposal: "prop-tail",
            summary: "Rename the trunk",
            content: { kind: "ops", ops: [{ op: "part.rename", part, label: "Agent idea" }] },
          }),
        ),
      );
      assert.equal(draft.receipt.revision, 2);
      assert.equal(draft.receipt.appended, false);
      const policy = committed(
        yield* session.apply(request(2, { type: "policy.set", agentDirectEdit: true })),
      );
      assert.equal(policy.entry.sequence, 4);
      committed(yield* bot.apply(rename(2, part, "Agent edit")));

      const current = yield* project.current(docId);
      assert.equal(current.revision, 3);
      assert.equal(current.policy.agentDirectEdit, true);
      assert.deepEqual(current.journal, { sequence: 5, digest: current.journal?.digest });
      assert.equal(current.access.mode, "writable");

      const manual = yield* project.changes(docId, { since: 1, by: "human" });
      assert.deepEqual(
        manual.deltas.map((d) => d.revision),
        [2],
      );
      assert.ok(manual.deltas[0]?.changes.length);
      const all = yield* project.changes(docId, { since: 0 });
      assert.deepEqual(
        all.deltas.map((d) => d.author.kind),
        ["human", "human", "agent"],
      );

      const diff = yield* project.diff(docId, 1, 3);
      assert.ok(diff.ok && diff.changes.length > 0);
      const badDiff = yield* project.diff(docId, 1, 99);
      assert.ok(!badDiff.ok);

      const preview = yield* project.draft(docId, "prop-tail");
      assert.ok(preview.ok);
      assert.equal(preview.stale, true);
      assert.equal(preview.proposal.author.id, "assistant");
      const unknown = yield* project.draft(docId, "prop-none");
      assert.ok(!unknown.ok);

      const receipt = yield* project.receipt(docId, policy.receipt.requestId);
      assert.deepEqual(receipt, policy.receipt);
      assert.equal(yield* project.receipt(docId, "req-never-sent"), undefined);

      const journal = yield* project.journal(docId);
      assert.equal(journal.length, 5);
      assert.equal((yield* project.journal(docId, 3)).length, 2);

      const listed = yield* project.documents;
      assert.equal(listed.length, 1);
      assert.equal(listed[0]?.revision, 3);
      assert.equal(listed[0]?.journal.sequence, 5);
      assert.equal(listed[0]?.label, "Marsh walker");

      assert.equal((yield* Effect.flip(project.current("doc-absent")))._tag, "DocumentMissing");
      assert.equal((yield* Effect.flip(project.current("NOT VALID")))._tag, "InvalidArgument");
    }),
  );
});

test("every accepted entry is persisted, including draft and policy entries that leave the head", async () => {
  const dir = tempDir("persist");
  const before = await run(
    Effect.gen(function* () {
      const { project, session, part } = yield* seeded(dir);
      const bot = yield* project.session({ actor: agent });
      committed(
        yield* bot.apply(
          request(1, {
            type: "proposal.create",
            proposal: "prop-a",
            summary: "Idea",
            content: { kind: "ops", ops: [{ op: "part.rename", part, label: "Proposal" }] },
          }),
        ),
      );
      committed(yield* session.apply(request(1, { type: "policy.set", agentDirectEdit: true })));
      committed(yield* bot.apply(request(1, { type: "proposal.discard", proposal: "prop-a" })));
      return yield* project.inspect(docId);
    }),
  );
  assert.equal(before.revision, 1);
  assert.equal(before.journal?.sequence, 4);

  const after = await run(Effect.flatMap(reopen(dir), (p) => p.inspect(docId)));
  // Compared as JSON: a fresh state may hold -0 where the recovered one holds 0.
  // Canonical bytes and digests write both as 0, so the two are the same record.
  assert.deepEqual(
    JSON.parse(JSON.stringify(after)),
    JSON.parse(JSON.stringify(before)),
    "the recovered state reads exactly like the one that was written",
  );

  // The header anchors the journal: dropping the last (policy-free, draft-only) entry is detected.
  const db = rawDb(dir);
  db.exec(`DELETE FROM journal WHERE document_id = '${docId}' AND sequence = 4`);
  db.close();
  const damaged = await failure(Effect.flatMap(reopen(dir), (p) => p.current(docId)));
  assert.ok(damaged._tag === "JournalDamaged");
  assert.equal(damaged.diagnostics[0]?.code, "journal-integrity");
});

test("damaged rows are reported per document with the failing entry; other documents still open", async () => {
  const dir = tempDir("damage");
  await run(
    Effect.gen(function* () {
      const { session, part } = yield* seeded(dir);
      committed(yield* session.apply(rename(1, part, "Two")));
      committed(yield* session.apply(generate(undefined, "doc-second")));
    }),
  );
  const db = rawDb(dir);
  const row = db
    .prepare("SELECT entry FROM journal WHERE document_id = ? AND sequence = 2")
    .get(docId);
  const text = row?.["entry"];
  assert.ok(typeof text === "string");
  db.prepare("UPDATE journal SET entry = ? WHERE document_id = ? AND sequence = 2").run(
    text.replace("Two", "Tw0"),
    docId,
  );
  db.close();
  await run(
    Effect.gen(function* () {
      const project = yield* reopen(dir);
      const error = yield* Effect.flip(project.current(docId));
      assert.ok(error._tag === "JournalDamaged");
      assert.equal(error.index, 1);
      const session = yield* project.session({ actor: human });
      const write = yield* Effect.flip(session.apply(rename(2, "p-x", "y")));
      assert.equal(write._tag, "JournalDamaged", "a damaged document refuses writes");
      assert.equal((yield* project.current("doc-second")).revision, 1);
      const report = yield* project.verify;
      assert.equal(report.ok, false);
      assert.deepEqual(
        report.documents.map((d) => [d.documentId, d.ok, d.index]),
        [
          ["doc-marsh01", false, 1],
          ["doc-second", true, undefined],
        ],
      );
    }),
  );
});

// ── Retries and concurrent writers ──────────────────────────────────────────

test("retries are idempotent across reopen; a reused request ID with another payload is refused", async () => {
  const dir = tempDir("retry");
  const id = requestId("retry");
  const first = await run(
    Effect.gen(function* () {
      const { session, part } = yield* seeded(dir);
      const edit = rename(1, part, "Once", id);
      const a = committed(yield* session.apply(edit));
      const b = yield* session.apply(edit);
      assert.equal(b.kind, "replayed");
      assert.deepEqual(b.kind === "replayed" && b.receipt, a.receipt);
      assert.deepEqual(rejectedCodes(yield* session.apply(rename(1, part, "Different", id))), [
        "request-reused",
      ]);
      return { receipt: a.receipt, part };
    }),
  );
  await run(
    Effect.gen(function* () {
      const project = yield* reopen(dir);
      const session = yield* project.session({ actor: human });
      const again = yield* session.apply(rename(1, first.part, "Once", id));
      assert.ok(again.kind === "replayed");
      assert.deepEqual(again.receipt, first.receipt);
      assert.equal((yield* project.journal(docId)).length, 2, "the replay wrote nothing");
    }),
  );
});

test("concurrent writers: one stale-revision race winner, one commit per request ID", async () => {
  const dir = tempDir("race");
  await run(
    Effect.gen(function* () {
      const { project, session, part } = yield* seeded(dir);
      const racers = Array.from({ length: 12 }, (_, i) => rename(1, part, `Racer ${i}`));
      const results = yield* Effect.all(
        racers.map((r) => session.apply(r)),
        { concurrency: "unbounded" },
      );
      assert.equal(results.filter((r) => r.kind === "committed").length, 1);
      for (const r of results.filter((x) => x.kind === "rejected"))
        assert.deepEqual(rejectedCodes(r), ["stale-revision"]);

      const same = rename(2, part, "Same request");
      const twins = yield* Effect.all(
        Array.from({ length: 8 }, () => session.apply(same)),
        { concurrency: "unbounded" },
      );
      assert.deepEqual(
        twins.map((t) => t.kind).sort(),
        ["committed", ...Array.from({ length: 7 }, () => "replayed")].sort(),
      );
      const journal = yield* project.journal(docId);
      assert.equal(journal.length, 3);
      assert.equal(new Set(journal.map((e) => e.receipt.requestId)).size, 3);
    }),
  );
});

test("a header that disagrees with its journal fails recovery, ahead or behind", async () => {
  // A second writer cannot open the project (see the lock tests), so the only
  // way the header and journal disagree is damage or a foreign tool.
  for (const sequence of [7, 1]) {
    const dir = tempDir("header");
    await run(
      Effect.gen(function* () {
        const { session, part } = yield* seeded(dir);
        committed(yield* session.apply(rename(1, part, "Fine")));
      }),
    );
    const db = rawDb(dir);
    db.exec(`UPDATE documents SET last_sequence = ${sequence} WHERE id = '${docId}'`);
    db.close();
    const error = await failure(Effect.flatMap(reopen(dir), (p) => p.current(docId)));
    assert.equal(error._tag, "JournalDamaged", `header at ${sequence}`);
  }
});

// ── Faults inside the service ───────────────────────────────────────────────

test("a fault before commit leaves the old state; a fault after commit leaves the new one", async () => {
  const dir = tempDir("faults");
  let failBefore = false;
  let failAfter = false;
  await run(
    Effect.gen(function* () {
      const project = yield* openProjectWithHooks(
        { path: dir, registry, create: "Faults" },
        {
          beforeCommit: () => {
            if (failBefore) throw new Error("injected before commit");
          },
          afterCommit: () => {
            if (failAfter) throw new Error("injected after commit");
          },
        },
      );
      const session = yield* project.session({ actor: human });
      committed(yield* session.apply(generate()));
      const part = yield* firstPart(project);

      failBefore = true;
      const edit = rename(1, part, "Before");
      const lost = yield* Effect.exit(session.apply(edit));
      assert.equal(lost._tag, "Failure");
      assert.equal((yield* project.current(docId)).revision, 1, "old state survives");
      failBefore = false;
      assert.equal(
        committed(yield* session.apply(edit)).entry.sequence,
        2,
        "the retry commits once",
      );

      failAfter = true;
      const edit2 = rename(2, part, "After");
      const unknown = yield* Effect.exit(session.apply(edit2));
      assert.equal(unknown._tag, "Failure", "the caller never saw the reply");
      failAfter = false;
      assert.equal((yield* project.current(docId)).revision, 3, "new state was published");
      assert.equal((yield* session.apply(edit2)).kind, "replayed", "the retry replays");
      assert.equal((yield* project.journal(docId)).length, 3);
    }),
  );
  const journal = await run(Effect.flatMap(reopen(dir), (p) => p.journal(docId)));
  assert.equal(journal.length, 3);
});

// ── Artwork ─────────────────────────────────────────────────────────────────

const assetEdit = (revision: number, digest: string, byteLength: number) =>
  request(revision, {
    type: "edit",
    ops: [
      { op: "asset.add", asset: { digest, mediaType: "image/png", byteLength, role: "reference" } },
    ],
  });

test("artwork is staged and verified before a document may reference it", async () => {
  const dir = tempDir("blobs");
  const bytes = pngBytes(4096);
  const digest = await run(
    Effect.gen(function* () {
      const { project, session } = yield* seeded(dir);
      const unstagedDigest = "sha256:" + "0".repeat(64);
      assert.deepEqual(rejectedCodes(yield* session.apply(assetEdit(1, unstagedDigest, 10))), [
        "missing-asset",
      ]);

      const wrong = yield* Effect.flip(
        session.putBlob({ bytes, mediaType: "image/png", digest: unstagedDigest }),
      );
      assert.ok(
        wrong._tag === "BlobRejected" && wrong.diagnostics.some((d) => d.path[0] === "digest"),
      );
      const lying = yield* Effect.flip(session.putBlob({ bytes, mediaType: "image/webp" }));
      assert.equal(lying._tag, "BlobRejected");
      const empty = yield* Effect.flip(
        session.putBlob({ bytes: new Uint8Array(), mediaType: "image/png" }),
      );
      assert.equal(empty._tag, "BlobRejected");

      const put = yield* session.putBlob({ bytes, mediaType: "image/png" });
      assert.equal(put.stored, "new");
      assert.equal((yield* session.putBlob({ bytes, mediaType: "image/png" })).stored, "existing");
      bytes[100] = (bytes[100] ?? 0) ^ 0xff; // the caller's buffer is not the stored one
      committed(yield* session.apply(assetEdit(1, put.digest, put.byteLength)));
      const read = yield* project.blob(put.digest);
      assert.equal(read.byteLength, 4096);
      assert.equal(
        (yield* Effect.flip(project.blob("sha256:" + "1".repeat(64))))._tag,
        "BlobMissing",
      );
      return put.digest;
    }),
  );
  // Rot the stored bytes: reads and verification detect it.
  const db = rawDb(dir);
  db.prepare("UPDATE blobs SET bytes = ? WHERE digest = ?").run(pngBytes(4096), digest);
  db.close();
  await run(
    Effect.gen(function* () {
      const project = yield* reopen(dir);
      const error = yield* Effect.flip(project.blob(digest));
      assert.ok(error._tag === "BlobMissing" && error.reason === "damaged");
      const report = yield* project.verify;
      assert.deepEqual(report.blobs.damaged, [digest]);
      assert.equal(report.ok, false);
    }),
  );
});

// ── Recovery across builds ──────────────────────────────────────────────────

test("a build without the document's generator reopens it read-only and still replays and sets policy", async () => {
  const dir = tempDir("retired");
  const ids = await run(
    Effect.gen(function* () {
      const { session, part } = yield* seeded(dir);
      const edit = rename(1, part, "Renamed");
      committed(yield* session.apply(edit));
      return { edit, part };
    }),
  );
  await run(
    Effect.gen(function* () {
      const project = yield* reopen(dir, retiredRegistry);
      const current = yield* project.current(docId);
      assert.equal(current.revision, 2);
      assert.equal(current.access.mode, "read-only");
      const session: Session = yield* project.session({ actor: human });
      assert.equal((yield* session.apply(ids.edit)).kind, "replayed");
      assert.ok(
        rejectedCodes(yield* session.apply(rename(2, ids.part, "No"))).includes("read-only"),
      );
      committed(yield* session.apply(request(2, { type: "policy.set", agentDirectEdit: true })));
    }),
  );
});
