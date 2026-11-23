const key = "irudd-character-workshop-v1";
let opening,
  sequence = 0,
  queue = Promise.resolve();
function database() {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open("irudd-character-workshop", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("sessions");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return opening;
}
async function disk(mode, write) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", mode),
      store = tx.objectStore("sessions");
    const r = write ? store.put(write, key) : store.get(key);
    tx.oncomplete = () => resolve(r.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? r.error);
  });
}
export async function readSession() {
  let local;
  try {
    local = JSON.parse(localStorage.getItem(key));
  } catch {}
  if (local && !local.database) return local;
  try {
    return await disk("readonly");
  } catch {
    return null;
  }
}
export function saveSession(state) {
  const current = ++sequence;
  // Small forms are synchronous, including previously saved workshop sessions.
  // Large artworks stay in IndexedDB, where an entire document is committed atomically.
  try {
    if (Object.keys(state.form.artwork ?? {}).length === 0) {
      localStorage.setItem(key, JSON.stringify(state));
      return Promise.resolve();
    }
  } catch {}
  const next = queue
    .catch(() => {})
    .then(async () => {
      if (current !== sequence) return;
      await disk("readwrite", state);
      if (current === sequence) {
        try {
          localStorage.setItem(key, JSON.stringify({ database: true }));
        } catch {}
      }
    });
  queue = next;
  return next;
}
