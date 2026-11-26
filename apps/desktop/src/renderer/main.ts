// The workshop window: project, outliner, viewport, properties, proposals,
// history and the GLB library.
//
// Every change the person makes is one command envelope sent through the
// shared host as the person: one gesture, one rename or one field edit is one
// revision. The window shows what the host committed, so edits from agents,
// the CLI or another window appear as they land.

import "@irudd/player/player.css";
import "./style.css";
import {
  commandFormat,
  commandVersion,
  createRegistry,
  familyFeatures,
  frameCreature,
  outfitLooks,
  readDocument,
  type CharacterDocument,
  type Diagnostic,
  type Part,
} from "@irudd/document";
import { domRaster } from "@irudd/character";
import { humanAdultGenerator, humanAdultId, loadHumanPacks } from "@irudd/character/human";
import {
  loadHumanPaint,
  prepareHumanPaint,
  type HumanPaintSources,
} from "@irudd/character/human/paint";
import { Player, mountControls, type InspectionSheet } from "@irudd/player";
import type { MethodResults, ReviewPreset } from "@irudd/workshop/wire";
import type { ApplyResult, HistoryItem, InspectView } from "@irudd/workshop/contract";
import type { AppInfo, LibraryEntry, ProjectState } from "../shared/api.js";
import { bridge, CallFailed, workshop } from "./bridge.js";
import { byId, button, el, numberInput } from "./dom.js";
import { mountArt } from "./art.js";
import { readImageChunks } from "./art-files.js";
import { ViewportPaint } from "./viewport-paint.js";
import { mountSteering } from "./steering.js";
import { mountUpdates } from "./update.js";
import { EditorViewport, type Tool, type Transform } from "./viewport.js";

const api = bridge();
const host = workshop(api);
const viewportPaint = new ViewportPaint();
let displaySequence = 0;
let headRequest = 0;
/** The same features and generators the host's registry holds; the adult joins once its packs are read. */
let registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });

// ── State ───────────────────────────────────────────────────────────────────

let app: AppInfo | undefined;
let project: ProjectState["project"] = null;
let documentId: string | undefined;
let view: InspectView | undefined;
let doc: CharacterDocument | undefined;
let preview: { proposal: string; version: number } | undefined;
/**
 * The character and revision a gizmo drag started on. The release commits
 * against exactly this base; any other commit to that character during the
 * drag cancels it, so a move never lands silently on a changed character.
 */
let dragBase: { documentId: string; revision: number; part: string } | undefined;
let busy = false;

const statusLine = byId("status", HTMLSpanElement);
const statusRight = byId("status-right", HTMLSpanElement);
const banner = byId("banner", HTMLDivElement);

function say(text: string): void {
  statusLine.textContent = text;
}

function showBanner(kind: "info" | "error", ...content: (Node | string)[]): void {
  banner.className = kind === "error" ? "banner error" : "banner";
  banner.replaceChildren(...content, button("Dismiss", hideBanner));
  banner.hidden = false;
}

function hideBanner(): void {
  banner.hidden = true;
  banner.replaceChildren();
}

function describe(diagnostics: ReadonlyArray<Diagnostic>): string {
  return diagnostics
    .map((d) => `${d.message}${d.path.length ? ` (${d.path.join(".")})` : ""}`)
    .join(" ");
}

function failure(error: unknown): string {
  if (error instanceof CallFailed) return `${error.tag}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// ── Viewport ────────────────────────────────────────────────────────────────

const viewport = new EditorViewport(byId("viewport", HTMLDivElement), {
  onPick: (part) => selectPart(part),
  onDragStart: (part) => {
    dragBase = view && documentId ? { documentId, revision: view.revision, part } : undefined;
  },
  onDragEnd: (part, transform) => {
    const base = dragBase;
    dragBase = undefined;
    if (transform && base && base.part === part) void gesture(part, transform, base);
  },
});

const toolButtons: Record<Tool, HTMLButtonElement> = {
  select: byId("tool-select", HTMLButtonElement),
  translate: byId("tool-move", HTMLButtonElement),
  rotate: byId("tool-rotate", HTMLButtonElement),
  scale: byId("tool-scale", HTMLButtonElement),
};

function setTool(tool: Tool): void {
  viewport.setTool(tool);
  for (const [name, b] of Object.entries(toolButtons)) b.classList.toggle("on", name === tool);
}
for (const [name, b] of Object.entries(toolButtons))
  b.onclick = () => {
    if (name === "select" || name === "translate" || name === "rotate" || name === "scale")
      setTool(name);
  };

function selectPart(part: string | null): void {
  viewport.select(part);
  // Mark the row in place: rebuilding the tree would swallow a double-click.
  for (const row of outliner.querySelectorAll<HTMLElement>(".row"))
    row.classList.toggle("selected", row.dataset["part"] === part);
  renderProperties();
}

// ── Commands ────────────────────────────────────────────────────────────────

function requestId(): string {
  return `desk-${crypto.randomUUID()}`;
}

/**
 * Send one command as the person against the revision on screen. A refusal
 * is shown and the screen goes back to the committed document.
 */
async function commit(
  command: Record<string, unknown>,
  what: string,
  base?: { readonly documentId: string; readonly revision: number },
): Promise<boolean> {
  if (!view || !documentId || busy) return false;
  if (base && (base.documentId !== documentId || base.revision !== view.revision)) {
    showBanner("error", `${what} was not applied: the character changed while you worked.`);
    await loadDocument();
    return false;
  }
  if (preview && command["type"] !== "proposal.accept" && command["type"] !== "proposal.discard") {
    showBanner("error", "Leave the proposal preview before editing.");
    void showHead();
    return false;
  }
  busy = true;
  const request = {
    format: commandFormat,
    version: commandVersion,
    requestId: requestId(),
    documentId: base?.documentId ?? documentId,
    expectedRevision: base?.revision ?? view.revision,
    command,
  };
  let result: ApplyResult;
  try {
    result = await host.call("apply", { request });
  } catch (error) {
    busy = false;
    showBanner("error", `${what} failed: ${failure(error)}`);
    void showHead();
    return false;
  }
  busy = false;
  if (result.kind === "rejected") {
    const stale = result.diagnostics.some((d) => d.code === "stale-revision");
    showBanner(
      "error",
      stale
        ? `${what} was not applied: the document changed while you worked. It now shows the latest revision.`
        : `${what} was refused: ${describe(result.diagnostics)}`,
    );
    await loadDocument();
    return false;
  }
  say(`${what} · revision ${result.receipt.revision}`);
  await loadDocument();
  return true;
}

function part(id: string): Part | undefined {
  return doc?.parts.find((p) => p.id === id);
}

async function gesture(
  id: string,
  transform: Transform,
  base: { readonly documentId: string; readonly revision: number },
): Promise<void> {
  const label = part(id)?.label ?? id;
  const verb =
    transform.kind === "translate" ? "Move" : transform.kind === "rotate" ? "Rotate" : "Resize";
  const op =
    transform.kind === "translate"
      ? { op: "part.transform", part: id, translate: transform.translate }
      : transform.kind === "rotate"
        ? { op: "part.transform", part: id, rotate: transform.rotate }
        : { op: "part.transform", part: id, scale: transform.scale };
  await commit({ type: "edit", ops: [op], summary: `${verb} ${label}` }, `${verb} ${label}`, base);
}

async function setPart(id: string, set: Record<string, unknown>, what: string): Promise<void> {
  await commit({ type: "edit", ops: [{ op: "part.set", part: id, set }], summary: what }, what);
}

async function rename(id: string, label: string): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed || trimmed === part(id)?.label) return;
  await commit(
    {
      type: "edit",
      ops: [{ op: "part.rename", part: id, label: trimmed }],
      summary: `Rename to ${trimmed}`,
    },
    `Rename to ${trimmed}`,
  );
}

/** The person's latest revision still in force, or the latest undo of theirs (for redo). */
function lastOwn(kind: "undoable" | "redoable"): HistoryItem | undefined {
  const items = [...(view?.history ?? [])].reverse();
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

// ── Outliner ────────────────────────────────────────────────────────────────

const outliner = byId("outliner", HTMLUListElement);

function renderOutliner(): void {
  outliner.replaceChildren();
  if (!doc) return;
  const children = new Map<string | null, Part[]>();
  for (const p of doc.parts) {
    const list = children.get(p.parent) ?? [];
    list.push(p);
    children.set(p.parent, list);
  }
  const selected = viewport.selection;
  const branch = (parent: string | null): HTMLLIElement[] =>
    (children.get(parent) ?? []).map((p) => {
      const name = el("span", { text: p.label });
      const row = el(
        "div",
        { className: p.id === selected ? "row selected" : "row" },
        name,
        el("span", { className: "shape", text: p.shape }),
      );
      row.setAttribute("role", "treeitem");
      row.dataset["part"] = p.id;
      row.onclick = () => selectPart(p.id);
      row.ondblclick = () => {
        const input = el("input");
        input.value = p.label;
        input.setAttribute("aria-label", "Part name");
        let done = false;
        const finish = (save: boolean): void => {
          if (done) return;
          done = true;
          if (save) void rename(p.id, input.value);
          else renderOutliner();
        };
        input.onkeydown = (e) => {
          if (e.key === "Enter") finish(true);
          if (e.key === "Escape") finish(false);
          e.stopPropagation();
        };
        input.onblur = () => finish(true);
        name.replaceWith(input);
        input.select();
        input.focus();
      };
      const kids = branch(p.id);
      return el("li", {}, row, kids.length ? el("ul", {}, ...kids) : null);
    });
  outliner.append(...branch(null));
}

// ── Properties ──────────────────────────────────────────────────────────────

const properties = byId("properties", HTMLDivElement);

function triple(
  values: ReadonlyArray<number>,
  onCommit: (next: [number, number, number]) => void,
): HTMLElement {
  const current: [number, number, number] = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
  return el(
    "div",
    { className: "triple" },
    ...current.map((v, i) =>
      numberInput(v, (next) => {
        const copy: [number, number, number] = [...current];
        copy[i] = next;
        onCommit(copy);
      }),
    ),
  );
}

function renderProperties(): void {
  properties.replaceChildren();
  if (!doc || !view) {
    properties.append(el("p", { className: "muted", text: "Start or open a character." }));
    return;
  }
  const docLabel = el("input");
  docLabel.value = doc.label;
  docLabel.onchange = () => {
    const label = docLabel.value.trim();
    if (label && label !== doc?.label)
      void commit(
        {
          type: "edit",
          ops: [{ op: "document.label", label }],
          summary: `Name the character ${label}`,
        },
        `Name the character ${label}`,
      );
  };
  const policy = el("input");
  policy.type = "checkbox";
  policy.checked = view.policy.agentDirectEdit;
  policy.onchange = () =>
    void commit({ type: "policy.set", agentDirectEdit: policy.checked }, "Agent policy");
  const grid = el(
    "div",
    { className: "props" },
    el("span", { text: "Character" }),
    docLabel,
    el("span", { text: "Agents" }),
    el("label", {}, policy, " may edit directly"),
  );
  properties.append(grid);
  const id = viewport.selection;
  const p = id === null ? undefined : part(id);
  if (!p) {
    properties.append(
      el("p", { className: "muted", text: "Select a part in the outliner or viewport." }),
    );
    return;
  }
  const label = el("input");
  label.value = p.label;
  label.onchange = () => void rename(p.id, label.value);
  const color = el("input");
  color.type = "color";
  color.value = p.color;
  color.onchange = () => void setPart(p.id, { color: color.value }, `Colour ${p.label}`);
  properties.append(
    el(
      "div",
      { className: "props" },
      el("span", { text: "Name" }),
      label,
      el("span", { text: "Shape" }),
      el("span", { text: p.shape }),
      el("span", { text: "Size (m)" }),
      triple(p.size, (size) => void setPart(p.id, { size }, `Resize ${p.label}`)),
      el("span", { text: "Position" }),
      triple(p.position, (position) => void setPart(p.id, { position }, `Move ${p.label}`)),
      el("span", { text: "Colour" }),
      color,
      el("span", { text: "Parent" }),
      el("span", { text: p.parent === null ? "none" : (part(p.parent)?.label ?? p.parent) }),
    ),
  );
}

// ── Proposals ───────────────────────────────────────────────────────────────

const proposals = byId("proposals", HTMLDivElement);

function changeLines(
  changes: ReadonlyArray<{ readonly path: ReadonlyArray<string> }>,
): HTMLElement {
  const shown = changes.slice(0, 8).map((c) => el("li", { text: c.path.join(".") }));
  if (changes.length > 8) shown.push(el("li", { text: `… ${changes.length - 8} more` }));
  return el("ul", { className: "changes" }, ...shown);
}

async function showPreview(proposalId: string): Promise<void> {
  if (!documentId) return;
  try {
    const selectedDocument = documentId;
    const fromProject = project;
    const draft = await host.call("draft", { documentId, proposalId });
    if (documentId !== selectedDocument || project !== fromProject) return;
    if (!draft.ok) {
      showBanner("error", `The proposal cannot be previewed: ${describe(draft.diagnostics)}`);
      return;
    }
    const read = readDocument(draft.preview, { registry });
    if (!read.ok) {
      showBanner("error", `The preview is not a valid document: ${describe(read.diagnostics)}`);
      return;
    }
    preview = { proposal: proposalId, version: draft.proposal.version };
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
    preview = undefined;
    void showHead();
    showBanner("error", `Preview failed: ${failure(error)}`);
  }
}

function endPreview(): void {
  preview = undefined;
  hideBanner();
  void showHead();
}

async function accept(proposal: string, version: number): Promise<void> {
  preview = { proposal, version };
  const done = await commit({ type: "proposal.accept", proposal, version }, "Accept proposal");
  preview = undefined;
  if (done) hideBanner();
  void showHead();
}

async function discard(proposal: string): Promise<void> {
  preview = { proposal, version: 0 };
  const done = await commit({ type: "proposal.discard", proposal }, "Reject proposal");
  preview = undefined;
  if (done) hideBanner();
  void showHead();
}

function renderProposals(): void {
  proposals.replaceChildren();
  const open = (view?.proposals ?? []).filter((p) => p.status === "draft");
  const closed = (view?.proposals ?? []).filter((p) => p.status !== "draft");
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

// ── History ─────────────────────────────────────────────────────────────────

const history = byId("history", HTMLOListElement);
const historyFilter = byId("history-filter", HTMLSelectElement);
const attribution = byId("attribution", HTMLParagraphElement);
historyFilter.onchange = () => renderHistory();

function renderHistory(): void {
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

// ── Agents ──────────────────────────────────────────────────────────────────

const agents = byId("agents", HTMLDivElement);
/** The last pairing message, kept across re-renders. */
let pairingNote = "";

async function renderAgents(): Promise<void> {
  agents.replaceChildren();
  if (!project) return;
  try {
    const paired = await host.call("pair.list", {});
    const id = el("input");
    id.placeholder = "agent id, e.g. claude";
    id.setAttribute("aria-label", "Agent ID");
    const result = el("p", { className: "muted", text: pairingNote });
    agents.append(
      el(
        "ul",
        { className: "entries" },
        ...paired.map((p) =>
          el(
            "li",
            {},
            el("span", { text: p.name ?? p.agent }),
            button("Revoke", () => {
              void host
                .call("pair.revoke", { agent: p.agent })
                .then(renderAgents)
                .then(() => Promise.all([steering.refresh(), art.refresh()]));
            }),
          ),
        ),
      ),
      el(
        "div",
        { className: "props" },
        id,
        button("Pair", () => {
          void host
            .call("pair.agent", { agent: id.value.trim() })
            .then((pair) => {
              pairingNote = `Paired ${pair.agent}. Its MCP server reads ${pair.credentialFile}.`;
              void renderAgents();
              void steering.refresh();
              void art.refresh();
            })
            .catch((error: unknown) => {
              pairingNote = failure(error);
              result.textContent = pairingNote;
            });
        }),
      ),
      result,
    );
  } catch (error) {
    agents.append(el("p", { className: "muted", text: failure(error) }));
  }
}

// ── Steering ────────────────────────────────────────────────────────────────

const steering = mountSteering(byId("steering", HTMLDivElement), {
  host,
  documentId: () => documentId,
  failure,
});
api.onSteer((notice) => steering.notice(notice));

// ── Artwork ─────────────────────────────────────────────────────────────────

const art = mountArt(byId("art", HTMLDivElement), {
  host,
  api,
  current: () =>
    documentId && view?.documentId === documentId && doc
      ? { documentId, revision: view.revision, doc }
      : undefined,
  selection: () => viewport.selection,
  capture: async (side, frameHead) => {
    if (busy || preview || viewport.dragging || !doc || !viewport.shows(doc))
      throw new Error(
        "Finish the edit or leave the proposal preview before capturing the committed character.",
      );
    return viewport.capture(side, frameHead);
  },
  picture: (digest) =>
    readImageChunks(digest, (offset) => host.call("project.image", { digest, offset })),
  failure,
});
api.onSteer((notice) => art.notice(notice));
api.onCommit((notice) => {
  if (notice.documentId === documentId) void art.refresh();
});

// ── Project and documents ───────────────────────────────────────────────────

const projectLabel = byId("project-label", HTMLSpanElement);
const documentSelect = byId("document", HTMLSelectElement);
const startSelect = byId("start", HTMLSelectElement);
const randomHuman = byId("random-human", HTMLButtonElement);

/** Save needs a character; open needs a project. Looked up by ID so it works before setup. */
function syncCharacterFiles(): void {
  const save = document.getElementById("character-save");
  const open = document.getElementById("character-open");
  if (save instanceof HTMLButtonElement) save.disabled = !project || !documentId || !view;
  if (open instanceof HTMLButtonElement) open.disabled = !project;
}

function renderAll(): void {
  randomHuman.hidden =
    !!documentId || !startSelect.querySelector('option[value="human-adult/seed"]');
  syncOutfits();
  syncCharacterFiles();
  renderOutliner();
  renderProperties();
  renderProposals();
  renderHistory();
  void renderAttribution();
  art.redraw();
  const res = viewport.resolution;
  statusRight.textContent = [
    view ? `revision ${view.revision}` : "",
    view ? `access ${view.access.mode}` : "",
    project
      ? project.mode === "host"
        ? "this window hosts the project"
        : "attached to the project's host"
      : "",
    `viewport ${res.width}×${res.height} px`,
    app ? `Electron ${app.versions.electron}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  renderUpgrade();
}

/** Let the person explicitly move a stored head to the feature versions in this build. */
function renderUpgrade(): void {
  if (!view || !documentId || view.access.mode !== "upgrade-required" || preview) return;
  const base = { documentId, revision: view.revision };
  statusRight.prepend(
    button(
      "Upgrade to edit",
      () => void commit({ type: "document.upgrade" }, "Upgrade", base),
      "Save the updated character as one new revision. Earlier revisions stay in history.",
    ),
    " ",
  );
}

let adultPaint: Promise<HumanPaintSources> | undefined;

/** Keep document controls and project switching available when a surface cannot be drawn. */
async function displayDocument(character: CharacterDocument | undefined): Promise<boolean> {
  const seq = ++displaySequence;
  const element = byId("viewport", HTMLDivElement);
  element.inert = true;
  try {
    const preparing = character && viewportPaint.prepare(host, character);
    const finish = preparing ? await preparing : undefined;
    const body = viewport.human;
    const paint =
      body && character?.generation?.generator === humanAdultId
        ? await (adultPaint ??= loadHumanPaint((file) => api.humanPack(file))
            .then((pack) => prepareHumanPaint(domRaster(), pack, body))
            .catch((error: unknown) => {
              adultPaint = undefined;
              throw error;
            }))
        : undefined;
    if (seq !== displaySequence) return false;
    viewport.show(character, registry, finish ?? (paint ? {} : undefined), paint);
    return true;
  } catch (error) {
    if (seq !== displaySequence) return false;
    throw error;
  } finally {
    if (seq === displaySequence) element.inert = false;
  }
}

async function showHead(): Promise<void> {
  try {
    await displayDocument(doc);
  } catch (error) {
    viewport.show(undefined, registry);
    showBanner("error", `Cannot render this character: ${failure(error)}`);
  }
}

/** Show the head of the current document, as the host has committed it. */
async function loadDocument(): Promise<void> {
  const seq = ++headRequest;
  if (!documentId) {
    view = undefined;
    doc = undefined;
    await displayDocument(undefined);
    renderAll();
    return;
  }
  try {
    const inspected = await host.call("inspect", { documentId });
    if (seq !== headRequest || inspected.documentId !== documentId) return;
    view = inspected;
  } catch (error) {
    showBanner("error", `Cannot read the document: ${failure(error)}`);
    return;
  }
  doc = undefined;
  if (view.document) {
    const read = readDocument(view.document, { registry });
    if (read.ok) {
      doc = read.value;
      const option = documentSelect.selectedOptions[0];
      if (option?.value === documentId) option.text = `${doc.label} · r${view.revision}`;
    } else
      showBanner("error", `This build cannot show the document: ${describe(read.diagnostics)}`);
  }
  if (!preview) await showHead();
  renderAll();
}

async function loadDocuments(select?: string): Promise<void> {
  if (!project) {
    documentSelect.replaceChildren(new Option("No project", ""));
    documentId = undefined;
    await loadDocument();
    return;
  }
  const list = await host.call("documents", {});
  documentSelect.replaceChildren(
    ...(list.length ? [] : [new Option("No characters yet", "")]),
    ...list.map((d) => new Option(`${d.label ?? d.documentId} · r${d.revision}`, d.documentId)),
  );
  const keep = select ?? documentId;
  documentId = list.some((d) => d.documentId === keep) ? keep : list[0]?.documentId;
  documentSelect.value = documentId ?? "";
  await loadDocument();
}

documentSelect.onchange = () => {
  documentId = documentSelect.value || undefined;
  preview = undefined;
  hideBanner();
  viewport.select(null);
  void loadDocument().then(() => (project ? art.refresh() : undefined));
  if (project) void steering.refresh();
};

async function loadStarters(): Promise<void> {
  startSelect.disabled = true;
  startSelect.replaceChildren(new Option("New character from…", ""));
  if (!project) return;
  const list: MethodResults["starters"] = await host.call("starters", {});
  for (const s of list.starters) {
    const reference = Reflect.get(s, "kind") !== "form" && s.reference;
    const label = reference ? `${s.label} (protocol reference)` : s.label;
    // A generator without a default preset starts from one of its named presets or a new seed.
    if (s.presets.length && !s.presets.some((p) => p.id === "default")) {
      for (const p of s.presets)
        startSelect.append(new Option(`${label}: ${p.label}`, `${s.id}/preset/${p.id}`));
      if (s.seeded) {
        const action =
          s.id === "human-adult" ? "New random human" : `New random ${s.label.toLowerCase()}`;
        startSelect.add(new Option(action, `${s.id}/seed`), 1);
      }
    } else startSelect.append(new Option(label, s.id));
  }
  startSelect.disabled = startSelect.options.length < 2;
}

/** What a starter menu entry asks the host to start: the starter and its preset or seed. */
function startChoice(value: string): {
  readonly starter: string;
  readonly preset?: string;
  readonly seed?: number;
} {
  const [starter = "", kind, preset] = value.split("/");
  if (kind === "preset" && preset) return { starter, preset };
  if (kind === "seed") return { starter, seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0 };
  return { starter };
}

startSelect.onchange = () => void startCharacter(startSelect.value);
randomHuman.onclick = () => void startCharacter("human-adult/seed");

async function startCharacter(value: string): Promise<void> {
  if (startSelect.disabled) return;
  const choice = startChoice(value);
  const starter = choice.starter;
  startSelect.value = "";
  if (!starter) return;
  startSelect.disabled = true;
  randomHuman.disabled = true;
  const id = `doc-${starter.replace(/[^a-z0-9-]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const started = await host.call("start", { documentId: id, requestId: requestId(), ...choice });
    if (started.result.kind === "rejected") {
      showBanner("error", `Could not start: ${describe(started.result.diagnostics)}`);
      return;
    }
    say(`Started ${starter}`);
    viewport.select(null);
    await loadDocuments(id);
    viewport.frame();
  } catch (error) {
    showBanner("error", `Could not start: ${failure(error)}`);
  } finally {
    startSelect.disabled = !project;
    randomHuman.disabled = false;
  }
}

async function adopt(state: ProjectState): Promise<void> {
  headRequest++;
  displaySequence++;
  preview = undefined;
  viewportPaint.reset();
  project = state.project;
  projectLabel.textContent = project?.label ?? "No project";
  projectLabel.title = project?.untitled
    ? "Characters stay in memory until you save them."
    : (project?.directory ?? "");
  if (state.error) showBanner("error", state.error);
  await loadStarters();
  await loadDocuments();
  await renderAgents();
  steering.reset();
  if (project) await steering.refresh();
  art.reset();
  if (project) await art.refresh();
  await refreshLibrary();
}

// ── Character files ─────────────────────────────────────────────────────────
// Save and open go through the project host, the same operation as
// `irudd save` and `irudd open`. Opening checks the whole file first.

const characterSave = byId("character-save", HTMLButtonElement);
const characterOpen = byId("character-open", HTMLButtonElement);

function where(path: ReadonlyArray<string | number>): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");
}

characterSave.onclick = async () => {
  if (!documentId) return;
  characterSave.disabled = true;
  try {
    const saved = await api.saveCharacter(documentId);
    if (saved.ok)
      say(
        `Saved ${saved.label} (revision ${saved.revision}) as ${saved.name}: ${saved.entries} history entries, ${saved.assets} picture(s).`,
      );
    else if (!saved.canceled) showBanner("error", `Save failed: ${saved.error.message}`);
  } catch (error) {
    showBanner("error", `Save failed: ${failure(error)}`);
  } finally {
    characterSave.disabled = !documentId;
  }
};

characterOpen.onclick = async () => {
  if (!project) return;
  characterOpen.disabled = true;
  try {
    const opened = await api.openCharacter();
    if (opened.ok) {
      hideBanner();
      await loadDocuments(opened.documentId);
      say(
        `Opened ${opened.label} from ${opened.name} at revision ${opened.revision}, with ${opened.entries} history entries and ${opened.assets} picture(s).`,
      );
    } else if (!opened.canceled) {
      const list = document.createElement("ul");
      list.className = "problems";
      for (const problem of opened.problems.slice(0, 8)) {
        const item = document.createElement("li");
        item.textContent = `${problem.path.length ? `${where(problem.path)}: ` : ""}${problem.message} (${problem.code})`;
        list.append(item);
      }
      if (opened.problems.length > 8) {
        const item = document.createElement("li");
        item.textContent = `${opened.problems.length - 8} more.`;
        list.append(item);
      }
      showBanner(
        "error",
        opened.error._tag === "ArchiveRejected"
          ? "The character was not opened and nothing was written:"
          : `The character was not opened: ${opened.error.message}`,
        ...(opened.problems.length ? [list] : []),
      );
    }
  } catch (error) {
    showBanner("error", `Open failed: ${failure(error)}`);
  } finally {
    characterOpen.disabled = !project;
  }
};

byId("project-open", HTMLButtonElement).onclick = async () => adopt(await api.openProject());
byId("project-new", HTMLButtonElement).onclick = async () => adopt(await api.createProject());
byId("project-untitled", HTMLButtonElement).onclick = async () =>
  adopt(await api.createProject("untitled"));

api.onCommit((notice) => {
  if (dragBase && notice.documentId === dragBase.documentId && viewport.cancelDrag()) {
    dragBase = undefined;
    const who =
      notice.actor.kind === "human" ? "Another edit" : (notice.actor.name ?? notice.actor.id);
    showBanner(
      "error",
      `Move cancelled: ${who} changed this character (revision ${notice.revision}) while you were dragging. It now shows that revision.`,
    );
  }
  if (notice.documentId === documentId) {
    if (notice.actor.kind === "agent")
      say(
        `${notice.actor.name ?? notice.actor.id}: ${notice.command} (revision ${notice.revision})`,
      );
    if (!busy) void loadDocument();
  }
  if (notice.command === "document.create" || notice.command === "document.open")
    void loadDocuments();
});

// ── Undo, redo and keys ─────────────────────────────────────────────────────

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

document.addEventListener("keydown", (e) => {
  const target = e.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
  if (e.ctrlKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    void (e.shiftKey ? redoLast() : undoLast());
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const keys: Record<string, Tool> = { q: "select", g: "translate", r: "rotate", s: "scale" };
  const tool = keys[e.key.toLowerCase()];
  if (tool) setTool(tool);
  else if (e.key === "f") viewport.frame();
  else if (e.key === "Escape") {
    if (preview) endPreview();
    else selectPart(null);
  }
});

// ── Library and player ──────────────────────────────────────────────────────

const workshopPane = byId("workshop", HTMLElement);
const libraryPane = byId("library", HTMLElement);
const tabWorkshop = byId("tab-workshop", HTMLButtonElement);
const tabLibrary = byId("tab-library", HTMLButtonElement);
const libraryList = byId("library-list", HTMLUListElement);
const saveSheet = byId("save-sheet", HTMLButtonElement);
const sheetStatus = byId("sheet-status", HTMLParagraphElement);
let player: Player | undefined;
let controls: ReturnType<typeof mountControls> | undefined;
let showing: string | undefined;

function tab(which: "workshop" | "library"): void {
  workshopPane.hidden = which !== "workshop";
  libraryPane.hidden = which !== "library";
  tabWorkshop.setAttribute("aria-selected", String(which === "workshop"));
  tabLibrary.setAttribute("aria-selected", String(which === "library"));
  if (which === "library" && !player) {
    player = new Player(byId("player", HTMLDivElement));
    controls = mountControls(byId("player-controls", HTMLDivElement), player, {
      sheetSize: [512, 512],
    });
  }
  if (which === "workshop") viewport.request();
}
tabWorkshop.onclick = () => tab("workshop");
tabLibrary.onclick = () => tab("library");

async function refreshLibrary(): Promise<void> {
  const entries = await api.library();
  libraryList.replaceChildren(
    ...(entries.length
      ? []
      : [el("li", { className: "muted", text: "No GLBs yet. Export one or open a file." })]),
    ...entries.map((entry) => {
      const item = el(
        "li",
        { className: entry.id === showing ? "selected" : "", title: entry.name },
        el("span", { text: entry.name }),
        el("span", {
          className: "muted",
          text: `${entry.origin} · ${(entry.byteLength / 1024).toFixed(0)} KiB`,
        }),
      );
      item.onclick = () => void openEntry(entry);
      return item;
    }),
  );
}

async function play(entry: LibraryEntry, bytes: Uint8Array): Promise<void> {
  tab("library");
  showing = entry.id;
  const info = await controls?.load(bytes, entry.name);
  saveSheet.disabled = !info || !project;
  sheetStatus.textContent = "";
  await refreshLibrary();
}

async function openEntry(entry: LibraryEntry): Promise<void> {
  const file = await api.readLibrary(entry.id);
  if (file) await play(file.entry, file.bytes);
}

byId("library-open", HTMLButtonElement).onclick = async () => {
  const file = await api.openGlb();
  if (file) await play(file.entry, file.bytes);
};

saveSheet.onclick = async () => {
  if (!controls) return;
  saveSheet.disabled = true;
  sheetStatus.textContent = "Rendering the inspection sheet…";
  try {
    const sheet: InspectionSheet | undefined = await controls.inspect(512, 512);
    if (!sheet) {
      sheetStatus.textContent = "The sheet could not be taken.";
      return;
    }
    const dir = await api.saveInspection({
      model: sheet.model,
      metadata: {
        format: "irudd.inspection-sheet",
        version: 1,
        model: sheet.model,
        width: sheet.width,
        height: sheet.height,
        gpu: sheet.gpu,
        info: player?.stage.info,
        shots: sheet.shots.map(({ png, ...shot }) => ({ ...shot, bytes: png.byteLength })),
      },
      images: sheet.shots.map((s) => ({ view: s.view, png: s.png })),
    });
    sheetStatus.textContent = `Saved to ${dir}`;
  } catch (error) {
    sheetStatus.textContent = failure(error);
  } finally {
    saveSheet.disabled = false;
  }
};

const exportPreset = byId("export-preset", HTMLSelectElement);
const exportPresets: ReadonlyArray<ReviewPreset> = ["clay", "full", "game", "portrait"];
const exportOutfits = byId("export-outfits", HTMLInputElement);

/** A wardrobe export needs saved outfits; the box is off for a document without them. */
function syncOutfits(): void {
  const looks = doc ? (outfitLooks.read(doc.features)?.looks.length ?? 0) : 0;
  exportOutfits.disabled = looks === 0;
  if (!looks) exportOutfits.checked = false;
  exportOutfits.parentElement?.setAttribute(
    "title",
    looks
      ? `Export all ${looks} saved outfits, each as its own scene with its own rig and clips`
      : "This character has no saved outfits",
  );
}

/** An issued review artifact's bytes, read in chunks from the host. */
async function artifactBytes(sha256: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const chunk = await host.call("review.read", { sha256, offset });
    const binary = atob(chunk.base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    parts.push(bytes);
    offset += bytes.byteLength;
    if (chunk.done || bytes.byteLength === 0) break;
  }
  const all = new Uint8Array(offset);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.byteLength;
  }
  return all;
}

// Export goes through the project host and its review worker, exactly as the
// CLI and agents do: the same revision, preset, provenance and SHA-256.
byId("export", HTMLButtonElement).onclick = async () => {
  if (!doc || !view || !documentId) return;
  const preset = exportPresets.find((p) => p === exportPreset.value) ?? "clay";
  const wardrobe = exportOutfits.checked && !exportOutfits.disabled;
  say(
    `Exporting revision ${view.revision} at ${preset}${wardrobe ? " with every saved outfit" : ""}…`,
  );
  try {
    const exported = await host.call("review.export", {
      documentId,
      revision: view.revision,
      preset,
      ...(wardrobe ? { wardrobe: true } : {}),
    });
    const bytes = await artifactBytes(exported.glb.sha256);
    const entry = await api.saveExport({
      documentId,
      label: doc.label,
      revision: exported.source.revision,
      preset,
      ...(exported.wardrobe ? { wardrobe: true } : {}),
      bytes,
    });
    say(
      `Exported ${entry.name}${exported.wardrobe ? ` with outfits ${exported.wardrobe.looks.join(", ")}` : ""} (sha256 ${exported.glb.sha256.slice(0, 12)}…, ${exported.gpu.renderer}${exported.gpu.software ? ", software fallback" : ""})`,
    );
    await play(entry, bytes);
  } catch (error) {
    showBanner("error", `Export failed: ${failure(error)}`);
  }
};

// ── Start ───────────────────────────────────────────────────────────────────

app = await api.app();
mountUpdates(api);
try {
  const body = await loadHumanPacks((file) => api.humanPack(file));
  registry = createRegistry({
    features: familyFeatures,
    generators: [frameCreature, humanAdultGenerator(body)],
  });
  viewport.human = body;
} catch (error) {
  showBanner("error", `The adult cannot be shown in this build: ${failure(error)}`);
}
const opened = await api.projectState();
await adopt(opened);
say(opened.project ? `Opened ${opened.project.label}` : "Open or create a project to begin.");
document.body.dataset["ready"] = "true";
