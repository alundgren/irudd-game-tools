import { bundledAsset, bundledAssets, bundledEntry } from "@irudd/character";
import { panelFromPixels, panelCanvas, traceFitOperations } from "@irudd/character/art-fit";
import {
  attachManualRegion,
  checkImportedTurnaround,
  decodeManualTraceMap,
  turnaroundImportSize,
  turnaroundQuality,
  manualRegion,
  traceRoot,
  type SheetPanels,
} from "@irudd/character/trace-build";
import { repaintOperations } from "@irudd/character/repaint";
import {
  digestBrand,
  figureHull,
  figurePaint,
  type AssetEntry,
  type Digest,
  type Part,
  type CharacterDocument,
} from "@irudd/document";
import { stagePicture } from "../art-files.js";
import { button, el } from "../dom.js";
import type { PanelContext } from "./context.js";
import { field } from "./garment-fields.js";
import { agentTraceMap } from "./trace-agent.js";
import { traceGuides } from "./trace-guides.js";
import { fittedPaintOperations } from "@irudd/character/fitted-edit";

function numeric(value: string, min: string, max: string, step: string) {
  const input = el("input");
  Object.assign(input, { type: "number", value, min, max, step });
  return input;
}

async function importTurnaround(file: File): Promise<Uint8Array> {
  turnaroundImportSize(file.size, 1, 1);
  const image = await createImageBitmap(file);
  try {
    const { width, height } = turnaroundImportSize(file.size, image.width, image.height);
    const canvas = el("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("The sheet needs a 2D canvas.");
    c.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", turnaroundQuality),
    );
    checkImportedTurnaround(blob?.size ?? 0);
    if (!blob) throw new Error("Could not encode the turnaround.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    image.close();
  }
}

function quadrants(image: ImageBitmap) {
  function panel(index: number) {
    const canvas = el("canvas");
    canvas.width = canvas.height = panelCanvas;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("The sheet needs a 2D canvas.");
    c.drawImage(
      image,
      ((index % 2) * image.width) / 2,
      (Math.floor(index / 2) * image.height) / 2,
      image.width / 2,
      image.height / 2,
      0,
      0,
      panelCanvas,
      panelCanvas,
    );
    return {
      canvas,
      panel: panelFromPixels(c.getImageData(0, 0, panelCanvas, panelCanvas).data, panelCanvas),
    };
  }
  return [panel(0), panel(1), panel(2), panel(3)] as const;
}

export function sheetTools({
  ctx,
  doc,
  part,
  open,
  edit,
  controls,
  read,
  create,
}: {
  ctx: PanelContext;
  doc: CharacterDocument;
  part: Part | undefined;
  controls: HTMLElement;
  open: (
    title: string,
    hint: string,
    fields: readonly HTMLElement[],
    action: () => Promise<boolean>,
  ) => void;
  edit: (summary: string, ops: readonly unknown[]) => Promise<boolean>;
  read: (digest: Digest) => Promise<ImageBitmap>;
  create: (doc: CharacterDocument, label: string) => Promise<boolean>;
}) {
  function trace(adding = false) {
    const name = el("input");
    name.maxLength = 48;
    name.value = adding ? "Traced region" : "Traced figure";
    const sheet = el("select"),
      file = el("input"),
      method = el("select");
    const destination = el("select");
    destination.add(new Option("New character", "new"));
    destination.add(new Option("Add to current character", "add"));
    destination.value = adding ? "add" : "new";
    const height = numeric("1.75", "0.15", "6", "0.01"),
      radius = numeric("4", "0.3", "35", "0.1"),
      influence = numeric("15", "3.5", "35", "0.5");
    const source = part && figurePaint.read(part.features);
    if (adding && part)
      height.value = String(source?.height ?? figureHull.read(part.features)?.height ?? 1.75);
    const assetChoices = new Map<Digest, AssetEntry>();
    for (const a of bundledAssets.filter((a) => a.use === "turnaround")) {
      sheet.add(new Option(a.name, a.digest));
      assetChoices.set(a.digest, bundledEntry(a));
    }
    for (const a of doc.assets)
      if (a.role === "paint-atlas" && !assetChoices.has(a.digest)) {
        sheet.add(
          new Option(
            doc.parts.find((p) => p.paint?.atlas === a.digest)?.label ?? a.digest,
            a.digest,
          ),
        );
        assetChoices.set(a.digest, a);
      }
    if (part?.paint && assetChoices.has(part.paint.atlas)) sheet.value = part.paint.atlas;
    file.type = "file";
    file.accept = "image/png,image/webp,image/jpeg";
    for (const [label, value] of [
      ["Rounded loft", "loft"],
      ["Solid hull", "hull"],
      ["Thin membrane", "membrane"],
      ["Curved centreline", "path"],
      ["Fit whole biped", "biped"],
      ["Import part map", "map"],
    ] as const)
      method.add(new Option(label, value));
    const agent = el("select"),
      steering = el("textarea");
    steering.maxLength = 4000;
    const agentField = field("Workshop agent", agent),
      steeringField = field("Agent steering (optional)", steering);
    void ctx.host
      .call("recipient.list", {})
      .then((recipients) => {
        for (const r of recipients)
          if (r.availability.state === "ready" || r.availability.state === "inbox-only")
            agent.add(new Option(r.name ?? r.agent, r.agent));
        if (agent.options.length) method.add(new Option("Fit with agent", "agent"));
      })
      .catch((e) => {
        status.textContent = String(e);
      });
    const correspondence = el("select");
    correspondence.add(new Option("Same direction", "same"));
    correspondence.add(new Option("Opposite direction", "opposite"));
    const mapFile = el("input");
    mapFile.type = "file";
    mapFile.accept = ".json";
    const edges = field("Matching edges", correspondence),
      size = field("Root radius as % of height", radius),
      depthRadius = field("Depth influence as % of height", influence),
      mapField = field("Part map", mapFile);
    const status = el("p"),
      guidance = el("p");
    let panels: SheetPanels | undefined,
      loaded: Uint8Array | undefined,
      revision = 0,
      loads = 0;
    const imported = new Map<string, Uint8Array>();
    const guides = traceGuides(
      () => panels,
      () => method.value,
    );
    function sync() {
      const kind = method.value;
      agentField.hidden = steeringField.hidden = kind !== "agent";
      edges.hidden = kind !== "membrane";
      size.hidden = kind !== "path";
      depthRadius.hidden = kind !== "depth";
      mapField.hidden = kind !== "map";
      destination.disabled = ["face", "depth", "biped", "map", "agent"].includes(kind);
      guidance.textContent =
        kind === "path"
          ? "Click matching centres from root to tip in each view. The radius tapers toward the tip."
          : kind === "face"
            ? "Mark both pupils, nose, lips and chin in the front view."
            : kind === "depth"
              ? "Mark one feature in front, then the same feature in profile."
              : "Click around the same region in front and profile. An empty outline uses the full silhouette.";
      guides.draw();
    }
    let previousMethod = method.value;
    method.onchange = () => {
      revision++;
      if (["face", "depth"].includes(previousMethod) || ["face", "depth"].includes(method.value))
        guides.clear();
      previousMethod = method.value;
      sync();
    };
    async function load() {
      const selected = imported.get(sheet.value);
      const ticket = ++loads;
      revision++;
      loaded = undefined;
      panels = undefined;
      guides.clear();
      guides.front.canvas.hidden = guides.side.canvas.hidden = true;
      for (const opt of method.querySelectorAll('option[value="face"],option[value="depth"]'))
        opt.remove();
      if (!selected && part?.paint?.atlas === sheet.value && source && source.frame !== "path") {
        method.add(new Option("Mark facial landmarks", "face"));
        method.add(new Option("Match front and profile", "depth"));
      }
      sync();
      const asset = [...assetChoices.values()].find((a) => a.digest === sheet.value);
      try {
        if (!asset && !selected) return;
        const image = selected
          ? await createImageBitmap(new Blob([new Uint8Array(selected)], { type: "image/webp" }))
          : asset && (await read(asset.digest));
        if (!image) return;
        try {
          if (ticket !== loads) return;
          const [a, b, c, d] = quadrants(image);
          panels = [a.panel, b.panel, c.panel, d.panel];
          loaded = selected;
          guides.front.set(a.canvas, panelCanvas, panelCanvas);
          guides.side.set(b.canvas, panelCanvas, panelCanvas);
          status.textContent = "";
        } finally {
          image.close();
        }
      } catch (e) {
        if (ticket === loads) status.textContent = String(e);
      }
    }
    file.onchange = async () => {
      const chosen = file.files?.[0];
      file.value = "";
      if (!chosen) return;
      const ticket = ++loads;
      try {
        const bytes = await importTurnaround(chosen);
        if (ticket !== loads) return;
        const key = "imported:" + String(imported.size + 1);
        imported.set(key, bytes);
        sheet.add(new Option("Imported art " + String(imported.size), key));
        sheet.value = key;
        await load();
        if (panels) status.textContent = "Turnaround ready.";
      } catch (e) {
        if (ticket === loads) status.textContent = e instanceof Error ? e.message : String(e);
      }
    };
    sheet.onchange = () => {
      void load();
    };
    const addMark = (view: 0 | 1, event: MouseEvent) => {
      const kind = method.value,
        a = guides.front.marks.length,
        b = guides.side.marks.length;
      if (
        (kind === "face" && (view !== 0 || a >= 5)) ||
        (kind === "depth" && (view === 0 ? a > 0 : a !== 1 || b > 0))
      )
        event.stopImmediatePropagation();
    };
    guides.front.canvas.addEventListener("click", (e) => addMark(0, e), true);
    guides.side.canvas.addEventListener("click", (e) => addMark(1, e), true);
    open(
      adding ? "Trace another region" : "Trace a new character",
      "Use a four-view turnaround on transparency or magenta, front and profile across the top.",
      [
        field("Registered turnaround", sheet),
        field("Import artwork", file),
        field("Region name", name),
        field("Destination", destination),
        field("Subject height (m)", height),
        field("Region shape", method),
        edges,
        size,
        depthRadius,
        mapField,
        agentField,
        steeringField,
        guidance,
        status,
        guides.node,
        guides.controls,
      ],
      async () => {
        if (!panels) throw new Error("Choose a loaded turnaround sheet.");
        const h = height.valueAsNumber;
        if (!Number.isFinite(h) || h < 0.15 || h > 6)
          throw new Error("Enter a standing height between 0.15 and 6 metres.");
        const label = name.value.trim() || "Painted region",
          kind = method.value;
        const outlines = [guides.front.marks, guides.side.marks] as const;
        if (part && (kind === "face" || kind === "depth")) {
          const a = outlines[0][0],
            b = outlines[1][0];
          if (kind === "depth" && (!a || !b)) throw new Error("Mark the feature in both views.");
          const region =
            kind === "depth" && a && b
              ? {
                  id: part.id,
                  method: "loft",
                  depthPairs: [[...a, ...b, influence.valueAsNumber / 100] as const],
                }
              : { id: part.id, method: "loft", faceLandmarks: outlines[0] };
          const result = traceFitOperations(doc, part.id, [region], panels[0], panels[1]);
          return edit(kind === "face" ? "Fit marked face" : "Fit depth point", result.operations);
        }
        let asset = [...assetChoices.values()].find((a) => a.digest === sheet.value);
        if (loaded) {
          const stored = await stagePicture(ctx.host, loaded);
          asset = {
            digest: digestBrand(stored.digest),
            byteLength: stored.byteLength,
            mediaType: stored.mediaType,
            role: "paint-atlas",
          };
        }
        if (!asset) throw new Error("Choose a turnaround.");
        if (!loaded && bundledAsset(asset.digest))
          await stagePicture(ctx.host, await ctx.api.bundledImage(asset.digest));
        if (kind === "map" || kind === "biped" || kind === "agent") {
          const selected = mapFile.files?.[0];
          if (kind === "map" && (!selected || selected.size > 500000))
            throw new Error("Choose a part map under 500 KB.");
          const ticket = revision;
          const dialog = method.closest("dialog");
          const current = () =>
            !!dialog?.open && method.isConnected && ticket === revision && kind === method.value;
          if (kind === "agent")
            status.textContent = "Waiting for the agent to trace the front and profile.";
          const map =
            kind === "map" && selected
              ? decodeManualTraceMap(JSON.parse(await selected.text()))
              : kind === "agent"
                ? await agentTraceMap(
                    ctx,
                    agent.value,
                    steering.value,
                    h,
                    [guides.front.source, guides.side.source],
                    asset.digest,
                    current,
                  )
                : undefined;
          if (kind === "agent" && (!current() || !map)) return false;
          const fit = fittedPaintOperations(
            doc,
            "whole",
            undefined,
            asset,
            panels,
            kind === "agent" ? h : (map?.height ?? h),
            map?.regions ?? [],
            "open",
            [],
            undefined,
            kind === "agent" ? undefined : kind,
          );
          const created = await create(fit.source, label);
          if (created && kind === "agent")
            ctx.say(
              "Built " + fit.source.parts.length + " agent-fitted parts. " + fit.notes.join(" "),
            );
          return created;
        }
        const region = manualRegion(
          label,
          kind,
          ...outlines,
          radius.valueAsNumber / 100,
          correspondence.value === "same" ? "same" : "opposite",
        );
        const traced = traceRoot(doc.id, label, asset, panels, outlines, h, region);
        if (destination.value === "add") {
          const root = traced.parts[0];
          if (!root) throw new Error("The trace has no region.");
          return edit("Trace " + label, attachManualRegion(doc, part, root, asset));
        }
        return create(traced, label);
      },
    );
    void load();
  }
  controls.append(
    button("Trace a new character", () => trace()),
    button("Trace another region", () => trace(true)),
  );

  const initialTarget = part?.paint ? part : doc.parts.find((p) => p.paint);
  if (!initialTarget?.paint) return;
  const sheets = new Map<string, AssetEntry>();
  for (const p of doc.parts) {
    if (!p.paint || sheets.has(p.paint.atlas)) continue;
    const atlas = p.paint.atlas,
      asset = doc.assets.find((a) => a.digest === atlas) ?? bundledAsset(atlas);
    if (asset)
      sheets.set(atlas, {
        digest: atlas,
        role: "paint-atlas",
        mediaType: asset.mediaType,
        byteLength: asset.byteLength,
      });
  }
  for (const a of doc.assets) if (a.role === "paint-atlas") sheets.set(a.digest, a);
  controls.append(
    button("Reuse turnaround", () => {
      const select = el("select"),
        file = el("input");
      file.type = "file";
      file.accept = "image/png,image/jpeg,image/webp";
      select.add(new Option("Choose a sheet file", ""));
      const destinations = el("select");
      destinations.multiple = true;
      destinations.size = 6;
      function targets() {
        const chosen = new Set([...destinations.selectedOptions].map((o) => o.value));
        destinations.replaceChildren();
        const groups = new Map<Digest, HTMLOptGroupElement>();
        for (const p of doc.parts) {
          if (!p.paint || p.paint.atlas === select.value) continue;
          let group = groups.get(p.paint.atlas);
          if (!group) {
            group = el("optgroup");
            group.label = "Same sheet as " + p.label;
            groups.set(p.paint.atlas, group);
            destinations.append(group);
          }
          const option = new Option(p.label, p.id);
          option.selected =
            chosen.has(p.id) ||
            (p.id === initialTarget?.id &&
              ![...chosen].some((id) =>
                doc.parts.some((other) => other.id === id && other.paint?.atlas !== select.value),
              ));
          group.append(option);
        }
      }
      for (const [id] of [...sheets].sort(
        ([a], [b]) =>
          Number(a === initialTarget.paint?.atlas) - Number(b === initialTarget.paint?.atlas),
      ))
        select.add(new Option(doc.parts.find((p) => p.paint?.atlas === id)?.label ?? id, id));
      select.onchange = targets;
      targets();
      const apply = document.querySelector<HTMLButtonElement>("#portrait-apply");
      const update = () => {
        if (apply) apply.disabled = !destinations.selectedOptions.length;
      };
      destinations.onchange = update;
      select.addEventListener("change", update);
      open(
        "Reuse turnaround",
        "Apply an existing sheet or a new four-view sheet to " +
          "selected regions" +
          ". Its geometry and paint registration stay in place.",
        [
          field("Existing sheet", select),
          field("Sheet file", file),
          field("Regions to repaint", destinations),
        ],
        async () => {
          let asset = sheets.get(select.value);
          if (!asset) {
            const selected = file.files?.[0];
            if (!selected) throw new Error("Choose a sheet.");
            const im = await createImageBitmap(selected);
            try {
              quadrants(im);
            } finally {
              im.close();
            }
            const stored = await stagePicture(
              ctx.host,
              new Uint8Array(await selected.arrayBuffer()),
            );
            asset = {
              digest: digestBrand(stored.digest),
              byteLength: stored.byteLength,
              mediaType: stored.mediaType,
              role: "paint-atlas",
            };
          }
          const ids = doc.parts
            .filter((p) => [...destinations.selectedOptions].some((o) => o.value === p.id))
            .map((p) => p.id);
          return edit(
            "Reuse turnaround on " + ids.length + " regions",
            repaintOperations(doc, ids, asset),
          );
        },
      );
      update();
    }),
  );
}
