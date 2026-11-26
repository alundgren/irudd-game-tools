import {
  Digest,
  DocumentId,
  emptyState,
  memoryEnvironment,
  type CatalogId,
  type Registry,
  type StoredAsset,
} from "@irudd/document";
import { Effect, Result, Schema } from "effect";
import type { StorageFailed } from "../contract/errors.js";
import type { DocumentCheck, VerifyReport } from "../contract/project.js";
import type { Store } from "../storage/store.js";
import { sha256 } from "./blobs.js";
import { recoverDocument, referencedAssets } from "./recover.js";

const decodeDocumentId = Schema.decodeUnknownResult(DocumentId);
const decodeDigest = Schema.decodeUnknownResult(Digest);

export const verifyStore = (
  store: Store,
  registry: Registry,
  catalog: ReadonlyArray<readonly [CatalogId, Digest]>,
): Effect.Effect<VerifyReport, StorageFailed> =>
  Effect.gen(function* () {
    const sqlite = yield* store.integrityCheck;
    const index = yield* store.blobIndex;
    const assets: Array<readonly [Digest, StoredAsset]> = [];
    for (const row of index) {
      const digest = decodeDigest(row.digest);
      if (Result.isSuccess(digest))
        assets.push([digest.success, { byteLength: row.byte_length, mediaType: row.media_type }]);
    }
    const env = memoryEnvironment(registry, assets, catalog);
    const stored = new Set(index.map((row) => row.digest));

    const damaged: string[] = [];
    let bytes = 0;
    yield* store.forEachBlob((digest, content) => {
      bytes += content.length;
      if (sha256(content) !== digest) damaged.push(digest);
    });

    const referenced = new Set<string>();
    const missing: Array<{ documentId: string; revision: number; digest: string }> = [];
    const documents: DocumentCheck[] = [];
    for (const row of yield* store.listDocuments) {
      const journal = { sequence: row.last_sequence, digest: row.last_digest };
      const id = decodeDocumentId(row.id);
      if (Result.isFailure(id)) {
        documents.push({
          documentId: row.id,
          journal,
          ok: false,
          index: 0,
          diagnostics: [
            {
              code: "journal-integrity",
              path: ["documentId"],
              message: "The stored document ID is invalid.",
            },
          ],
        });
        continue;
      }
      const loaded = yield* recoverDocument(store, id.success, env, emptyState).pipe(
        Effect.map((value) => ({ ok: true as const, value })),
        Effect.catchTag("JournalDamaged", (error) => Effect.succeed({ ok: false as const, error })),
      );
      if (!loaded.ok) {
        documents.push({
          documentId: row.id,
          journal,
          ok: false,
          index: loaded.error.index,
          diagnostics: loaded.error.diagnostics,
        });
        continue;
      }
      documents.push({ documentId: row.id, journal, ok: true, diagnostics: [] });
      for (const [digest, revision] of referencedAssets(loaded.value.state)) {
        referenced.add(digest);
        if (!stored.has(digest)) missing.push({ documentId: row.id, revision, digest });
      }
    }
    const unreferenced = index.filter((row) => !referenced.has(row.digest)).length;
    return {
      ok:
        sqlite === "ok" &&
        documents.every((d) => d.ok) &&
        damaged.length === 0 &&
        missing.length === 0,
      projectId: store.meta.projectId,
      sqlite,
      documents,
      blobs: { count: index.length, bytes, damaged, missing, unreferenced },
    };
  });
