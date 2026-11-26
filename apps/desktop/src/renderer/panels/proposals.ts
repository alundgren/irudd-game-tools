import { readDocument, type CharacterDocument, type Registry } from "@irudd/document";
import { describe, failure } from "./context.js";
import { byId, button, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountProposals(
  ctx: PanelContext,
  actions: {
    readonly registry: () => Registry;
    readonly displayDocument: (doc: CharacterDocument) => Promise<boolean>;
    readonly showHead: () => Promise<void>;
    readonly hideBanner: () => void;
  },
) {
  const { host, showBanner, commit } = ctx;
  const { showHead, displayDocument, hideBanner } = actions;
  let preview = false;
  const proposals = byId("proposals", HTMLDivElement);

  function changeLines(
    changes: ReadonlyArray<{ readonly path: ReadonlyArray<string> }>,
  ): HTMLElement {
    const shown = changes.slice(0, 8).map((c) => el("li", { text: c.path.join(".") }));
    if (changes.length > 8) shown.push(el("li", { text: `… ${changes.length - 8} more` }));
    return el("ul", { className: "changes" }, ...shown);
  }

  async function showPreview(proposalId: string): Promise<void> {
    const { documentId, project } = ctx;
    if (!documentId) return;
    try {
      const draft = await host.call("draft", { documentId, proposalId });
      if (ctx.documentId !== documentId || ctx.project !== project) return;
      if (!draft.ok) {
        showBanner("error", `The proposal cannot be previewed: ${describe(draft.diagnostics)}`);
        return;
      }
      const read = readDocument(draft.preview, { registry: actions.registry() });
      if (!read.ok) {
        showBanner("error", `The preview is not a valid document: ${describe(read.diagnostics)}`);
        return;
      }
      preview = true;
      if (!(await displayDocument(read.value))) return;
      const rebased = draft.rebased.ok
        ? `${draft.rebased.changes.length} changes still apply to the current revision.`
        : `It conflicts with the current revision: ${describe(draft.rebased.diagnostics)}`;
      showBanner(
        "info",
        el(
          "span",
          {},
          el("strong", { text: `Previewing “${draft.proposal.summary}”` }),
          ` by ${draft.proposal.author.name ?? draft.proposal.author.id}, ${draft.changes.length} changes on revision ${draft.proposal.baseRevision}. `,
          draft.stale ? `The document has moved on. ${rebased}` : "",
        ),
        button("Accept", () => void accept(proposalId, draft.proposal.version)),
        button("Reject", () => void discard(proposalId)),
        button("Back to the document", endPreview),
      );
    } catch (error) {
      preview = false;
      void showHead();
      showBanner("error", `Preview failed: ${failure(error)}`);
    }
  }

  function endPreview(): void {
    preview = false;
    hideBanner();
    void showHead();
  }

  async function accept(proposal: string, version: number): Promise<void> {
    preview = true;
    const done = await commit({ type: "proposal.accept", proposal, version }, "Accept proposal");
    preview = false;
    if (done) hideBanner();
    void showHead();
  }

  async function discard(proposal: string): Promise<void> {
    preview = true;
    const done = await commit({ type: "proposal.discard", proposal }, "Reject proposal");
    preview = false;
    if (done) hideBanner();
    void showHead();
  }

  function renderProposals(): void {
    proposals.replaceChildren();
    const open = (ctx.view?.proposals ?? []).filter((p) => p.status === "draft");
    const closed = (ctx.view?.proposals ?? []).filter((p) => p.status !== "draft");
    if (!open.length) proposals.append(el("p", { className: "muted", text: "No open proposals." }));
    for (const p of open)
      proposals.append(
        el(
          "div",
          { className: "proposal" },
          el("strong", { text: p.summary }),
          el("span", {
            className: p.author.kind === "agent" ? "actor-agent" : "actor-human",
            text: `${p.author.name ?? p.author.id} · version ${p.version} · base revision ${p.baseRevision}`,
          }),
          changeLines(p.changes),
          el(
            "div",
            { className: "actions" },
            button("Preview", () => void showPreview(p.id)),
            button("Accept", () => void accept(p.id, p.version)),
            button("Reject", () => void discard(p.id)),
          ),
        ),
      );
    if (closed.length)
      proposals.append(
        el(
          "p",
          { className: "muted" },
          closed
            .map(
              (p) =>
                `${p.summary}: ${p.status}${p.acceptedRevision ? ` in revision ${p.acceptedRevision}` : ""}`,
            )
            .join(" · "),
        ),
      );
  }
  return {
    render: renderProposals,
    get active() {
      return preview;
    },
    reset() {
      preview = false;
    },
    endPreview,
  };
}
