import { readDocument, type CharacterDocument, type Registry } from "@irudd/document";
import { protectedChanges } from "../protected-shape.js";
import { describe, failure } from "./context.js";
import { byId, button, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountProposals(
  ctx: PanelContext,
  actions: {
    readonly createCopy: (doc: CharacterDocument, label: string) => Promise<boolean>;
    readonly protectedParts: (id: string) => readonly string[];
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

  const name = byId("variation-name", HTMLInputElement),
    keep = byId("save-variation", HTMLButtonElement);
  let saving = false;
  async function save(doc: CharacterDocument, label: string) {
    if (saving) return;
    saving = true;
    try {
      await actions.createCopy(doc, name.value.trim() || label);
      name.value = "";
    } catch (e) {
      showBanner("error", failure(e));
    } finally {
      saving = false;
    }
  }
  keep.onclick = () => {
    if (ctx.doc) void save(ctx.doc, ctx.doc.label + " variation");
  };
  function changeLines(
    changes: ReadonlyArray<{ readonly path: ReadonlyArray<string> }>,
  ): HTMLElement {
    const shown = changes.slice(0, 8).map((c) => el("li", { text: c.path.join(".") }));
    if (changes.length > 8) shown.push(el("li", { text: `… ${changes.length - 8} more` }));
    return el("ul", { className: "changes" }, ...shown);
  }

  function warning(p: NonNullable<PanelContext["view"]>["proposals"][number]) {
    const ids = protectedChanges(ctx.doc, ctx.humanBody, p.changes, actions.protectedParts(p.id));
    return ids.length
      ? el("p", {
          className: "protected-warning",
          text:
            "This proposal changes protected geometry: " +
            ids.map((id) => (ctx.part(id)?.label ?? id) + " (" + id + ")").join(", "),
        })
      : null;
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
          warning(draft.proposal),
          draft.stale ? `The document has moved on. ${rebased}` : "",
        ),
        button("Accept", () => void accept(proposalId, draft.proposal.version)),
        button("Reject", () => void discard(proposalId)),
        button(
          "Keep alternate",
          () => void save(read.value, draft.proposal.summary + " alternate"),
        ),
        button("Show current", async () => {
          preview = false;
          await showHead();
          if (ctx.documentId === documentId)
            showBanner(
              "info",
              "Current character",
              button("Show proposal", () => void showPreview(proposalId)),
              button("Close", endPreview),
            );
        }),
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

  function refinement(id: string, version: number, agent: string) {
    const input = el("input");
    input.setAttribute("aria-label", "Refinement notes");
    input.placeholder = "What should change?";
    const documentId = ctx.documentId;
    const send = button("Request refinement", async () => {
      if (!documentId || !input.value.trim()) return;
      send.disabled = true;
      try {
        await host.call("steer.send", {
          requestId: "steer-" + crypto.randomUUID(),
          documentId,
          agent,
          text:
            "Refine proposal " +
            id +
            " version " +
            version +
            " using proposal.refine. " +
            input.value.trim(),
        });
        ctx.say("Requested refinement from " + agent);
        input.value = "";
      } catch (e) {
        showBanner("error", failure(e));
      } finally {
        send.disabled = false;
      }
    });
    return el("div", {}, input, send);
  }
  function renderProposals(): void {
    keep.disabled = !ctx.doc || preview;
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
          warning(p),
          changeLines(p.changes),
          p.author.kind === "agent" ? refinement(p.id, p.version, p.author.id) : null,
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
