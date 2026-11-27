import { required } from "../dom.js";
import { Vector3 } from "three";
import {
  clearMask,
  createMask,
  fitLandmarks,
  fitMarkedProportions,
  fitSurface,
  fittingSkin,
  hideBeyond,
  hidePatch,
  humanMeasurements,
  humanRange,
  isHumanAxis,
  matchReferenceFeature,
  maskSummary,
  maskText,
  maskedIndices,
  placeHeadScan,
  poseReadings,
  prealignAdult,
  proportionChoices,
  proportionPoints,
  proportionReadings,
  proportions,
  readFittingFile,
  readProportion,
  referenceTree,
  registerNeutral,
  transferHead,
  undoMask,
  type AlignmentOptions,
  type FittedAdult,
  type FitRegion,
  type HumanAdultParams,
  type HumanBody,
  type ReferenceMesh,
} from "@irudd/character/human/reference";
import {
  humanCorrections,
  humanFineHead,
  humanReferenceRigs,
  jsonEqual,
  type CharacterDocument,
} from "@irudd/document";
import { referenceModels } from "../../shared/reference-models.js";
import { byId } from "../dom.js";
import { failure, type PanelContext } from "./context.js";
import { referenceViewport } from "./reference-viewport.js";
import { template } from "./reference-template.js";

type Source = ReferenceMesh & { name: string; credit: string; meshes: number; id?: string };
const regions: FitRegion[] = ["whole", "head", "trunk", "arms", "legs"];
const regionOf = (s: string) => regions.find((r) => r === s) ?? "whole";
const waitPaint = () =>
  new Promise<void>((done) => {
    const fallback = setTimeout(done, 100);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        done();
      }),
    );
  });
type Opening = {
  body: HumanBody;
  params: HumanAdultParams;
  doc: CharacterDocument;
  base: { documentId: string; revision: number };
};
export function mountReferenceRoom(ctx: PanelContext) {
  document.body.insertAdjacentHTML("beforeend", template);
  const id = (s: string) => "hfit-" + s;
  const button = (s: string) => byId(id(s), HTMLButtonElement),
    input = (s: string) => byId(id(s), HTMLInputElement),
    select = (s: string) => byId(id(s), HTMLSelectElement);
  const node = (s: string) => byId(id(s), HTMLElement);
  const dialog = byId(id("room"), HTMLDialogElement),
    stage = node("stage"),
    canvas = byId(id("canvas"), HTMLCanvasElement);
  let viewport: ReturnType<typeof referenceViewport> | undefined;
  const view = () =>
    (viewport ??= referenceViewport(stage, canvas, () => {
      node("view-reading").textContent = "";
    }));
  let opening: Opening | undefined, source: Source | undefined, neutral: Source | undefined;
  let registered: ReturnType<typeof registerNeutral> | undefined,
    registrationKey = "",
    landmarks: ReturnType<typeof fitLandmarks> | undefined;
  let original: FittedAdult = { human: {} },
    working = original;
  let placed: ReferenceMesh | undefined,
    tree: ReturnType<typeof referenceTree> | undefined,
    hiddenTree: ReturnType<typeof referenceTree> | undefined;
  let mask: ReturnType<typeof createMask> | undefined,
    busy = false,
    token = 0,
    mode = "side",
    tool = "",
    referenceFacts = "",
    warningText: string[] = [];
  let steps: { adult: FittedAdult; label: string }[] = [];
  let pairs: Vector3[] = [],
    feature: Vector3 | undefined,
    pending: Vector3 | undefined,
    marked = new Map<string, [Vector3, Vector3]>();
  let choices: ReturnType<typeof proportionChoices> = [],
    kept = new Set<string>();
  const manual = new Map<string, boolean>();
  const surfaceMarks = new WeakMap<Vector3, { corners: readonly number[]; shares: Vector3 }>();
  const note = (s: string) => (node("note").textContent = s);
  const head = () => select("kind").value === "head";
  const settings = (): AlignmentOptions => ({
    units: select("units").value,
    up: select("up").value,
    turn: select("turn").value,
    nudge: [
      input("nudge-x").valueAsNumber / 1000 || 0,
      input("nudge-y").valueAsNumber / 1000 || 0,
      input("nudge-z").valueAsNumber / 1000 || 0,
    ],
  });
  const held = (p: Vector3, shown: number) => {
    const h = hiddenTree?.nearest(p);
    return !!h && h.distance < Math.abs(shown);
  };
  const show = (s: string, visible: boolean) => (node(s).hidden = !visible);
  const score = (x: number) => x.toFixed(1);
  const body = () => {
    if (!opening) throw new Error("Open an editable adult.");
    return opening.body;
  };
  function angles() {
    view().settings(
      mode,
      input("original").checked,
      input("opacity").valueAsNumber / 100,
      input("wipe").valueAsNumber / 100,
    );
  }
  function sync() {
    for (const item of dialog.querySelectorAll("button,select,input"))
      if (
        item instanceof HTMLButtonElement ||
        item instanceof HTMLSelectElement ||
        item instanceof HTMLInputElement
      )
        item.disabled = busy && item !== button("close");
    if (busy) return;
    const ready = !!source,
      aligned = ready && (!head() || !!landmarks);
    for (const s of ["view-score"]) button(s).disabled = !ready;
    button("run").disabled = !aligned || tool === "landmarks";
    select("region").disabled = head();
    for (const s of ["match-stature", "match-arms"]) input(s).disabled = head();
    for (const s of ["reset", "undo", "apply"]) button(s).disabled = !steps.length;
    show("contour-field", ["whole", "head"].includes(select("region").value));
    show("eyes-field", head());
    show("head-tools", head() && ready);
    show("mask-tools", head() && ready);
    show("empty", !ready);
    show("opacity-field", ready && mode === "overlay");
    show("wipe-line", ready && mode === "wipe");
    show("wipe-field", ready && mode === "wipe");
    show("legend", ready && mode === "deviation");
    input("original").disabled = tool === "landmarks";
    for (const b of node("views").querySelectorAll("button")) {
      b.disabled = tool === "landmarks";
      b.setAttribute("aria-pressed", String(b.dataset["view"] === mode));
    }
    for (const s of ["units", "up", "turn"]) select(s).disabled = tool === "landmarks";
    const states: Record<string, string> = {
      feature: "Match a feature",
      mask: "Hide parts that are not skin",
      prop: "Match proportions",
      landmarks: "Match three landmarks",
    };
    for (const [k, label] of Object.entries(states)) {
      button(k).setAttribute("aria-pressed", String(tool === k));
      button(k).textContent =
        tool === k
          ? ({
              mask: "Stop hiding parts",
              feature: "Stop matching features",
              prop: "Stop matching proportions",
              landmarks: "Cancel landmark placement",
            }[k] ?? label)
          : label;
    }
    button("feature").disabled = button("prop").disabled = !aligned || tool === "landmarks";
    show("feature-settings", tool === "feature");
    show("mask-settings", tool === "mask");
    show("prop-panel", tool === "prop");
    button("mask-undo").disabled = button("mask-clear").disabled = !mask?.count;
    show("mask-size-field", select("mask-kind").value === "patch");
    node("mask-size-reading").textContent = input("mask-size").value + " mm";
    node("feature-size").textContent = input("feature-reach").value + " cm";
    const same =
      !!source &&
      !!neutral &&
      neutral.positions.length === source.positions.length &&
      neutral.indices.length === source.indices.length;
    button("family-run").disabled =
      !same || !(input("family-measure").checked || input("family-detail").checked);
    button("family-clear").disabled = !working.fineHead;
    node("prop-controls")
      .querySelectorAll("input")
      .forEach((toggle, index) => {
        toggle.disabled = !choices[index]?.free;
      });
    button("prop-fit").disabled = !choices.some((choice) => choice.free && !kept.has(choice.key));
    node("family-reading").textContent = neutral
      ? neutral.name +
        " · " +
        (neutral.positions.length / 3).toLocaleString() +
        " vertices" +
        (registered
          ? " · registered, head " +
            registered.registered +
            " of " +
            registered.headVertices +
            " vertices"
          : "") +
        (source
          ? same
            ? ". The reference has the same vertex count."
            : ". This reference has a different vertex count."
          : ". Choose the family member above.")
      : "Choose a neutral mesh for this session.";
    node("landmark-instruction").textContent =
      tool === "landmarks"
        ? "Click the " +
          (["right outer eye corner", "left outer eye corner", "centre of the chin"][
            Math.floor(pairs.length / 2)
          ] ?? "landmark") +
          " on the " +
          (pairs.length % 2 ? "editable head." : "reference.")
        : landmarks
          ? "Three landmarks matched. RMS placement error " + score(landmarks.rmsMm) + " mm."
          : "Match both outer eye corners and the chin.";
    node("labels").textContent = source
      ? (mode === "overlay"
          ? "Reference overlay"
          : mode === "deviation"
            ? "Signed distance to the reference"
            : "Reference") +
        " · " +
        (input("original").checked ? "Original" : steps.length ? "Fitted" : "Aligned adult")
      : "Editable adult";
    node("steps").replaceChildren(
      ...steps.map((s) => Object.assign(document.createElement("li"), { textContent: s.label })),
    );
    node("warnings").replaceChildren(
      ...warningText.map((s) => Object.assign(document.createElement("li"), { textContent: s })),
    );
    node("facts").textContent =
      referenceFacts +
      (working.corrections
        ? " · " + working.corrections.controls.length + " surface corrections"
        : "") +
      (working.fineHead
        ? " · fine head layer on " + working.fineHead.vertices.length + " vertices"
        : "");
  }
  function drawMarkers() {
    const dots: { point: Vector3; side: "both" | "reference" | "human"; color: number }[] = [];
    if (feature) dots.push({ point: feature, side: "both", color: 0xe44230 });
    pairs.forEach((point, i) =>
      dots.push({ point, side: i % 2 ? "human" : "reference", color: 0xfeba30 }),
    );
    if (tool === "prop") {
      const spec = proportions.find((p) => p.id === select("prop-pick").value);
      const pts = proportionPoints(body(), working);
      if (spec)
        for (const key of [spec.from, spec.to])
          dots.push({ point: required(pts.get(key)), side: "human", color: 0x338552 });
      for (const pair of marked.values())
        for (const p of pair) dots.push({ point: p, side: "reference", color: 0xd98324 });
      if (pending) dots.push({ point: pending, side: "reference", color: 0xe44230 });
    }
    view().markers(dots);
  }
  function draw(currentOnly = false) {
    const stage = view();
    const results = stage.actor(
      "now",
      body(),
      working,
      tree,
      head(),
      hiddenTree ? held : undefined,
    );
    if (!currentOnly || !baseline)
      baseline = stage.actor(
        "original",
        body(),
        original,
        tree,
        head(),
        hiddenTree ? held : undefined,
      );
    const rows = required(byId(id("table"), HTMLTableElement).tBodies[0]);
    rows.replaceChildren();
    for (const region of regions) {
      const row = rows.insertRow();
      const a = baseline.regions[region],
        b = results.regions[region];
      for (const text of [
        region,
        a ? score(a.meanMm) + " / " + score(a.p95Mm) : "–",
        b ? score(b.meanMm) + " / " + score(b.p95Mm) : "–",
        b ? score(b.biasMm) : "–",
      ])
        row.insertCell().textContent = text;
    }
    if (mask?.count && placed)
      node("mask-reading").textContent =
        maskText(maskSummary(mask, placed.positions, placed.indices)) +
        " · " +
        score(100 * results.hiddenShare) +
        "% of editable head surface held";
    sync();
    angles();
    drawMarkers();
  }
  let baseline: ReturnType<ReturnType<typeof referenceViewport>["actor"]> | undefined;
  function restart() {
    steps = [];
    working = original;
    feature = pending = undefined;
    choices = [];
    warningText = [];
    referenceFacts = "";
    baseline = undefined;
    hiddenTree = undefined;
    tree = undefined;
    placed = undefined;
    if (source) {
      const options = settings();
      if (head()) {
        const p = placeHeadScan(source, options, fittingSkin(body(), original), landmarks);
        placed = { indices: source.indices, positions: p.positions };
        referenceFacts = "Scan " + p.report.stature.toFixed(3) + " m";
      } else {
        const result = prealignAdult(
          body(),
          original,
          source,
          options,
          input("match-stature").checked,
          input("match-arms").checked,
        );
        working = result.prepared;
        const r = result.placed.report;
        placed = { indices: source.indices, positions: result.placed.positions };
        warningText = [...r.notes];
        const skin = fittingSkin(body(), working),
          mine = poseReadings(skin.positions.subarray(0, skin.bodyVertices * 3));
        const arm = (v: number | null) => (v === null ? "unreadable" : v.toFixed(1) + "°");
        const feet = (v: number | null) =>
          v === null ? "unreadable" : (100 * v).toFixed(1) + " cm";
        referenceFacts =
          (r.unit === "stature" ? "Unknown units" : r.unit) +
          (r.unitAuto ? " (detected)" : "") +
          " · input " +
          r.sourceHeight.toFixed(2) +
          " · scale ×" +
          r.factor.toPrecision(4) +
          " · " +
          r.stature.toFixed(3) +
          " m · " +
          r.up +
          " up · turn " +
          r.turn +
          "° · arms " +
          arm(result.pose.armsBelowHorizontal) +
          " / " +
          arm(mine.armsBelowHorizontal) +
          " · feet " +
          feet(result.pose.footSpacing) +
          " / " +
          feet(mine.footSpacing);
        if (r.stature < 1.425 || r.stature > 2.085)
          warningText.push("Stature lies outside the editable adult range.");
        else if (Math.abs((working.human.height ?? 1.72) - r.stature) > 0.02)
          warningText.push("Stature differs. Match it under Alignment or fit measurements first.");
        if (result.pose.armsBelowHorizontal === null)
          warningText.push("The arm angle could not be read.");
        else if (
          mine.armsBelowHorizontal !== null &&
          Math.abs(mine.armsBelowHorizontal - result.pose.armsBelowHorizontal) > 6
        )
          warningText.push("The template and reference arms rest at different angles.");
        if ((result.pose.armDifference ?? 0) > 10)
          warningText.push("The reference arms are posed differently.");
        if (
          mine.footSpacing !== null &&
          result.pose.footSpacing !== null &&
          Math.abs(mine.footSpacing - result.pose.footSpacing) > 0.06
        )
          warningText.push("Foot spacing differs. Fit measurements first to move the legs.");
        if (source.indices.length < 9000)
          warningText.push("Coarse reference. Distances follow flat facets.");
      }
      referenceFacts =
        source.name +
        " · " +
        (source.indices.length / 3).toLocaleString() +
        " triangles · " +
        source.meshes +
        " meshes · " +
        referenceFacts;
      if (head() && mask?.count) {
        const { hidden, shown } = maskedIndices(mask, placed.indices);
        const summary = maskText(maskSummary(mask, placed.positions, placed.indices));
        node("mask-reading").textContent = summary;
        referenceFacts += " · " + summary;
        hiddenTree = referenceTree({ ...placed, indices: hidden });
        tree = referenceTree({ ...placed, indices: shown });
      } else {
        tree = referenceTree(placed);
        node("mask-reading").textContent = "All triangles shown.";
      }
    }
    if (placed) {
      for (const pair of marked.values())
        for (const point of pair) {
          const mark = surfaceMarks.get(point);
          if (mark) {
            point.set(0, 0, 0);
            mark.corners.forEach((v, i) =>
              point.addScaledVector(
                new Vector3().fromArray(required(placed).positions, 3 * v),
                mark.shares.getComponent(i),
              ),
            );
          }
        }
    }
    view().setReference(tree?.mesh, hiddenTree?.mesh);
    draw();
    refreshProportions(true);
  }
  function step(adult: FittedAdult, label: string) {
    steps.push({ adult: working, label });
    working = adult;
    draw(true);
    refreshProportions(true);
    note(label + ". Apply to keep it.");
  }
  function chooseTool(name: string) {
    tool = tool === name ? "" : name;
    feature = pending = undefined;
    pairs = [];
    if (tool) {
      mode = "side";
      input("original").checked = tool === "landmarks";
      if (tool === "landmarks") {
        select("frame").value = "head";
        view().frame("head", 0);
      }
    }
    sync();
    angles();
    refreshProportions(true);
    drawMarkers();
  }
  async function run(action: (current: () => boolean) => void | Promise<void>) {
    if (busy) return;
    const request = ++token,
      current = () => request === token && dialog.open;
    busy = true;
    sync();
    try {
      await waitPaint();
      if (current()) await action(current);
    } catch (e) {
      if (current()) note(failure(e));
    } finally {
      if (current()) {
        busy = false;
        sync();
      }
    }
  }
  const chooseSource = async (read: () => Promise<Source>) => {
    const request = ++token;
    busy = true;
    sync();
    try {
      const loaded = await read();
      if (request !== token) return;
      const previous = source,
        oldMask = mask,
        oldLandmarks = landmarks;
      const previousState = {
        working,
        steps,
        placed,
        tree,
        hiddenTree,
        baseline,
        referenceFacts,
        warningText,
        tool,
        pairs,
        marked: new Map(marked),
        manual: new Map(manual),
        kept: new Set(kept),
      };
      try {
        source = loaded;
        marked.clear();
        manual.clear();
        kept.clear();
        mask = createMask(loaded.indices.length / 3);
        landmarks = undefined;
        pairs = [];
        tool = "";
        restart();
      } catch (e) {
        source = previous;
        mask = oldMask;
        landmarks = oldLandmarks;
        ({
          working,
          steps,
          placed,
          tree,
          hiddenTree,
          baseline,
          referenceFacts,
          warningText,
          tool,
          pairs,
          marked,
          kept,
        } = previousState);
        manual.clear();
        for (const [key, value] of previousState.manual) manual.set(key, value);
        view().setReference(tree?.mesh, hiddenTree?.mesh);
        draw();
        refreshProportions(true);
        throw e;
      }
      node("licence").textContent = source.credit || "This local reference stays in this session.";
      const list = select("source");
      list.querySelector("[data-local]")?.remove();
      if (!source.id) {
        const option = new Option("Your file · " + source.name, "local");
        option.dataset["local"] = "true";
        list.add(option);
      }
      list.value = source.id ?? "local";
      view().frame(regionOf(select("frame").value));
      note("Reference aligned. Choose a region to fit.");
    } catch (e) {
      if (request === token) {
        const error = failure(e);
        note(
          /DRACO|KHR_draco/i.test(error)
            ? "Draco-compressed files are not supported. Export without Draco compression."
            : /JSON|Unexpected|token/i.test(error)
              ? "This is not a readable single-file GLB."
              : error,
        );
      }
    } finally {
      if (request === token) {
        busy = false;
        sync();
      }
    }
  };
  const loadFile = async (file: File): Promise<Source> => ({
    ...(await readFittingFile(file)),
    name: file.name,
  });
  function example(key: string) {
    const spec = referenceModels.find((r) => r.id === key);
    if (spec)
      void chooseSource(async () => ({
        ...(await loadFile(
          new File([Uint8Array.from(await ctx.api.referenceModel(key))], spec.file),
        )),
        id: key,
        name: spec.label,
        credit:
          "Momentum Human Rig v1.0.1 · Meta Platforms, Inc. and affiliates · Apache License 2.0. Converted reference.",
      }));
  }
  select("source").onchange = () => example(select("source").value);
  button("browse").onclick = () => input("file").click();
  input("file").accept = ".glb,.gltf,.obj";
  input("file").onchange = () => {
    const file = input("file").files?.[0];
    input("file").value = "";
    if (file) void chooseSource(() => loadFile(file));
  };
  stage.ondragover = (e) => {
    e.preventDefault();
    stage.classList.add("hfit-drop");
  };
  stage.ondragleave = () => stage.classList.remove("hfit-drop");
  dialog.ondragover = (e) => e.preventDefault();
  dialog.ondrop = (e) => e.preventDefault();
  stage.ondrop = (e) => {
    e.preventDefault();
    stage.classList.remove("hfit-drop");
    const f = e.dataTransfer?.files[0];
    if (f && !busy) void chooseSource(() => loadFile(f));
  };
  for (const b of node("views").querySelectorAll("button"))
    b.onclick = () => {
      mode = b.dataset["view"] ?? "side";
      tool = "";
      sync();
      angles();
      drawMarkers();
    };
  for (const b of node("angles").querySelectorAll("button"))
    b.onclick = () => view().look(Number(b.dataset["angle"]));
  select("frame").onchange = () => view().frame(regionOf(select("frame").value));
  select("region").onchange = () => {
    select("frame").value = select("region").value;
    select("frame").onchange?.call(select("frame"), new Event("change"));
    sync();
  };
  input("original").onchange = () => {
    if (input("original").checked && (tool === "feature" || tool === "prop")) chooseTool(tool);
    angles();
  };
  input("opacity").oninput = angles;
  input("wipe").oninput = () => {
    node("wipe-line").style.left = input("wipe").value + "%";
    angles();
  };
  for (const k of [
    "units",
    "up",
    "turn",
    "nudge-x",
    "nudge-y",
    "nudge-z",
    "match-stature",
    "match-arms",
  ])
    node(k).onchange = () => {
      if (["units", "up", "turn"].includes(k)) {
        registered = undefined;
        landmarks = undefined;
      }
      tool = "";
      pairs = [];
      const count = steps.length;
      restart();
      note(count ? "Alignment changed. The previous steps were cleared." : "Alignment updated.");
    };
  select("kind").onchange = () => {
    tool = "";
    pairs = [];
    landmarks = undefined;
    if (mask) clearMask(mask);
    select("region").value = select("frame").value = head() ? "head" : "whole";
    restart();
    view().frame(regionOf(select("frame").value), 0);
  };
  button("run").onclick = () =>
    void run(() => {
      if (!tree) return;
      const region = regionOf(select("region").value);
      const result = fitSurface(body(), working, tree.mesh, region, {
        measurements: input("measure").checked,
        contours: !node("contour-field").hidden && input("contour").checked,
        keepEyes: head() && input("eyes").checked,
        headOnly: head(),
        held,
      });
      step(
        result.adult,
        region +
          " fit · " +
          result.fitted +
          " of " +
          result.candidates +
          " eligible anchors · " +
          (result.metrics?.heldAnchors ?? 0) +
          " held" +
          (result.metrics
            ? " · " +
              score(result.metrics.before.meanMm) +
              " → " +
              score(result.metrics.after.meanMm) +
              " mm mean"
            : "") +
          (result.metrics?.refinedFacialContours ? " · facial contours refined" : "") +
          (result.problem ? " · " + result.problem : "") +
          (result.measure
            ? " · measurements " +
              score(result.measure.before.meanMm) +
              " → " +
              score(result.measure.after.meanMm) +
              " mm mean"
            : " · surface only") +
          (head() && input("eyes").checked ? " · eye openings kept" : "") +
          (result.preserved
            ? " · head kept: moved " +
              score(result.preserved.carried) +
              " → " +
              score(result.preserved.kept) +
              " mm, " +
              result.preserved.limited +
              " at layer limit, " +
              result.preserved.folds +
              " folds"
            : ""),
      );
    });
  button("view-score").onclick = () => {
    try {
      const s = view().score();
      const fmt = (v: typeof s.original) =>
        v.sharedPixels
          ? (100 * (v.overlap ?? 0)).toFixed(1) +
            "% outline overlap · " +
            score(v.meanMm ?? 0) +
            " mm mean and " +
            score(v.p95Mm ?? 0) +
            " mm P95 depth" +
            (v.contours
              ? " · normals " +
                score(v.contours.normalMeanDeg) +
                "° · relief " +
                score(v.contours.reliefErrorP95Mm) +
                " mm"
              : "")
          : "No shared surface pixels";
      node("view-reading").textContent =
        "Original " +
        fmt(s.original) +
        ". Current " +
        fmt(s.fitted) +
        ". " +
        s.width +
        " × " +
        s.height +
        " pixels.";
    } catch (e) {
      note(failure(e));
    }
  };
  button("undo").onclick = () => {
    const prior = steps.pop();
    if (prior) {
      working = prior.adult;
      draw(true);
      refreshProportions();
      note("Last fit step undone.");
    }
  };
  button("reset").onclick = () => {
    tool = "";
    restart();
    note("Back to the aligned starting shape.");
  };
  button("close").onclick = () => dialog.close();
  dialog.onclose = () => {
    tool = "";
    pairs = [];
    token++;
    busy = false;
    sync();
  };
  button("apply").onclick = () =>
    void run(async () => {
      if (!opening || !steps.length) return;
      const { params, doc, base } = opening,
        human = { ...params.human };
      for (const [axis, value] of Object.entries(working.human)) {
        if (!isHumanAxis(axis)) continue;
        const [lo, hi, base] = humanRange(axis),
          old = original.human[axis] ?? base;
        if (value !== old)
          human[axis] = Math.min(hi, Math.max(lo, (human[axis] ?? base) + value - old));
      }
      const ops: Record<string, unknown>[] = [];
      if (!jsonEqual(params.human, human))
        ops.push({ op: "generation.steer", params: { ...params, human } });
      for (const [family, value] of [
        [humanCorrections, working.corrections],
        [humanFineHead, working.fineHead],
      ] as const)
        if (!jsonEqual(doc.features[family.id] ?? null, value ?? null))
          ops.push({ op: "feature.set", feature: family.id, value: value ?? null });
      const rig = referenceModels.find((r) => r.id === source?.id);
      if (rig) {
        const rigs = humanReferenceRigs.read(doc.features)?.rigs ?? [];
        if (!rigs.some((id) => id === rig.id))
          ops.push({
            op: "feature.set",
            feature: humanReferenceRigs.id,
            value: { rigs: [...rigs, rig.id] },
          });
      }
      if (!ops.length) {
        note("The character already has this fit.");
        return;
      }
      const summary = "Fit adult to " + (source?.name ?? "reference");
      if (await ctx.commit({ type: "edit", summary, ops }, summary, base)) dialog.close();
    });
  for (const k of ["landmarks", "feature", "prop", "mask"]) button(k).onclick = () => chooseTool(k);
  for (const k of ["feature-reach", "mask-size"]) input(k).oninput = sync;
  select("mask-kind").onchange = sync;
  button("mask-undo").onclick = () => {
    if (mask) {
      undoMask(mask);
      restart();
      note("Last hide undone.");
    }
  };
  button("mask-clear").onclick = () => {
    if (mask) {
      clearMask(mask);
      restart();
      note("All reference surfaces shown.");
    }
  };
  button("family-browse").onclick = () => input("family-file").click();
  input("family-file").onchange = () => {
    const f = input("family-file").files?.[0];
    input("family-file").value = "";
    if (f)
      void run(async (current) => {
        const loaded = await loadFile(f);
        if (!current()) return;
        neutral = loaded;
        registered = undefined;
        note("Neutral loaded. Transfer a member of the same family.");
      });
  };
  for (const k of ["family-measure", "family-detail"]) input(k).onchange = sync;
  button("family-run").onclick = () =>
    void run(async (current) => {
      if (!source || !neutral) return;
      const options = settings(),
        key = JSON.stringify([options.units, options.up, options.turn]);
      if (!registered || key !== registrationKey) {
        note("Fitting and registering the family's neutral…");
        await waitPaint();
        if (!current()) return;
        registered = registerNeutral(body(), neutral, { ...options, nudge: [0, 0, 0] });
        registrationKey = key;
      }
      note("Transferring the head…");
      await waitPaint();
      if (!current()) return;
      const r = transferHead(
        body(),
        registered,
        source,
        working,
        input("family-measure").checked,
        input("family-detail").checked,
      );
      step(
        r.adult,
        "Head from the family · " +
          r.registered +
          " matched points · " +
          r.measurementKeys.length +
          " head measurements · " +
          score(r.before.mean) +
          " → " +
          score(r.after.mean) +
          " mm mean · " +
          score(r.after.p95) +
          " mm at 95% · " +
          (r.adult.fineHead?.vertices.length ?? 0) +
          " fine vertices" +
          (r.adult.fineHead
            ? ", " + score(r.fineMean) + " mm mean, " + score(r.fineMax) + " mm longest"
            : "") +
          (r.limited
            ? " · " +
              r.limited +
              " reached the layer limit; fit the whole body first to carry larger differences"
            : "") +
          " · outside head moved " +
          score(r.outsideMm) +
          " mm · touching skin " +
          score(r.contactAfter) +
          " mm apart (" +
          score(r.contactBefore) +
          " before) · " +
          r.folds +
          " triangles turned over",
      );
    });
  button("family-clear").onclick = () => {
    const next = { ...working };
    delete next.fineHead;
    step(next, "Fine head layer removed");
  };
  select("prop-pick").replaceChildren(...proportions.map((p) => new Option(p.name, p.id)));
  input("eyes").onchange = () => {
    refreshProportions(true);
    drawMarkers();
  };
  select("prop-pick").onchange = () => {
    pending = undefined;
    refreshProportions();
    drawMarkers();
  };
  function refreshProportions(recommend = false) {
    if (tool !== "prop") return;
    const spec = required(proportions.find((p) => p.id === select("prop-pick").value));
    node("prop-hint").textContent = "Mark " + spec.ends[pending ? 1 : 0] + " on the reference.";
    const current = proportionReadings(body(), working);
    const targetIds = [...marked.keys()].filter(
      (key) => proportions.find((p) => p.id === key)?.kind !== "height",
    );
    if (recommend) {
      choices = proportionChoices(
        body(),
        working,
        targetIds,
        hiddenTree ? (p) => held(p, tree?.nearest(p)?.signed ?? 0) : undefined,
        head() && input("eyes").checked,
      );
      kept = new Set(choices.filter((c) => !(manual.get(c.key) ?? c.suggested)).map((c) => c.key));
    }
    show("prop-list", marked.size > 0);
    show("prop-choice", targetIds.length > 0);
    const rows = required(byId(id("prop-list"), HTMLTableElement).tBodies[0]);
    rows.replaceChildren();
    for (const [key, pair] of marked) {
      const row = rows.insertRow(),
        wanted = readProportion(key, ...pair),
        mine = current.get(key) ?? 0;
      for (const val of [
        required(proportions.find((p) => p.id === key)).name,
        score(wanted),
        score(mine),
        score(mine - wanted),
      ])
        row.insertCell().textContent = val;
      const drop = document.createElement("button");
      drop.textContent = "Remove";
      row.insertCell().append(drop);
      drop.onclick = () => {
        marked.delete(key);
        refreshProportions(true);
        drawMarkers();
      };
    }
    node("prop-controls").replaceChildren(
      ...choices.map((c) => {
        const label = document.createElement("label"),
          toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = c.free && !kept.has(c.key);
        toggle.disabled = !c.free;
        toggle.onchange = () => {
          manual.set(c.key, toggle.checked);
          if (toggle.checked) kept.delete(c.key);
          else kept.add(c.key);
          refreshProportions();
        };
        label.append(toggle, c.key + (c.reason ? " (" + c.reason + ")" : ""));
        return label;
      }),
    );
    button("prop-fit").disabled = !choices.some((c) => c.free && !kept.has(c.key));
    node("prop-kept").textContent = kept.size + " controls kept.";
  }
  button("prop-fit").onclick = () =>
    void run(() => {
      const targets = new Map(
        [...marked]
          .filter(([k]) => proportions.find((p) => p.id === k)?.kind !== "height")
          .map(([key, pair]) => [key, readProportion(key, ...pair)]),
      );
      const axes = choices.filter((c) => c.free && !kept.has(c.key)).map((c) => c.key);
      const fit = fitMarkedProportions(
        body(),
        working,
        targets,
        axes,
        hiddenTree ? (p) => held(p, tree?.nearest(p)?.distance ?? 0) : undefined,
        head() && input("eyes").checked,
      );
      if (!fit.changed) {
        note("The chosen controls cannot bring the marks closer.");
        return;
      }
      const readings = fit.proportions.map(
        (p) =>
          p.name +
          " " +
          score(p.beforeMm) +
          " → " +
          score(p.afterMm) +
          " mm (reference " +
          score(p.referenceMm) +
          ")",
      );
      const controls = fit.controls.map(
        (c) => c.key + " " + c.from + " → " + c.to + (c.atLimit ? " at limit" : ""),
      );
      const others = fit.others
        .filter((o) => Math.abs(o.afterMm - o.beforeMm) >= 0.3)
        .map((o) => o.name + " " + score(o.afterMm - o.beforeMm) + " mm");
      const label =
        readings.join(", ") +
        " · " +
        controls.join(", ") +
        " · skin moved " +
        score(fit.skinMovedMm) +
        " mm" +
        (others.length ? " · other changes: " + others.join(", ") : "");
      node("prop-reading").textContent = label;
      step(fit.form, label);
    });
  let down: Vector3 | undefined;
  canvas.addEventListener("pointerdown", (e) => {
    down = new Vector3(e.clientX, e.clientY, 0);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (
      !tool ||
      busy ||
      !placed ||
      !down ||
      down.distanceTo(new Vector3(e.clientX, e.clientY, 0)) > 5
    )
      return;
    try {
      const hit = view().pick(e);
      if (!hit) {
        note("Click directly on the surface.");
        return;
      }
      if (tool === "landmarks") {
        if (hit.side !== (pairs.length % 2 ? "human" : "reference")) {
          note("Alternate between the reference and your head.");
          return;
        }
        const p = hit.point.clone().sub(new Vector3(...(settings().nudge ?? [0, 0, 0])));
        if (hit.side === "reference" && landmarks)
          p.applyMatrix4(landmarks.transform.clone().invert());
        pairs.push(p);
        if (pairs.length === 6) {
          const marks = pairs;
          pairs = [];
          tool = "";
          landmarks = fitLandmarks(
            [
              required(marks[0]).toArray(),
              required(marks[2]).toArray(),
              required(marks[4]).toArray(),
            ],
            [
              required(marks[1]).toArray(),
              required(marks[3]).toArray(),
              required(marks[5]).toArray(),
            ],
          );
          input("original").checked = false;
          restart();
          note("Head aligned. RMS " + score(landmarks.rmsMm) + " mm.");
          return;
        }
      } else if (tool === "mask" && mask && hit.side === "reference") {
        const kind = select("mask-kind").value;
        if (kind === "patch")
          hidePatch(
            mask,
            placed.positions,
            placed.indices,
            hit.point.toArray(),
            input("mask-size").valueAsNumber / 1000,
          );
        else
          hideBeyond(
            mask,
            placed.positions,
            placed.indices,
            hit.point.toArray(),
            view()
              .cameraUp()
              .multiplyScalar(kind === "above" ? 1 : -1)
              .toArray(),
          );
        restart();
        note("Hidden triangles excluded from the fit and distances.");
        return;
      } else if (tool === "feature") {
        if (!feature && hit.side === "reference") {
          feature = hit.point;
          note("Click the same feature on your skin.");
        } else if (feature && hit.side === "human" && hit.latest && hit.quad !== undefined) {
          const target = feature;
          feature = undefined;
          const r = matchReferenceFeature(
            body(),
            working,
            hit.face,
            hit.point,
            target,
            input("feature-reach").valueAsNumber / 100,
            input("feature-mirror").checked,
          );
          const label =
            "Matched a feature · asked " +
            score(r.requestedMm) +
            " mm, moved " +
            score(r.achievedMm) +
            " mm at the clicked skin, " +
            score(r.leftMm) +
            " mm apart now" +
            (r.limited ? " · limited to " + score(r.limitMm) + " mm" : "");
          node("feature-reading").textContent = label;
          if (r.adult !== working) step(r.adult, label);
          else note(label);
          return;
        } else note("Pick the reference first, then your skin.");
      } else if (tool === "prop") {
        if (hit.side !== "reference") {
          note("Mark both ends on the reference.");
          return;
        }
        if (hit.corners && hit.shares)
          surfaceMarks.set(hit.point, { corners: hit.corners, shares: hit.shares });
        if (!pending) pending = hit.point;
        else {
          if (Math.hypot(hit.point.x - pending.x, hit.point.y - pending.y) < 0.001) {
            pending = undefined;
            note("Mark two distinct ends.");
          } else {
            marked.set(select("prop-pick").value, [pending, hit.point]);
            pending = undefined;
            refreshProportions(true);
          }
        }
        refreshProportions();
      }
      sync();
      drawMarkers();
    } catch (error) {
      note(failure(error));
      sync();
    }
  });
  return {
    closeStale(docId: string | undefined, revision: number | undefined) {
      if (
        dialog.open &&
        (opening?.base.documentId !== docId || opening?.base.revision !== revision)
      )
        dialog.close();
    },
    async open(next: Opening) {
      const request = ++token;
      opening = next;
      const { params, doc } = next;
      const corrections = humanCorrections.read(doc.features),
        fineHead = humanFineHead.read(doc.features);
      original = {
        human: humanMeasurements(params),
        ...(corrections ? { corrections } : {}),
        ...(fineHead ? { fineHead } : {}),
      };
      tool = "";
      pairs = [];
      landmarks = undefined;
      input("original").checked = false;
      const installed = await ctx.api.referenceModels();
      if (request !== token) return;
      select("source").replaceChildren(
        new Option(installed.length ? "Choose a reference…" : "No file chosen", ""),
        ...referenceModels
          .filter((r) => installed.includes(r.id))
          .map((r) => new Option(r.label, r.id)),
      );
      if (source && !source.id) {
        const local = new Option("Your file · " + source.name, "local");
        local.dataset["local"] = "true";
        select("source").add(local);
      }
      select("source").value = source?.id ?? (source ? "local" : "");
      dialog.showModal();
      restart();
      view().frame(regionOf(select("frame").value), 0.35);
      note("Choose a reference or compare and fit a region.");
      const linked = [...(humanReferenceRigs.read(doc.features)?.rigs ?? [])]
        .reverse()
        .find((k) => installed.includes(k));
      if (linked && source?.id !== linked) {
        select("kind").value = "body";
        select("frame").value = select("region").value = "whole";
        for (const k of ["units", "up", "turn"]) select(k).value = "auto";
        for (const k of ["x", "y", "z"]) input("nudge-" + k).value = "0";
        example(linked);
      }
    },
  };
}
