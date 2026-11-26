import { bundledAsset, type Mark } from "@irudd/character";
import { panelFromPixels, panelCanvas } from "@irudd/character/art-fit";
import {
  buildAnchorRefusal,
  traceBuildOperations,
  traceRoot,
  type SheetPanels,
} from "@irudd/character/trace-build";
import { repaintOperations } from "@irudd/character/repaint";
import {
  digestBrand,
  type AssetEntry,
  type Digest,
  type Part,
  type CharacterDocument,
} from "@irudd/document";
import { stagePicture } from "../art-files.js";
import { button, el } from "../dom.js";
import type { PanelContext } from "./context.js";
import { field } from "./garment-fields.js";
import { pictureMarks } from "./picture-marks.js";

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
  const anchor = part && !buildAnchorRefusal(part) ? part : undefined;
  function trace(from?: Part) {
    const name = el("input");
    name.maxLength = 100;
    name.value = from ? "Traced region" : "Traced figure";
    const front = pictureMarks("Front outline", false),
      side = pictureMarks("Profile outline", false);
    const file = el("input");
    file.type = "file";
    file.accept = "image/png,image/webp,image/jpeg";
    const status = el("p");
    let panels: SheetPanels | undefined, loaded: File | undefined;
    function show(im: ImageBitmap) {
      try {
        const [a, b, c, d] = quadrants(im);
        panels = [a.panel, b.panel, c.panel, d.panel];
        front.set(a.canvas, panelCanvas, panelCanvas);
        side.set(b.canvas, panelCanvas, panelCanvas);
      } finally {
        im.close();
      }
    }
    file.onchange = async () => {
      const selected = file.files?.[0];
      panels = undefined;
      loaded = undefined;
      if (!selected) return;
      try {
        const im = await createImageBitmap(selected);
        if (file.files?.[0] !== selected) {
          im.close();
          return;
        }
        show(im);
        loaded = selected;
        status.textContent = "";
      } catch (e) {
        status.textContent = String(e);
      }
    };
    if (from?.paint)
      void read(from.paint.atlas)
        .then(show)
        .catch((e: unknown) => {
          status.textContent = String(e);
        });
    const method = el("select"),
      correspondence = el("select");
    method.add(new Option("Rounded loft", "loft"));
    method.add(new Option("Solid hull", "hull"));
    method.add(new Option("Thin membrane", "membrane"));
    correspondence.add(new Option("Same direction", "same"));
    correspondence.add(new Option("Opposite direction", "opposite"));
    const edges = field("Matching edges", correspondence);
    edges.hidden = true;
    method.onchange = () => {
      edges.hidden = method.value !== "membrane";
    };
    open(
      from ? "Trace another region" : "Trace a new character",
      "Mark at least three points around each outline. Use a four-view turnaround on transparency or magenta, front and profile across the top.",
      [
        ...(from ? [] : [field("Turnaround sheet", file)]),
        field("Region name", name),
        ...(from ? [field("Region shape", method), edges] : []),
        status,
        front.node,
        side.node,
      ],
      async () => {
        if (!panels || !name.value.trim() || front.marks.length < 3 || side.marks.length < 3)
          throw new Error("Name the region and outline it in both views.");
        const outlines: readonly [readonly Mark[], readonly Mark[]] = [front.marks, side.marks];
        const label = name.value.trim();
        if (from) {
          const built = traceBuildOperations(
            doc,
            from.id,
            [
              { id: from.id, method: "loft" },
              {
                id: label,
                parent: from.id,
                method: method.value,
                correspondence: correspondence.value === "opposite" ? "opposite" : "same",
                front: outlines[0],
                side: outlines[1],
              },
            ],
            panels,
          );
          if (!built.operations.length)
            throw new Error(built.missed[0]?.reason ?? "Choose a new region name.");
          return edit("Trace " + label, built.operations);
        }
        if (!loaded) throw new Error("Choose a turnaround sheet.");
        const stored = await stagePicture(ctx.host, new Uint8Array(await loaded.arrayBuffer()));
        const asset = {
          digest: digestBrand(stored.digest),
          byteLength: stored.byteLength,
          mediaType: stored.mediaType,
          role: "paint-atlas",
        } as const;
        return create(traceRoot(doc.id, label, asset, panels, outlines), label);
      },
    );
  }
  controls.append(button("Trace a new character", () => trace()));
  if (anchor) controls.append(button("Trace another region", () => trace(anchor)));
  if (!part?.paint) return;
  const sheets = new Map<string, AssetEntry>();
  for (const p of doc.parts) {
    if (!p.paint || p.paint.atlas === part.paint.atlas) continue;
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
  for (const a of doc.assets)
    if (a.role === "paint-atlas" && a.digest !== part.paint.atlas) sheets.set(a.digest, a);
  controls.append(
    button("Reuse turnaround", () => {
      const select = el("select"),
        file = el("input");
      file.type = "file";
      file.accept = "image/png,image/jpeg,image/webp";
      select.add(new Option("Choose a sheet file", ""));
      for (const [id] of sheets)
        select.add(new Option(doc.parts.find((p) => p.paint?.atlas === id)?.label ?? id, id));
      open(
        "Reuse turnaround",
        "Apply an existing sheet or a new four-view sheet to " +
          part.label +
          ". Its geometry and paint registration stay in place.",
        [field("Existing sheet", select), field("Sheet file", file)],
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
          return edit(
            "Reuse turnaround on " + part.label,
            repaintOperations(doc, [part.id], asset),
          );
        },
      );
    }),
  );
}
