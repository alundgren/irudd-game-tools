// Byte fields stored as base64 in a document, such as a portrait's depth
// field and a hair cap's mask, decoded once while recent builds reuse them.

const decoded = new Map<string, Uint8Array>();

/** The bytes of a base64 field. */
export function unpack(field: string): Uint8Array {
  let bytes = decoded.get(field);
  if (!bytes) {
    const oldest = decoded.keys().next();
    if (decoded.size >= 24 && !oldest.done) decoded.delete(oldest.value);
    bytes = Uint8Array.from(atob(field), (c) => c.charCodeAt(0));
    decoded.set(field, bytes);
  }
  return bytes;
}
