import { outfitLooks } from "@irudd/document";
import { Player, mountControls, type InspectionSheet } from "@irudd/player";
import type { ReviewPreset } from "@irudd/workshop/wire";
import type { LibraryEntry } from "../../shared/api.js";
import { failure } from "./context.js";
import { byId, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountLibrary(
  ctx: PanelContext,
  redrawViewport: () => void,
  inspectVisible: () => Promise<void> | undefined,
) {
  const { api, host, say, showBanner } = ctx;
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
    if (which === "workshop") redrawViewport();
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
    saveSheet.disabled = !info || !ctx.project;
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

  function syncOutfits(): void {
    const { doc } = ctx;
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

  byId("export", HTMLButtonElement).onclick = async () => {
    const { doc, view, documentId } = ctx;
    if (!doc || !view || !documentId) return;
    const preset = exportPresets.find((p) => p === exportPreset.value) ?? "clay";
    const wardrobe = exportOutfits.checked && !exportOutfits.disabled;
    const staticMesh = !byId("export-motion", HTMLInputElement).checked;
    say(
      `Exporting revision ${view.revision} at ${preset}${wardrobe ? " with every saved outfit" : ""}…`,
    );
    try {
      const exported = await host.call("review.export", {
        documentId,
        revision: view.revision,
        preset,
        ...(wardrobe ? { wardrobe: true } : {}),
        ...(staticMesh ? { staticMesh: true } : {}),
      });
      const bytes = await artifactBytes(exported.glb.sha256);
      const entry = await api.saveExport({
        documentId,
        label: doc.label,
        revision: exported.source.revision,
        preset,
        ...(exported.wardrobe ? { wardrobe: true } : {}),
        ...(staticMesh ? { staticMesh: true } : {}),
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
  const report = byId("game-report", HTMLDialogElement),
    results = byId("game-results", HTMLDivElement);
  byId("inspection-close", HTMLButtonElement).onclick = () => report.close();
  const inspect = byId("inspect-game", HTMLButtonElement);
  inspect.onclick = async () => {
    const proposal = inspectVisible();
    if (proposal) return proposal;
    const { view, documentId, project } = ctx;
    if (!view || !documentId) return;
    results.replaceChildren(el("p", { text: "Inspecting revision " + view.revision + "..." }));
    report.showModal();
    inspect.disabled = true;
    try {
      const result = await host.call("review.inspect", {
        documentId,
        revision: view.revision,
        preset: "game",
        ...(!byId("export-motion", HTMLInputElement).checked ? { staticMesh: true } : {}),
        sheets: ["body", "portrait"],
        width: 256,
        height: 256,
      });
      const m = result.metrics,
        views = await Promise.all(
          result.images.map(async (im) => {
            const bytes = await artifactBytes(im.sha256),
              img = el("img");
            img.alt = im.name;
            img.width = im.width;
            img.height = im.height;
            const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "image/png" }));
            img.onload = img.onerror = () => URL.revokeObjectURL(url);
            img.src = url;
            return img;
          }),
        );
      if (ctx.project !== project || ctx.documentId !== documentId) {
        report.close();
        return;
      }
      results.replaceChildren(
        el("p", {
          text:
            "Revision " +
            view.revision +
            ", " +
            m.geometry.triangles +
            " triangles, " +
            m.textures.images +
            " textures, " +
            m.rig.joints +
            " joints, " +
            m.rig.clips +
            " clips",
        }),
        ...views,
        ...result.notes.map((text) => el("p", { text })),
      );
    } catch (e) {
      results.textContent = failure(e);
    } finally {
      inspect.disabled = false;
    }
  };
  return { refresh: refreshLibrary, render: syncOutfits };
}
