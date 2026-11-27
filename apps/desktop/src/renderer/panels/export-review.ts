import { compareExportViews, type GameInspection } from "@irudd/character/proposal-export";
import type { CharacterDocument } from "@irudd/document";
import { byId, button, el } from "../dom.js";
import { stagePicture, fromBase64, type BriefDraft } from "../art-files.js";
import { failure, type PanelContext } from "./context.js";

export function proposalReviews(
  ctx: PanelContext,
  inspect: (
    doc: CharacterDocument,
    revision: number,
    previous?: GameInspection,
  ) => Promise<GameInspection>,
) {
  const reports = new Map<string, GameInspection>();
  const key = (id: string, version: number) =>
    JSON.stringify([ctx.project?.directory, ctx.documentId, id, version]);
  let ticket = 0;
  const get = (id: string, version: number) => reports.get(key(id, version));
  async function open(id: string, version: number, doc: CharacterDocument, revision: number) {
    const token = ++ticket;
    const cacheKey = key(id, version);
    const earlier = get(id, version - 1);
    const dialog = byId("game-report", HTMLDialogElement),
      results = byId("game-results", HTMLDivElement);
    results.replaceChildren(el("p", { text: "Exporting and reloading the proposed game mesh…" }));
    dialog.showModal();
    try {
      const current = reports.get(cacheKey) ?? (await inspect(doc, revision, earlier));
      if (token !== ticket || cacheKey !== key(id, version)) return;
      reports.set(cacheKey, current);
      while (reports.size > 9) reports.delete(reports.keys().next().value ?? "");
      function draw(shown: GameInspection, prior: boolean) {
        const detail = shown.detail;
        const exposure = [...(detail.detailCoverage ?? [])].sort(
          (a, b) => b.exposedSkinPixels - a.exposedSkinPixels,
        )[0];
        const coverage = el("details");
        coverage.append(el("summary", { text: "Garment coverage by view" }));
        for (const f of detail.detailCoverage ?? []) {
          const swaps = (f.layers ?? []).map(
            (change) =>
              change.fullPiece + " to " + change.gamePiece + " (" + change.pixels + " px)",
          );
          const describePatches = (patches: typeof f.fullSkinPatches) =>
            (patches ?? [])
              .map((p) => p.pixels + " px inside " + p.borderingPieces.join(", "))
              .join(", ") || "none";
          coverage.append(
            el("p", {
              text:
                f.frame +
                " · " +
                f.view +
                " · " +
                f.exposedSkinPixels +
                " newly exposed pixels. Layer changes: " +
                (swaps.join(", ") || "none") +
                ". Enclosed skin in full detail: " +
                describePatches(f.fullSkinPatches) +
                ". Enclosed skin in game: " +
                describePatches(f.gameSkinPatches) +
                ".",
            }),
          );
        }
        for (const c of detail.coverage?.changes ?? [])
          coverage.append(
            el("p", {
              text:
                c.view + " · " + c.garment + " to bare " + c.body + " · " + c.pixels + " pixels.",
            }),
          );

        const change = detail.coverage?.changes[0];
        results.replaceChildren(
          el("p", {
            text:
              (prior ? "Earlier proposal" : "This proposal") +
              " · " +
              detail.triangles.toLocaleString() +
              " triangles · " +
              detail.restHeightMetres.toFixed(2) +
              " m",
          }),
          ...shown.views.map((view) => {
            const img = el("img");
            img.src = "data:image/jpeg;base64," + view.jpeg;
            img.alt = view.name;
            return img;
          }),
          ...(exposure
            ? [
                el("p", {
                  text:
                    exposure.frame +
                    " · " +
                    exposure.view +
                    ": " +
                    exposure.exposedSkinPixels +
                    " exposed skin pixels inside " +
                    exposure.interiorClothingPixels +
                    " full-detail clothing pixels.",
                }),
              ]
            : []),
          ...(change
            ? [
                el("p", {
                  text:
                    change.view +
                    ": " +
                    change.pixels +
                    " of 256 × 256 pixels switched from " +
                    change.garment +
                    " to bare " +
                    change.body +
                    ".",
                }),
              ]
            : []),
          ...(detail.detailCoverage?.length || detail.coverage ? [coverage] : []),
          ...(earlier
            ? [
                el("p", {
                  text: current.detail.matchedPreviousFrame
                    ? "Matched earlier camera."
                    : "Reframed to fit the proposal.",
                }),
                button(prior ? "Show this export" : "Show earlier export", () =>
                  draw(prior ? current : earlier, !prior),
                ),
              ]
            : []),
        );
      }
      draw(current, false);
    } catch (error) {
      if (token === ticket) results.replaceChildren(el("p", { text: failure(error) }));
    }
  }
  async function attachments(id: string, version: number) {
    const current = get(id, version),
      earlier = get(id, version - 1);
    const images =
      current && earlier
        ? await compareExportViews(earlier.views, current.views)
        : (current?.views ?? []);
    const attachments: BriefDraft["attachments"] = await Promise.all(
      images.map(async (image) => ({
        role: "reference" as const,
        label: image.name.slice(0, 120),
        digest: (await stagePicture(ctx.host, fromBase64(image.jpeg))).digest,
      })),
    );
    return {
      attachments,
      detail: current && {
        ...current.detail,
        ...(earlier ? { previous: earlier.detail } : {}),
        attachments: images.map((v) => v.name),
      },
    };
  }
  return {
    open,
    get,
    attachments,
    reset() {
      ticket++;
      reports.clear();
    },
  };
}
