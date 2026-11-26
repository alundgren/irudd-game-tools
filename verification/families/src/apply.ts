// Apply operations to a fixture as a client sends them, then validate the result.

import {
  applyOperations,
  decodeOperations,
  validateDocument,
  type CharacterDocument,
} from "@irudd/document";
import { familyRegistry } from "./prepare.js";

export function applyChecked(doc: CharacterDocument, ops: unknown): CharacterDocument {
  const decoded = decodeOperations(ops);
  if (!decoded.ok) throw new Error(JSON.stringify(decoded.diagnostics));
  const applied = applyOperations(doc, decoded.value, {
    registry: familyRegistry,
    retired: new Set(),
    idFor: (slot) => {
      throw new Error("No generated slots in a manual edit: " + slot);
    },
  });
  if (!applied.ok) throw new Error(JSON.stringify(applied.diagnostics));
  const checked = validateDocument(applied.value, { registry: familyRegistry });
  if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));
  return checked.value;
}
