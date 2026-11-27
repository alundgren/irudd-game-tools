import { paintNudge } from "@irudd/character/paint-nudge";
import { formGenerator, creatureGenerator } from "@irudd/character/creature";
import "@irudd/player/player.css";
import "./style.css";
import {
  commandFormat,
  commandVersion,
  createRegistry,
  familyFeatures,
  frameCreature,
  readDocument,
  type CharacterDocument,
  type Part,
} from "@irudd/document";
import { inspectProposalExport } from "@irudd/character/proposal-export";
import { domRaster } from "@irudd/character";
import { humanAdultGenerator, humanAdultId, loadHumanPacks } from "@irudd/character/human";
import {
  loadHumanPaint,
  prepareHumanPaint,
  type HumanPaintSources,
} from "@irudd/character/human/paint";
import type { ApplyResult, InspectView } from "@irudd/workshop/contract";
import type { AppInfo, ProjectState } from "../shared/api.js";
import { bridge, workshop } from "./bridge.js";
import { byId, button } from "./dom.js";
import { mountArt } from "./art.js";
import { readImageChunks } from "./art-files.js";
import { ViewportPaint } from "./viewport-paint.js";
import { mountSteering } from "./steering.js";
import { mountUpdates } from "./update.js";
import { mountMotion } from "./panels/motion.js";
import { EditorViewport, type Tool, type Transform } from "./viewport.js";

import { mountDisplay } from "./panels/display.js";
import { mountOutliner } from "./panels/outliner.js";
import { mountProperties } from "./panels/properties.js";
import { mountProposals } from "./panels/proposals.js";
import { mountHistory } from "./panels/history.js";
import { mountAgents } from "./panels/agents.js";
import { mountVariation } from "./panels/variation.js";
import { mountPortrait } from "./panels/portrait.js";
import { mountShape } from "./panels/shape.js";
import { mountSurface } from "./panels/surface.js";
import { mountWardrobe } from "./panels/wardrobe.js";
import { mountCreature } from "./panels/creature.js";
import { mountHuman } from "./panels/human.js";
import { mountStart } from "./panels/start.js";
import { mountLibrary } from "./panels/library.js";
import { describe, failure, type PanelContext } from "./panels/context.js";

const api = bridge();
const host = workshop(api);
const viewportPaint = new ViewportPaint((digest) => api.bundledImage(digest));
let displaySequence = 0;
let headRequest = 0;
let registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });

let app: AppInfo | undefined;
let project: ProjectState["project"] = null;
let documentId: string | undefined;
let view: InspectView | undefined;
let doc: CharacterDocument | undefined;
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
  outliner.select(part);
  wardrobe.render();
  surface.render();
  shape.render();
  portrait.render();
  properties.render();
  variation.render();
  art.redraw();
}

function requestId(): string {
  return `desk-${crypto.randomUUID()}`;
}

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
  if (
    proposals.active &&
    command["type"] !== "proposal.accept" &&
    command["type"] !== "proposal.refine" &&
    command["type"] !== "proposal.discard"
  ) {
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
    expectedRevision:
      command["type"] === "proposal.refine"
        ? (view.proposals.find((p) => p.id === command["proposal"])?.baseRevision ?? view.revision)
        : (base?.revision ?? view.revision),
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

const panels: PanelContext = {
  api,
  host,
  get doc() {
    return doc;
  },
  get humanBody() {
    return viewport.human;
  },
  get project() {
    return project;
  },
  get view() {
    return view;
  },
  get documentId() {
    return documentId;
  },
  get selection() {
    return viewport.selection;
  },
  part,
  selectPart,
  rename,
  commit,
  say,
  showBanner,
};

mountDisplay(viewport);
const motion = mountMotion(panels, viewport);
const outliner = mountOutliner(panels);
const properties = mountProperties(panels);
const variation = mountVariation(panels, () => proposals.render());
const proposals = mountProposals(panels, {
  protectedParts: (id: string): readonly string[] => [
    ...(variation.current()?.protected ?? []),
    ...art.protectedParts(id),
  ],
  thumbnail: () => viewport.comparisonImage(),
  guide: () => viewport.proposalGuide(),
  reference: (rear) => viewport.measuredView(null, rear),
  createCopy: (source, label) => createCopy(source, label, true),
  enrich: variation.enrich,
  originalBrief: (id) => art.originalBrief(id),
  selectedAgent: () => art.selectedAgent(),
  async inspect(doc, revision, previous) {
    const { textures } = await viewportPaint.prepare(host, doc);
    const human = viewport.human;
    const humanPaint = await adultPaint;
    return inspectProposalExport(
      doc,
      {
        preset: "game",
        revision,
        build: "desktop",
        textures,
        ...(human ? { human } : {}),
        ...(humanPaint ? { humanPaint } : {}),
      },
      previous,
    );
  },
  registry: () => registry,
  displayDocument,
  showHead,
  hideBanner,
});
async function createCopy(source: CharacterDocument, label: string, resumeOriginal = false) {
  const original = documentId;
  const id = "doc-" + crypto.randomUUID().slice(0, 12),
    projectAtStart = project;
  const result = await host.call("apply", {
    request: {
      format: commandFormat,
      version: commandVersion,
      requestId: requestId(),
      documentId: id,
      expectedRevision: 0,
      command: {
        type: "document.create",
        document: { ...source, id, label: label.trim().slice(0, 120) },
      },
    },
  });
  if (result.kind === "rejected") throw new Error(describe(result.diagnostics));
  if (project !== projectAtStart) return undefined;
  proposals.reset();
  hideBanner();
  viewport.select(null);
  await loadDocuments(resumeOriginal ? original : id);
  viewport.frame();
  return id;
}
const portrait = mountPortrait(
  panels,
  viewport,
  async (source, label) => !!(await createCopy(source, label)),
);
const history = mountHistory(panels);
const shape = mountShape(
  panels,
  viewport,
  async (id) => {
    const view = await host.call("inspect", { documentId: id });
    const result = readDocument(view.document, { registry });
    if (!result.ok) throw new Error(describe(result.diagnostics));
    return result.value;
  },
  () => registry,
);
const surface = mountSurface(
  panels,
  (face, pivot) => viewport.accessoryAnchor(face, pivot),
  (id) => viewport.fitEyes(id),
  (p) => viewport.fitHand(p),
);
const wardrobe = mountWardrobe(panels, (host, kind, color) => viewport.cut(host, kind, color));
const creature = mountCreature(
  panels,
  () => variation.current()?.direction,
  viewport,
  (p, label) => start.fromPlan(p, label),
);
viewport.onFrame = () => {
  creature.place();
  shape.place();
};
const human = mountHuman(panels, () => variation.current()?.direction);
const library = mountLibrary(panels, () => viewport.request(), proposals.inspectVisible);
const start = mountStart(panels, async (id) => {
  viewport.select(null);
  await loadDocuments(id);
  viewport.frame();
});

const steering = mountSteering(byId("steering", HTMLDivElement), {
  host,
  documentId: () => documentId,
  variationBrief: (text) => {
    const settings = variation.current();
    if (
      !documentId ||
      !view ||
      !settings ||
      !(settings.direction || settings.protected.size || settings.references.length)
    )
      return undefined;
    return variation.enrich({
      format: "irudd.art-brief",
      version: 1,
      kind: "variation",
      fromSteer: true,
      documentId,
      revision: view.revision,
      direction: text,
      attachments: [],
    });
  },
  failure,
});
api.onSteer((notice) => steering.notice(notice));

const art = mountArt(byId("art", HTMLDivElement), {
  host,
  api,
  current: () =>
    documentId && view?.documentId === documentId && doc
      ? { documentId, revision: view.revision, doc }
      : undefined,
  enrich: variation.enrich,
  locks: () => variation.current()?.protected ?? new Set(),
  onRequests: () => proposals.render(),
  selection: () => viewport.selection,
  measured: async (target, rear, nudge) => {
    if (busy || proposals.active || viewport.dragging || !doc || !viewport.shows(doc))
      throw new Error("Finish the edit before capturing the character.");
    if (!nudge) return viewport.measuredView(target, rear);
    const original = doc;
    const nudged = paintNudge(original, nudge.target, nudge.amounts).document;
    if (!(await displayDocument(nudged))) throw new Error("The character changed during capture.");
    try {
      return await viewport.measuredView(target, rear);
    } finally {
      if (doc === original && viewport.shows(nudged)) await displayDocument(original);
    }
  },
  capture: async (side, frameHead) => {
    if (busy || proposals.active || viewport.dragging || !doc || !viewport.shows(doc))
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
const agents = mountAgents(panels, () => Promise.all([steering.refresh(), art.refresh()]));

window.addEventListener("focus", () => {
  if (!project) return;
  void agents.render();
  void steering.refresh();
  void art.refresh();
});
api.onCommit((notice) => {
  if (notice.documentId === documentId) void art.refresh();
});

const projectLabel = byId("project-label", HTMLSpanElement);
const documentSelect = byId("document", HTMLSelectElement);
function syncCharacterFiles(): void {
  const save = document.getElementById("character-save");
  const open = document.getElementById("character-open");
  if (save instanceof HTMLButtonElement) save.disabled = !project || !documentId || !view;
  if (open instanceof HTMLButtonElement) open.disabled = !project;
}

function renderAll(): void {
  start.render();
  human.render();
  creature.render();
  wardrobe.render();
  surface.render();
  shape.render();
  portrait.render();
  library.render();
  syncCharacterFiles();
  outliner.render();
  properties.render();
  variation.render();
  proposals.render();
  history.render();
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

function renderUpgrade(): void {
  if (!view || !documentId || view.access.mode !== "upgrade-required" || proposals.active) return;
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

async function displayDocument(character: CharacterDocument | undefined): Promise<boolean> {
  const seq = ++displaySequence;
  const element = byId("viewport", HTMLDivElement);
  element.inert = true;
  try {
    const preparing = character && viewportPaint.prepare(host, character);
    const finish = preparing ? await preparing : undefined;
    const body = viewport.human;
    const paint =
      body &&
      (character?.generation?.generator === humanAdultId ||
        character?.parts.some((p) => p.features["human.region-copy"]))
        ? await (adultPaint ??= loadHumanPaint((file) => api.humanPack(file))
            .then((pack) => prepareHumanPaint(domRaster(), pack, body))
            .catch((error: unknown) => {
              adultPaint = undefined;
              throw error;
            }))
        : undefined;
    if (seq !== displaySequence) return false;
    viewport.show(character, registry, finish, paint);
    motion.render();
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
    motion.render();
    showBanner("error", `Cannot render this character: ${failure(error)}`);
  }
}

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
  if (!proposals.active) await showHead();
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
  proposals.reset();
  hideBanner();
  viewport.select(null);
  void loadDocument().then(() => (project ? art.refresh() : undefined));
  if (project) void steering.refresh();
};

async function adopt(state: ProjectState): Promise<void> {
  headRequest++;
  displaySequence++;
  proposals.reset();
  viewportPaint.reset();
  variation.reset();
  project = state.project;
  projectLabel.textContent = project?.label ?? "No project";
  projectLabel.title = project?.untitled
    ? "Characters stay in memory until you save them."
    : (project?.directory ?? "");
  if (state.error) showBanner("error", state.error);
  await start.loadStarters();
  await loadDocuments();
  await agents.render();
  steering.reset();
  if (project) await steering.refresh();
  art.reset();
  if (project) await art.refresh();
  await library.refresh();
}

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

document.addEventListener("keydown", (e) => {
  const target = e.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return;
  if (e.ctrlKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    void (e.shiftKey ? history.redoLast() : history.undoLast());
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const keys: Record<string, Tool> = { q: "select", g: "translate", r: "rotate", s: "scale" };
  const tool = keys[e.key.toLowerCase()];
  if (tool) setTool(tool);
  else if (e.key.toLowerCase() === "f") viewport.focusSelection();
  else if (e.key === "Escape") {
    if (proposals.active) proposals.endPreview();
    else selectPart(null);
  }
});

app = await api.app();
mountUpdates(api);
try {
  const body = await loadHumanPacks((file) => api.humanPack(file));
  registry = createRegistry({
    features: familyFeatures,
    generators: [frameCreature, formGenerator, creatureGenerator, humanAdultGenerator(body)],
  });
  viewport.human = body;
} catch (error) {
  showBanner("error", `The adult cannot be shown in this build: ${failure(error)}`);
}
const opened = await api.projectState();
await adopt(opened);
say(opened.project ? `Opened ${opened.project.label}` : "Open or create a project to begin.");
document.body.dataset["ready"] = "true";
