import {
  diagnostic,
  documentDigest,
  openJournal,
  type DocumentId,
  type DocumentState,
  type Environment,
} from "@irudd/document";
import { Effect } from "effect";
import { JournalDamaged, type StorageFailed } from "../contract/errors.js";
import type { JournalPosition } from "../contract/project.js";
import type { HeaderCache, Store } from "../storage/store.js";

export interface Loaded {
  readonly state: DocumentState;
  readonly position: JournalPosition | null;
}

function damaged(
  documentId: string,
  index: number,
  path: ReadonlyArray<string | number>,
  message: string,
): JournalDamaged {
  return new JournalDamaged({
    documentId,
    index,
    diagnostics: [diagnostic("journal-integrity", path, message)],
    message: `The journal of ${documentId} does not recover at entry ${index + 1}: ${message}`,
  });
}

export const recoverDocument = (
  store: Store,
  documentId: DocumentId,
  env: Environment,
  empty: (id: DocumentId) => DocumentState,
): Effect.Effect<Loaded, JournalDamaged | StorageFailed> =>
  Effect.gen(function* () {
    const header = yield* store.header(documentId);
    const rows = yield* store.entries(documentId);
    if (!header) {
      if (rows.length)
        return yield* damaged(
          documentId,
          0,
          [0],
          "Journal entries exist without a document header.",
        );
      return { state: empty(documentId), position: null };
    }
    const parsed: unknown[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) break;
      let value: unknown;
      try {
        value = JSON.parse(row.entry);
      } catch {
        return yield* damaged(documentId, i, [i], "The stored entry is not JSON.");
      }
      const sequence: unknown =
        typeof value === "object" && value !== null ? Reflect.get(value, "sequence") : undefined;
      const digest: unknown =
        typeof value === "object" && value !== null ? Reflect.get(value, "digest") : undefined;
      if (row.sequence !== i + 1 || sequence !== row.sequence || digest !== row.digest)
        return yield* damaged(
          documentId,
          i,
          [i],
          `Row ${row.sequence} does not hold entry ${i + 1} with its indexed digest.`,
        );
      parsed.push(value);
    }
    const last = { sequence: header.last_sequence, digest: header.last_digest };
    const recovery = openJournal(documentId, parsed, env, { last });
    if (!recovery.ok)
      return yield* new JournalDamaged({
        documentId,
        index: recovery.index,
        diagnostics: recovery.diagnostics,
        message: `The journal of ${documentId} does not recover at entry ${recovery.index + 1}: ${recovery.diagnostics
          .map((d) => d.message)
          .join(" ")}`,
      });
    return { state: recovery.state, position: last };
  });

export function headerCache(state: DocumentState): HeaderCache {
  return {
    label: state.document?.label ?? null,
    revision: state.head,
    documentDigest: state.document ? documentDigest(state.document) : null,
  };
}

export function referencedAssets(state: DocumentState): Map<string, number> {
  const out = new Map<string, number>();
  for (const record of state.history)
    for (const asset of record.document.assets)
      if (!out.has(asset.digest)) out.set(asset.digest, record.revision);
  return out;
}
