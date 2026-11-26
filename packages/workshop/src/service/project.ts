// The project service: the single authoritative writer of one project.
//
// Every write runs `reduce` on the document's current state, appends the
// committed journal entry and the document header in one SQLite transaction,
// and only then publishes the new state. A rejection or a replay writes
// nothing. When the append fails, its outcome is unknown, so the cached state
// is dropped and the next use recovers the document from disk; a retry with
// the same request ID then commits once or replays the original receipt.
//
// Concurrency: one permit guards every write, every cache fill and backups.
// Reads use the immutable published state without waiting. Across processes,
// the store's exclusive file lock makes this service the only one.

import {
  Actor,
  canonicalJson,
  changesSince,
  diagnostic,
  diffRevisions,
  Digest,
  DocumentId,
  documentAccess,
  documentDigest,
  documentJson,
  emptyState,
  isJson,
  isUndone,
  journalJson,
  openJournal,
  previewProposal,
  readDocument,
  reduce,
  type Access,
  type CatalogId,
  type Diagnostic,
  type DocumentState,
  type Environment,
  type RevisionRecord,
  type StoredAsset,
} from "@irudd/document";
import { Effect, Result, Schema, Semaphore } from "effect";
import type { Scope } from "effect";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ArchiveRejected,
  BlobMissing,
  BlobRejected,
  DocumentExists,
  DocumentMissing,
  InvalidArgument,
  JournalDamaged,
  ProjectClosed,
  ProjectExists,
  ProjectMissing,
  StorageFailed,
  type ProjectError,
} from "../contract/errors.js";
import {
  projectFileName,
  projectFormat,
  type AccessView,
  type ApplyResult,
  type BackupReport,
  type Caller,
  type CharacterSaveReport,
  type ChangesView,
  type CreateProjectOptions,
  type CurrentView,
  type DiffView,
  type DraftView,
  type RevisionView,
  type HistoryItem,
  type ImportReport,
  type InspectView,
  type JournalPosition,
  type OpenProjectOptions,
  type Project,
  type RestoreProjectOptions,
  type RevisionDelta,
  type Session,
  type VerifyReport,
} from "../contract/project.js";
import { openStore, type Store, type StoreMeta } from "../storage/store.js";
import type { ArchiveBlob } from "./archive.js";
import { decodeAnyArchive, encodePackage, summarize } from "./package.js";
import { checkBlob, isDigest, sha256 } from "./blobs.js";
import { headerCache, recoverDocument, referencedAssets, type Loaded } from "./recover.js";
import { verifyStore } from "./verify.js";

/**
 * Test-only fault points. `beforeCommit` runs inside the append transaction
 * after the rows are written; `afterCommit` runs after the commit and after the
 * new state is published, before the result is returned.
 */
export interface ServiceHooks {
  readonly beforeCommit?: (documentId: string, sequence: number) => void;
  readonly afterCommit?: (documentId: string, sequence: number) => void;
}

const decodeDocumentId = Schema.decodeUnknownResult(DocumentId);
const decodeActor = Schema.decodeUnknownResult(Actor, { onExcessProperty: "error" });

const defaultLockTimeoutMs = 250;

function projectFile(directory: string): string {
  return path.join(path.resolve(directory), projectFileName);
}

function accessView(access: Access): AccessView {
  return { mode: access.mode, diagnostics: access.mode === "writable" ? [] : access.diagnostics };
}

function historyItem(state: DocumentState, r: RevisionRecord): HistoryItem {
  return {
    revision: r.revision,
    kind: r.kind,
    actor: r.actor,
    author: r.author,
    requestId: r.requestId,
    digest: r.digest,
    ...(r.summary !== undefined ? { summary: r.summary } : {}),
    ...(r.undoes !== undefined ? { undoes: r.undoes } : {}),
    ...(r.restores !== undefined ? { restores: r.restores } : {}),
    ...(r.proposal !== undefined ? { proposal: r.proposal } : {}),
    undone: isUndone(state, r.revision),
    changeCount: r.changes.length,
  };
}

function rejection(diagnostics: ReadonlyArray<Diagnostic>): ApplyResult {
  return { kind: "rejected", diagnostics };
}

const sameActor = (a: Actor, b: Actor): boolean =>
  a.kind === b.kind && a.id === b.id && a.name === b.name;

// ── Opening ─────────────────────────────────────────────────────────────────

/** Create a new project directory and open it. The directory must not hold a project. */
export const createProject = (
  options: CreateProjectOptions,
): Effect.Effect<Project, ProjectError, Scope.Scope> =>
  openWith(options, { create: options.label, inMemory: options.inMemory === true }, {});

/** Open an existing project. Fails with `ProjectLocked` while another service owns it. */
export const openProject = (
  options: OpenProjectOptions,
): Effect.Effect<Project, ProjectError, Scope.Scope> => openWith(options, {}, {});

/** For tests: open with fault points. */
export const openProjectWithHooks = (
  options: OpenProjectOptions & { readonly create?: string },
  hooks: ServiceHooks,
): Effect.Effect<Project, ProjectError, Scope.Scope> =>
  openWith(options, options.create !== undefined ? { create: options.create } : {}, hooks);

const openWith = (
  options: OpenProjectOptions,
  mode: { readonly create?: string; readonly inMemory?: boolean },
  hooks: ServiceHooks,
): Effect.Effect<Project, ProjectError, Scope.Scope> =>
  Effect.gen(function* () {
    const file = mode.inMemory ? ":memory:" : projectFile(options.path);
    const created: StoreMeta | undefined =
      mode.create !== undefined
        ? { projectId: randomUUID(), label: mode.create, version: 1, createdAt: Date.now() }
        : undefined;
    const store = yield* openStore({
      file,
      ...(created ? { create: created } : {}),
      lockTimeoutMs: options.lockTimeoutMs ?? defaultLockTimeoutMs,
      durability: options.durability ?? "full",
    });
    // Added after the store, so it runs first when the scope closes.
    let closed = false;
    yield* Effect.addFinalizer(() => Effect.sync(() => (closed = true)));
    return yield* makeProject(store, options, hooks, () => closed);
  });

// ── The project ─────────────────────────────────────────────────────────────

const makeProject = (
  store: Store,
  options: OpenProjectOptions,
  hooks: ServiceHooks,
  isClosed: () => boolean,
): Effect.Effect<Project, StorageFailed> =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1);
    const catalogEntries = options.catalog ?? [];
    const catalog = new Map<CatalogId, Digest>(catalogEntries);
    const blobs = new Map<string, StoredAsset>();
    const cache = new Map<string, Loaded>();

    const loadBlobIndex = Effect.gen(function* () {
      const rows = yield* store.blobIndex;
      blobs.clear();
      for (const row of rows)
        blobs.set(row.digest, { byteLength: row.byte_length, mediaType: row.media_type });
    });
    yield* loadBlobIndex;

    const env: Environment = {
      registry: options.registry,
      assets: { lookup: (digest) => blobs.get(digest) },
      catalog: { lookup: (id) => catalog.get(id) },
    };

    const open = Effect.suspend(() =>
      isClosed()
        ? Effect.fail(new ProjectClosed({ message: "The project is closed. Open it again." }))
        : Effect.void,
    );

    /** Cached state, or recovery from disk. Call with the permit held. */
    const loadHeld = (documentId: DocumentId) =>
      Effect.suspend(() => {
        const known = cache.get(documentId);
        if (known) return Effect.succeed(known);
        return recoverDocument(store, documentId, env, emptyState).pipe(
          Effect.tap((loaded) => Effect.sync(() => cache.set(documentId, loaded))),
        );
      });

    const load = (documentId: DocumentId) =>
      Effect.suspend(() => {
        const known = cache.get(documentId);
        return known ? Effect.succeed(known) : lock.withPermit(loadHeld(documentId));
      });

    const documentIdArg = (value: string) => {
      const id = decodeDocumentId(value);
      return Result.isSuccess(id)
        ? Effect.succeed(id.success)
        : Effect.fail(
            new InvalidArgument({
              path: ["documentId"],
              message: `${value} is not a document ID.`,
            }),
          );
    };

    /** A created document's state, for reads. */
    const existing = (documentIdText: string) =>
      Effect.gen(function* () {
        yield* open;
        const documentId = yield* documentIdArg(documentIdText);
        const loaded = yield* load(documentId);
        if (loaded.position === null)
          return yield* new DocumentMissing({
            documentId,
            message: `The project holds no document ${documentId}.`,
          });
        return loaded;
      });

    const currentOf = (loaded: Loaded): CurrentView => {
      const { state } = loaded;
      const head = state.history[state.head - 1];
      return {
        documentId: state.documentId,
        revision: state.head,
        document: state.document ?? null,
        documentDigest: head?.digest ?? null,
        access: accessView(documentAccess(state, env)),
        policy: state.policy,
        journal: loaded.position,
      };
    };

    // ── Writes ──────────────────────────────────────────────────────────────

    const apply = (
      caller: Caller,
      request: unknown,
    ): Effect.Effect<ApplyResult, StorageFailed | JournalDamaged | ProjectClosed> =>
      Effect.gen(function* () {
        yield* open;
        if (typeof request !== "object" || request === null || Array.isArray(request))
          return rejection([diagnostic("schema", [], "A command envelope is a JSON object.")]);
        const fields: Record<string, unknown> = Object.fromEntries(Object.entries(request));
        const named = fields["actor"];
        if (named !== undefined) {
          const actor = decodeActor(named);
          if (Result.isFailure(actor) || !sameActor(actor.success, caller.actor))
            return rejection([
              diagnostic(
                "forbidden",
                ["actor"],
                `This session acts as ${caller.actor.kind} ${caller.actor.id}; a request cannot name another actor.`,
              ),
            ]);
        }
        const documentId = decodeDocumentId(fields["documentId"]);
        if (Result.isFailure(documentId))
          return rejection([
            diagnostic("schema", ["documentId"], "The request names no valid document ID."),
          ]);
        const id = documentId.success;
        const envelope = { ...fields, actor: caller.actor };

        return yield* lock.withPermit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* open;
              const loaded = yield* loadHeld(id);
              const step = reduce(loaded.state, envelope, env);
              const outcome = step.outcome;
              if (outcome.kind === "rejected") return rejection(outcome.diagnostics);
              if (outcome.kind === "replayed")
                return { kind: "replayed", receipt: outcome.receipt } as const;
              const entry = outcome.entry;
              const position: JournalPosition = { sequence: entry.sequence, digest: entry.digest };
              yield* (
                store
                  .append(
                    id,
                    loaded.position,
                    {
                      sequence: entry.sequence,
                      digest: entry.digest,
                      requestId: entry.receipt.requestId,
                      text: canonicalJson(journalJson(entry)),
                    },
                    headerCache(step.state),
                    Effect.sync(() => hooks.beforeCommit?.(id, entry.sequence)),
                  )
                  // Failed or died: the commit's outcome is unknown, so recover from disk next time.
                  .pipe(Effect.onError(() => Effect.sync(() => cache.delete(id))))
              );
              cache.set(id, { state: step.state, position });
              hooks.afterCommit?.(id, entry.sequence);
              return {
                kind: "committed",
                receipt: outcome.receipt,
                entry: position,
                access: accessView(documentAccess(step.state, env)),
              } as const;
            }),
          ),
        );
      });

    const putBlob: Session["putBlob"] = (input) =>
      Effect.gen(function* () {
        yield* open;
        // Verify a private copy, so later changes to the caller's buffer cannot reach the store.
        const bytes = input.bytes instanceof Uint8Array ? new Uint8Array(input.bytes) : input.bytes;
        const check = checkBlob({ bytes, mediaType: input.mediaType, digest: input.digest });
        if (!check.ok)
          return yield* new BlobRejected({
            diagnostics: check.diagnostics,
            message: check.diagnostics.map((d) => d.message).join(" "),
          });
        return yield* lock.withPermit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* open;
              const stored = yield* store.putBlob({
                digest: check.digest,
                mediaType: check.mediaType,
                bytes,
              });
              blobs.set(check.digest, { byteLength: bytes.length, mediaType: check.mediaType });
              return {
                digest: check.digest,
                mediaType: check.mediaType,
                byteLength: bytes.length,
                stored,
              } as const;
            }),
          ),
        );
      });

    const importArchive: Session["importArchive"] = (bytes) =>
      Effect.gen(function* () {
        yield* open;
        const decoded = decodeAnyArchive(bytes);
        if (Result.isFailure(decoded)) return yield* decoded.failure;
        const archive = decoded.success;
        const id = decodeDocumentId(archive.documentId);
        if (Result.isFailure(id))
          return yield* new ArchiveRejected({
            path: ["documentId"],
            diagnostics: [
              diagnostic("schema", ["documentId"], "The archive names no valid document ID."),
            ],
            message: "The archive names no valid document ID.",
          });
        const documentId = id.success;
        const incoming = new Map(archive.blobs.map((b) => [b.digest, b] as const));
        const importEnv: Environment = {
          ...env,
          assets: {
            lookup: (digest) => {
              const local = blobs.get(digest);
              if (local) return local;
              const blob = incoming.get(digest);
              return blob
                ? { byteLength: blob.bytes.length, mediaType: blob.mediaType }
                : undefined;
            },
          },
        };
        // A package's document.json is checked first against this build and
        // project: features, part, pose and artwork references, catalogs.
        const checkHead = (raw: unknown, at: ReadonlyArray<string | number>) => {
          const checked = readDocument(raw, { registry: options.registry, environment: importEnv });
          if (checked.ok) return undefined;
          const diagnostics = checked.diagnostics.map((d) => ({ ...d, path: [...at, ...d.path] }));
          return new ArchiveRejected({
            path: at,
            diagnostics,
            message: summarize("The character cannot open in this project:", diagnostics),
          });
        };
        if ("document" in archive) {
          const problem = checkHead(archive.document, ["document.json"]);
          if (problem) return yield* problem;
        }
        const recovery = openJournal(documentId, archive.journal, importEnv, {
          last: archive.last,
        });
        if (!recovery.ok)
          return yield* new ArchiveRejected({
            path: ["journal", recovery.index],
            diagnostics: recovery.diagnostics,
            message: `The archived journal does not recover at entry ${recovery.index + 1}.`,
          });
        const state = recovery.state;
        const head = state.document;
        if (!head)
          return yield* new ArchiveRejected({
            path: ["journal"],
            diagnostics: [
              diagnostic("schema", ["journal"], "The archive holds no document revision."),
            ],
            message: "The archive holds no document revision.",
          });
        if ("document" in archive) {
          const { manifest } = archive;
          const raw = archive.document;
          const mismatch =
            !isJson(raw) || canonicalJson(raw) !== canonicalJson(documentJson(head))
              ? "document.json is not the head of history.jsonl."
              : manifest.revision !== state.head || manifest.digest !== documentDigest(head)
                ? `The manifest names revision ${manifest.revision} (${manifest.digest}); the history ends at revision ${state.head} (${documentDigest(head)}).`
                : undefined;
          if (mismatch)
            return yield* new ArchiveRejected({
              path: ["document.json"],
              diagnostics: [diagnostic("journal-integrity", ["document.json"], mismatch)],
              message: mismatch,
            });
        } else {
          const problem = checkHead(documentJson(head), ["document"]);
          if (problem) return yield* problem;
        }
        const missing: Diagnostic[] = [];
        for (const [digest, revision] of referencedAssets(state))
          if (!blobs.has(digest) && !incoming.has(digest))
            missing.push(
              diagnostic(
                "missing-asset",
                ["assets", digest],
                `Revision ${revision} references ${digest}, which the archive lacks.`,
              ),
            );
        if (missing.length)
          return yield* new ArchiveRejected({
            path: ["blobs"],
            diagnostics: missing,
            message: "The archive lacks artwork its revisions reference.",
          });
        const entries = state.journal.map((entry) => ({
          sequence: entry.sequence,
          digest: entry.digest,
          requestId: entry.receipt.requestId,
          text: canonicalJson(journalJson(entry)),
        }));
        const last = state.journal[state.journal.length - 1];
        if (!last)
          return yield* new ArchiveRejected({
            path: ["journal"],
            diagnostics: [diagnostic("schema", ["journal"], "The archive holds no entries.")],
            message: "The archive holds no entries.",
          });
        const toStore: ArchiveBlob[] = archive.blobs.filter((b) => !blobs.has(b.digest));
        return yield* lock.withPermit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              yield* open;
              if (yield* store.header(documentId))
                return yield* new DocumentExists({
                  documentId,
                  message: `The project already holds ${documentId}.`,
                });
              const added = yield* store.insertDocument(
                documentId,
                entries,
                headerCache(state),
                toStore,
              );
              for (const blob of toStore)
                blobs.set(blob.digest, {
                  byteLength: blob.bytes.length,
                  mediaType: blob.mediaType,
                });
              const position = { sequence: last.sequence, digest: last.digest };
              cache.set(documentId, { state, position });
              return {
                documentId,
                label: head.label,
                format: archive.format,
                journal: position,
                revision: state.head,
                blobs: { added: added.added, existing: archive.blobs.length - added.added },
              } satisfies ImportReport;
            }),
          ),
        );
      });

    const openCharacter: Session["openCharacter"] = (source) =>
      Effect.gen(function* () {
        yield* open;
        const file = path.resolve(source);
        const bytes = yield* Effect.try({
          try: () => {
            const size = fs.statSync(file).size;
            if (size > maxCharacterBytes)
              throw new RangeError(`${file} is larger than ${maxCharacterBytes} bytes.`);
            return new Uint8Array(fs.readFileSync(file));
          },
          catch: (cause) =>
            new InvalidArgument({
              path: ["path"],
              message:
                cause instanceof RangeError
                  ? cause.message
                  : `${file} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        });
        return yield* importArchive(bytes);
      });

    // ── Reads ───────────────────────────────────────────────────────────────

    const readBlob = (digest: string) =>
      Effect.gen(function* () {
        yield* open;
        if (!isDigest(digest))
          return yield* new InvalidArgument({
            path: ["digest"],
            message: `${digest} is not a sha256 digest.`,
          });
        const stored = yield* store.readBlob(digest);
        if (!stored)
          return yield* new BlobMissing({
            digest,
            reason: "absent",
            message: `No blob ${digest} is stored.`,
          });
        if (sha256(stored.bytes) !== digest || stored.bytes.length !== stored.byteLength)
          return yield* new BlobMissing({
            digest,
            reason: "damaged",
            message: `The stored bytes of ${digest} no longer match their digest. Restore the project from a backup.`,
          });
        return {
          digest,
          mediaType: stored.mediaType,
          byteLength: stored.byteLength,
          bytes: stored.bytes,
        };
      });

    const verify = lock.withPermit(
      Effect.gen(function* () {
        yield* open;
        return yield* verifyStore(store, options.registry, catalogEntries);
      }),
    );

    const backup = (destination: string): Effect.Effect<BackupReport, ProjectError> =>
      Effect.gen(function* () {
        yield* open;
        const target = path.resolve(destination);
        if (fs.existsSync(target))
          return yield* new InvalidArgument({
            path: ["destination"],
            message: `${target} already exists.`,
          });
        const partial = `${target}.${randomUUID()}.partial`;
        const removePartial = Effect.sync(() => {
          for (const suffix of ["", "-wal", "-shm", "-journal"])
            fs.rmSync(partial + suffix, { force: true });
        });
        return yield* Effect.gen(function* () {
          yield* lock.withPermit(Effect.andThen(open, store.backup(partial)));
          const report = yield* Effect.scoped(
            Effect.gen(function* () {
              const copy = yield* openStore({
                file: partial,
                lockTimeoutMs: 0,
                durability: "full",
              });
              return yield* verifyStore(copy, options.registry, catalogEntries);
            }),
          );
          if (!report.ok)
            return yield* new StorageFailed({
              operation: "backup-verify",
              message: "The backup copy failed verification and was removed.",
              cause: report,
            });
          const sealed = yield* sealFile(partial, target);
          return {
            path: target,
            bytes: sealed.bytes,
            sha256: sealed.sha256,
            verify: report,
          } satisfies BackupReport;
        }).pipe(Effect.onError(() => removePartial));
      });

    const exportArchive: Project["exportArchive"] = (documentId) =>
      Effect.gen(function* () {
        const loaded = yield* existing(documentId);
        const out: ArchiveBlob[] = [];
        for (const digest of referencedAssets(loaded.state).keys()) {
          const blob = yield* readBlob(digest).pipe(
            Effect.catchTag("InvalidArgument", () =>
              Effect.fail(
                new BlobMissing({ digest, reason: "absent", message: `${digest} is not stored.` }),
              ),
            ),
          );
          out.push({ digest, mediaType: blob.mediaType, bytes: blob.bytes });
        }
        return encodePackage(loaded.state, out);
      });

    const saveCharacter: Project["saveCharacter"] = (documentId, destination) =>
      Effect.gen(function* () {
        const target = path.resolve(destination);
        if (fs.existsSync(target))
          return yield* new InvalidArgument({
            path: ["path"],
            message: `${target} already exists; a save never overwrites.`,
          });
        if (!fs.existsSync(path.dirname(target)))
          return yield* new InvalidArgument({
            path: ["path"],
            message: `The folder ${path.dirname(target)} does not exist.`,
          });
        const loaded = yield* existing(documentId);
        const bytes = yield* exportArchive(documentId);
        const partial = `${target}.${randomUUID()}.partial`;
        return yield* Effect.try({
          try: () => {
            const fd = fs.openSync(partial, "wx");
            try {
              fs.writeSync(fd, bytes);
              fs.fsyncSync(fd);
            } finally {
              fs.closeSync(fd);
            }
            if (fs.existsSync(target)) throw new Error(`${target} appeared while saving.`);
            fs.renameSync(partial, target);
            return {
              path: target,
              bytes: bytes.length,
              sha256: sha256(bytes),
              documentId,
              label: loaded.state.document?.label ?? documentId,
              revision: loaded.state.head,
              entries: loaded.state.journal.length,
              assets: referencedAssets(loaded.state).size,
            } satisfies CharacterSaveReport;
          },
          catch: (cause) =>
            new InvalidArgument({
              path: ["path"],
              message: `Saving to ${target} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
        }).pipe(Effect.onError(() => Effect.sync(() => fs.rmSync(partial, { force: true }))));
      });

    const project: Project = {
      info: {
        projectId: store.meta.projectId,
        label: store.meta.label,
        directory: path.resolve(options.path),
        file: store.file,
        format: projectFormat,
        version: store.meta.version,
        sqliteVersion: store.sqliteVersion,
        createdAt: store.meta.createdAt,
      },
      session: (caller) => {
        const actor = decodeActor(caller.actor);
        if (Result.isFailure(actor))
          return Effect.fail(
            new InvalidArgument({
              path: ["actor"],
              message: `Invalid caller actor: ${actor.failure.message}`,
            }),
          );
        const bound: Caller = { actor: actor.success };
        return Effect.succeed({
          caller: bound,
          apply: (request) => apply(bound, request),
          putBlob,
          importArchive,
          openCharacter,
        } satisfies Session);
      },
      documents: Effect.andThen(
        open,
        Effect.map(store.listDocuments, (rows) =>
          rows.map((row) => ({
            documentId: row.id,
            label: row.label,
            revision: row.revision,
            documentDigest: row.document_digest,
            journal: { sequence: row.last_sequence, digest: row.last_digest },
            updatedAt: row.updated_at,
          })),
        ),
      ),
      current: (documentId) => Effect.map(existing(documentId), currentOf),
      inspect: (documentId) =>
        Effect.map(existing(documentId), (loaded): InspectView => ({
          ...currentOf(loaded),
          history: loaded.state.history.map((r) => historyItem(loaded.state, r)),
          proposals: [...loaded.state.proposals.values()],
        })),
      changes: (documentId, query) =>
        Effect.map(existing(documentId), (loaded): ChangesView => {
          const { state } = loaded;
          const deltas: RevisionDelta[] = changesSince(state, query.since)
            .filter((r) => query.by === undefined || r.author.kind === query.by)
            .map((r) => ({ ...historyItem(state, r), changes: r.changes }));
          return { documentId: state.documentId, since: query.since, revision: state.head, deltas };
        }),
      diff: (documentId, from, to) =>
        Effect.map(existing(documentId), (loaded): DiffView => {
          const result = diffRevisions(loaded.state, from, to);
          return result.ok ? { ok: true, from, to, changes: result.value } : result;
        }),
      draft: (documentId, proposalId) =>
        Effect.map(existing(documentId), (loaded): DraftView => {
          const result = previewProposal(loaded.state, proposalId);
          if (!result.ok) return result;
          const p = result.value;
          return {
            ok: true,
            proposal: p.proposal,
            preview: p.preview,
            changes: p.changes,
            stale: p.stale,
            rebased: p.rebased.ok ? { ok: true, changes: p.rebased.value } : p.rebased,
          };
        }),
      revision: (documentId, revision) =>
        Effect.map(existing(documentId), (loaded): RevisionView | undefined => {
          const record = loaded.state.history[revision - 1];
          return record && Number.isInteger(revision) && revision >= 1
            ? {
                documentId: loaded.state.documentId,
                revision,
                document: record.document,
                documentDigest: record.digest,
                head: loaded.state.head,
              }
            : undefined;
        }),
      receipt: (documentId, requestId) =>
        Effect.map(existing(documentId), (loaded) => loaded.state.receipts.get(requestId)),
      journal: (documentId, after = 0) =>
        Effect.map(existing(documentId), (loaded) =>
          loaded.state.journal.slice(Math.max(0, after)),
        ),
      blob: readBlob,
      blobInfo: (digest) =>
        Effect.map(open, () => {
          const known = blobs.get(digest);
          return known
            ? { digest, mediaType: known.mediaType, byteLength: known.byteLength }
            : undefined;
        }),
      reload: (documentId) =>
        lock.withPermit(
          Effect.gen(function* () {
            yield* open;
            if (documentId === undefined) {
              cache.clear();
              yield* loadBlobIndex.pipe(Effect.ignore);
            } else cache.delete(documentId);
          }),
        ),
      verify,
      backup,
      exportArchive,
      saveCharacter,
    };
    return project;
  });

// ── Restore ─────────────────────────────────────────────────────────────────

/**
 * Turn a backup file into a new project directory. The copy is verified in
 * full before it is moved into place; on any failure the directory is removed.
 */
export const restoreProject = (
  options: RestoreProjectOptions,
): Effect.Effect<VerifyReport, ProjectError> =>
  Effect.gen(function* () {
    const source = path.resolve(options.backup);
    const directory = path.resolve(options.path);
    if (!fs.existsSync(source))
      return yield* new ProjectMissing({ path: source, message: `No backup at ${source}.` });
    if (fs.existsSync(directory))
      return yield* new ProjectExists({ path: directory, message: `${directory} already exists.` });
    const target = projectFile(directory);
    const partial = `${target}.partial`;
    return yield* Effect.gen(function* () {
      yield* Effect.try({
        try: () => {
          fs.mkdirSync(directory, { recursive: true });
          fs.copyFileSync(source, partial, fs.constants.COPYFILE_EXCL);
        },
        catch: (cause) =>
          new StorageFailed({ operation: "restore-copy", message: String(cause), cause }),
      });
      const report = yield* Effect.scoped(
        Effect.gen(function* () {
          const copy = yield* openStore({ file: partial, lockTimeoutMs: 0, durability: "full" });
          return yield* verifyStore(copy, options.registry, options.catalog ?? []);
        }),
      );
      if (!report.ok)
        return yield* new ArchiveRejected({
          path: [],
          diagnostics: report.documents.flatMap((d) => d.diagnostics),
          message: "The backup failed verification; nothing was restored.",
        });
      yield* sealFile(partial, target);
      return report;
    }).pipe(
      Effect.onError(() =>
        Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })),
      ),
    );
  });

/** Flush a finished file and move it into place. */
/** Largest character file `openCharacter` reads into memory. */
const maxCharacterBytes = 1024 * 1024 * 1024;

const sealFile = (from: string, to: string) =>
  Effect.try({
    try: () => {
      for (const suffix of ["-wal", "-shm"])
        if (fs.existsSync(from + suffix)) throw new Error(`${from}${suffix} was left behind.`);
      const fd = fs.openSync(from, "r+");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const bytes = fs.readFileSync(from);
      fs.renameSync(from, to);
      return { bytes: bytes.length, sha256: sha256(bytes) };
    },
    catch: (cause) => new StorageFailed({ operation: "seal-file", message: String(cause), cause }),
  });
