let opening;
function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("irudd-character-alternates", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("covers", { keyPath: "id" });
        request.result.createObjectStore("forms");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}
async function transact(names, mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode),
      last = action(tx);
    tx.oncomplete = () => resolve(last?.result);
    tx.onabort = tx.onerror = () =>
      reject(
        tx.error ?? new Error("Browser storage could not save this variation."),
      );
  });
}
export async function listAlternates() {
  const list = await transact(["covers"], "readonly", (tx) =>
    tx.objectStore("covers").getAll(),
  );
  return list.sort((a, b) => b.savedAt - a.savedAt);
}
export function saveAlternate(cover, form) {
  return transact(["covers", "forms"], "readwrite", (tx) => {
    tx.objectStore("covers").put(cover);
    return tx.objectStore("forms").put(form, cover.id);
  });
}
export function loadAlternate(id) {
  return transact(["forms"], "readonly", (tx) =>
    tx.objectStore("forms").get(id),
  );
}
export function removeAlternate(id) {
  return transact(["covers", "forms"], "readwrite", (tx) => {
    tx.objectStore("covers").delete(id);
    return tx.objectStore("forms").delete(id);
  });
}
