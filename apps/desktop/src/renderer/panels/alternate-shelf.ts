import { readDocument, type Registry, type CharacterDocument } from "@irudd/document";
import { byId, button, el } from "../dom.js";
import { failure, type PanelContext } from "./context.js";

interface Cover {
  id: string;
  project: string;
  title: string;
  thumbnail: string;
  savedAt: number;
  document: CharacterDocument;
}

let opened: Promise<IDBDatabase> | undefined;
function database() {
  return (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("irudd-desktop-alternates", 1);
    request.onupgradeneeded = () =>
      request.result
        .createObjectStore("covers", { keyPath: "id" })
        .createIndex("project", "project");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((e: unknown) => {
    opened = undefined;
    throw e;
  }));
}
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("covers", mode),
      request = work(tx.objectStore("covers"));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error("The alternate shelf could not be saved."));
  });
}

export function alternateShelf(
  ctx: PanelContext,
  preview: (id: string) => Promise<void>,
  registry: () => Registry,
) {
  const shelf = byId("alternate-shelf", HTMLDivElement);
  let revision = 0;
  const projectKey = () => ctx.project?.directory;
  async function render() {
    const project = projectKey(),
      ticket = ++revision;
    if (!project) {
      shelf.replaceChildren();
      return;
    }
    try {
      const stored: readonly unknown[] = await transact("readonly", (store) =>
        store.index("project").getAll(project),
      );
      const covers = stored.flatMap((raw) => {
        if (
          !raw ||
          typeof raw !== "object" ||
          !("id" in raw) ||
          typeof raw.id !== "string" ||
          !("title" in raw) ||
          typeof raw.title !== "string" ||
          !("thumbnail" in raw) ||
          typeof raw.thumbnail !== "string" ||
          !("savedAt" in raw) ||
          typeof raw.savedAt !== "number" ||
          !("document" in raw)
        )
          return [];
        return [
          {
            id: raw.id,
            title: raw.title,
            savedAt: raw.savedAt,
            thumbnail: raw.thumbnail,
            document: raw.document,
          },
        ];
      });
      if (ticket !== revision || project !== projectKey()) return;
      shelf.replaceChildren(
        ...covers
          .sort((a, b) => b.savedAt - a.savedAt)
          .map((cover) => {
            const picture = el("img");
            picture.src = cover.thumbnail;
            picture.alt = "";
            picture.height = 56;
            const open = button(cover.title, async () => {
              try {
                const documentId = ctx.documentId,
                  original = ctx.doc;
                if (!documentId || !original || !ctx.view) return;
                const revision = ctx.view.revision;
                const saved = readDocument(cover.document, { registry: registry() });
                if (!saved.ok) throw new Error("This variation could not be opened.");
                const proposal = "prop-" + crypto.randomUUID();
                const document: CharacterDocument = {
                  ...saved.value,
                  id: original.id,
                  label: original.label,
                };
                if (
                  await ctx.commit(
                    {
                      type: "proposal.create",
                      proposal,
                      summary: cover.title,
                      content: { kind: "replace", document },
                    },
                    "Compare saved variation",
                    { documentId, revision },
                  )
                )
                  await preview(proposal);
              } catch (e) {
                ctx.showBanner("error", failure(e));
              }
            });
            open.prepend(picture);
            const remove = button("Remove", async () => {
              try {
                await transact("readwrite", (s) => s.delete(cover.id));
                await render();
              } catch (e) {
                ctx.showBanner("error", failure(e));
              }
            });
            remove.setAttribute("aria-label", "Remove " + cover.title);
            return el("div", { className: "row-actions" }, open, remove);
          }),
      );
    } catch (e) {
      ctx.showBanner("error", failure(e));
    }
  }
  return {
    render,
    async save(cover: Cover) {
      await transact("readwrite", (s) => s.put(cover));
      await render();
    },
  };
}
