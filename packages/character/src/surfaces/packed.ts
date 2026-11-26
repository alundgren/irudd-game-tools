const decoded = new Map<string, Uint8Array>();

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
