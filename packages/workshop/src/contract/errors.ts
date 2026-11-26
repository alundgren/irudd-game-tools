// Typed failures of the project service. Command rejections are not errors: a
// rejected request is an ordinary `ApplyResult` with diagnostics. These cover
// the project itself, its storage and invalid service arguments.
//
// Every error carries plain, serialisable fields and a readable `message`, so a
// transport can send `{_tag, ...fields}` and a client can rebuild it.

import { Data } from "effect";
import type { Diagnostic } from "@irudd/document";

/** No project exists at the path. */
export class ProjectMissing extends Data.TaggedError("ProjectMissing")<{
  readonly path: string;
  readonly message: string;
}> {}

/** Creating a project where a project or other file already exists. */
export class ProjectExists extends Data.TaggedError("ProjectExists")<{
  readonly path: string;
  readonly message: string;
}> {}

/** Another service (in this or another process) owns the project. */
export class ProjectLocked extends Data.TaggedError("ProjectLocked")<{
  readonly path: string;
  readonly message: string;
}> {}

/**
 * The file is not a workshop project, was written by a newer build, or failed
 * SQLite's own integrity check.
 */
export class ProjectUnreadable extends Data.TaggedError("ProjectUnreadable")<{
  readonly path: string;
  readonly reason: "not-a-project" | "newer-format" | "damaged";
  readonly message: string;
}> {}

/** The project's scope has closed; open it again. */
export class ProjectClosed extends Data.TaggedError("ProjectClosed")<{
  readonly message: string;
}> {}

/**
 * SQLite or the file system failed. After a failed write the outcome is
 * unknown to the caller: the service reloads the document from disk before its
 * next use, and a retry with the same request ID is safe either way.
 */
export class StorageFailed extends Data.TaggedError("StorageFailed")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * A document's stored journal does not recover. Nothing of it is served until
 * the file is repaired or restored; other documents in the project still work.
 */
export class JournalDamaged extends Data.TaggedError("JournalDamaged")<{
  readonly documentId: string;
  /** Zero-based index of the first entry that fails. */
  readonly index: number;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly message: string;
}> {}

/** A read named a document the project has never committed. */
export class DocumentMissing extends Data.TaggedError("DocumentMissing")<{
  readonly documentId: string;
  readonly message: string;
}> {}

/** Importing a document the project already holds. */
export class DocumentExists extends Data.TaggedError("DocumentExists")<{
  readonly documentId: string;
  readonly message: string;
}> {}

/** A service argument (not a command envelope) is malformed. */
export class InvalidArgument extends Data.TaggedError("InvalidArgument")<{
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}> {}

/** Blob bytes failed verification and were not stored. */
export class BlobRejected extends Data.TaggedError("BlobRejected")<{
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly message: string;
}> {}

/** No complete blob with this digest is stored, or its stored bytes are damaged. */
export class BlobMissing extends Data.TaggedError("BlobMissing")<{
  readonly digest: string;
  readonly reason: "absent" | "damaged";
  readonly message: string;
}> {}

/** A document archive or backup failed verification; nothing was written. */
export class ArchiveRejected extends Data.TaggedError("ArchiveRejected")<{
  readonly path: ReadonlyArray<string | number>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly message: string;
}> {}

export type ProjectError =
  | ProjectMissing
  | ProjectExists
  | ProjectLocked
  | ProjectUnreadable
  | ProjectClosed
  | StorageFailed
  | JournalDamaged
  | DocumentMissing
  | DocumentExists
  | InvalidArgument
  | BlobRejected
  | BlobMissing
  | ArchiveRejected;

/** Every `_tag` a service failure can carry. */
export const projectErrorTags = [
  "ProjectMissing",
  "ProjectExists",
  "ProjectLocked",
  "ProjectUnreadable",
  "ProjectClosed",
  "StorageFailed",
  "JournalDamaged",
  "DocumentMissing",
  "DocumentExists",
  "InvalidArgument",
  "BlobRejected",
  "BlobMissing",
  "ArchiveRejected",
] as const satisfies ReadonlyArray<ProjectError["_tag"]>;
