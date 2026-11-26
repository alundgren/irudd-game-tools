// The project service contract: what desktop, the authenticated transport, the
// CLI and MCP rely on. Types only, plus format constants; this module reaches
// no storage code, so clients may import `@irudd/workshop/contract`.
//
// Every value a method returns is plain JSON data (documents, receipts,
// proposals, diagnostics, numbers and strings), except blob bytes, which are a
// Uint8Array. A transport can serialise results without knowing their types.

import type {
  Access,
  Actor,
  CatalogId,
  Change,
  CharacterDocument,
  CommandEnvelopeInput,
  Diagnostic,
  Digest,
  JournalEntry,
  Proposal,
  Receipt,
  Registry,
  RevisionKind,
} from "@irudd/document";
import type { Effect, Scope } from "effect";
import type {
  ArchiveRejected,
  BlobMissing,
  BlobRejected,
  DocumentExists,
  DocumentMissing,
  InvalidArgument,
  JournalDamaged,
  ProjectClosed,
  ProjectError,
  StorageFailed,
} from "./errors.js";

export const projectFormat = "irudd.workshop-project";
export const projectVersion = 1;
/** The SQLite file inside a project directory. */
export const projectFileName = "workshop.sqlite";

export const archiveFormat = "irudd.document-archive";
export const archiveVersion = 1;
/** The ZIP character package saving writes; JSON archives stay readable. */
export const packageFormat = "irudd.character-package";
export const packageVersion = 1;
/** The file extension of a saved character package. */
export const packageExtension = ".irudd-character";

// ── Opening ─────────────────────────────────────────────────────────────────

export interface OpenProjectOptions {
  /** The project directory. It holds `workshop.sqlite` and nothing else is required. */
  readonly path: string;
  /** Generators and features this build supports. */
  readonly registry: Registry;
  /** Installed catalog content digests. Defaults to none. */
  readonly catalog?: ReadonlyArray<readonly [CatalogId, Digest]>;
  /**
   * How long to wait for another owner to release the project before failing
   * with `ProjectLocked`. Default 250 ms.
   */
  readonly lockTimeoutMs?: number;
  /**
   * `full` (default) makes every acknowledged commit survive power loss.
   * `normal` survives process crashes but may lose the last commits on power loss.
   */
  readonly durability?: "full" | "normal";
}

export interface CreateProjectOptions extends OpenProjectOptions {
  /** Keep character history and artwork in SQLite memory until explicitly saved. */
  readonly inMemory?: boolean;
  readonly label: string;
}

export interface RestoreProjectOptions {
  /** A file written by `Project.backup`. */
  readonly backup: string;
  /** A new project directory; it must not exist yet. */
  readonly path: string;
  readonly registry: Registry;
  readonly catalog?: ReadonlyArray<readonly [CatalogId, Digest]>;
}

/** The functions the service module exports, for hosts that want the shape as a type. */
export interface ProjectService {
  readonly createProject: (
    options: CreateProjectOptions,
  ) => Effect.Effect<Project, ProjectError, Scope.Scope>;
  readonly openProject: (
    options: OpenProjectOptions,
  ) => Effect.Effect<Project, ProjectError, Scope.Scope>;
  readonly restoreProject: (
    options: RestoreProjectOptions,
  ) => Effect.Effect<VerifyReport, ProjectError>;
}

// ── Callers ─────────────────────────────────────────────────────────────────

/**
 * An authenticated caller. The transport decides who is calling (the desktop
 * window is a person, an MCP connection is an agent) and binds a session; the
 * service never trusts an actor named inside a request.
 */
export interface Caller {
  readonly actor: Actor;
}

/**
 * A command envelope as a bound session receives it. `actor` may be omitted;
 * the session supplies the caller's actor. A request that names a different
 * actor is rejected with `forbidden` at `["actor"]`.
 */
export type CommandRequest = Omit<CommandEnvelopeInput, "actor"> & {
  readonly actor?: CommandEnvelopeInput["actor"];
};

// ── Results ─────────────────────────────────────────────────────────────────

export interface AccessView {
  readonly mode: Access["mode"];
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** Position of an entry in a document's durable journal. */
export interface JournalPosition {
  readonly sequence: number;
  readonly digest: string;
}

export type ApplyResult =
  | {
      readonly kind: "committed";
      readonly receipt: Receipt;
      /** The journal entry this commit wrote, durable before this result returns. */
      readonly entry: JournalPosition;
      readonly access: AccessView;
    }
  /** The request ID was committed before; nothing new was written. */
  | { readonly kind: "replayed"; readonly receipt: Receipt }
  /** Nothing was written. */
  | { readonly kind: "rejected"; readonly diagnostics: ReadonlyArray<Diagnostic> };

export interface ProjectInfo {
  readonly projectId: string;
  readonly label: string;
  readonly directory: string;
  readonly file: string;
  readonly format: typeof projectFormat;
  readonly version: number;
  readonly sqliteVersion: string;
  /** Milliseconds since the epoch. */
  readonly createdAt: number;
}

/** One document as the project's header table lists it, without loading its journal. */
export interface DocumentSummary {
  readonly documentId: string;
  readonly label: string | null;
  readonly revision: number;
  readonly documentDigest: string | null;
  readonly journal: JournalPosition;
  /** Wall-clock time of the last commit, in milliseconds. Informational only. */
  readonly updatedAt: number;
}

export interface CurrentView {
  readonly documentId: string;
  /** Head revision; 0 before creation. */
  readonly revision: number;
  readonly document: CharacterDocument | null;
  readonly documentDigest: string | null;
  readonly access: AccessView;
  readonly policy: { readonly agentDirectEdit: boolean };
  readonly journal: JournalPosition | null;
}

/** One committed revision, immutable: the document exactly as it was then. */
export interface RevisionView {
  readonly documentId: string;
  readonly revision: number;
  readonly document: CharacterDocument;
  readonly documentDigest: string;
  /** The head when it was read. */
  readonly head: number;
}

export interface HistoryItem {
  readonly revision: number;
  readonly kind: RevisionKind;
  readonly actor: Actor;
  readonly author: Actor;
  readonly requestId: string;
  readonly digest: string;
  readonly summary?: string;
  readonly undoes?: number;
  readonly restores?: number;
  readonly proposal?: { readonly id: string; readonly version: number };
  /** Whether an undo currently in force reverses this revision. */
  readonly undone: boolean;
  readonly changeCount: number;
}

export interface InspectView extends CurrentView {
  readonly history: ReadonlyArray<HistoryItem>;
  readonly proposals: ReadonlyArray<Proposal>;
}

export interface RevisionDelta extends HistoryItem {
  readonly changes: ReadonlyArray<Change>;
}

export interface ChangesQuery {
  /** Revisions after this one. */
  readonly since: number;
  /** Only revisions authored by this kind of actor, for example a person's manual edits. */
  readonly by?: "human" | "agent";
}

export interface ChangesView {
  readonly documentId: string;
  readonly since: number;
  readonly revision: number;
  readonly deltas: ReadonlyArray<RevisionDelta>;
}

export type DiffView =
  | {
      readonly ok: true;
      readonly from: number;
      readonly to: number;
      readonly changes: ReadonlyArray<Change>;
    }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> };

export type DraftView =
  | {
      readonly ok: true;
      readonly proposal: Proposal;
      /** The draft applied to its own base revision. */
      readonly preview: CharacterDocument;
      readonly changes: ReadonlyArray<Change>;
      /** True when the head has moved past the draft's base. */
      readonly stale: boolean;
      /** The same changes against the head, when they still apply cleanly. */
      readonly rebased:
        | { readonly ok: true; readonly changes: ReadonlyArray<Change> }
        | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> };
    }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> };

export interface BlobInfo {
  readonly digest: string;
  readonly mediaType: string;
  readonly byteLength: number;
}

export interface BlobPut extends BlobInfo {
  /** `new` when this call stored the bytes, `existing` when they were already present. */
  readonly stored: "new" | "existing";
}

export interface BlobContent extends BlobInfo {
  /** Re-verified against the digest on every read. */
  readonly bytes: Uint8Array;
}

export interface PutBlobInput {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  /** When given, the bytes must hash to it. */
  readonly digest?: string;
}

export interface DocumentCheck {
  readonly documentId: string;
  readonly journal: JournalPosition;
  readonly ok: boolean;
  readonly index?: number;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly projectId: string;
  /** SQLite `PRAGMA integrity_check`; `ok` when the file is sound. */
  readonly sqlite: string;
  readonly documents: ReadonlyArray<DocumentCheck>;
  readonly blobs: {
    readonly count: number;
    readonly bytes: number;
    /** Stored blobs whose bytes no longer hash to their digest. */
    readonly damaged: ReadonlyArray<string>;
    /** Digests some revision references that the store lacks. */
    readonly missing: ReadonlyArray<{
      readonly documentId: string;
      readonly revision: number;
      readonly digest: string;
    }>;
    /** Stored blobs no revision references (staged uploads, or abandoned ones). */
    readonly unreferenced: number;
  };
}

export interface BackupReport {
  /** The finished backup file. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Verification of the backup file itself, before it was moved into place. */
  readonly verify: VerifyReport;
}

export interface ImportReport {
  readonly documentId: string;
  /** The head document's label. */
  readonly label: string;
  /** What was read: `irudd.character-package` (ZIP) or `irudd.document-archive` (JSON). */
  readonly format: string;
  readonly journal: JournalPosition;
  readonly revision: number;
  readonly blobs: { readonly added: number; readonly existing: number };
}

export interface CharacterSaveReport {
  /** The finished `.irudd-character` file. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly documentId: string;
  readonly label: string;
  readonly revision: number;
  /** Journal entries carried, so history and undo travel with the character. */
  readonly entries: number;
  /** Artwork files carried, from every revision. */
  readonly assets: number;
}

// ── The service ─────────────────────────────────────────────────────────────

export type ReadError =
  | DocumentMissing
  | JournalDamaged
  | StorageFailed
  | InvalidArgument
  | ProjectClosed;

/**
 * One open project. Only one `Project` per project directory exists at a time,
 * across all processes: opening it elsewhere fails with `ProjectLocked` until
 * this one's scope closes or its process exits.
 */
export interface Project {
  readonly info: ProjectInfo;
  /** Bind an authenticated caller. Every write goes through a session. */
  readonly session: (caller: Caller) => Effect.Effect<Session, InvalidArgument>;

  readonly documents: Effect.Effect<ReadonlyArray<DocumentSummary>, StorageFailed | ProjectClosed>;
  readonly current: (documentId: string) => Effect.Effect<CurrentView, ReadError>;
  readonly inspect: (documentId: string) => Effect.Effect<InspectView, ReadError>;
  readonly changes: (
    documentId: string,
    query: ChangesQuery,
  ) => Effect.Effect<ChangesView, ReadError>;
  readonly diff: (
    documentId: string,
    from: number,
    to: number,
  ) => Effect.Effect<DiffView, ReadError>;
  readonly draft: (documentId: string, proposalId: string) => Effect.Effect<DraftView, ReadError>;
  /** A committed revision's document and digest; `undefined` when there is no such revision. */
  readonly revision: (
    documentId: string,
    revision: number,
  ) => Effect.Effect<RevisionView | undefined, ReadError>;
  /** The receipt of an earlier request, so a client that lost a reply can check without resending. */
  readonly receipt: (
    documentId: string,
    requestId: string,
  ) => Effect.Effect<Receipt | undefined, ReadError>;
  /** Stored journal entries after `after` (default 0), in order. */
  readonly journal: (
    documentId: string,
    after?: number,
  ) => Effect.Effect<ReadonlyArray<JournalEntry>, ReadError>;

  readonly blob: (
    digest: string,
  ) => Effect.Effect<BlobContent, BlobMissing | StorageFailed | InvalidArgument | ProjectClosed>;
  readonly blobInfo: (digest: string) => Effect.Effect<BlobInfo | undefined, ProjectClosed>;

  /** Drop cached state and recover from disk: one document, or all of them. */
  readonly reload: (documentId?: string) => Effect.Effect<void, ProjectClosed>;
  /** Full check of the open project: SQLite, every journal, every blob. */
  readonly verify: Effect.Effect<VerifyReport, StorageFailed | ProjectClosed>;
  /**
   * Write a consistent, verified single-file copy of the project (journals and
   * artwork) to `destination`, which must not exist. Writes wait while it runs.
   */
  readonly backup: (destination: string) => Effect.Effect<BackupReport, ProjectError>;
  /**
   * A portable character package (`irudd.character-package`, a ZIP) of one
   * document: its head, its whole journal and every blob it references.
   */
  readonly exportArchive: (
    documentId: string,
  ) => Effect.Effect<Uint8Array, ReadError | BlobMissing>;
  /**
   * Write `exportArchive` to `destination`, which must not exist: a sibling
   * partial file is flushed and moved into place, so a failure leaves nothing.
   */
  readonly saveCharacter: (
    documentId: string,
    destination: string,
  ) => Effect.Effect<CharacterSaveReport, ReadError | BlobMissing | InvalidArgument>;
}

/** A project bound to one trusted caller. */
export interface Session {
  readonly caller: Caller;
  /**
   * Run one command through the document reducer. A committed entry is durable
   * before the result returns; a replay or rejection writes nothing.
   */
  readonly apply: (
    request: unknown,
  ) => Effect.Effect<ApplyResult, StorageFailed | JournalDamaged | ProjectClosed>;
  /**
   * Stage artwork: verify and store immutable, content-addressed bytes. Only
   * stored blobs satisfy a document's asset references.
   */
  readonly putBlob: (
    input: PutBlobInput,
  ) => Effect.Effect<BlobPut, BlobRejected | StorageFailed | ProjectClosed>;
  /**
   * Add a document from a character package or a JSON document archive. Its
   * journal and receipts come back unchanged. Everything is checked before
   * anything is written.
   */
  readonly importArchive: (
    bytes: Uint8Array,
  ) => Effect.Effect<
    ImportReport,
    ArchiveRejected | DocumentExists | StorageFailed | ProjectClosed
  >;
  /** Read a saved character file and `importArchive` it. */
  readonly openCharacter: (
    source: string,
  ) => Effect.Effect<
    ImportReport,
    ArchiveRejected | DocumentExists | StorageFailed | ProjectClosed | InvalidArgument
  >;
}
