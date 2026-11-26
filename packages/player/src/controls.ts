import type { Player, PlayerState } from "./player.js";
import { Inspector, reviewShots, type InspectionSheet, type ShotRequest } from "./inspect.js";
import {
  clampAngle,
  isPortrait,
  isSurface,
  isView,
  surfaces,
  viewLabels,
  views,
  type ModelInfo,
} from "./stage.js";

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Pick<HTMLElement, "className" | "textContent" | "title">> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.textContent) node.textContent = props.textContent;
  if (props.title) node.title = props.title;
  node.append(...children);
  return node;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return make("label", { className: "pl-field" }, make("span", { textContent: label }), control);
}

function options(
  select: HTMLSelectElement,
  entries: ReadonlyArray<readonly [string, string]>,
): void {
  select.replaceChildren(...entries.map(([value, text]) => new Option(text, value)));
}

function numberField(min: number, max: number, value: number): HTMLInputElement {
  const input = make("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = "1";
  input.value = String(value);
  return input;
}

function slider(label: string): HTMLInputElement {
  const input = make("input");
  input.type = "range";
  input.min = "-100";
  input.max = "100";
  input.value = "0";
  input.setAttribute("aria-label", label);
  return input;
}

export interface Controls {
  readonly root: HTMLElement;
  load(bytes: Uint8Array, name: string): Promise<ModelInfo | undefined>;
  inspect(width?: number, height?: number): Promise<InspectionSheet | undefined>;
}

export interface ControlsOptions {
  readonly onSheet?: (sheet: InspectionSheet) => void;
  readonly sheetSize?: readonly [number, number];
}

export function mountControls(
  panel: HTMLElement,
  player: Player,
  opts: ControlsOptions = {},
): Controls {
  const status = make("p", { className: "pl-status" });
  status.setAttribute("role", "status");
  const stats = make("p", { className: "pl-stats" });
  const origin = make("p", { className: "pl-origin" });
  const scene = make("select");
  scene.name = "scene";
  const sceneField = field("Scene", scene);
  const view = make("select");
  view.name = "view";
  options(
    view,
    views.map((v) => [v, viewLabels[v]]),
  );
  const free = new Option("Free orbit", "");
  free.disabled = true;
  view.append(free);
  const yaw = numberField(-180, 180, player.state.angle.yaw);
  const pitch = numberField(-80, 80, player.state.angle.pitch);
  const orbitFields = make(
    "div",
    { className: "pl-row" },
    field("Camera turn (°)", yaw),
    field("Camera elevation (°)", pitch),
  );
  orbitFields.hidden = true;
  const lookX = slider("Look across");
  const lookY = slider("Look up or down");
  const lookFields = make("div", {}, field("Look across", lookX), field("Look up or down", lookY));
  lookFields.hidden = true;
  const surface = make("select");
  surface.name = "surface";
  options(surface, [
    ["source", "File materials"],
    ["clay", "Clay"],
    ["ink", "Silhouette"],
  ]);
  const morph = make("select");
  morph.name = "morph";
  const morphField = field("Facial expression", morph);
  const clip = make("select");
  clip.name = "clip";
  const playing = make("input");
  playing.type = "checkbox";
  playing.checked = true;
  const time = make("input");
  time.type = "range";
  time.min = "0";
  time.max = "1";
  time.step = "0.001";
  time.value = "0";
  time.setAttribute("aria-label", "Clip time");
  const check = make("button", { textContent: "Check motion" });
  check.type = "button";
  const sheet = make("button", { textContent: "Inspection sheet" });
  sheet.type = "button";
  const report = make("pre", { className: "pl-report" });
  const shots = make("div", { className: "pl-shots" });

  const root = make(
    "div",
    { className: "pl-controls" },
    status,
    stats,
    origin,
    sceneField,
    field("Camera", view),
    orbitFields,
    field("Surface", surface),
    lookFields,
    morphField,
    field("Clip", clip),
    make("div", { className: "pl-row" }, field("Play", playing), time),
    make("div", { className: "pl-row" }, check, sheet),
    report,
    shots,
  );
  panel.append(root);

  const urls: string[] = [];
  const enable = (loaded: boolean): void => {
    for (const control of [
      view,
      yaw,
      pitch,
      surface,
      lookX,
      lookY,
      clip,
      playing,
      time,
      check,
      sheet,
    ])
      control.disabled = !loaded;
  };
  enable(false);
  status.textContent = "Open a GLB file.";

  function show(info: ModelInfo): void {
    const s = info.summary;
    status.textContent = `${info.name} · ${info.heightMetres.toFixed(3)} m tall · ${info.skeletons} skeletons · ${info.clips.length} clips`;
    stats.textContent = `${info.triangles.toLocaleString()} triangles · ${info.meshes} meshes · ${info.drawnMaterials} materials · ${(s.byteLength / 1024).toFixed(0)} KiB`;
    const p = s.provenance;
    origin.textContent = p
      ? `Workshop export: ${p.document} revision ${p.revision}, ${p.preset} preset, build ${p.build.slice(0, 12)}`
      : `No workshop recipe in this file${s.generator ? ` (made by ${s.generator})` : ""}.`;
    options(
      scene,
      s.scenes.map((name, i) => [String(i), name]),
    );
    scene.value = String(info.scene);
    sceneField.hidden = s.scenes.length < 2;
    options(morph, [
      ["", "Rest"],
      ...info.expressions.map((m) => [m, m === "BrowLift" ? "Raise brows" : m] as const),
    ]);
    morph.value = player.stage.morph ?? "";
    morphField.hidden = !info.expressions.length;
    lookFields.hidden = !info.gaze;
    const gaze = player.stage.gaze;
    lookX.value = String(Math.round(gaze.x * 100));
    lookY.value = String(Math.round(gaze.y * 100));
    for (const option of view.options)
      if (isView(option.value) && isPortrait(option.value)) option.disabled = !info.face;
    showView();
    options(clip, [
      ["", "Rest pose"],
      ...info.clips.map((c) => [c.name, `${c.name} (${c.duration.toFixed(2)} s)`] as const),
    ]);
    clip.value = player.stage.clip ?? "";
    clip.disabled = !info.clips.length;
    check.disabled = !info.clips.length;
    report.textContent = "";
  }

  function showView(): void {
    const state = player.state;
    view.value = state.view ?? "";
    orbitFields.hidden = state.view !== "portrait-angle";
  }

  player.subscribe((state: PlayerState) => {
    if (document.activeElement !== time) time.value = String(state.time);
    playing.checked = state.playing;
    if (view.value !== (state.view ?? "")) showView();
  });

  scene.onchange = () => {
    player.showScene(Number(scene.value));
    if (player.stage.info) show(player.stage.info);
  };
  view.onchange = () => {
    if (isView(view.value)) player.view(view.value);
    showView();
  };
  const angle = (): void => {
    const chosen = clampAngle({ yaw: Number(yaw.value), pitch: Number(pitch.value) });
    yaw.value = String(chosen.yaw);
    pitch.value = String(chosen.pitch);
    player.view("portrait-angle", chosen);
  };
  yaw.onchange = angle;
  pitch.onchange = angle;
  lookX.oninput = lookY.oninput = () =>
    player.setGaze(Number(lookX.value) / 100, Number(lookY.value) / 100);
  surface.onchange = () => {
    if (isSurface(surface.value)) player.setSurface(surface.value);
  };
  morph.onchange = () => player.setMorph(morph.value || null);
  clip.onchange = () => player.setClip(clip.value || null);
  playing.onchange = () => player.setPlaying(playing.checked);
  time.oninput = () => player.setTime(Number(time.value));
  let current: { readonly bytes: Uint8Array; readonly name: string } | undefined;

  function size(width?: number, height?: number): [number, number] {
    return [width ?? opts.sheetSize?.[0] ?? 512, height ?? opts.sheetSize?.[1] ?? 512];
  }

  check.onclick = async () => {
    const file = current;
    if (!file) return;
    const inspector = new Inspector(64, 64);
    try {
      await inspector.load(file.bytes, file.name, player.stage.info?.scene ?? 0);
      const lines = inspector
        .measure()
        .map(
          (m) =>
            `${m.clip} · movement ${m.movement.toFixed(3)} m · lowest vertex ${m.lowest.toFixed(3)} m`,
        );
      report.textContent = lines.join("\n") || "No clips.";
    } catch (error) {
      report.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      inspector.dispose();
    }
  };

  function liveShots(): ShotRequest[] {
    const state = player.state;
    return reviewShots(state.info, {
      clip: state.clip,
      time: state.time,
      surface: isSurface(surface.value) ? surface.value : "source",
      morph: state.morph,
      gaze: state.gaze,
      angle: state.angle,
    });
  }

  async function inspect(width?: number, height?: number): Promise<InspectionSheet | undefined> {
    const file = current;
    if (!file) return undefined;
    const [w, h] = size(width, height);
    const requests = liveShots();
    const inspector = new Inspector(w, h);
    try {
      const taken = await inspector.sheet(file.bytes, file.name, {
        scene: player.stage.info?.scene ?? 0,
        shots: requests,
      });
      for (const url of urls.splice(0)) URL.revokeObjectURL(url);
      shots.replaceChildren(
        ...taken.shots.map((shot) => {
          const url = URL.createObjectURL(new Blob([shot.png.slice()], { type: "image/png" }));
          urls.push(url);
          const img = make("img");
          img.src = url;
          img.width = Math.min(shot.width, 160);
          const label =
            viewLabels[shot.view] +
            (shot.angle ? ` ${shot.angle.yaw}°/${shot.angle.pitch}°` : "") +
            (shot.view === shot.requested ? "" : ` (no face for ${viewLabels[shot.requested]})`);
          img.alt = `${label} view`;
          return make("figure", {}, img, make("figcaption", { textContent: label }));
        }),
        make("p", {
          className: "pl-stats",
          textContent: `${w}×${h} px each · ${inspector.gpu.renderer}${inspector.gpu.software ? " (software fallback)" : ""}`,
        }),
      );
      opts.onSheet?.(taken);
      return taken;
    } catch (error) {
      report.textContent = error instanceof Error ? error.message : String(error);
      return undefined;
    } finally {
      inspector.dispose();
    }
  }

  sheet.onclick = () => {
    void inspect();
  };

  return {
    root,
    inspect,
    async load(bytes, name) {
      status.textContent = `Loading ${name}…`;
      try {
        const info = await player.load(bytes, name);
        current = { bytes: bytes.slice(), name };
        enable(true);
        show(info);
        if (isSurface(surface.value)) player.setSurface(surface.value);
        shots.replaceChildren();
        return info;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
        enable(player.stage.loaded);
        return undefined;
      }
    },
  };
}

export { surfaces };
