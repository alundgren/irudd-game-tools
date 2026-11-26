import type { HistoryItem } from "@irudd/workshop/contract";
import { failure } from "./context.js";
import { byId, button, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountHistory(ctx: PanelContext) {
  const { commit, host, say } = ctx;
  function lastOwn(kind: "undoable" | "redoable"): HistoryItem | undefined {
    const items = [...(ctx.view?.history ?? [])].reverse();
    return items.find(
      (h) =>
        h.actor.kind === "human" &&
        !h.undone &&
        h.kind !== "create" &&
        h.kind !== "upgrade" &&
        (kind === "redoable" ? h.kind === "undo" : h.kind !== "undo"),
    );
  }

  async function undo(target: number, what: string): Promise<void> {
    await commit({ type: "undo", target }, what);
  }
  const history = byId("history", HTMLOListElement);
  const historyFilter = byId("history-filter", HTMLSelectElement);
  const attribution = byId("attribution", HTMLParagraphElement);
  historyFilter.onchange = () => renderHistory();

  function renderHistory(): void {
    const { view } = ctx;
    history.replaceChildren();
    const filter = historyFilter.value;
    const items = [...(view?.history ?? [])]
      .reverse()
      .filter((h) => filter === "all" || h.author.kind === filter || h.actor.kind === filter);
    for (const h of items) {
      const who =
        h.author.id === h.actor.id
          ? (h.author.name ?? h.author.id)
          : `${h.author.name ?? h.author.id} via ${h.actor.name ?? h.actor.id}`;
      const what =
        h.summary ??
        (h.kind === "undo"
          ? `Undo revision ${h.undoes ?? "?"}`
          : h.kind === "restore"
            ? `Restore revision ${h.restores ?? "?"}`
            : h.kind);
      const actions = el("span");
      if (h.kind !== "create" && !h.undone)
        actions.append(button("Undo", () => void undo(h.revision, `Undo revision ${h.revision}`)));
      if (view && h.revision < view.revision)
        actions.append(
          button(
            "Restore",
            () =>
              void commit(
                { type: "restore", revision: h.revision },
                `Restore revision ${h.revision}`,
              ),
          ),
        );
      history.append(
        el(
          "li",
          { className: h.undone ? "undone" : "" },
          el("span", { className: "muted", text: `r${h.revision}` }),
          el(
            "span",
            {},
            el("span", { className: "what", text: `${what} ` }),
            el("span", {
              className: h.author.kind === "agent" ? "actor-agent" : "actor-human",
              text: who,
            }),
            el("span", {
              className: "muted",
              text: ` · ${h.changeCount} changes${h.undone ? " · undone" : ""}`,
            }),
          ),
          actions,
        ),
      );
    }
  }

  async function renderAttribution(): Promise<void> {
    const { view, documentId } = ctx;
    attribution.textContent = "";
    if (!documentId || !view) return;
    try {
      const mine = await host.call("changes", { documentId, since: 0, by: "human" });
      const fields = new Set(mine.deltas.flatMap((d) => d.changes.map((c) => c.path.join("."))));
      const agents = view.history.filter((h) => h.author.kind === "agent").length;
      attribution.textContent = `Manual edits by people: ${mine.deltas.length} revisions touching ${fields.size} fields. Agent-authored revisions: ${agents}.`;
    } catch (error) {
      attribution.textContent = failure(error);
    }
  }
  async function undoLast(): Promise<void> {
    const item = lastOwn("undoable");
    if (item) await undo(item.revision, `Undo ${item.summary ?? `revision ${item.revision}`}`);
    else say("Nothing of yours to undo.");
  }

  async function redoLast(): Promise<void> {
    const item = lastOwn("redoable");
    if (item) await undo(item.revision, `Redo revision ${item.undoes ?? item.revision}`);
    else say("Nothing to redo.");
  }

  byId("undo", HTMLButtonElement).onclick = () => void undoLast();
  byId("redo", HTMLButtonElement).onclick = () => void redoLast();
  return {
    render() {
      renderHistory();
      void renderAttribution();
    },
    undoLast,
    redoLast,
  };
}
