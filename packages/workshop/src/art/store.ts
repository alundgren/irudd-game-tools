import { Schema } from "effect";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { Actor, JsonValue, decodeWith, diagnosticCodes, type Diagnostic } from "@irudd/document";
import { ArtBrief, ArtReply, type ArtSubmissionState } from "../wire/art.js";

export const artFileName = "art.sqlite";
const format = "irudd.art-log";
const version = 2;

export class ArtStoreFailed extends Error {
  readonly _tag = "StorageFailed";
  readonly operation: string;
  constructor(operation: string, message: string) {
    super(message);
    this.operation = operation;
  }
}

const pendingTable = `CREATE TABLE pending (
     art_id TEXT NOT NULL REFERENCES requests (art_id),
     submission_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     by TEXT NOT NULL,
     via TEXT NOT NULL CHECK (via IN ('agent', 'person-import')),
     pairing_id TEXT,
     reply TEXT NOT NULL,
     reply_digest TEXT NOT NULL,
     files TEXT NOT NULL,
     translator TEXT NOT NULL,
     proposal TEXT NOT NULL,
     source TEXT NOT NULL,
     PRIMARY KEY (art_id, submission_id)
   ) STRICT`;

const schema = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  `CREATE TABLE requests (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     art_id TEXT NOT NULL UNIQUE,
     agent TEXT NOT NULL,
     pairing_id TEXT NOT NULL,
     request_id TEXT NOT NULL,
     message_id TEXT NOT NULL,
     document_id TEXT NOT NULL,
     brief TEXT NOT NULL,
     files TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     created_by TEXT NOT NULL,
     closed TEXT,
     UNIQUE (agent, request_id)
   ) STRICT`,
  `CREATE TABLE submissions (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     art_id TEXT NOT NULL REFERENCES requests (art_id),
     submission_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     by TEXT NOT NULL,
     via TEXT NOT NULL CHECK (via IN ('agent', 'person-import')),
     pairing_id TEXT,
     reply TEXT NOT NULL,
     reply_digest TEXT NOT NULL,
     files TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('proposed', 'recorded', 'rejected')),
     diagnostics TEXT NOT NULL,
     duplicate_of TEXT,
     translator TEXT,
     proposal TEXT,
     source TEXT NOT NULL,
     UNIQUE (art_id, submission_id)
   ) STRICT`,
  pendingTable,
];

const File = Schema.Struct({
  digest: Schema.String,
  mediaType: Schema.String,
  byteLength: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
});
export type StoredFile = typeof File.Type;
const Files = Schema.Array(File);
const Closed = Schema.Struct({ at: Schema.Number, detail: Schema.String });
const Proposal = Schema.Struct({
  id: Schema.String,
  version: Schema.Int,
  requestId: Schema.String,
  baseRevision: Schema.Int,
});
const Source = Schema.Struct({
  baseRevision: Schema.Int,
  headAtSubmit: Schema.Int,
  stale: Schema.Boolean,
});
const Diagnostics = Schema.Array(
  Schema.Struct({
    code: Schema.Literals(diagnosticCodes),
    path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
    message: Schema.String,
    detail: Schema.optionalKey(JsonValue),
  }),
);

export interface StoredRequest {
  readonly seq: number;
  readonly artId: string;
  readonly agent: string;
  readonly pairingId: string;
  readonly requestId: string;
  readonly messageId: string;
  readonly brief: ArtBrief;
  readonly files: ReadonlyArray<StoredFile>;
  readonly createdAt: number;
  readonly createdBy: Actor;
  readonly closed: { readonly at: number; readonly detail: string } | null;
}

export interface StoredSubmission {
  readonly seq: number;
  readonly artId: string;
  readonly submissionId: string;
  readonly at: number;
  readonly by: Actor;
  readonly via: "agent" | "person-import";
  readonly pairingId: string | null;
  readonly reply: ArtReply;
  readonly replyDigest: string;
  readonly files: ReadonlyArray<StoredFile>;
  readonly state: ArtSubmissionState;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly duplicateOf: string | null;
  readonly translator: string | null;
  readonly proposal: typeof Proposal.Type | null;
  readonly source: typeof Source.Type;
}

function decoded<S extends Schema.Decoder<unknown>>(
  s: S,
  text: SQLOutputValue,
  what: string,
): S["Type"] {
  if (typeof text !== "string") throw new ArtStoreFailed("read", `${what} is not stored as text.`);
  const result = decodeWith(s, JSON.parse(text));
  if (!result.ok)
    throw new ArtStoreFailed("read", `${what} in ${artFileName} does not match this build.`);
  return result.value;
}

const num = (v: SQLOutputValue): number => Number(v);
const str = (v: SQLOutputValue): string => String(v);

export class ArtStore {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(options: {
    readonly directory: string;
    readonly projectId: string;
    readonly now?: () => number;
  }): { readonly store: ArtStore; readonly replaced: string | null } {
    const now = options.now ?? Date.now;
    const file = path.join(options.directory, artFileName);
    fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    let replaced: string | null = null;
    if (fs.existsSync(file) && projectOf(file) !== options.projectId) {
      replaced = path.join(options.directory, `art.replaced-${now()}.sqlite`);
      for (const suffix of ["", "-wal", "-journal"])
        if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, replaced + suffix);
    }
    const fresh = !fs.existsSync(file);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 250 });
      db.exec("PRAGMA locking_mode = EXCLUSIVE");
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = FULL");
      db.exec("PRAGMA trusted_schema = OFF");
    } catch (error) {
      throw new ArtStoreFailed("open", String(error));
    }
    const store = new ArtStore(db);
    if (fresh) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of schema) db.exec(statement);
        const insert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
        insert.run("format", format);
        insert.run("version", String(version));
        insert.run("project_id", options.projectId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        db.close();
        throw new ArtStoreFailed("open", String(error));
      }
    } else {
      const stored = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
      if (Number(stored?.["value"]) === 1) {
        db.exec("BEGIN IMMEDIATE");
        try {
          db.exec(pendingTable);
          db.prepare("UPDATE meta SET value = ? WHERE key = 'version'").run(String(version));
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          db.close();
          throw new ArtStoreFailed("open", String(error));
        }
      } else if (Number(stored?.["value"]) !== version) {
        db.close();
        throw new ArtStoreFailed(
          "open",
          `${file} has art log version ${String(stored?.["value"])}; this build reads ${version}.`,
        );
      }
    }
    return { store, replaced };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  insertRequest(r: Omit<StoredRequest, "seq" | "closed">): StoredRequest {
    this.db
      .prepare(
        `INSERT INTO requests (art_id, agent, pairing_id, request_id, message_id, document_id, brief, files, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.artId,
        r.agent,
        r.pairingId,
        r.requestId,
        r.messageId,
        r.brief.documentId,
        JSON.stringify(r.brief),
        JSON.stringify(r.files),
        r.createdAt,
        JSON.stringify(r.createdBy),
      );
    const stored = this.request(r.artId);
    if (!stored) throw new ArtStoreFailed("write", `${r.artId} was not stored.`);
    return stored;
  }

  deleteRequest(artId: string): void {
    this.db.prepare("DELETE FROM requests WHERE art_id = ?").run(artId);
  }

  request(artId: string): StoredRequest | undefined {
    const row = this.db.prepare("SELECT * FROM requests WHERE art_id = ?").get(artId);
    return row ? requestOf(row) : undefined;
  }

  byMessage(messageId: string): StoredRequest | undefined {
    const row = this.db.prepare("SELECT * FROM requests WHERE message_id = ?").get(messageId);
    return row ? requestOf(row) : undefined;
  }

  requests(filter: { readonly agent?: string; readonly documentId?: string }): StoredRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM requests WHERE (?1 IS NULL OR agent = ?1) AND (?2 IS NULL OR document_id = ?2) ORDER BY seq`,
      )
      .all(filter.agent ?? null, filter.documentId ?? null);
    return rows.map(requestOf);
  }

  closeRequest(artId: string, closed: { readonly at: number; readonly detail: string }): void {
    this.db
      .prepare("UPDATE requests SET closed = ? WHERE art_id = ? AND closed IS NULL")
      .run(JSON.stringify(closed), artId);
  }

  insertSubmission(s: Omit<StoredSubmission, "seq">): StoredSubmission {
    this.db
      .prepare(
        `INSERT INTO submissions (art_id, submission_id, at, by, via, pairing_id, reply, reply_digest, files, state, diagnostics, duplicate_of, translator, proposal, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        s.artId,
        s.submissionId,
        s.at,
        JSON.stringify(s.by),
        s.via,
        s.pairingId,
        JSON.stringify(s.reply),
        s.replyDigest,
        JSON.stringify(s.files),
        s.state,
        JSON.stringify(s.diagnostics),
        s.duplicateOf,
        s.translator,
        s.proposal ? JSON.stringify(s.proposal) : null,
        JSON.stringify(s.source),
      );
    const stored = this.submission(s.artId, s.submissionId);
    if (!stored) throw new ArtStoreFailed("write", `${s.submissionId} was not stored.`);
    return stored;
  }

  insertPending(p: StoredPending): StoredPending {
    this.db
      .prepare(
        `INSERT INTO pending (art_id, submission_id, at, by, via, pairing_id, reply, reply_digest, files, translator, proposal, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.artId,
        p.submissionId,
        p.at,
        JSON.stringify(p.by),
        p.via,
        p.pairingId,
        JSON.stringify(p.reply),
        p.replyDigest,
        JSON.stringify(p.files),
        p.translator,
        JSON.stringify(p.proposal),
        JSON.stringify(p.source),
      );
    const stored = this.pendingOne(p.artId, p.submissionId);
    if (!stored) throw new ArtStoreFailed("write", `${p.submissionId} was not recorded.`);
    return stored;
  }

  pendingOne(artId: string, submissionId: string): StoredPending | undefined {
    const row = this.db
      .prepare("SELECT * FROM pending WHERE art_id = ? AND submission_id = ?")
      .get(artId, submissionId);
    return row ? pendingOf(row) : undefined;
  }

  pending(artId?: string): StoredPending[] {
    return this.db
      .prepare(
        `SELECT pending.* FROM pending JOIN requests USING (art_id)
         WHERE (?1 IS NULL OR art_id = ?1) ORDER BY requests.seq, pending.at, pending.submission_id`,
      )
      .all(artId ?? null)
      .map(pendingOf);
  }

  dropPending(artId: string, submissionId: string): void {
    this.db
      .prepare("DELETE FROM pending WHERE art_id = ? AND submission_id = ?")
      .run(artId, submissionId);
  }

  finishPending(artId: string, submissionId: string): StoredSubmission {
    const existing = this.submission(artId, submissionId);
    if (existing) {
      this.dropPending(artId, submissionId);
      return existing;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          `INSERT INTO submissions (art_id, submission_id, at, by, via, pairing_id, reply, reply_digest, files, state, diagnostics, duplicate_of, translator, proposal, source)
           SELECT art_id, submission_id, at, by, via, pairing_id, reply, reply_digest, files, 'proposed', '[]', NULL, translator, proposal, source
           FROM pending WHERE art_id = ? AND submission_id = ?`,
        )
        .run(artId, submissionId);
      this.dropPending(artId, submissionId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw new ArtStoreFailed("write", String(error));
    }
    const stored = this.submission(artId, submissionId);
    if (!stored) throw new ArtStoreFailed("write", `${submissionId} has no pending row.`);
    return stored;
  }

  submission(artId: string, submissionId: string): StoredSubmission | undefined {
    const row = this.db
      .prepare("SELECT * FROM submissions WHERE art_id = ? AND submission_id = ?")
      .get(artId, submissionId);
    return row ? submissionOf(row) : undefined;
  }

  submissions(artId: string): StoredSubmission[] {
    return this.db
      .prepare("SELECT * FROM submissions WHERE art_id = ? ORDER BY seq")
      .all(artId)
      .map(submissionOf);
  }
}

export interface StoredPending {
  readonly artId: string;
  readonly submissionId: string;
  readonly at: number;
  readonly by: Actor;
  readonly via: "agent" | "person-import";
  readonly pairingId: string | null;
  readonly reply: ArtReply;
  readonly replyDigest: string;
  readonly files: ReadonlyArray<StoredFile>;
  readonly translator: string;
  readonly proposal: typeof Proposal.Type;
  readonly source: typeof Source.Type;
}

function pendingOf(row: Record<string, SQLOutputValue>): StoredPending {
  const pairing = row["pairing_id"];
  return {
    artId: str(row["art_id"] ?? null),
    submissionId: str(row["submission_id"] ?? null),
    at: num(row["at"] ?? null),
    by: decoded(Actor, row["by"] ?? null, "A submitter"),
    via: row["via"] === "person-import" ? "person-import" : "agent",
    pairingId: typeof pairing === "string" ? pairing : null,
    reply: decoded(ArtReply, row["reply"] ?? null, "A reply"),
    replyDigest: str(row["reply_digest"] ?? null),
    files: decoded(Files, row["files"] ?? null, "Reply files"),
    translator: str(row["translator"] ?? null),
    proposal: decoded(Proposal, row["proposal"] ?? null, "A proposal link"),
    source: decoded(Source, row["source"] ?? null, "A submission source"),
  };
}

function projectOf(file: string): string | undefined {
  try {
    const db = new DatabaseSync(file, { readOnly: true, timeout: 250 });
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'project_id'").get();
      return row ? String(row["value"]) : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function requestOf(row: Record<string, SQLOutputValue>): StoredRequest {
  const closed = row["closed"];
  return {
    seq: num(row["seq"] ?? null),
    artId: str(row["art_id"] ?? null),
    agent: str(row["agent"] ?? null),
    pairingId: str(row["pairing_id"] ?? null),
    requestId: str(row["request_id"] ?? null),
    messageId: str(row["message_id"] ?? null),
    brief: decoded(ArtBrief, row["brief"] ?? null, "A brief"),
    files: decoded(Files, row["files"] ?? null, "Attachment sizes"),
    createdAt: num(row["created_at"] ?? null),
    createdBy: decoded(Actor, row["created_by"] ?? null, "A request's sender"),
    closed: closed === null || closed === undefined ? null : decoded(Closed, closed, "A closure"),
  };
}

function submissionOf(row: Record<string, SQLOutputValue>): StoredSubmission {
  const proposal = row["proposal"];
  const duplicate = row["duplicate_of"];
  const translator = row["translator"];
  const pairing = row["pairing_id"];
  const via = row["via"];
  const state = row["state"];
  return {
    seq: num(row["seq"] ?? null),
    artId: str(row["art_id"] ?? null),
    submissionId: str(row["submission_id"] ?? null),
    at: num(row["at"] ?? null),
    by: decoded(Actor, row["by"] ?? null, "A submitter"),
    via: via === "person-import" ? "person-import" : "agent",
    pairingId: typeof pairing === "string" ? pairing : null,
    reply: decoded(ArtReply, row["reply"] ?? null, "A reply"),
    replyDigest: str(row["reply_digest"] ?? null),
    files: decoded(Files, row["files"] ?? null, "Reply files"),
    state: state === "proposed" || state === "recorded" ? state : "rejected",
    diagnostics: decoded(Diagnostics, row["diagnostics"] ?? null, "Diagnostics"),
    duplicateOf: typeof duplicate === "string" ? duplicate : null,
    translator: typeof translator === "string" ? translator : null,
    proposal:
      proposal === null || proposal === undefined
        ? null
        : decoded(Proposal, proposal, "A proposal link"),
    source: decoded(Source, row["source"] ?? null, "A submission source"),
  };
}
