import { Data } from "effect";
import type { Diagnostic } from "@irudd/document";

export class ProjectMissing extends Data.TaggedError("ProjectMissing")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ProjectExists extends Data.TaggedError("ProjectExists")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ProjectLocked extends Data.TaggedError("ProjectLocked")<{
  readonly path: string;
  readonly message: string;
}> {}

export class ProjectUnreadable extends Data.TaggedError("ProjectUnreadable")<{
  readonly path: string;
  readonly reason: "not-a-project" | "newer-format" | "damaged";
  readonly message: string;
}> {}

export class ProjectClosed extends Data.TaggedError("ProjectClosed")<{
  readonly message: string;
}> {}

export class StorageFailed extends Data.TaggedError("StorageFailed")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class JournalDamaged extends Data.TaggedError("JournalDamaged")<{
  readonly documentId: string;
  readonly index: number;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly message: string;
}> {}

export class DocumentMissing extends Data.TaggedError("DocumentMissing")<{
  readonly documentId: string;
  readonly message: string;
}> {}

export class DocumentExists extends Data.TaggedError("DocumentExists")<{
  readonly documentId: string;
  readonly message: string;
}> {}

export class InvalidArgument extends Data.TaggedError("InvalidArgument")<{
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}> {}

export class BlobRejected extends Data.TaggedError("BlobRejected")<{
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly message: string;
}> {}

export class BlobMissing extends Data.TaggedError("BlobMissing")<{
  readonly digest: string;
  readonly reason: "absent" | "damaged";
  readonly message: string;
}> {}

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
