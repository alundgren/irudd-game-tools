import {
  colourRanges,
  randomCreature,
  otherForms,
  formArchetypes,
  formParams,
} from "@irudd/character/creature";
import {
  creatureFamilies,
  isJson,
  isJsonObject,
  isJsonArray,
  type Json,
  type CreaturePlan,
} from "@irudd/document";
import { adultColourRanges, randomDressedAdult } from "@irudd/character/human";
import { describe, failure } from "./context.js";
import { byId } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountStart(ctx: PanelContext, onStarted: (id: string) => Promise<void>) {
  const { host, showBanner, say } = ctx;
  const startSelect = byId("start", HTMLSelectElement);
  const randomHuman = byId("random-human", HTMLButtonElement);
  const randomBeast = byId("random-creature", HTMLButtonElement);
  const creatureDialog = byId("creature-start", HTMLDialogElement);
  const family = byId("creature-family", HTMLSelectElement);
  const palette = byId("creature-colours", HTMLSelectElement);
  const seedField = byId("creature-seed", HTMLInputElement);
  family.replaceChildren(...["Any", ...creatureFamilies].map((name) => new Option(name, name)));
  palette.replaceChildren(...colourRanges.map((name) => new Option(name, name)));
  const kind = byId("creature-form", HTMLSelectElement),
    frameField = byId("form-frame", HTMLSelectElement);
  kind.replaceChildren(...["Creature", ...otherForms].map((n) => new Option(n, n)));
  frameField.replaceChildren(...formArchetypes.map((n) => new Option(n, n)));
  function showKind() {
    family.disabled = kind.value === "Figure" || kind.value === "Humanoid";
    frameField.disabled = kind.value === "Creature";
    byId("create-form", HTMLButtonElement).textContent = "Create " + kind.value.toLowerCase();
    byId("creature-start-title", HTMLElement).textContent =
      "New random " + kind.value.toLowerCase();
  }
  kind.onchange = showKind;
  function openForm(type: string) {
    kind.value = type;
    showKind();
    creatureDialog.showModal();
  }
  randomBeast.onclick = () => openForm("Creature");
  byId("creature-cancel", HTMLButtonElement).onclick = () => creatureDialog.close();
  creatureDialog.onsubmit = (event) => {
    event.preventDefault();
    const seed =
      seedField.value === ""
        ? (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0)
        : seedField.valueAsNumber;
    const type = otherForms.find((f) => f === kind.value);
    if (type) {
      const params = formParams(
        type,
        seed,
        formArchetypes.find((f) => f === frameField.value) ?? "any",
        colourRanges.find((c) => c === palette.value) ?? "Mixed",
        creatureFamilies.find((f) => f === family.value),
      );
      creatureDialog.close();
      void startCharacter("workshop-form", params, type + " " + seed);
      return;
    }
    const plan = randomCreature(
      seed,
      creatureFamilies.find((f) => f === family.value),
      colourRanges.find((c) => c === palette.value),
    );
    creatureDialog.close();
    void startCharacter("creature-plan", plan, `${plan.family ?? "Creature"} ${seed}`);
  };
  const dialog = byId("human-start", HTMLDialogElement);
  const archetype = byId("human-archetype", HTMLSelectElement);
  const colours = byId("human-colours", HTMLSelectElement);
  colours.replaceChildren(...adultColourRanges.map((name) => new Option(name, name)));
  byId("human-start-cancel", HTMLButtonElement).onclick = () => dialog.close();
  dialog.onsubmit = (event) => {
    event.preventDefault();
    const body = ctx.humanBody;
    if (!body) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const frame = archetype.value;
    const range = adultColourRanges.find((name) => name === colours.value);
    if (
      !range ||
      !(frame === "any" || frame === "male" || frame === "female" || frame === "neutral")
    )
      return;
    const params = randomDressedAdult(body, seed, frame, range);
    dialog.close();
    void startCharacter("human-adult", params, `Adult human ${params.seed}`);
  };
  ctx.api.onTorsoStudy(() => {
    const studies = byId("study-choice", HTMLSelectElement);
    studies.value = "study.mhr-torso";
    studies.dispatchEvent(new Event("change"));
    void startCharacter(studies.value);
  });
  const studyMetadata = new Map<
    string,
    {
      id: string;
      title: string;
      game: string;
      source?: string;
      angle: string;
      mode?: string;
      referenceRigs: boolean;
    }
  >();
  const requested = new URLSearchParams(location.hash.slice(1));
  let initialStudy = requested.get("study");
  async function loadStarters(): Promise<void> {
    startSelect.disabled = true;
    startSelect.replaceChildren(new Option("New character from…", ""));
    if (!ctx.project) return;
    const list = await host.call("starters", {});
    const studies = byId("study-choice", HTMLSelectElement);
    const response = await fetch("./studies.json");
    const metadata: unknown = await response.json();
    studyMetadata.clear();
    if (isJson(metadata) && isJsonArray(metadata))
      for (const item of metadata) {
        if (
          isJsonObject(item) &&
          typeof item["id"] === "string" &&
          typeof item["game"] === "string" &&
          typeof item["starter"] === "string" &&
          typeof item["title"] === "string" &&
          typeof item["angle"] === "string"
        )
          studyMetadata.set(item["starter"], {
            id: item["id"],
            title: item["title"],
            referenceRigs: item["referenceRigs"] === true,
            game: item["game"],
            ...(typeof item["source"] === "string" ? { source: item["source"] } : {}),
            ...(typeof item["mode"] === "string" ? { mode: item["mode"] } : {}),
            angle: item["angle"],
          });
      }
    const link = byId("study-source", HTMLAnchorElement);
    studies.onchange = () => {
      const study = studyMetadata.get(studies.value);
      link.hidden = !study?.source;
      if (study?.source) link.href = study.source;
      else link.removeAttribute("href");
    };
    studies.replaceChildren();
    const available = new Set(list.starters.map((s) => s.id));
    for (const [id, study] of studyMetadata)
      if (available.has(id)) studies.add(new Option(study.title + " \u00b7 " + study.game, id));
    byId("study-rig", HTMLAnchorElement).hidden = !(
      (await fetch("./rig-available.json").then((r) => r.json())) === true
    );
    const examples = document.createElement("optgroup");
    examples.label = "Example forms";
    for (const s of list.starters) {
      if (studyMetadata.has(s.id)) continue;
      if (s.kind === "form") examples.append(new Option(s.label, s.id));
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
      } else if (s.id === "creature-plan")
        startSelect.add(new Option("New random creature", "creature-plan/seed"), 1);
      else if (s.id === "workshop-form")
        startSelect.add(new Option("New figure, humanoid or hybrid", "workshop-form/seed"), 2);
      else startSelect.append(new Option(label, s.id));
    }
    studies.append(examples);
    studies.dispatchEvent(new Event("change"));
    startSelect.disabled = startSelect.options.length < 2;
    if (initialStudy) {
      const entry = [...studyMetadata].find(([, s]) => s.id === initialStudy);
      initialStudy = null;
      if (entry && available.has(entry[0])) {
        studies.value = entry[0];
        studies.dispatchEvent(new Event("change"));
        await startCharacter(entry[0], undefined, undefined, requested.get("compare") === "3d");
      } else showBanner("error", "Unknown workshop study.");
    }
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

  startSelect.onchange = () => {
    if (startSelect.value === "human-adult/seed") {
      startSelect.value = "";
      dialog.showModal();
    } else if (
      startSelect.value === "creature-plan/seed" ||
      startSelect.value === "workshop-form/seed"
    ) {
      const type = startSelect.value === "creature-plan/seed" ? "Creature" : "Figure";
      startSelect.value = "";
      openForm(type);
    } else void startCharacter(startSelect.value);
  };
  byId("open-study", HTMLButtonElement).onclick = () =>
    void startCharacter(byId("study-choice", HTMLSelectElement).value);
  randomHuman.onclick = () => dialog.showModal();

  async function startCharacter(
    value: string,
    params?: Json,
    label?: string,
    compare = false,
  ): Promise<void> {
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
        ...(params ? { params } : {}),
        ...(label ? { label } : {}),
      });
      if (started.result.kind === "rejected") {
        showBanner("error", `Could not start: ${describe(started.result.diagnostics)}`);
        return;
      }
      say(`Started ${starter}`);
      await onStarted(id);
      const study = studyMetadata.get(starter);
      if (study) {
        if (study.mode) {
          const display = byId("display-mode", HTMLSelectElement);
          display.value =
            study.mode === "Clay" ? "clay" : study.mode === "Silhouette" ? "silhouette" : "studio";
          display.dispatchEvent(new Event("change"));
        }
        const angle =
          { Front: "front", Portrait: "portrait", Side: "side", Back: "back" }[study.angle] ??
          "threequarter";
        byId("camera-" + angle, HTMLButtonElement).click();
        if (compare && study.referenceRigs) {
          for (let i = 0; i < 300 && !document.getElementById("fit-study-reference"); i++)
            await new Promise((done) => setTimeout(done, 100));
          const fit = document.getElementById("fit-study-reference");
          if (fit) fit.click();
          else showBanner("error", "The study's 3D reference could not be opened.");
        }
      }
    } catch (error) {
      showBanner("error", `Could not start: ${failure(error)}`);
    } finally {
      startSelect.disabled = !ctx.project;
      randomHuman.disabled = false;
    }
  }

  function render(): void {
    randomBeast.hidden =
      !!ctx.documentId || !startSelect.querySelector('option[value="creature-plan/seed"]');
    randomHuman.hidden =
      !!ctx.documentId || !startSelect.querySelector('option[value="human-adult/seed"]');
  }
  return {
    render,
    loadStarters,
    fromPlan: (plan: CreaturePlan, label: string) => startCharacter("creature-plan", plan, label),
  };
}
