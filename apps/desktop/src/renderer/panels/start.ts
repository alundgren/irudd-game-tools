import { describe, failure } from "./context.js";
import { byId } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountStart(ctx: PanelContext, onStarted: (id: string) => Promise<void>) {
  const { host, showBanner, say } = ctx;
  const startSelect = byId("start", HTMLSelectElement);
  const randomHuman = byId("random-human", HTMLButtonElement);
  async function loadStarters(): Promise<void> {
    startSelect.disabled = true;
    startSelect.replaceChildren(new Option("New character from…", ""));
    if (!ctx.project) return;
    const list = await host.call("starters", {});
    for (const s of list.starters) {
      const reference = Reflect.get(s, "kind") !== "form" && s.reference;
      const label = reference ? `${s.label} (protocol reference)` : s.label;
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

  function startChoice(value: string): {
    readonly starter: string;
    readonly preset?: string;
    readonly seed?: number;
  } {
    const [starter = "", kind, preset] = value.split("/");
    if (kind === "preset" && preset) return { starter, preset };
    if (kind === "seed")
      return { starter, seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 0 };
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
      const started = await host.call("start", {
        documentId: id,
        requestId: "desk-" + crypto.randomUUID(),
        ...choice,
      });
      if (started.result.kind === "rejected") {
        showBanner("error", `Could not start: ${describe(started.result.diagnostics)}`);
        return;
      }
      say(`Started ${starter}`);
      await onStarted(id);
    } catch (error) {
      showBanner("error", `Could not start: ${failure(error)}`);
    } finally {
      startSelect.disabled = !ctx.project;
      randomHuman.disabled = false;
    }
  }

  function render(): void {
    randomHuman.hidden =
      !!ctx.documentId || !startSelect.querySelector('option[value="human-adult/seed"]');
  }
  return { render, loadStarters };
}
