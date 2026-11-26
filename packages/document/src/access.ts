import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { documentDigest, documentJson, readDocument } from "./document.js";
import type { Registry } from "./registry.js";
import type { CharacterDocument } from "./schema.js";
import { detach, own } from "./state.js";

export type Access =
  | { readonly mode: "writable" }
  | {
      readonly mode: "upgrade-required";
      readonly upgraded: CharacterDocument;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    }
  | { readonly mode: "read-only"; readonly diagnostics: ReadonlyArray<Diagnostic> };

const writable: Access = Object.freeze({ mode: "writable" });
const cache = new WeakMap<CharacterDocument, WeakMap<Registry, Access>>();

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
