// The SQLite storage writer. One file per project holds every document's
// journal, a header row per document and the content-addressed blobs.
//
// Only the project service imports this module. It knows SQL, files and locks;
// it never interprets journal entries beyond the columns the service hands it.
//
// Ownership: the connection runs in SQLite's EXCLUSIVE locking mode, set before
// WAL is first entered, so no shared-memory index exists and the first write
// takes a file lock that is held until the connection closes or the process
// exits. A second service, in this or another process, cannot read or write the
// file meanwhile and fails to open with `ProjectLocked`.

import { SqliteClient } from "@effect/sql-sqlite-node";
import { Duration, Effect, Schema } from "effect";
import type { Scope } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import type { SqlError } from "effect/sql/SqlError";
import fs from "node:fs";
import path from "node:path";
import {
  ProjectExists,
  ProjectLocked,
  ProjectMissing,
  ProjectUnreadable,
  StorageFailed,
} from "../contract/errors.js";
import { projectFormat, projectVersion } from "../contract/project.js";

/** "irwd" — marks the file as a workshop project in SQLite's header. */
export const applicationId = 0x69727764;
/** Storage schema version, kept in `PRAGMA user_version` and in `meta.version`. */
export const schemaVersion = projectVersion;

const schema = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`,
  `CREATE TABLE documents (
     id TEXT PRIMARY KEY,
     last_sequence INTEGER NOT NULL CHECK (last_sequence >= 1),
     last_digest TEXT NOT NULL,
     label TEXT,
     revision INTEGER NOT NULL CHECK (revision >= 0),
     document_digest TEXT,
     updated_at INTEGER NOT NULL
   ) STRICT`,
  `CREATE TABLE journal (
     document_id TEXT NOT NULL REFERENCES documents (id),
     sequence INTEGER NOT NULL CHECK (sequence >= 1),
     digest TEXT NOT NULL,
     request_id TEXT NOT NULL,
     entry TEXT NOT NULL,
     committed_at INTEGER NOT NULL,
     PRIMARY KEY (document_id, sequence),
     UNIQUE (document_id, request_id)
   ) STRICT, WITHOUT ROWID`,
  `CREATE TABLE blobs (
     digest TEXT PRIMARY KEY,
     media_type TEXT NOT NULL,
     byte_length INTEGER NOT NULL CHECK (byte_length > 0),
     bytes BLOB NOT NULL,
     stored_at INTEGER NOT NULL
   ) STRICT`,
];

// ── Rows ────────────────────────────────────────────────────────────────────

const MetaRow = Schema.Struct({ key: Schema.String, value: Schema.String });
const DocumentRow = Schema.Struct({
  id: Schema.String,
  last_sequence: Schema.Number,
  last_digest: Schema.String,
  label: Schema.NullOr(Schema.String),
  revision: Schema.Number,
  document_digest: Schema.NullOr(Schema.String),
  updated_at: Schema.Number,
});
export type DocumentRow = typeof DocumentRow.Type;
const EntryRow = Schema.Struct({
  sequence: Schema.Number,
  digest: Schema.String,
  request_id: Schema.String,
  entry: Schema.String,
});
export type EntryRow = typeof EntryRow.Type;
const BlobMetaRow = Schema.Struct({
  digest: Schema.String,
  media_type: Schema.String,
  byte_length: Schema.Number,
});
export type BlobMetaRow = typeof BlobMetaRow.Type;
const BlobRow = Schema.Struct({
  media_type: Schema.String,
  byte_length: Schema.Number,
  bytes: Schema.Uint8Array,
});
const Returned = Schema.Struct({ id: Schema.String });
const ReturnedDigest = Schema.Struct({ digest: Schema.String });
const IntegrityRow = Schema.Struct({ integrity_check: Schema.String });
const Pragma = (name: string) => Schema.Struct({ [name]: Schema.Number });

export interface StoreMeta {
  readonly projectId: string;
  readonly label: string;
  readonly version: number;
  readonly createdAt: number;
}

export interface NewEntry {
  readonly sequence: number;
  readonly digest: string;
  readonly requestId: string;
  /** `canonicalJson(journalJson(entry))` */
  readonly text: string;
}

/** Non-authoritative header columns, kept so listing documents needs no journal. */
export interface HeaderCache {
  readonly label: string | null;
  readonly revision: number;
  readonly documentDigest: string | null;
}

export interface NewBlob {
  readonly digest: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface Store {
  readonly file: string;
  readonly meta: StoreMeta;
  readonly sqliteVersion: string;
  readonly listDocuments: Effect.Effect<ReadonlyArray<DocumentRow>, StorageFailed>;
  readonly header: (documentId: string) => Effect.Effect<DocumentRow | undefined, StorageFailed>;
  readonly entries: (documentId: string) => Effect.Effect<ReadonlyArray<EntryRow>, StorageFailed>;
  /**
   * Append one entry and move the document's header from `expected` to it, in
   * one transaction. `expected` is null for a document's first entry. When the
   * stored header is not `expected` (another writer moved it) nothing is
   * written and the call fails with `StorageFailed` operation `append-diverged`.
   * `beforeCommit` runs inside the transaction after the rows are written.
   */
  readonly append: (
    documentId: string,
    expected: { readonly sequence: number; readonly digest: string } | null,
    entry: NewEntry,
    cache: HeaderCache,
    beforeCommit: Effect.Effect<void>,
  ) => Effect.Effect<void, StorageFailed>;
  /** Write a whole document (an import) with its blobs, in one transaction. */
  readonly insertDocument: (
    documentId: string,
    entries: ReadonlyArray<NewEntry>,
    cache: HeaderCache,
    blobs: ReadonlyArray<NewBlob>,
  ) => Effect.Effect<{ readonly added: number; readonly existing: number }, StorageFailed>;
  readonly blobIndex: Effect.Effect<ReadonlyArray<BlobMetaRow>, StorageFailed>;
  /** Store verified bytes. Returns whether they were new. Stored blobs never change. */
  readonly putBlob: (blob: NewBlob) => Effect.Effect<"new" | "existing", StorageFailed>;
  readonly readBlob: (
    digest: string,
  ) => Effect.Effect<
    | { readonly mediaType: string; readonly byteLength: number; readonly bytes: Uint8Array }
    | undefined,
    StorageFailed
  >;
  /** Each stored blob in turn, without holding them all in memory. */
  readonly forEachBlob: (
    visit: (digest: string, bytes: Uint8Array) => void,
  ) => Effect.Effect<void, StorageFailed>;
  readonly integrityCheck: Effect.Effect<string, StorageFailed>;
  /** SQLite online backup of the whole file to `destination`. */
  readonly backup: (destination: string) => Effect.Effect<void, StorageFailed>;
}

export interface OpenStoreOptions {
  readonly file: string;
  /** Present to create a new file; absent to open an existing one. */
  readonly create?: StoreMeta;
  readonly lockTimeoutMs: number;
  readonly durability: "full" | "normal";
}

// ── Errors ──────────────────────────────────────────────────────────────────

function sqliteCode(error: SqlError): number | undefined {
  const cause: unknown = error.reason.cause;
  if (typeof cause !== "object" || cause === null) return undefined;
  const code: unknown = Reflect.get(cause, "errcode");
  return typeof code === "number" ? code : undefined;
}

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

function failed(operation: string) {
  return (error: SqlError) =>
    new StorageFailed({ operation, message: `${operation}: ${error.message}`, cause: error });
}

function decodeRows<S extends Schema.Top & { readonly DecodingServices: never }>(
  row: S,
  operation: string,
) {
  const decode = Schema.decodeUnknownEffect(Schema.Array(row));
  return (rows: unknown) =>
    decode(rows).pipe(
      Effect.mapError(
        (error) =>
          new StorageFailed({
            operation,
            message: `${operation}: stored rows have an unexpected shape: ${error.message}`,
            cause: error,
          }),
      ),
    );
}

// ── Opening ─────────────────────────────────────────────────────────────────

export const openStore = (
  options: OpenStoreOptions,
): Effect.Effect<
  Store,
  ProjectMissing | ProjectExists | ProjectLocked | ProjectUnreadable | StorageFailed,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const memory = options.file === ":memory:";
    const file = memory ? options.file : path.resolve(options.file);
    const exists = !memory && fs.existsSync(file);
    if (options.create && exists)
      return yield* new ProjectExists({
        path: file,
        message: `A project already exists at ${file}.`,
      });
    if (!options.create && !exists)
      return yield* new ProjectMissing({ path: file, message: `No project at ${file}.` });
    if (options.create && !memory)
      yield* Effect.try({
        try: () => fs.mkdirSync(path.dirname(file), { recursive: true }),
        catch: (cause) =>
          new StorageFailed({ operation: "create-directory", message: String(cause), cause }),
      });

    const openFailure = (error: SqlError) => {
      const code = sqliteCode(error);
      if (
        error.reason._tag === "LockTimeoutError" ||
        code === SQLITE_BUSY ||
        code === SQLITE_LOCKED
      )
        return new ProjectLocked({
          path: file,
          message: `Another workshop service owns ${file}. Close it, or connect to it instead.`,
        });
      if (code === SQLITE_NOTADB || code === SQLITE_CORRUPT)
        return new ProjectUnreadable({
          path: file,
          reason: code === SQLITE_NOTADB ? "not-a-project" : "damaged",
          message: `${file} is not a readable SQLite database: ${error.message}`,
        });
      return new StorageFailed({ operation: "open", message: error.message, cause: error });
    };

    const sql = yield* Effect.flatMap(Reactivity.make, (reactivity) =>
      SqliteClient.make({
        filename: file,
        // WAL is entered below, after EXCLUSIVE locking mode is set.
        disableWAL: true,
        busyTimeout: Duration.millis(Math.max(0, options.lockTimeoutMs)),
      }).pipe(Effect.provideService(Reactivity.Reactivity, reactivity)),
    ).pipe(Effect.mapError(openFailure));

    const exec = (statement: string) => sql.unsafe(statement);
    yield* exec("PRAGMA locking_mode = EXCLUSIVE").pipe(Effect.mapError(openFailure));
    yield* exec("PRAGMA journal_mode = WAL").pipe(Effect.mapError(openFailure));
    yield* exec(`PRAGMA synchronous = ${options.durability === "normal" ? "NORMAL" : "FULL"}`).pipe(
      Effect.mapError(openFailure),
    );
    yield* exec("PRAGMA foreign_keys = ON").pipe(Effect.mapError(openFailure));
    yield* exec("PRAGMA trusted_schema = OFF").pipe(Effect.mapError(openFailure));

    const pragmaNumber = (name: string) =>
      exec(`PRAGMA ${name}`).pipe(
        Effect.mapError(openFailure),
        Effect.flatMap(decodeRows(Pragma(name), `read ${name}`)),
        Effect.map((rows) => {
          const value: unknown = rows[0]?.[name];
          return typeof value === "number" ? value : 0;
        }),
      );

    const now = Date.now();
    const owner = JSON.stringify({ pid: process.pid, openedAt: now });

    // The first write takes the exclusive lock, and keeps it.
    const meta = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          if (options.create) {
            for (const statement of schema) yield* exec(statement);
            yield* exec(`PRAGMA application_id = ${applicationId}`);
            yield* exec(`PRAGMA user_version = ${schemaVersion}`);
            const created = options.create;
            const rows: ReadonlyArray<readonly [string, string]> = [
              ["format", projectFormat],
              ["version", String(schemaVersion)],
              ["project_id", created.projectId],
              ["label", created.label],
              ["created_at", String(created.createdAt)],
            ];
            for (const [key, value] of rows)
              yield* sql`INSERT INTO meta (key, value) VALUES (${key}, ${value})`;
          } else {
            const app = yield* pragmaNumber("application_id");
            if (app !== applicationId)
              return yield* new ProjectUnreadable({
                path: file,
                reason: "not-a-project",
                message: `${file} is a SQLite file but not a workshop project.`,
              });
          }
          const stored = yield* sql`SELECT key, value FROM meta`.pipe(
            Effect.flatMap(decodeRows(MetaRow, "read meta")),
          );
          const value = (key: string) => stored.find((row) => row.key === key)?.value;
          const version = Number(value("version"));
          if (value("format") !== projectFormat || !Number.isInteger(version))
            return yield* new ProjectUnreadable({
              path: file,
              reason: "not-a-project",
              message: `${file} has no workshop project header.`,
            });
          if (version > schemaVersion)
            return yield* new ProjectUnreadable({
              path: file,
              reason: "newer-format",
              message: `${file} was written by a newer build (project format ${version}); this build reads ${schemaVersion}.`,
            });
          yield* sql`INSERT INTO meta (key, value) VALUES ('owner', ${owner})
                     ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
          return {
            projectId: value("project_id") ?? "",
            label: value("label") ?? "",
            version,
            createdAt: Number(value("created_at") ?? 0),
          } satisfies StoreMeta;
        }),
      )
      .pipe(Effect.catchTag("SqlError", (error) => Effect.fail(openFailure(error))));

    const versionRows = yield* sql`SELECT sqlite_version() AS v`.pipe(
      Effect.mapError(failed("sqlite-version")),
      Effect.flatMap(decodeRows(Schema.Struct({ v: Schema.String }), "sqlite-version")),
    );
    const sqliteVersion = versionRows[0]?.v ?? "unknown";

    const listDocuments =
      sql`SELECT id, last_sequence, last_digest, label, revision, document_digest, updated_at
                              FROM documents ORDER BY id`.pipe(
        Effect.mapError(failed("list-documents")),
        Effect.flatMap(decodeRows(DocumentRow, "list-documents")),
      );

    const header = (documentId: string) =>
      sql`SELECT id, last_sequence, last_digest, label, revision, document_digest, updated_at
          FROM documents WHERE id = ${documentId}`.pipe(
        Effect.mapError(failed("read-header")),
        Effect.flatMap(decodeRows(DocumentRow, "read-header")),
        Effect.map((rows) => rows[0]),
      );

    const entries = (documentId: string) =>
      sql`SELECT sequence, digest, request_id, entry FROM journal
          WHERE document_id = ${documentId} ORDER BY sequence`.pipe(
        Effect.mapError(failed("read-journal")),
        Effect.flatMap(decodeRows(EntryRow, "read-journal")),
      );

    const insertEntry = (documentId: string, entry: NewEntry, at: number) =>
      sql`INSERT INTO journal (document_id, sequence, digest, request_id, entry, committed_at)
          VALUES (${documentId}, ${entry.sequence}, ${entry.digest}, ${entry.requestId}, ${entry.text}, ${at})`;

    const append: Store["append"] = (documentId, expected, entry, cache, beforeCommit) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const at = Date.now();
            if (expected === null) {
              yield* sql`INSERT INTO documents (id, last_sequence, last_digest, label, revision, document_digest, updated_at)
                         VALUES (${documentId}, ${entry.sequence}, ${entry.digest}, ${cache.label},
                                 ${cache.revision}, ${cache.documentDigest}, ${at})`;
            } else {
              const moved = yield* sql`UPDATE documents
                  SET last_sequence = ${entry.sequence}, last_digest = ${entry.digest}, label = ${cache.label},
                      revision = ${cache.revision}, document_digest = ${cache.documentDigest}, updated_at = ${at}
                  WHERE id = ${documentId} AND last_sequence = ${expected.sequence} AND last_digest = ${expected.digest}
                  RETURNING id`.pipe(Effect.flatMap(decodeRows(Returned, "append")));
              if (moved.length !== 1)
                return yield* new StorageFailed({
                  operation: "append-diverged",
                  message: `The stored journal of ${documentId} is not at sequence ${expected.sequence}; another writer changed it.`,
                });
            }
            yield* insertEntry(documentId, entry, at);
            yield* beforeCommit;
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.fail(failed("append")(error))));

    const storeBlob = (blob: NewBlob) =>
      sql`INSERT INTO blobs (digest, media_type, byte_length, bytes, stored_at)
          VALUES (${blob.digest}, ${blob.mediaType}, ${blob.bytes.length}, ${blob.bytes}, ${Date.now()})
          ON CONFLICT (digest) DO NOTHING RETURNING digest`.pipe(
        Effect.flatMap(decodeRows(ReturnedDigest, "put-blob")),
        Effect.map((rows): "new" | "existing" => (rows.length === 1 ? "new" : "existing")),
      );

    const insertDocument: Store["insertDocument"] = (documentId, list, cache, blobs) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            let added = 0;
            for (const blob of blobs) if ((yield* storeBlob(blob)) === "new") added += 1;
            const last = list[list.length - 1];
            if (!last)
              return yield* new StorageFailed({
                operation: "import",
                message: "An import needs entries.",
              });
            const at = Date.now();
            yield* sql`INSERT INTO documents (id, last_sequence, last_digest, label, revision, document_digest, updated_at)
                       VALUES (${documentId}, ${last.sequence}, ${last.digest}, ${cache.label},
                               ${cache.revision}, ${cache.documentDigest}, ${at})`;
            for (const entry of list) yield* insertEntry(documentId, entry, at);
            return { added, existing: blobs.length - added };
          }),
        )
        .pipe(Effect.catchTag("SqlError", (error) => Effect.fail(failed("import")(error))));

    const blobIndex = sql`SELECT digest, media_type, byte_length FROM blobs`.pipe(
      Effect.mapError(failed("blob-index")),
      Effect.flatMap(decodeRows(BlobMetaRow, "blob-index")),
    );

    const putBlob = (blob: NewBlob) =>
      sql
        .withTransaction(storeBlob(blob))
        .pipe(Effect.catchTag("SqlError", (error) => Effect.fail(failed("put-blob")(error))));

    const readBlob = (digest: string) =>
      sql`SELECT media_type, byte_length, bytes FROM blobs WHERE digest = ${digest}`.pipe(
        Effect.mapError(failed("read-blob")),
        Effect.flatMap(decodeRows(BlobRow, "read-blob")),
        Effect.map((rows) => {
          const row = rows[0];
          return row
            ? { mediaType: row.media_type, byteLength: row.byte_length, bytes: row.bytes }
            : undefined;
        }),
      );

    const forEachBlob = (visit: (digest: string, bytes: Uint8Array) => void) =>
      Effect.gen(function* () {
        const list = yield* blobIndex;
        for (const item of list) {
          const blob = yield* readBlob(item.digest);
          if (blob) visit(item.digest, blob.bytes);
        }
      });

    const integrityCheck = exec("PRAGMA integrity_check").pipe(
      Effect.mapError(failed("integrity-check")),
      Effect.flatMap(decodeRows(IntegrityRow, "integrity-check")),
      Effect.map((rows) => rows.map((row) => row.integrity_check).join("; ")),
    );

    const backup = (destination: string) =>
      sql.backup(destination).pipe(Effect.asVoid, Effect.mapError(failed("backup")));

    return {
      file,
      meta,
      sqliteVersion,
      listDocuments,
      header,
      entries,
      append,
      insertDocument,
      blobIndex,
      putBlob,
      readBlob,
      forEachBlob,
      integrityCheck,
      backup,
    } satisfies Store;
  });
