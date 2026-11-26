import { stagePicture, type BriefDraft } from "../art-files.js";
import { button, byId, el } from "../dom.js";
import { deckText, parseDecks } from "../choice-decks.js";
import {
  redrawDirection,
  replayDirection,
  directionCode,
  strengths,
  type Direction,
  type Strength,
} from "../direction.js";
import { failure, type PanelContext } from "./context.js";

interface Settings {
  text: string;
  code: string;
  strength: Strength;
  direction?: Direction;
  references: BriefDraft["attachments"][number][];
  protected: Set<string>;
  note: string;
}

export function mountVariation(ctx: PanelContext, onProtection: () => void) {
  const drafts = new Map<string, Settings>();
  const root = byId("variation", HTMLDetailsElement);
  const decks = byId("variation-decks", HTMLTextAreaElement);
  const range = byId("variation-strength", HTMLSelectElement);
  const code = byId("variation-code", HTMLInputElement);
  const draw = byId("variation-draw", HTMLButtonElement);
  const copy = byId("variation-copy", HTMLButtonElement);
  const protect = byId("variation-protect", HTMLInputElement);
  const files = byId("variation-files", HTMLInputElement);
  function current() {
    const id = ctx.documentId;
    if (!id || ctx.view?.documentId !== id) return undefined;
    let settings = drafts.get(id);
    if (!settings) {
      settings = {
        text: "",
        code: "",
        strength: "exploratory",
        references: [],
        protected: new Set(),
        note: "",
      };
      drafts.set(id, settings);
    }
    return settings;
  }
  function update(fn: (s: Settings) => void) {
    const s = current();
    if (!s) return;
    s.note = "";
    try {
      fn(s);
    } catch (error) {
      s.note = failure(error);
    }
    render();
  }
  function setDirection(s: Settings, d: Direction) {
    s.direction = d;
    s.strength = d.strength;
    s.code = directionCode(d);
  }
  range.onchange = () =>
    update((s) => {
      s.strength = strengths.find((v) => v === range.value) ?? "exploratory";
    });
  decks.oninput = () => {
    const s = current();
    if (s) s.text = decks.value;
  };
  code.oninput = () => {
    const s = current();
    if (s) s.code = code.value;
  };
  draw.onclick = () =>
    update((s) =>
      setDirection(s, redrawDirection(s.direction, s.strength, undefined, parseDecks(s.text))),
    );
  byId("variation-clear", HTMLButtonElement).onclick = () =>
    update((s) => {
      delete s.direction;
      s.code = "";
    });
  byId("variation-replay", HTMLButtonElement).onclick = () =>
    update((s) => {
      const replayed = replayDirection(s.code);
      setDirection(s, replayed);
      s.text = deckText(replayed.decks);
    });
  copy.onclick = async () => {
    const s = current();
    if (!s?.direction) return;
    try {
      await ctx.api.copyDirection(directionCode(s.direction));
      s.note = "Direction code copied.";
    } catch (error) {
      s.note = failure(error);
    }
    render();
  };
  protect.onchange = () =>
    update((s) => {
      const part = ctx.selection;
      if (!part) return;
      if (!protect.checked) s.protected.delete(part);
      else if (s.protected.size >= 32) throw new Error("Choose up to 32 protected parts.");
      else s.protected.add(part);
      onProtection();
    });
  files.onchange = async () => {
    const s = current();
    const picked = Array.from(files.files ?? []);
    const role = byId("variation-reference-role", HTMLSelectElement).value;
    files.value = "";
    if (!s) return;
    try {
      const { limits } = await ctx.host.call("art.capabilities", {});
      for (const file of picked) {
        if (s.references.length >= limits.attachments)
          throw new Error("Attach up to eight references.");
        if (file.size > limits.attachmentBytes) throw new Error("Choose an image under 16 MiB.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (current() !== s) return;
        const image = await stagePicture(ctx.host, bytes);
        if (current() !== s) return;
        if (
          !s.references.some(
            (a) => a.digest === image.digest && a.label === (role + ": " + file.name).slice(0, 120),
          )
        )
          s.references.push({
            role: "reference",
            digest: image.digest,
            label: (role + ": " + file.name).slice(0, 120),
          });
      }
      s.note = "";
    } catch (error) {
      s.note = failure(error);
    }
    render();
  };
  function pin(label: string, checked: boolean, change: (on: boolean) => void) {
    const input = el("input");
    input.type = "checkbox";
    input.checked = checked;
    input.onchange = () => change(input.checked);
    return el("label", {}, input, label);
  }
  function render() {
    const s = current();
    root.hidden = !s;
    if (!s) return;
    range.value = s.strength;
    decks.value = s.text;
    code.value = s.code;
    const d = s.direction;
    draw.textContent = d ? "Redraw direction" : "Draw direction";
    copy.disabled = !d;
    const results = byId("variation-results", HTMLDivElement);
    results.replaceChildren();
    if (d) {
      results.append(el("strong", { text: d.strength + " · " + d.magnitude + "%" }));
      for (const [i, cue] of d.cues.entries())
        results.append(
          pin(" Pin " + cue, d.pins[i] != null, (on) =>
            update(() => {
              d.pins[i] = on ? d.seed : null;
              setDirection(s, redrawDirection(d, d.strength, d.seed));
            }),
          ),
        );
      for (const deck of d.decks)
        results.append(
          pin(" Pin " + deck.label + " = " + deck.value, deck.pin !== null, (on) =>
            update(() => {
              deck.pin = on ? d.seed : null;
              setDirection(s, redrawDirection(d, d.strength, d.seed));
            }),
          ),
        );
    }
    byId("variation-references", HTMLDivElement).replaceChildren(
      ...s.references.map((a) =>
        button("Remove " + (a.label ?? "reference"), () =>
          update(() => {
            s.references = s.references.filter((x) => x !== a);
          }),
        ),
      ),
    );
    const part = ctx.selection ? ctx.part(ctx.selection) : undefined;
    byId("variation-part", HTMLSpanElement).textContent = part
      ? "(" + part.label + ")"
      : "(select a part)";
    protect.disabled = !part;
    protect.checked = !!part && s.protected.has(part.id);
    byId("variation-note", HTMLParagraphElement).textContent = s.note;
  }
  function enrich(brief: BriefDraft): BriefDraft {
    const s = current();
    if (!s || brief.kind !== "variation" || ctx.documentId !== brief.documentId) return brief;
    const d = s.direction;
    const protectedParts = [...new Set([...(brief.protected ?? []), ...s.protected])];
    return {
      ...brief,
      ...(d
        ? {
            variation: {
              strength: d.strength,
              seed: d.seed,
              magnitude: d.magnitude,
              cues: d.cues,
              choices: d.decks.map(({ label, value }) => ({ label, value })),
            },
          }
        : {}),
      ...(protectedParts.length ? { protected: protectedParts } : {}),
      attachments: [
        ...brief.attachments,
        ...s.references.filter(
          (a) => !brief.attachments.some((b) => b.role === a.role && b.digest === a.digest),
        ),
      ],
    };
  }
  return { render, enrich, current, reset: () => drafts.clear() };
}
