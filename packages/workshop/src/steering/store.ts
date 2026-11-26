// The steering outbox: one SQLite file per project and OS account, next to the
// host's endpoint and pairings (`hosts/<key>/steering.sqlite`), never in the
// project directory. Routes name machine-local conversations, so a backup,
// archive or copy of the project never carries them.
//
// Only the project's host opens it, and only while it owns the project, so
// there is one writer. The file records the project ID it belongs to: a
// project replaced at the same path gets a fresh outbox, and the old file is
// kept aside, so no message is ever delivered on behalf of another project.

import { Schema } from "effect";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { Actor, decodeWith } from "@irudd/document";
import {
  RecipientRoute,
  steeringStatus,
  type DeliveryState,
  type HostReceipt,
  type ManualCursor,
  type Recipient,
  type RouteAvailability,
  type SteeringMessage,
} from "../wire/steering.js";

export const steeringFileName = "steering.sqlite";
const format = "irudd.workshop-steering";
const version = 2;

const deliveryStates: ReadonlyArray<DeliveryState> = [
  "pending",
  "dispatching",
  "accepted",
  "inbox-only",
  "unknown",
  "failed",
  "withdrawn",
];

const schema = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  `CREATE TABLE recipients (
     agent TEXT PRIMARY KEY,
     pairing_id TEXT NOT NULL,
     route TEXT NOT NULL,
     documents TEXT NOT NULL,
     bound_at INTEGER NOT NULL,
     bound_by TEXT NOT NULL,
     availability TEXT
   ) STRICT`,
  `CREATE TABLE messages (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     message_id TEXT NOT NULL UNIQUE,
     request_id TEXT NOT NULL,
     agent TEXT NOT NULL,
     pairing_id TEXT NOT NULL,
     document_id TEXT,
     text TEXT NOT NULL,
     cursor TEXT,
     created_at INTEGER NOT NULL,
     created_by TEXT NOT NULL,
     route TEXT NOT NULL,
     delivery_state TEXT NOT NULL CHECK (delivery_state IN (${deliveryStates.map((s) => `'${s}'`).join(", ")})),
     attempts INTEGER NOT NULL DEFAULT 0,
     last_attempt_at INTEGER,
     next_attempt_at INTEGER,
     receipt TEXT,
     detail TEXT,
     acknowledged TEXT,
     applied TEXT,
     closed TEXT,
     baseline TEXT,
     report TEXT,
     review TEXT,
     UNIQUE (agent, request_id)
   ) STRICT`,
  `CREATE INDEX messages_agent ON messages (agent, seq)`,
  `CREATE TABLE transitions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     message_id TEXT NOT NULL REFERENCES messages (message_id),
     at INTEGER NOT NULL,
     status TEXT NOT NULL,
     detail TEXT
   ) STRICT`,
  `CREATE TABLE cursors (
     agent TEXT NOT NULL,
     document_id TEXT NOT NULL,
     pairing_id TEXT NOT NULL,
     revision INTEGER NOT NULL,
     PRIMARY KEY (agent, document_id)
   ) STRICT`,
];

// ── Stored JSON ─────────────────────────────────────────────────────────────

const Receipt = Schema.Struct({
  transport: Schema.Literals(["claude-channel", "inbox"]),
  hostMessageId: Schema.optionalKey(Schema.String),
  runId: Schema.optionalKey(Schema.String),
  delivery: Schema.optionalKey(Schema.String),
  via: Schema.optionalKey(Schema.String),
  at: Schema.Number,
});
const Cursor = Schema.Struct({ documentId: Schema.String, since: Schema.Int, head: Schema.Int });
const Acknowledged = Schema.Struct({
  at: Schema.Number,
  agent: Schema.String,
  pairingId: Schema.String,
});
const ProposalRef = Schema.Struct({ id: Schema.String, version: Schema.Int });
const Report = Schema.Struct({
  at: Schema.Number,
  documentId: Schema.String,
  requestId: Schema.String,
  command: Schema.String,
  kind: Schema.Literals(["revision", "proposal"]),
  revision: Schema.Int,
  proposal: Schema.NullOr(ProposalRef),
});
const Review = Schema.Struct({
  proposalId: Schema.String,
  version: Schema.Int,
  state: Schema.Literals(["pending", "accepted", "discarded", "superseded"]),
  latestVersion: Schema.Int,
  decidedAt: Schema.NullOr(Schema.Number),
  decidedBy: Schema.NullOr(Actor),
  decisionRequestId: Schema.NullOr(Schema.String),
  acceptedRevision: Schema.NullOr(Schema.Int),
});
const Applied = Schema.Struct({
  at: Schema.Number,
  documentId: Schema.String,
  requestId: Schema.String,
  revision: Schema.Int,
  via: Schema.Literals(["direct", "proposal-accepted"]),
  proposal: Schema.NullOr(ProposalRef),
  acceptedBy: Schema.NullOr(Actor),
});
/** Each document's journal sequence when the message was sent. */
const Baseline = Schema.Record(Schema.String, Schema.Int);
export type Baseline = typeof Baseline.Type;
const Closed = Schema.Struct({
  at: Schema.Number,
  reason: Schema.Literals(["revoked", "cancelled"]),
  detail: Schema.String,
});
const Documents = Schema.Array(Schema.String);
const Availability = Schema.Struct({
  state: Schema.Literals([
    "ready",
    "inbox-only",
    "offline",
    "gone",
    "unbound",
    "unpaired",
    "unchecked",
  ]),
  push: Schema.Boolean,
  summary: Schema.String,
  checkedAt: Schema.Number,
  conversation: Schema.NullOr(
    Schema.Struct({
      status: Schema.optionalKey(Schema.String),
      busy: Schema.optionalKey(Schema.Boolean),
      provider: Schema.optionalKey(Schema.String),
      model: Schema.optionalKey(Schema.String),
      project: Schema.optionalKey(Schema.String),
    }),
  ),
});

export class SteeringStoreFailed extends Error {
  readonly _tag = "StorageFailed";
  readonly operation: string;
  constructor(operation: string, message: string) {
    super(`${operation}: ${message}`);
    this.operation = operation;
  }
}

type Row = Record<string, SQLOutputValue>;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new SteeringStoreFailed("read", `column ${key} is not text`);
  return value;
}
function optText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}
function int(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new SteeringStoreFailed("read", `column ${key} is not a number`);
}
function optInt(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return int(row, key);
}
function decodeJson<S extends Schema.Decoder<unknown>>(
  raw: string | null,
  codec: S,
  what: string,
): S["Type"] | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SteeringStoreFailed("read", `${what} is not JSON`);
  }
  const decoded = decodeWith(codec, value);
  if (!decoded.ok) throw new SteeringStoreFailed("read", `${what} has an unexpected shape`);
  return decoded.value;
}
function need<T>(value: T | null, what: string): T {
  if (value === null) throw new SteeringStoreFailed("read", `${what} is missing`);
  return value;
}
function deliveryState(raw: string): DeliveryState {
  const found = deliveryStates.find((state) => state === raw);
  if (!found) throw new SteeringStoreFailed("read", `unknown delivery state ${raw}`);
  return found;
}

export interface NewMessage {
  readonly messageId: string;
  readonly requestId: string;
  readonly agent: string;
  readonly pairingId: string;
  readonly documentId: string | null;
  readonly text: string;
  readonly cursor: ManualCursor | null;
  readonly createdAt: number;
  readonly createdBy: Actor;
  readonly route: RecipientRoute;
  readonly delivery: "pending" | "inbox-only";
  /** Each document's journal sequence at send: requests at or before it can never be linked. */
  readonly baseline: Baseline;
}

export interface MessagePatch {
  readonly delivery?: {
    readonly state: DeliveryState;
    readonly attempts?: number;
    readonly lastAttemptAt?: number | null;
    readonly nextAttemptAt?: number | null;
    readonly receipt?: HostReceipt | null;
    readonly detail?: string | null;
  };
  readonly acknowledged?: SteeringMessage["acknowledged"];
  readonly report?: SteeringMessage["report"];
  readonly review?: SteeringMessage["review"];
  readonly applied?: SteeringMessage["applied"];
  readonly closed?: SteeringMessage["closed"];
}

export interface OpenedStore {
  readonly store: SteeringStore;
  /** The file belonged to another project at this path; it was moved aside to this name. */
  readonly replaced: string | null;
}

export class SteeringStore {
  readonly file: string;
  private readonly db: DatabaseSync;
  private readonly now: () => number;

  private constructor(file: string, db: DatabaseSync, now: () => number) {
    this.file = file;
    this.db = db;
    this.now = now;
  }

  /** Open (or create) the outbox of `projectId` in `directory`. */
  static open(options: {
    readonly directory: string;
    readonly projectId: string;
    readonly now?: () => number;
  }): OpenedStore {
    const now = options.now ?? Date.now;
    const file = path.join(options.directory, steeringFileName);
    fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    let replaced: string | null = null;
    if (fs.existsSync(file)) {
      const owner = readProjectId(file);
      if (owner !== options.projectId) {
        replaced = path.join(options.directory, `steering.replaced-${now()}.sqlite`);
        for (const suffix of ["", "-wal", "-journal"])
          if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, replaced + suffix);
      }
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
      throw new SteeringStoreFailed("open", String(error));
    }
    const store = new SteeringStore(file, db, now);
    store.transaction(() => {
      if (fresh) {
        for (const statement of schema) db.exec(statement);
        const insert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
        insert.run("format", format);
        insert.run("version", String(version));
        insert.run("project_id", options.projectId);
        insert.run("created_at", String(now()));
      } else {
        const stored = db.prepare("SELECT value FROM meta WHERE key = 'version'").get();
        let storedVersion = stored ? Number(stored["value"]) : NaN;
        if (storedVersion === 1) {
          // Version 1 counted a linked proposal as applied. Keep each link as an
          // unresolved report with no baseline; the service re-checks it against the
          // journal on start and never marks it applied without a real revision.
          for (const column of ["baseline", "report", "review"])
            db.exec(`ALTER TABLE messages ADD COLUMN ${column} TEXT`);
          db.exec(`UPDATE messages SET report = json_object(
              'at', json_extract(applied, '$.at'),
              'documentId', json_extract(applied, '$.documentId'),
              'requestId', json_extract(applied, '$.requestId'),
              'command', 'unknown', 'kind', 'proposal',
              'revision', json_extract(applied, '$.revision'),
              'proposal', json('null')),
            applied = NULL WHERE applied IS NOT NULL`);
          db.prepare("UPDATE meta SET value = ? WHERE key = 'version'").run(String(version));
          storedVersion = version;
        }
        if (storedVersion !== version)
          throw new SteeringStoreFailed(
            "open",
            `${file} has steering format ${String(stored?.["value"])}; this build reads ${version}.`,
          );
      }
    });
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
    return { store, replaced };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private transaction<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = body();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // ── Recipients ──────────────────────────────────────────────────────────

  recipient(agent: string): Recipient | undefined {
    const row = this.db.prepare("SELECT * FROM recipients WHERE agent = ?").get(agent);
    return row ? toRecipient(row) : undefined;
  }

  recipients(): ReadonlyArray<Recipient> {
    return this.db.prepare("SELECT * FROM recipients ORDER BY agent").all().map(toRecipient);
  }

  bind(recipient: Recipient): void {
    this.db
      .prepare(
        `INSERT INTO recipients (agent, pairing_id, route, documents, bound_at, bound_by, availability)
         VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (agent) DO UPDATE SET pairing_id = excluded.pairing_id, route = excluded.route,
           documents = excluded.documents, bound_at = excluded.bound_at, bound_by = excluded.bound_by,
           availability = NULL`,
      )
      .run(
        recipient.agent,
        recipient.pairingId,
        JSON.stringify(recipient.route),
        JSON.stringify(recipient.documents),
        recipient.boundAt,
        JSON.stringify(recipient.boundBy),
      );
  }

  unbind(agent: string): boolean {
    const result = this.db.prepare("DELETE FROM recipients WHERE agent = ?").run(agent);
    return Number(result.changes) > 0;
  }

  availability(agent: string): RouteAvailability | undefined {
    const row = this.db.prepare("SELECT availability FROM recipients WHERE agent = ?").get(agent);
    if (!row) return undefined;
    return decodeJson(optText(row, "availability"), Availability, "availability") ?? undefined;
  }

  setAvailability(agent: string, availability: RouteAvailability): void {
    this.db
      .prepare("UPDATE recipients SET availability = ? WHERE agent = ?")
      .run(JSON.stringify(availability), agent);
  }

  // ── Messages ────────────────────────────────────────────────────────────

  message(messageId: string): SteeringMessage | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE message_id = ?").get(messageId);
    return row ? toMessage(row) : undefined;
  }

  byRequest(agent: string, requestId: string): SteeringMessage | undefined {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE agent = ? AND request_id = ?")
      .get(agent, requestId);
    return row ? toMessage(row) : undefined;
  }

  insert(message: NewMessage): SteeringMessage {
    return this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (message_id, request_id, agent, pairing_id, document_id, text, cursor,
             created_at, created_by, route, delivery_state, detail, baseline)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          message.messageId,
          message.requestId,
          message.agent,
          message.pairingId,
          message.documentId,
          message.text,
          message.cursor ? JSON.stringify(message.cursor) : null,
          message.createdAt,
          JSON.stringify(message.createdBy),
          JSON.stringify(message.route),
          message.delivery,
          message.delivery === "inbox-only"
            ? "This route has no push; the agent reads it from its inbox."
            : null,
          JSON.stringify(message.baseline),
        );
      const stored = this.must(message.messageId);
      this.transition(stored, null);
      return stored;
    });
  }

  /** Each document's journal sequence when the message was sent; empty for version 1 messages. */
  baseline(messageId: string): Baseline | null {
    const row = this.db
      .prepare("SELECT baseline FROM messages WHERE message_id = ?")
      .get(messageId);
    if (!row) return null;
    return decodeJson(optText(row, "baseline"), Baseline, "baseline");
  }

  /** Messages with a linked request that is not applied, closed or finally decided. */
  unresolved(documentId?: string): ReadonlyArray<SteeringMessage> {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE report IS NOT NULL AND applied IS NULL AND closed IS NULL
           AND (? IS NULL OR json_extract(report, '$.documentId') = ?) ORDER BY seq`,
      )
      .all(documentId ?? null, documentId ?? null);
    return rows.map(toMessage).filter((m) => m.review?.state !== "discarded");
  }

  /** Apply one change and record the resulting status, in one transaction. */
  update(messageId: string, patch: MessagePatch, detail: string | null = null): SteeringMessage {
    return this.transaction(() => {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      const set = (column: string, value: string | number | null) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      const delivery = patch.delivery;
      if (delivery) {
        set("delivery_state", delivery.state);
        if (delivery.attempts !== undefined) set("attempts", delivery.attempts);
        if (delivery.lastAttemptAt !== undefined) set("last_attempt_at", delivery.lastAttemptAt);
        if (delivery.nextAttemptAt !== undefined) set("next_attempt_at", delivery.nextAttemptAt);
        if (delivery.receipt !== undefined)
          set("receipt", delivery.receipt ? JSON.stringify(delivery.receipt) : null);
        if (delivery.detail !== undefined) set("detail", delivery.detail);
      }
      if (patch.acknowledged !== undefined)
        set("acknowledged", patch.acknowledged ? JSON.stringify(patch.acknowledged) : null);
      if (patch.report !== undefined)
        set("report", patch.report ? JSON.stringify(patch.report) : null);
      if (patch.review !== undefined)
        set("review", patch.review ? JSON.stringify(patch.review) : null);
      if (patch.applied !== undefined)
        set("applied", patch.applied ? JSON.stringify(patch.applied) : null);
      if (patch.closed !== undefined)
        set("closed", patch.closed ? JSON.stringify(patch.closed) : null);
      if (sets.length > 0)
        this.db
          .prepare(`UPDATE messages SET ${sets.join(", ")} WHERE message_id = ?`)
          .run(...values, messageId);
      const stored = this.must(messageId);
      this.transition(stored, detail);
      return stored;
    });
  }

  list(filter: {
    readonly agent?: string;
    readonly after?: number;
    readonly limit?: number;
    readonly unacknowledged?: boolean;
  }): ReadonlyArray<SteeringMessage> {
    const where: string[] = ["seq > ?"];
    const values: Array<string | number> = [filter.after ?? 0];
    if (filter.agent !== undefined) {
      where.push("agent = ?");
      values.push(filter.agent);
    }
    if (filter.unacknowledged) where.push("acknowledged IS NULL AND closed IS NULL");
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY seq LIMIT ${Math.max(1, Math.min(filter.limit ?? 500, 500))}`,
      )
      .all(...values)
      .map(toMessage);
  }

  lastSeq(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS last FROM messages").get();
    return row ? int(row, "last") : 0;
  }

  /** Each agent's oldest message that still waits for a push. */
  deliverable(): ReadonlyArray<SteeringMessage> {
    return this.db
      .prepare(
        `SELECT * FROM messages m WHERE seq = (
           SELECT MIN(seq) FROM messages o
           WHERE o.agent = m.agent AND o.delivery_state = 'pending'
             AND o.acknowledged IS NULL AND o.closed IS NULL)
         ORDER BY seq`,
      )
      .all()
      .map(toMessage);
  }

  /** Messages that were being sent when the host stopped. */
  inFlight(): ReadonlyArray<SteeringMessage> {
    return this.db
      .prepare("SELECT * FROM messages WHERE delivery_state = 'dispatching' ORDER BY seq")
      .all()
      .map(toMessage);
  }

  /** Messages of an agent that are neither acknowledged nor closed. */
  open(agent: string): ReadonlyArray<SteeringMessage> {
    return this.list({ agent, unacknowledged: true });
  }

  transitions(messageId: string): ReadonlyArray<{
    readonly at: number;
    readonly status: string;
    readonly detail: string | null;
  }> {
    return this.db
      .prepare("SELECT at, status, detail FROM transitions WHERE message_id = ? ORDER BY id")
      .all(messageId)
      .map((row) => ({
        at: int(row, "at"),
        status: text(row, "status"),
        detail: optText(row, "detail"),
      }));
  }

  // ── Manual-change cursors ──────────────────────────────────────────────

  cursor(agent: string, documentId: string, pairingId: string): number | undefined {
    const row = this.db
      .prepare("SELECT revision, pairing_id FROM cursors WHERE agent = ? AND document_id = ?")
      .get(agent, documentId);
    if (!row || text(row, "pairing_id") !== pairingId) return undefined;
    return int(row, "revision");
  }

  /** Move the cursor forward (never back). */
  advanceCursor(agent: string, documentId: string, pairingId: string, revision: number): void {
    this.db
      .prepare(
        `INSERT INTO cursors (agent, document_id, pairing_id, revision) VALUES (?, ?, ?, ?)
         ON CONFLICT (agent, document_id) DO UPDATE SET
           revision = CASE WHEN cursors.pairing_id = excluded.pairing_id
                           THEN MAX(cursors.revision, excluded.revision) ELSE excluded.revision END,
           pairing_id = excluded.pairing_id`,
      )
      .run(agent, documentId, pairingId, revision);
  }

  private must(messageId: string): SteeringMessage {
    const stored = this.message(messageId);
    if (!stored) throw new SteeringStoreFailed("read", `message ${messageId} vanished`);
    return stored;
  }

  private transition(message: SteeringMessage, detail: string | null): void {
    this.db
      .prepare("INSERT INTO transitions (message_id, at, status, detail) VALUES (?, ?, ?, ?)")
      .run(message.messageId, this.now(), message.status, detail);
  }
}

function readProjectId(file: string): string | null {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: 250 });
    const row = db.prepare("SELECT value FROM meta WHERE key = 'project_id'").get();
    return row ? optText(row, "value") : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function toRecipient(row: Row): Recipient {
  return {
    agent: text(row, "agent"),
    pairingId: text(row, "pairing_id"),
    route: need(decodeJson(text(row, "route"), RecipientRoute, "route"), "route"),
    documents: need(decodeJson(text(row, "documents"), Documents, "documents"), "documents"),
    boundAt: int(row, "bound_at"),
    boundBy: need(decodeJson(text(row, "bound_by"), Actor, "bound_by"), "bound_by"),
  };
}

function toMessage(row: Row): SteeringMessage {
  const delivery = {
    state: deliveryState(text(row, "delivery_state")),
    attempts: int(row, "attempts"),
    lastAttemptAt: optInt(row, "last_attempt_at"),
    nextAttemptAt: optInt(row, "next_attempt_at"),
    receipt: decodeJson(optText(row, "receipt"), Receipt, "receipt"),
    detail: optText(row, "detail"),
  };
  const acknowledged = decodeJson(optText(row, "acknowledged"), Acknowledged, "acknowledged");
  const report = decodeJson(optText(row, "report"), Report, "report");
  const review = decodeJson(optText(row, "review"), Review, "review");
  const applied = decodeJson(optText(row, "applied"), Applied, "applied");
  const closed = decodeJson(optText(row, "closed"), Closed, "closed");
  return {
    messageId: text(row, "message_id"),
    seq: int(row, "seq"),
    requestId: text(row, "request_id"),
    agent: text(row, "agent"),
    pairingId: text(row, "pairing_id"),
    documentId: optText(row, "document_id"),
    text: text(row, "text"),
    cursor: decodeJson(optText(row, "cursor"), Cursor, "cursor"),
    createdAt: int(row, "created_at"),
    createdBy: need(decodeJson(text(row, "created_by"), Actor, "created_by"), "created_by"),
    route: need(decodeJson(text(row, "route"), RecipientRoute, "route"), "route"),
    status: steeringStatus({ delivery, acknowledged, review, applied, closed }),
    delivery,
    acknowledged,
    report,
    review,
    applied,
    closed,
  };
}
