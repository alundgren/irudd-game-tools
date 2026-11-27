import { buildView, visibleIn } from "@irudd/character";
import { readDocument, type CharacterDocument, type Registry } from "@irudd/document";
import type { GameInspection } from "@irudd/character/proposal-export";
import { readImageChunks, stagePicture, toBase64, type BriefDraft } from "../art-files.js";
import { alternateShelf } from "./alternate-shelf.js";
import { proposalReviews } from "./export-review.js";
import { protectedChanges } from "../protected-shape.js";
import { describe, failure } from "./context.js";
import { byId, button, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountProposals(
  ctx: PanelContext,
  actions: {
    readonly guide: () => {
      spatialGuide: import("@irudd/document").Json;
      surfaceMarks: import("@irudd/document").Json;
    };
    readonly reference: (rear: boolean) => Promise<{ bytes: Uint8Array; height: number }>;
    readonly thumbnail: () => string;
    readonly createCopy: (doc: CharacterDocument, label: string) => Promise<string | undefined>;
    readonly protectedParts: (id: string) => readonly string[];
    readonly inspect: (
      doc: CharacterDocument,
      revision: number,
      previous?: GameInspection,
    ) => Promise<GameInspection>;
    readonly enrich: (brief: BriefDraft) => BriefDraft;
    readonly selectedAgent: () => string;
    readonly originalBrief: (id: string) => BriefDraft | undefined;
    readonly registry: () => Registry;
    readonly displayDocument: (doc: CharacterDocument) => Promise<boolean>;
    readonly showHead: () => Promise<void>;
    readonly hideBanner: () => void;
  },
) {
  const { host, showBanner, commit } = ctx;
  const { showHead, displayDocument, hideBanner } = actions;
  let preview = false;
  let inspectVisible: (() => Promise<void>) | undefined;
  let ticket = 0;
  const reviews = proposalReviews(ctx, actions.inspect);
  const proposals = byId("proposals", HTMLDivElement);

  const name = byId("variation-name", HTMLInputElement),
    keep = byId("save-variation", HTMLButtonElement);
  const shelf = alternateShelf(ctx, showPreview, actions.registry);
  let saving = false;
  async function save(doc: CharacterDocument, label: string, thumbnail = actions.thumbnail()) {
    if (saving) return;
    saving = true;
    try {
      const title = (name.value.trim() || label).slice(0, 120),
        project = ctx.project?.directory;
      const id = await actions.createCopy(doc, title);
      if (id && project)
        await shelf.save({ id, project, title, thumbnail, savedAt: Date.now(), document: doc });
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

  async function showPreview(proposalId: string, version?: number): Promise<void> {
    const token = ++ticket;
    const { documentId, project } = ctx;
    if (!documentId) return;
    try {
      const draft = await host.call("draft", {
        documentId,
        proposalId,
        ...(version ? { version } : {}),
      });
      if (token !== ticket || ctx.documentId !== documentId || ctx.project !== project) return;
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
      const thumbnail = actions.thumbnail();
      const latest =
        ctx.view?.proposals.find((p) => p.id === proposalId)?.version ?? draft.proposal.version;
      inspectVisible = () =>
        reviews.open(proposalId, draft.proposal.version, read.value, draft.proposal.baseRevision);
      const candidate = buildView(read.value);
      const outfit = candidate.outfit;
      const existing = new Set<string>(ctx.doc?.parts.map((p) => p.id));
      const hidden = candidate.parts.filter((p) => !existing.has(p.id) && !visibleIn(candidate, p));
      const historical = latest !== draft.proposal.version;
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
          hidden.length
            ? "Hidden in " + outfit + ": " + hidden.map((p) => p.label).join(", ") + ". "
            : "",
          draft.stale ? `The document has moved on. ${rebased}` : "",
        ),
        historical
          ? button("Restore this proposal", async () => {
              if (
                await commit(
                  {
                    type: "proposal.refine",
                    proposal: proposalId,
                    version: latest,
                    summary: draft.proposal.summary,
                    content: { kind: "replace", document: read.value },
                  },
                  "Restore earlier proposal",
                )
              )
                await showPreview(proposalId);
            })
          : button("Accept", () => void accept(proposalId, draft.proposal.version)),
        button(
          "Inspect proposal game export",
          () =>
            void reviews.open(
              proposalId,
              draft.proposal.version,
              read.value,
              draft.proposal.baseRevision,
            ),
        ),
        ...(draft.proposal.version > Math.max(1, latest - 8)
          ? [
              button(
                "Show previous proposal",
                () => void showPreview(proposalId, draft.proposal.version - 1),
              ),
            ]
          : []),
        ...(historical ? [button("Show latest proposal", () => void showPreview(proposalId))] : []),
        button("Reject", () => void discard(proposalId)),
        button(
          "Keep alternate",
          () => void save(read.value, draft.proposal.summary + " alternate", thumbnail),
        ),
        button("Show current", async () => {
          preview = false;
          await showHead();
          if (ctx.documentId === documentId)
            showBanner(
              "info",
              "Current character",
              button("Show proposal", () => void showPreview(proposalId, version)),
              button(
                "Keep alternate",
                () => void save(read.value, draft.proposal.summary + " alternate", thumbnail),
              ),
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

  function refinement(id: string, version: number, agent?: string) {
    const input = el("input");
    input.setAttribute("aria-label", "Refinement notes");
    input.placeholder = "What should change?";
    const documentId = ctx.documentId;
    async function prepare(offline: boolean) {
      const notes =
        input.value.trim() ||
        (reviews.get(id, version)
          ? "Inspect the attached game export and correct one visible defect in the original direction. Describe the defect and the change. Preserve unrelated work. Return an empty operations list if there is no visible defect."
          : "");
      if (!documentId || !notes) return;
      const recipient = agent ?? actions.selectedAgent();
      if (!offline && !recipient) {
        ctx.say("Choose a paired agent in Artwork or export the refinement.");
        return;
      }
      send.disabled = true;
      try {
        const p = ctx.view?.proposals.find((p) => p.id === id);
        if (!p || p.version !== version || ctx.documentId !== documentId) return;
        await showPreview(id);
        const draft = await host.call("draft", { documentId, proposalId: id });
        if (!draft.ok || draft.proposal.version !== version || draft.stale || !preview)
          throw new Error("The character or proposal changed. Use the latest draft.");
        const guide = actions.guide();
        const original = actions.originalBrief(id);
        const text =
          "Refine proposal " +
          id +
          " version " +
          version +
          " using variation operations on its visible draft. " +
          notes;
        const images = await reviews.attachments(id, version);
        const views = images.attachments.length
          ? images.attachments
          : await Promise.all(
              [false, true].map(async (rear) => {
                const view = await actions.reference(rear);
                return {
                  role: rear ? ("back" as const) : ("whole" as const),
                  label: rear ? "Rear quarter" : "Whole proposed character",
                  digest: (await stagePicture(host, view.bytes)).digest,
                };
              }),
            );
        const enriched = actions.enrich({
          format: "irudd.art-brief",
          version: 1,
          kind: "variation",
          fromSteer: true,
          documentId,
          revision: p.baseRevision,
          direction: text,
          attachments: [
            ...views,
            ...(original?.attachments.filter((a) => a.role === "reference") ?? []),
          ],
          protected: actions
            .protectedParts(id)
            .filter((key) => draft.preview.parts.some((part) => part.id === key)),
          refinement: {
            proposal: id,
            version,
            summary: p.summary,
            earlierDirection: original?.direction ?? "",
            ...guide,
            ...(images.detail ? { exportReview: images.detail } : {}),
          },
        });
        if (
          ctx.documentId !== documentId ||
          ctx.view?.proposals.find((p) => p.id === id)?.version !== version
        )
          return;
        const brief = {
          ...enriched,
          protected: (enriched.protected ?? []).filter((key) =>
            draft.preview.parts.some((part) => part.id === key),
          ),
        };
        if (offline) {
          const files = await Promise.all(
            brief.attachments.map(async (a) => {
              const f = await readImageChunks(a.digest, (offset) =>
                host.call("project.image", { digest: a.digest, offset }),
              );
              return { ...a, mediaType: f.mediaType, base64: toBase64(f.bytes) };
            }),
          );
          const link = el("a");
          link.href = URL.createObjectURL(
            new Blob([JSON.stringify({ brief, preview: draft.preview, files })], {
              type: "application/json",
            }),
          );
          link.download = id + "-v" + version + "-refinement.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          ctx.say("Exported refinement for " + id);
          return;
        }
        await host.call("art.request", {
          agent: recipient,
          requestId: "refine-" + crypto.randomUUID(),
          brief,
        });
        ctx.say("Requested refinement from " + recipient);
        input.value = "";
      } catch (e) {
        showBanner("error", failure(e));
      } finally {
        send.disabled = false;
      }
    }
    const send = button("Request refinement", () => prepare(false));
    const exportFile = button("Export refinement", () => prepare(true));
    const file = el("input");
    file.type = "file";
    file.accept = ".json";
    file.hidden = true;
    file.onchange = async () => {
      try {
        const picked = file.files?.[0];
        file.value = "";
        if (!picked) return;
        const raw: unknown = JSON.parse(await picked.text());
        if (
          !raw ||
          typeof raw !== "object" ||
          !("proposal" in raw) ||
          raw.proposal !== id ||
          !("version" in raw) ||
          raw.version !== version ||
          !("documentId" in raw) ||
          raw.documentId !== documentId ||
          !("revision" in raw) ||
          raw.revision !== ctx.view?.revision ||
          !("operations" in raw) ||
          !Array.isArray(raw.operations) ||
          !("summary" in raw) ||
          typeof raw.summary !== "string"
        )
          throw new Error(
            "Return the exported documentId, revision, proposal and version with a summary and operations.",
          );
        if (
          await commit(
            {
              type: "proposal.refine",
              proposal: id,
              version,
              summary: raw.summary,
              content: { kind: "draft-ops", ops: raw.operations },
            },
            "Import refinement",
          )
        )
          await showPreview(id);
      } catch (e) {
        showBanner("error", failure(e));
      }
    };
    return el(
      "div",
      {},
      input,
      send,
      exportFile,
      button("Load refinement", () => file.click()),
      file,
    );
  }
  function renderProposals(): void {
    keep.disabled = !ctx.doc || preview;
    void shelf.render();
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
          refinement(p.id, p.version, p.author.kind === "agent" ? p.author.id : undefined),
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
    inspectVisible: () => (preview ? inspectVisible?.() : undefined),
    get active() {
      return preview;
    },
    reset() {
      ticket++;
      reviews.reset();
      preview = false;
    },
    endPreview,
  };
}
