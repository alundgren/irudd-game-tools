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
export const projectFileName = "workshop.sqlite";

export const archiveFormat = "irudd.document-archive";
export const archiveVersion = 1;
export const packageFormat = "irudd.character-package";
export const packageVersion = 1;
export const packageExtension = ".irudd-character";

export interface OpenProjectOptions {
  readonly path: string;
  readonly registry: Registry;
  readonly catalog?: ReadonlyArray<readonly [CatalogId, Digest]>;
  readonly lockTimeoutMs?: number;
  readonly durability?: "full" | "normal";
}

export interface CreateProjectOptions extends OpenProjectOptions {
  readonly inMemory?: boolean;
  readonly label: string;
}

export interface RestoreProjectOptions {
  readonly backup: string;
  readonly path: string;
  readonly registry: Registry;
  readonly catalog?: ReadonlyArray<readonly [CatalogId, Digest]>;
}

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

export interface Caller {
  readonly actor: Actor;
}

export type CommandRequest = Omit<CommandEnvelopeInput, "actor"> & {
  readonly actor?: CommandEnvelopeInput["actor"];
};

export interface AccessView {
  readonly mode: Access["mode"];
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export interface JournalPosition {
  readonly sequence: number;
  readonly digest: string;
}

export type ApplyResult =
  | {
      readonly kind: "committed";
      readonly receipt: Receipt;
      readonly entry: JournalPosition;
      readonly access: AccessView;
    }
  | { readonly kind: "replayed"; readonly receipt: Receipt }
  | { readonly kind: "rejected"; readonly diagnostics: ReadonlyArray<Diagnostic> };

export interface ProjectInfo {
  readonly projectId: string;
  readonly label: string;
  readonly directory: string;
  readonly file: string;
  readonly format: typeof projectFormat;
  readonly version: number;
  readonly sqliteVersion: string;
  readonly createdAt: number;
}

export interface DocumentSummary {
  readonly documentId: string;
  readonly label: string | null;
  readonly revision: number;
  readonly documentDigest: string | null;
  readonly journal: JournalPosition;
  readonly updatedAt: number;
}

export interface CurrentView {
  readonly documentId: string;
  readonly revision: number;
  readonly document: CharacterDocument | null;
  readonly documentDigest: string | null;
  readonly access: AccessView;
  readonly policy: { readonly agentDirectEdit: boolean };
  readonly journal: JournalPosition | null;
}

export interface RevisionView {
  readonly documentId: string;
  readonly revision: number;
  readonly document: CharacterDocument;
  readonly documentDigest: string;
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
  readonly since: number;
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
      readonly preview: CharacterDocument;
      readonly changes: ReadonlyArray<Change>;
      readonly stale: boolean;
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
  readonly stored: "new" | "existing";
}

export interface BlobContent extends BlobInfo {
  readonly bytes: Uint8Array;
}

export interface PutBlobInput {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
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
  readonly sqlite: string;
  readonly documents: ReadonlyArray<DocumentCheck>;
  readonly blobs: {
    readonly count: number;
    readonly bytes: number;
    readonly damaged: ReadonlyArray<string>;
    readonly missing: ReadonlyArray<{
      readonly documentId: string;
      readonly revision: number;
      readonly digest: string;
    }>;
    readonly unreferenced: number;
  };
}

export interface BackupReport {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly verify: VerifyReport;
}

export interface ImportReport {
  readonly documentId: string;
  readonly label: string;
  readonly format: string;
  readonly journal: JournalPosition;
  readonly revision: number;
  readonly blobs: { readonly added: number; readonly existing: number };
}

export interface CharacterSaveReport {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly documentId: string;
  readonly label: string;
  readonly revision: number;
  readonly entries: number;
  readonly assets: number;
}

export type ReadError =
  | DocumentMissing
  | JournalDamaged
  | StorageFailed
  | InvalidArgument
  | ProjectClosed;

export interface Project {
  readonly info: ProjectInfo;
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
  readonly revision: (
    documentId: string,
    revision: number,
  ) => Effect.Effect<RevisionView | undefined, ReadError>;
  readonly receipt: (
    documentId: string,
    requestId: string,
  ) => Effect.Effect<Receipt | undefined, ReadError>;
  readonly journal: (
    documentId: string,
    after?: number,
  ) => Effect.Effect<ReadonlyArray<JournalEntry>, ReadError>;

  readonly blob: (
    digest: string,
  ) => Effect.Effect<BlobContent, BlobMissing | StorageFailed | InvalidArgument | ProjectClosed>;
  readonly blobInfo: (digest: string) => Effect.Effect<BlobInfo | undefined, ProjectClosed>;

  readonly reload: (documentId?: string) => Effect.Effect<void, ProjectClosed>;
  readonly verify: Effect.Effect<VerifyReport, StorageFailed | ProjectClosed>;
  readonly backup: (destination: string) => Effect.Effect<BackupReport, ProjectError>;
  readonly exportArchive: (
    documentId: string,
  ) => Effect.Effect<Uint8Array, ReadError | BlobMissing>;
  readonly saveCharacter: (
    documentId: string,
    destination: string,
  ) => Effect.Effect<CharacterSaveReport, ReadError | BlobMissing | InvalidArgument>;
}

export interface Session {
  readonly caller: Caller;
  readonly apply: (
    request: unknown,
  ) => Effect.Effect<ApplyResult, StorageFailed | JournalDamaged | ProjectClosed>;
  readonly putBlob: (
    input: PutBlobInput,
  ) => Effect.Effect<BlobPut, BlobRejected | StorageFailed | ProjectClosed>;
  readonly importArchive: (
    bytes: Uint8Array,
  ) => Effect.Effect<
    ImportReport,
    ArchiveRejected | DocumentExists | StorageFailed | ProjectClosed
  >;
  readonly donorCharacter: (
    source: string,
  ) => Effect.Effect<
    { readonly document: CharacterDocument; readonly revision: number },
    ArchiveRejected | BlobRejected | StorageFailed | ProjectClosed | InvalidArgument
  >;
  readonly openCharacter: (
    source: string,
  ) => Effect.Effect<
    ImportReport,
    ArchiveRejected | DocumentExists | StorageFailed | ProjectClosed | InvalidArgument
  >;
}
