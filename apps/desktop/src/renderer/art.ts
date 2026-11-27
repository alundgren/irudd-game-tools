import type { BriefDraft } from "./art-files.js";
import {
  figureHairCap,
  type AssetAttribution,
  type CharacterDocument,
  type Part,
} from "@irudd/document";
import { paintNudgeAxes } from "@irudd/character/paint-nudge";
import { paintedBranch } from "@irudd/character/repaint";
import { ArtFitError, depthRefusal, traceTarget } from "@irudd/character/art-fit";
import { buildAnchorRefusal } from "@irudd/character/trace-build";
import type {
  ArtCapabilities,
  ArtKind,
  ArtRequestView,
  TraceIntent,
  ArtSubmissionView,
  AttachmentRole,
  MethodParams,
  MethodResults,
} from "@irudd/workshop/wire";
import type { DesktopApi, SteerNotice } from "../shared/api.js";
import type { Workshop } from "./bridge.js";
import { button, el } from "./dom.js";
import {
  artKindsShown,
  briefNeeds,
  extensionOf,
  importedReply,
  readPicture,
  toBase64,
  resendRequest,
  rolesShown,
  stagePicture,
  undelivered,
  undeliveredRequestId,
} from "./art-files.js";
import { sheetViews } from "./art-views.js";

export type CaptureView = "current" | "front" | "side" | "back";

export interface ArtOptions {
  readonly enrich: (brief: BriefDraft) => BriefDraft;
  readonly onRequests: () => void;
  readonly host: Workshop;
  readonly api: DesktopApi;
  readonly current: () =>
    | { readonly documentId: string; readonly revision: number; readonly doc: CharacterDocument }
    | undefined;
  readonly locks: () => ReadonlySet<string>;
  readonly selection: () => string | null;
  readonly measured: (
    target: string | null,
    rear?: boolean,
    nudge?: NonNullable<BriefDraft["nudge"]>,
  ) => Promise<{ bytes: Uint8Array; height: number }>;
  readonly capture: (view: CaptureView, frameHead: boolean) => Promise<Uint8Array>;
  readonly picture: (
    digest: string,
  ) => Promise<{ readonly bytes: Uint8Array; readonly mediaType: string }>;
  readonly failure: (error: unknown) => string;
}

function fitRefusal(
  kind: "trace" | "depth",
  doc: CharacterDocument,
  part: Part,
  intent: TraceIntent = "fit",
): string | undefined {
  if (kind === "depth") return depthRefusal(part);
  if (intent === "build") return buildAnchorRefusal(part);
  try {
    traceTarget(doc, [part.id]);
    return undefined;
  } catch (error) {
    if (error instanceof ArtFitError) return error.message;
    throw error;
  }
}

export interface ArtPanel {
  selectedAgent(): string;
  originalBrief(id: string): BriefDraft | undefined;
  protectedParts(id: string): readonly string[];
  refresh(): Promise<void>;
  redraw(): void;
  reset(): void;
  notice(notice: SteerNotice): void;
}

interface Pending {
  readonly role: AttachmentRole;
  readonly digest: string;
  readonly label?: string;
  readonly url?: string;
  readonly size: string;
}

const viewFor: Partial<Record<AttachmentRole, CaptureView>> = {
  front: "front",
  side: "side",
  back: "back",
};

const pollMs = 3000;
const activeMs = 10 * 60 * 1000;

const stateText = {
  proposed: "proposed",
  recorded: "recorded only",
  rejected: "rejected",
} as const;

function parseJson(bytes: Uint8Array): unknown {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return value;
}

export function mountArt(root: HTMLElement, options: ArtOptions): ArtPanel {
  const { host, failure } = options;
  let capabilities: ArtCapabilities | undefined;
  let paired: MethodResults["recipient.list"] = [];
  let requests: ReadonlyArray<ArtRequestView> = [];
  let refreshId = 0;
  let lastSnapshot = "";
  let pending: Pending[] = [];
  let kind: ArtKind = "variation";
  let paintAction: BriefDraft["paintAction"];
  let intent: TraceIntent = "fit";
  let attachmentRole: AttachmentRole = "whole";
  let agent = "";
  let direction = "";
  let nudge: Record<string, number> = {};
  let sourceOptions: Pick<ArtRequestView["brief"], "height" | "protected"> = {};
  let composingFor: { documentId: string; revision: number } | undefined;
  let draftEpoch = 0;
  let sending = false;
  let importDialog: HTMLDialogElement | undefined;
  let parts = new Set<string>();
  let note = "";
  let poll: ReturnType<typeof setTimeout> | undefined;
  const urls = new Map<string, string>();
  const known = new Set<string>();

  const say = (text: string): void => {
    note = text;
    render();
  };

  async function pictureUrl(artId: string, digest: string): Promise<string> {
    const have = urls.get(digest);
    if (have) return have;
    const { bytes, mediaType } = await readPicture(host, artId, digest);
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mediaType }));
    urls.set(digest, url);
    return url;
  }

  function thumb(artId: string, file: { digest: string; mediaType: string }, name: string) {
    const img = el("img", { className: "art-thumb", title: file.digest });
    img.alt = name;
    const save = el("a", { text: "Save", title: `Save ${name}` });
    save.download = `${name}.${extensionOf(file.mediaType)}`;
    void pictureUrl(artId, file.digest)
      .then((url) => {
        img.src = url;
        save.href = url;
      })
      .catch((error: unknown) => {
        img.title = failure(error);
      });
    return el("figure", { className: "art-figure" }, img, el("figcaption", { text: name }), save);
  }

  function clearPending(keepReferences = false): void {
    pending = pending.filter((a) => {
      if (keepReferences && a.role === "reference" && a.label) return true;
      if (a.url) URL.revokeObjectURL(a.url);
      return false;
    });
    draftEpoch++;
  }

  async function attach(
    role: AttachmentRole,
    bytes: Uint8Array,
    epoch: number,
    label?: string,
  ): Promise<void> {
    if (epoch !== draftEpoch) return;
    const stored = await stagePicture(host, bytes);
    if (epoch !== draftEpoch) return;
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: stored.mediaType }));
    pending.push({
      role,
      digest: stored.digest,
      ...(label ? { label } : {}),
      url,
      size: `${stored.width}×${stored.height}, ${stored.byteLength} bytes`,
    });
    render();
  }

  function paintedParts(
    doc: CharacterDocument,
  ): ReadonlyArray<{ id: string; label: string; atlas: string }> {
    return doc.parts.flatMap((p) =>
      p.paint ? [{ id: p.id, label: p.label, atlas: p.paint.atlas }] : [],
    );
  }

  function composer(): HTMLElement {
    const now = options.current();
    if (!now) return el("p", { className: "muted", text: "Open a document to ask for artwork." });
    if (composingFor?.documentId !== now.documentId) {
      clearPending();
      parts.clear();
      direction = "";
      paintAction = undefined;
      nudge = {};
      sourceOptions = {};
    } else if (composingFor.revision !== now.revision) {
      const before = pending.length;
      clearPending(true);
      if (pending.length < before)
        note = "The character changed. Add fresh views for this revision.";
    }
    composingFor = { documentId: now.documentId, revision: now.revision };
    const epoch = draftEpoch;
    const box = el("fieldset", { className: "art-compose" });
    box.disabled = sending;

    const agentSelect = el("select");
    agentSelect.setAttribute("aria-label", "Paired agent");
    for (const p of paired) agentSelect.append(new Option(p.name ?? p.agent, p.agent));
    if (!agent || !paired.some((p) => p.agent === agent)) agent = paired[0]?.agent ?? "";
    agentSelect.value = agent;
    agentSelect.onchange = () => {
      agent = agentSelect.value;
      render();
    };

    const connected = paired.some(
      (p) =>
        p.agent === agent &&
        (p.availability.state === "ready" || p.availability.state === "inbox-only"),
    );
    const kindSelect = el("select");
    kindSelect.setAttribute("aria-label", "Kind of artwork");
    for (const k of artKindsShown) kindSelect.append(new Option(k.label, k.kind));
    kindSelect.value = kind;
    kindSelect.onchange = () => {
      const next = artKindsShown.find((k) => k.kind === kindSelect.value)?.kind;
      if (next) kind = next;
      paintAction = undefined;
      attachmentRole = kind === "trace" || kind === "depth" ? "front" : "whole";
      nudge = {};
      sourceOptions = {};
      parts = new Set();
      intent = "fit";
      render();
    };

    const text = el("textarea");
    text.rows = 3;
    text.placeholder = "What should change, and what must stay as it is.";
    text.setAttribute("aria-label", "Direction");
    text.value = direction;
    text.oninput = () => {
      direction = text.value;
      offline.disabled = !direction.trim() || needs.length > 0;
      send.disabled = !connected || !direction.trim() || needs.length > 0;
    };

    const offered = capabilities?.kinds.find((k) => k.kind === kind);
    const apply =
      kind === "trace"
        ? (offered?.intents?.find((i) => i.intent === intent)?.apply ?? offered?.apply)
        : offered?.apply;
    box.append(
      el("div", { className: "steer-field" }, el("label", { text: "Agent" }), agentSelect),
      el("div", { className: "steer-field" }, el("label", { text: "Kind" }), kindSelect),
      el("p", {
        className: "muted",
        text: apply
          ? apply.available
            ? `Replies become proposals (${apply.translator ?? "operations"}).`
            : `Replies are checked and kept but not proposed: ${apply.reason ?? ""}`
          : "",
      }),
      text,
    );

    if (kind === "turnaround") {
      const mode = el("select");
      mode.setAttribute("aria-label", "Painted edit");
      const target = now.doc.parts.find((p) => p.id === options.selection());
      const cap = target && figureHairCap.read(target.features);
      const modes = [
        ["", "Repaint existing geometry", true],
        ["whole", "Design a whole character", true],
        ["replace", "Redesign this part", !!target],
        ["wear", "Fit an isolated garment to this part", !!target],
        ["revise", "Revise this portrait from its source art", target && !depthRefusal(target)],
        ["scalp", "Fit a clean scalp under this hair", cap && !cap.sourceOnly],
      ] as const;
      for (const [value, label, available] of modes)
        if (available) mode.append(new Option(label, value));
      if (!modes.some(([value, , available]) => value === paintAction && available))
        paintAction = undefined;
      mode.value = paintAction ?? "";
      mode.onchange = () => {
        paintAction = modes.find(([value]) => value === mode.value)?.[0] || undefined;
        clearPending(true);
        parts.clear();
        render();
      };
      box.append(mode);
      if (paintAction) {
        parts = new Set(target && paintAction !== "whole" ? [target.id] : []);
        box.append(
          el("p", { text: paintAction === "whole" ? "Whole character" : (target?.label ?? "") }),
        );
      }
    }
    if ((kind === "turnaround" && !paintAction) || kind === "variation") {
      const choices =
        kind === "turnaround"
          ? paintedParts(now.doc)
          : now.doc.parts.map((p) => ({ id: p.id, label: p.label, atlas: "" }));
      const selected = options.selection();
      if (parts.size === 0 && selected && choices.some((c) => c.id === selected))
        parts.add(selected);
      const sheet = kind === "turnaround" ? choices.find((c) => parts.has(c.id))?.atlas : undefined;
      const list = el("div", { className: "art-parts" });
      for (const c of choices) {
        const tick = el("input");
        tick.type = "checkbox";
        tick.checked = parts.has(c.id);
        tick.disabled =
          kind === "turnaround" &&
          (options.locks().has(c.id) || (sheet !== undefined && c.atlas !== sheet));
        tick.onchange = () => {
          if (tick.checked) parts.add(c.id);
          else parts.delete(c.id);
          render();
        };
        list.append(el("label", { title: c.id }, tick, ` ${c.label}`));
      }
      const branchAtlas = choices.find((c) => c.id === selected)?.atlas;
      if (kind === "turnaround" && selected && branchAtlas) {
        list.prepend(
          button("Select painted branch", () => {
            parts = new Set(paintedBranch(now.doc, selected, options.locks()));
            render();
          }),
        );
      }
      if (!choices.length)
        list.append(el("p", { className: "muted", text: "This document has no painted regions." }));
      box.append(el("p", { text: kind === "turnaround" ? "Repaint" : "Change (optional)" }), list);
    }

    if (kind === "trace" || kind === "depth") {
      const fit = kind;
      const build = fit === "trace" && intent === "build";
      if (fit === "trace") {
        const intentSelect = el("select");
        intentSelect.setAttribute("aria-label", "Trace intent");
        intentSelect.append(
          new Option("Fit the selected head", "fit"),
          new Option("Build new parts from the map", "build"),
        );
        intentSelect.value = intent;
        intentSelect.onchange = () => {
          intent = intentSelect.value === "build" ? "build" : "fit";
          render();
        };
        box.append(
          el("div", { className: "steer-field" }, el("label", { text: "Trace" }), intentSelect),
        );
      }
      const choices = now.doc.parts.filter((p) => !fitRefusal(fit, now.doc, p, intent));
      const selected = options.selection();
      for (const id of parts) if (!choices.some((c) => c.id === id)) parts.delete(id);
      if (parts.size === 0 && selected && choices.some((c) => c.id === selected))
        parts.add(selected);
      const list = el("div", { className: "art-parts" });
      for (const c of choices) {
        const pick = el("input");
        pick.type = "radio";
        pick.name = "art-fit-target";
        pick.checked = parts.has(c.id);
        pick.onchange = () => {
          parts = new Set([c.id]);
          render();
        };
        list.append(el("label", { title: c.id }, pick, ` ${c.label}`));
      }
      if (!choices.length)
        list.append(
          el("p", {
            className: "muted",
            text:
              fit === "depth"
                ? "This document has no painted portrait with calibrated landmarks."
                : build
                  ? "This document has no part painted from a sheet to build on."
                  : "This document has no traced head to fit.",
          }),
        );
      const [target] = [...parts];
      const atlas = now.doc.parts.find((p) => p.id === target)?.paint?.atlas;
      const views = button(
        "Add sheet views",
        () => {
          if (!atlas) return;
          void options
            .picture(atlas)
            .then((sheet) => sheetViews(sheet, fit))
            .then(async ({ front, side }) => {
              await attach("front", front, epoch, "sheet front");
              await attach("side", side, epoch, "sheet profile, facing left");
            })
            .catch((error: unknown) => say(failure(error)));
        },
        "Attach the part's sheet as the agent measures it: its front and left-facing profile panels",
      );
      views.disabled = !atlas;
      box.append(
        el("p", { text: build ? "Build on the sheet of" : "Fit" }),
        list,
        el("div", { className: "row-actions" }, views),
      );
    }

    if (kind === "turnaround" || kind === "depth") {
      const id = paintAction === "whole" ? null : (options.selection() ?? [...parts][0]);
      const target = now.doc.parts.find((p) => p.id === id);
      const details = el("details");
      details.append(
        el("summary", { text: "Nudge before fitting" }),
        el("p", {
          className: "muted",
          text: "Use percent for size and facial features, centimetres for moves, and degrees for turns.",
        }),
      );
      const axes = paintNudgeAxes(now.doc, target);
      nudge = Object.fromEntries(Object.entries(nudge).filter(([axis]) => axes.includes(axis)));
      for (const axis of axes) {
        const field = el("input");
        field.type = "number";
        field.min = "-40";
        field.max = "40";
        field.step = "1";
        field.value = String(nudge[axis] ?? 0);
        field.oninput = () => {
          if (field.validity.valid && field.valueAsNumber) nudge[axis] = field.valueAsNumber;
          else delete nudge[axis];
        };
        details.append(el("label", { className: "steer-field" }, axis, field));
      }
      box.append(details);
    }
    if (kind === "turnaround") {
      const target = paintAction === "whole" ? null : options.selection();
      box.append(
        button("Capture measured views", async () => {
          try {
            const adjustment = Object.keys(nudge).length
              ? { target, amounts: { ...nudge } }
              : undefined;
            const whole = await options.measured(null, false, adjustment);
            const detail = await options.measured(target, !target, adjustment);
            if (epoch !== draftEpoch || options.current()?.revision !== now.revision) return;
            await attach(
              "whole",
              whole.bytes,
              epoch,
              "Whole character, " + whole.height.toFixed(3) + " m",
            );
            await attach(
              target ? "close-up" : "back",
              detail.bytes,
              epoch,
              (target ? "Selected part alone, " : "Rear quarter, ") +
                detail.height.toFixed(3) +
                " m",
            );
            if (epoch === draftEpoch)
              sourceOptions = {
                ...sourceOptions,
                height: Math.max(0.15, Math.min(6, detail.height)),
              };
          } catch (error) {
            say(failure(error));
          }
        }),
      );
    }
    const role = el("select");
    role.setAttribute("aria-label", "Attachment role");
    for (const r of rolesShown) role.append(new Option(r, r));
    role.value = attachmentRole;
    role.onchange = () => {
      attachmentRole = chosen();
    };
    const chosen = (): AttachmentRole => rolesShown.find((r) => r === role.value) ?? "whole";
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.hidden = true;
    file.onchange = () => {
      const picked = file.files?.[0];
      file.value = "";
      if (picked)
        void picked
          .arrayBuffer()
          .then((b) => attach(chosen(), new Uint8Array(b), epoch, picked.name.slice(0, 120)))
          .catch((error: unknown) => say(failure(error)));
    };
    box.append(
      el(
        "div",
        { className: "row-actions" },
        role,
        button(
          "Add editor view",
          () => {
            const r = chosen();
            void options
              .capture(viewFor[r] ?? "current", kind === "depth" && (r === "front" || r === "side"))
              .then((png) => attach(r, png, epoch))
              .catch((error: unknown) => say(failure(error)));
          },
          "Capture the viewport; front, side and back square the camera to that side",
        ),
        button("Add picture…", () => file.click()),
        file,
      ),
    );
    const list = el("div", { className: "art-figures" });
    for (const [i, a] of pending.entries()) {
      const img = el("img", { className: "art-thumb", title: a.digest });
      img.alt = a.role;
      if (a.url) img.src = a.url;
      list.append(
        el(
          "figure",
          { className: "art-figure" },
          img,
          el("figcaption", { text: `${a.role}${a.label ? `: ${a.label}` : ""} · ${a.size}` }),
          button("Remove", () => {
            if (a.url) URL.revokeObjectURL(a.url);
            pending = pending.filter((_, j) => j !== i);
            render();
          }),
        ),
      );
    }
    box.append(list);

    const sheet =
      kind === "turnaround" ? paintedParts(now.doc).find((c) => parts.has(c.id))?.atlas : undefined;
    const needs = briefNeeds(
      kind,
      pending.map((a) => a.role),
      [...parts],
      kind === "trace" && intent === "build",
      paintAction === "whole",
    );
    const send = button("Send brief", () => {
      void sendBrief(now.documentId, now.revision, sheet);
    });
    const offline = button(
      "Prepare offline brief",
      () => void sendBrief(now.documentId, now.revision, sheet, true),
    );
    offline.disabled = !direction.trim() || needs.length > 0;
    send.disabled = !connected || !direction.trim() || needs.length > 0;
    box.append(
      el("p", {
        className: "muted",
        text: !paired.length
          ? "No agent yet. Ask Claude Code or Codex to look at the workshop and it connects on its own."
          : !connected
            ? "The agent is not running now. Ask it about the workshop in its conversation, then send."
            : needs.length
              ? `Still needed: ${needs.join(", ")}.`
              : `For revision ${now.revision}${sheet ? `, with the current sheet ${sheet.slice(0, 19)}…` : ""}.`,
      }),
      el("div", { className: "row-actions" }, send, offline),
    );
    return box;
  }

  async function sendBrief(
    documentId: string,
    revision: number,
    sheet: string | undefined,
    offline = false,
  ) {
    if (
      sending ||
      options.current()?.documentId !== documentId ||
      options.current()?.revision !== revision
    )
      return;
    const epoch = draftEpoch;
    sending = true;
    render();
    const attachments = pending.map((a) => ({
      role: a.role,
      digest: a.digest,
      ...(a.label ? { label: a.label } : {}),
    }));
    if (sheet && !attachments.some((a) => a.role === "source-sheet" && a.digest === sheet))
      attachments.push({ role: "source-sheet", digest: sheet, label: "current sheet" });
    const brief = options.enrich({
      format: "irudd.art-brief",
      version: 1,
      kind,
      documentId,
      revision,
      direction: direction.trim(),
      ...sourceOptions,
      ...(Object.keys(nudge).length && (kind === "turnaround" || kind === "depth")
        ? {
            nudge: {
              target:
                paintAction === "whole" ? null : (options.selection() ?? [...parts][0] ?? null),
              amounts: { ...nudge },
            },
          }
        : {}),
      ...(kind === "turnaround" && paintAction ? { paintAction } : {}),
      attachments,
      ...(parts.size ? { parts: [...parts] } : {}),
      ...(kind === "trace" && intent === "build" ? { intent } : {}),
    });
    try {
      const sent = await host.call("art.request", {
        agent: offline ? "offline" : agent,
        ...(offline ? { offline } : {}),
        requestId: undeliveredRequestId(requests, agent, brief) ?? `art-${crypto.randomUUID()}`,
        brief,
      });
      if (epoch !== draftEpoch) return;
      clearPending();
      direction = "";
      nudge = {};
      sourceOptions = {};
      parts = new Set();
      intent = "fit";
      known.add(sent.messageId);
      note = offline
        ? "Offline brief ready. Save the brief, then import the artwork on its card."
        : `Sent ${sent.artId} to ${sent.agent}.`;
      await refresh();
    } catch (error) {
      say(`Could not send the brief: ${failure(error)}`);
    } finally {
      sending = false;
      render();
    }
  }

  function again(r: ArtRequestView): void {
    const now = options.current();
    if (!now || now.documentId !== r.brief.documentId || sending) return;
    clearPending();
    agent = r.agent;
    kind = r.brief.kind;
    paintAction = r.brief.paintAction;
    intent = r.brief.intent ?? "fit";
    attachmentRole = kind === "trace" || kind === "depth" ? "front" : "whole";
    direction = r.brief.direction;
    nudge = { ...r.brief.nudge?.amounts };
    sourceOptions = {
      ...(r.brief.height === undefined ? {} : { height: r.brief.height }),
      ...(r.brief.protected ? { protected: r.brief.protected } : {}),
    };
    parts = new Set(r.brief.parts?.filter((id) => now.doc.parts.some((p) => p.id === id)));
    say(
      `Preparing a brief for revision ${now.revision}. Check the regions and add fresh pictures before sending.`,
    );
    root.querySelector("textarea")?.focus();
  }

  async function resend(r: ArtRequestView): Promise<void> {
    if (sending) return;
    sending = true;
    render();
    try {
      const sent = await host.call("art.request", resendRequest(r));
      known.add(sent.messageId);
      note = sent.steering
        ? `Sent ${sent.artId} to ${sent.agent}.`
        : `${sent.artId} was already answered; nothing was sent again.`;
      await refresh();
    } catch (error) {
      say(`Could not send the brief: ${failure(error)}`);
    } finally {
      sending = false;
      render();
    }
  }

  async function cancel(r: ArtRequestView): Promise<void> {
    try {
      await host.call("art.cancel", { artId: r.artId });
      await refresh();
    } catch (error) {
      say(failure(error));
    }
  }

  function confirmImport(r: ArtRequestView, picked: File): void {
    importDialog?.close();
    const dialog = el("dialog");
    importDialog = dialog;
    const form = el("form", { className: "art-compose" });
    const field = (label: string, max: number) => {
      const input = el("input");
      input.maxLength = max;
      form.append(el("label", { className: "steer-field" }, label, input));
      return input;
    };
    form.append(
      el("strong", { text: `Import ${picked.name}` }),
      el("p", { text: "Add any source or credit that should travel with this artwork." }),
    );
    const mapFile = el("input");
    mapFile.type = "file";
    mapFile.accept = ".json";
    const coverage = el("select");
    coverage.append(new Option("Continuous shell", "closed"), new Option("Open garment", "open"));
    if (r.brief.paintAction) form.append(el("label", {}, "Trace map (optional)", mapFile));
    if (r.brief.paintAction === "wear") form.append(el("label", {}, "Garment coverage", coverage));
    const author = field("Artist or studio", 200);
    const source = field("Source", 500);
    const license = field("License", 120);
    const credit = field("Credit", 300);
    const submit = el("button", { text: "Import artwork" });
    submit.type = "submit";
    form.append(
      el(
        "div",
        { className: "row-actions" },
        submit,
        button("Cancel", () => dialog.close()),
      ),
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      dialog.close();
      void importFile(
        r,
        picked,
        {
          ...(source.value.trim() ? { source: source.value.trim() } : {}),
          ...(license.value.trim() ? { license: license.value.trim() } : {}),
          ...(author.value.trim() ? { author: author.value.trim() } : {}),
          ...(credit.value.trim() ? { credit: credit.value.trim() } : {}),
        },
        mapFile.files?.[0],
        r.brief.paintAction === "wear"
          ? coverage.value === "open"
            ? "open"
            : "closed"
          : undefined,
      );
    };
    dialog.onclose = () => {
      dialog.remove();
      if (importDialog === dialog) importDialog = undefined;
    };
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
  }

  async function importFile(
    r: ArtRequestView,
    picked: File,
    attribution: AssetAttribution,
    mapFile?: File,
    coverage?: "open" | "closed",
  ): Promise<void> {
    try {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      const isPicture = r.brief.kind === "turnaround" || r.brief.kind === "depth";
      const file = isPicture
        ? { digest: (await stagePicture(host, bytes)).digest }
        : { json: parseJson(bytes) };
      const made = importedReply(
        r.brief.kind,
        `Imported ${picked.name}`.slice(0, 400),
        file,
        attribution,
      );
      if ("problem" in made) return say(made.problem);
      const params = {
        artId: r.artId,
        submissionId: `import-${crypto.randomUUID()}`,
        reply: {
          ...made.reply,
          ...(mapFile ? { traceMap: parseJson(new Uint8Array(await mapFile.arrayBuffer())) } : {}),
          ...(coverage ? { coverage } : {}),
        },
      };
      const outcome = await options.api.call("art.submit", params);
      if (!outcome.ok) return say(`${outcome.error._tag}: ${outcome.error.message}`);
      say(`Imported ${picked.name}.`);
      await refresh();
    } catch (error) {
      say(`Could not import: ${failure(error)}`);
    }
  }

  function saveBrief(r: ArtRequestView): HTMLElement {
    return button("Save brief", async () => {
      try {
        const files = await Promise.all(
          r.attachments.map(async (a) => {
            const image = await readPicture(host, r.artId, a.digest);
            return { ...a, base64: toBase64(image.bytes) };
          }),
        );
        const a = el("a");
        a.download = r.artId + "-brief.json";
        a.href = URL.createObjectURL(
          new Blob([JSON.stringify({ request: r.artId, brief: r.brief, attachments: files })], {
            type: "application/json",
          }),
        );
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch (error) {
        say(failure(error));
      }
    });
  }

  function submission(r: ArtRequestView, s: ArtSubmissionView): HTMLElement {
    const facts = [
      `${s.via === "agent" ? (s.by.name ?? s.by.id) : `imported by ${s.by.name ?? s.by.id}`}`,
      stateText[s.state],
      s.translator ? `by ${s.translator}` : "",
      s.duplicateOf ? `same reply as ${s.duplicateOf}` : "",
      s.proposal
        ? `proposal ${s.proposal.id} v${s.proposal.version}: ${s.proposal.status}${s.proposal.acceptedRevision ? ` in revision ${s.proposal.acceptedRevision}` : ""}`
        : "",
      s.source.stale
        ? `drafted on revision ${s.source.baseRevision}; the head was ${s.source.headAtSubmit}`
        : "",
    ].filter(Boolean);
    const item = el(
      "li",
      { className: `art-reply art-${s.state}` },
      el("strong", { text: s.reply.summary }),
      el("span", { className: "muted", text: facts.join(" · ") }),
    );
    for (const d of s.diagnostics) item.append(el("p", { className: "muted", text: d.message }));
    const figures = el("div", { className: "art-figures" });
    for (const f of s.files)
      figures.append(
        thumb(r.artId, f, `reply ${s.seq} · ${f.width}×${f.height} · ${f.byteLength} bytes`),
      );
    if (s.files.length) item.append(figures);
    if ((s.reply.kind === "turnaround" || s.reply.kind === "trace") && s.reply.traceMap) {
      const link = el("a", { text: "Save trace map" });
      const key = r.artId + "/" + s.submissionId;
      const url =
        urls.get(key) ??
        URL.createObjectURL(
          new Blob([JSON.stringify(s.reply.traceMap, null, 2)], { type: "application/json" }),
        );
      urls.set(key, url);
      link.href = url;
      link.download = s.submissionId + "-trace-map.json";
      item.append(link);
    }
    if (s.proposal?.status === "draft")
      item.append(
        el("p", {
          className: "muted",
          text: "Review it under Proposals: preview, accept or reject.",
        }),
      );
    return item;
  }

  function request(r: ArtRequestView): HTMLElement {
    const now = options.current();
    const head = now?.documentId === r.brief.documentId ? now.revision : r.head;
    const stale = head > r.brief.revision;
    const card = el(
      "div",
      { className: `art-request art-${r.state}` },
      el("strong", {
        text: `${artKindsShown.find((k) => k.kind === r.brief.kind)?.label ?? r.brief.kind}${r.brief.intent === "build" ? " · build" : ""} · ${r.agent}`,
      }),
      el("span", {
        className: "muted",
        text: [
          r.artId,
          r.state,
          `revision ${r.brief.revision}${stale ? ` (head ${head})` : ""}`,
          r.steering ? `message ${r.steering.status}` : "",
          r.apply.available ? "" : "replies recorded only",
        ]
          .filter(Boolean)
          .join(" · "),
      }),
      el("p", { text: r.brief.direction }),
    );
    if (r.closed) card.append(el("p", { className: "muted", text: r.closed.detail }));
    const figures = el("div", { className: "art-figures" });
    for (const a of r.attachments)
      figures.append(thumb(r.artId, a, `${a.role}${a.label ? `: ${a.label}` : ""}`));
    card.append(figures);
    if (r.submissions.length)
      card.append(
        el("ol", { className: "art-replies" }, ...r.submissions.map((s) => submission(r, s))),
      );
    else if (r.pairingId === "file:offline")
      card.append(el("p", { text: "Save the brief and import the completed artwork here." }));
    else if (undelivered(r))
      card.append(
        el("p", {
          className: "muted",
          text: "Saved but not sent: the app stopped before this brief reached the agent's conversation.",
        }),
      );
    else if (r.state === "open")
      card.append(
        el("p", { className: "muted", text: "Waiting for the agent's reply in its conversation." }),
      );
    const file = el("input");
    file.type = "file";
    file.hidden = true;
    file.accept =
      r.brief.kind === "turnaround" || r.brief.kind === "depth"
        ? "image/png,image/jpeg,image/webp"
        : "application/json,.json";
    file.onchange = () => {
      const picked = file.files?.[0];
      file.value = "";
      if (picked) confirmImport(r, picked);
    };
    const actions = el("div", { className: "row-actions" }, saveBrief(r));
    if (undelivered(r)) {
      const send = button(
        "Send to conversation",
        () => void resend(r),
        "Send this saved brief to the agent's conversation as the same request",
      );
      send.disabled =
        sending ||
        !paired.some(
          (p) =>
            p.agent === r.agent &&
            (p.availability.state === "ready" || p.availability.state === "inbox-only"),
        );
      actions.append(send);
    }
    if (r.state !== "cancelled") {
      actions.append(
        button("Import file…", () => file.click(), "Use a file made elsewhere as the reply"),
        file,
      );
      actions.append(button("Cancel request", () => void cancel(r)));
    }
    if (stale && now?.documentId === r.brief.documentId && r.state !== "cancelled")
      actions.append(button("Prepare updated brief", () => again(r)));
    card.append(actions);
    return card;
  }

  function render(): void {
    root.replaceChildren();
    root.append(
      el("p", {
        className: "muted",
        text: "The agent makes the artwork in its own conversation; this app never generates images. After sending, tell the agent to check the workshop.",
      }),
      composer(),
    );
    if (note) root.append(el("p", { className: "muted", text: note }));
    const now = options.current();
    const shown = requests.filter(
      (r) =>
        (!r.brief.fromSteer || r.brief.refinement) &&
        (!now || r.brief.documentId === now.documentId),
    );
    if (shown.length) root.append(...shown.map(request));
  }

  async function refresh(): Promise<void> {
    const id = ++refreshId;
    try {
      const now = options.current();
      const list: MethodParams["art.list"] = now
        ? { documentId: now.documentId, all: true }
        : { all: true };
      const snapshot = await Promise.all([
        capabilities ? Promise.resolve(capabilities) : host.call("art.capabilities", {}),
        host.call("recipient.list", {}),
        host.call("art.list", list).then((l) => l.requests),
      ]);
      if (id !== refreshId || now?.documentId !== options.current()?.documentId) return;
      [capabilities, paired, requests] = snapshot;
      for (const r of requests) known.add(r.messageId);
      const encoded = JSON.stringify([
        capabilities,
        paired.map((p) => [p.agent, p.name, p.pairingId, p.availability.state]),
        requests,
      ]);
      if (encoded !== lastSnapshot) {
        render();
        options.onRequests();
      }
      lastSnapshot = encoded;
    } catch (error) {
      if (id !== refreshId) return;
      note = failure(error);
      render();
    }
    clearTimeout(poll);
    const recent = Date.now() - activeMs;
    poll =
      paired.length ||
      requests.some(
        (r) =>
          r.state === "open" ||
          (r.state === "answered" &&
            Math.max(r.createdAt, ...r.submissions.map((x) => x.at)) > recent),
      )
        ? setTimeout(() => void refresh(), pollMs)
        : undefined;
  }

  return {
    refresh,
    selectedAgent: () => agent,
    originalBrief(id) {
      return requests.find(
        (r) =>
          r.brief.documentId === options.current()?.documentId &&
          (r.steering?.proposalId === id || r.submissions.some((s) => s.proposal?.id === id)),
      )?.brief;
    },
    protectedParts(id) {
      return requests
        .filter(
          (r) =>
            r.brief.documentId === options.current()?.documentId &&
            (r.steering?.proposalId === id || r.submissions.some((s) => s.proposal?.id === id)),
        )
        .flatMap((r) => r.brief.protected ?? []);
    },
    redraw: render,
    reset() {
      refreshId++;
      lastSnapshot = "";
      importDialog?.close();
      clearTimeout(poll);
      poll = undefined;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      clearPending();
      composingFor = undefined;
      urls.clear();
      known.clear();
      pending = [];
      requests = [];
      capabilities = undefined;
      note = "";
      render();
    },
    notice(n) {
      if (known.has(n.messageId)) void refresh();
    },
  };
}
