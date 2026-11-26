// What this build can do with a document head.
//
// A recovered document keeps the bytes it was committed with. This build may
// have newer feature codecs, or it may lack a generator or feature the
// document names. Access is derived from the head and the registry on every
// write, never stored:
//
//   writable          the head validates unchanged under this registry;
//   upgrade-required  it validates only after feature upgrades, which only
//                     `document.upgrade` applies, as its own revision;
//   read-only         this build cannot validate it (an unknown, newer or
//                     retired feature or generator). Reads, retries of earlier
//                     requests, policy changes and discarding drafts still work.

import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { documentDigest, documentJson, readDocument } from "./document.js";
import type { Registry } from "./registry.js";
import type { CharacterDocument } from "./schema.js";
import { detach, own } from "./state.js";

export type Access =
  | { readonly mode: "writable" }
  | {
      readonly mode: "upgrade-required";
      /** The head after this build's feature upgrades. */
      readonly upgraded: CharacterDocument;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    }
  | { readonly mode: "read-only"; readonly diagnostics: ReadonlyArray<Diagnostic> };

const writable: Access = Object.freeze({ mode: "writable" });
const cache = new WeakMap<CharacterDocument, WeakMap<Registry, Access>>();

/** Record that `doc` was just validated unchanged under `registry`. */
export function markWritable(doc: CharacterDocument, registry: Registry): void {
  let byRegistry = cache.get(doc);
  if (!byRegistry) {
    byRegistry = new WeakMap();
    cache.set(doc, byRegistry);
  }
  byRegistry.set(registry, writable);
}

export function headAccess(doc: CharacterDocument, registry: Registry): Access {
  const known = cache.get(doc)?.get(registry);
  if (known) return known;
  const checked = readDocument(detach(documentJson(doc)), { registry });
  let access: Access;
  if (!checked.ok) access = Object.freeze({ mode: "read-only", diagnostics: checked.diagnostics });
  else if (documentDigest(checked.value) === documentDigest(doc)) access = writable;
  else
    access = Object.freeze({
      mode: "upgrade-required",
      upgraded: own(checked.value),
      diagnostics: [
        diagnostic(
          "upgrade-required",
          ["requires"],
          "This build reads the document only after upgrading its features. Send document.upgrade first.",
        ),
      ],
    });
  let byRegistry = cache.get(doc);
  if (!byRegistry) {
    byRegistry = new WeakMap();
    cache.set(doc, byRegistry);
  }
  byRegistry.set(registry, access);
  return access;
}
