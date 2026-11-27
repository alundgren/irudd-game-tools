import {
  appendLandmarks,
  bundledAsset,
  landmarkPass,
  nativePortraitLayer,
  profileFromMarks,
  referenceGlb,
} from "@irudd/character";
import { depthFromPixels, depthOperations, depthRefusal } from "@irudd/character/art-fit";
import {
  fitReference,
  humanAdultId,
  HumanAdultParams,
  humanWornCast,
  referenceVertices,
} from "@irudd/character/human";
import {
  decodeWith,
  figureAnatomy,
  figureFrontFit,
  figureNativePortrait,
  figurePiece,
  figureProfileFit,
  figurePortraitDepth,
  type CharacterDocument,
  type Json,
} from "@irudd/document";
import { readImageChunks, stagePicture } from "../art-files.js";
import { byId, button, el } from "../dom.js";
import type { EditorViewport } from "../viewport.js";
import { failure, type PanelContext } from "./context.js";
import { field, choices } from "./garment-fields.js";
import { pictureMarks } from "./picture-marks.js";
import { mountReferenceRoom } from "./reference-room.js";
import { sheetTools } from "./sheet-tools.js";

export function mountPortrait(
  ctx: PanelContext,
  viewport: EditorViewport,
  create: (doc: CharacterDocument, label: string) => Promise<boolean>,
) {
  const panel = byId("portrait-editor", HTMLDetailsElement),
    controls = byId("portrait-actions", HTMLDivElement);
  const dialog = byId("portrait-dialog", HTMLDialogElement),
    content = byId("portrait-fields", HTMLDivElement);
  const note = byId("portrait-status", HTMLParagraphElement);
  const apply = byId("portrait-apply", HTMLButtonElement);
  byId("portrait-close", HTMLButtonElement).onclick = () => dialog.close();
  let identity: string | undefined;
  let fitting: ReturnType<typeof mountReferenceRoom> | undefined;
  function render() {
    const doc = ctx.doc,
      view = ctx.view;
    const current = view?.documentId + "@" + view?.revision;
    if (identity !== current && dialog.open) dialog.close();
    identity = current;
    fitting?.closeStale(view?.documentId, view?.revision);
    controls.replaceChildren();
    panel.hidden = !doc || !view;
    if (!doc || !view) return;
    const base = { documentId: view.documentId, revision: view.revision };
    const part = ctx.selection ? ctx.part(ctx.selection) : undefined;
    const adult =
      doc.generation?.generator === humanAdultId &&
      decodeWith(HumanAdultParams, doc.generation.params);
    const body = ctx.humanBody;
    const edit = (summary: string, ops: readonly unknown[]) =>
      ctx.commit({ type: "edit", summary, ops }, summary, base);
    function open(
      title: string,
      hint: string,
      fields: readonly HTMLElement[],
      action: () => Promise<boolean>,
    ) {
      byId("portrait-title", HTMLHeadingElement).textContent = title;
      content.replaceChildren(el("p", { text: hint }), ...fields);
      note.textContent = "";
      apply.disabled = false;
      apply.onclick = async () => {
        apply.disabled = true;
        try {
          if (await action()) dialog.close();
        } catch (e) {
          note.textContent = failure(e);
        } finally {
          apply.disabled = false;
        }
      };
      dialog.showModal();
    }
    if (adult && adult.ok && body) {
      const params = adult.value;
      controls.append(
        Object.assign(
          button("Fit 3D reference", () => {
            fitting ??= mountReferenceRoom(ctx);
            void fitting.open({ body, params, doc, base }).catch((e) => ctx.say(failure(e)));
          }),
          { id: "fit-study-reference" },
        ),
        button("Quick fit upright mesh", () => {
          const file = el("input");
          file.type = "file";
          file.accept = ".obj,.glb";
          open(
            "Fit 3D reference",
            "Choose an upright, forward-facing OBJ or GLB. The fit uses torso, leg and head depths to adjust build. Heights in metres also set stature.",
            [field("3D reference file", file)],
            async () => {
              const obj = file.files?.[0];
              if (!obj) throw new Error("Choose an OBJ or GLB first.");
              const vertices = obj.name.toLowerCase().endsWith(".glb")
                ? await referenceGlb(await obj.arrayBuffer())
                : referenceVertices(await obj.text());
              const next = fitReference(body, params, vertices);
              return edit("Fit adult to " + obj.name, [{ op: "generation.steer", params: next }]);
            },
          );
        }),
      );
      const head = doc.parts.find((p) => p.slot === "head");
      if (head && !humanWornCast(params) && params.style.faceFamily !== "Studio Rain") {
        controls.append(
          button("Paint native portrait", () => {
            const photo = pictureMarks("Front portrait", true, 3),
              side = pictureMarks("Right-facing profile (optional)", true, 3);
            open(
              "Paint native portrait",
              "Mark the left eye, right eye and lip seam on the front portrait. For side paint, mark the eye, nose tip and lips on a right-facing profile.",
              [photo.node, side.node],
              async () => {
                const lip = photo.marks[2],
                  c = photo.source.getContext("2d");
                if (!lip || !c) throw new Error("Mark both eyes and the lip seam.");
                const result = nativePortraitLayer(
                  body,
                  c.getImageData(0, 0, photo.source.width, photo.source.height),
                  photo.marks,
                  lip,
                  side.loaded ? { image: side.pixels(), marks: side.marks } : undefined,
                );
                const plate = el("canvas");
                plate.width = result.width;
                plate.height = result.height;
                plate.getContext("2d")?.putImageData(result, 0, 0);
                const blob = await new Promise<Blob>((resolve, reject) =>
                  plate.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error("Could not save the portrait."))),
                    "image/png",
                  ),
                );
                const stored = await stagePicture(
                  ctx.host,
                  new Uint8Array(await blob.arrayBuffer()),
                );
                const asset = {
                  digest: stored.digest,
                  mediaType: stored.mediaType,
                  byteLength: stored.byteLength,
                  role: "portrait-plate",
                };
                return edit("Paint native portrait", [
                  ...(doc.assets.some((a) => a.digest === asset.digest)
                    ? []
                    : [{ op: "asset.add", asset }]),
                  {
                    op: "feature.set",
                    part: head.id,
                    feature: figureNativePortrait.id,
                    value: { layer: asset.digest },
                  },
                ]);
              },
            );
          }),
        );
        if (figureNativePortrait.read(head.features))
          controls.append(
            button(
              "Remove portrait paint",
              () =>
                void edit("Remove portrait paint", [
                  {
                    op: "feature.set",
                    part: head.id,
                    feature: figureNativePortrait.id,
                    value: null,
                  },
                ]),
            ),
          );
      }
    }
    const fitted =
      part &&
      (figurePiece.read(part.features)?.piece === "head" ||
        figureAnatomy.read(part.features)?.region === "face");
    if (part && fitted) {
      const feature = (name: string, id: string, value: Json) =>
        edit(name, [{ op: "feature.set", feature: id, part: part.id, value }]);
      controls.append(
        button("Match facial landmarks", () => {
          try {
            const guide = viewport.portraitGuide(part.id),
              model = pictureMarks("Model face", false, 32),
              photo = pictureMarks("Portrait", true, 32);
            model.set(guide.image, guide.image.width, guide.image.height);
            open(
              "Match facial landmarks",
              "Mark corresponding points in the same order on both faces. Start with two widely spaced alignment points, then add the features to move.",
              [model.node, photo.node],
              async () => {
                const pass = landmarkPass(
                  model.marks.map(([u, v]) => guide.pick(u, v)),
                  photo.marks,
                  photo.aspect,
                );
                return feature(
                  "Match facial landmarks",
                  figureFrontFit.id,
                  appendLandmarks(figureFrontFit.read(part.features)?.passes ?? [], pass),
                );
              },
            );
          } catch (e) {
            ctx.showBanner("error", failure(e));
          }
        }),
        button("Trace side portrait", () => {
          const photo = pictureMarks("Side portrait", true),
            facing = choices(["right", "left"] as const, "right");
          open(
            "Trace side portrait",
            "Follow the outline from the brow down over the nose, lips and chin.",
            [field("Facing", facing.input), photo.node],
            async () =>
              feature(
                "Trace side portrait",
                figureProfileFit.id,
                profileFromMarks(photo.marks, facing.read(), photo.aspect),
              ),
          );
        }),
      );
    }
    if (part && !depthRefusal(part)) {
      controls.append(
        button("Adjust portrait depth", () => {
          const prior = figurePortraitDepth.read(part.features),
            photo = pictureMarks("Grayscale depth map", true, 0);
          const mix = el("input");
          mix.type = "range";
          mix.min = "0";
          mix.max = "1";
          mix.step = "0.01";
          mix.value = String(prior?.field?.mix ?? 0.88);
          open(
            "Adjust portrait depth",
            "Choose a front-facing grayscale depth map on black, or adjust the strength of the current map.",
            [photo.node, field("Depth strength", mix)],
            async () => {
              const c = photo.source.getContext("2d");
              const next = photo.loaded
                ? c &&
                  depthFromPixels(
                    c.getImageData(0, 0, photo.source.width, photo.source.height).data,
                    photo.source.width,
                    photo.source.height,
                  )
                : prior?.field;
              if (!next) throw new Error("Choose a depth map first.");
              return edit(
                "Adjust portrait depth",
                depthOperations(doc, part.id, { ...next, mix: mix.valueAsNumber }),
              );
            },
          );
        }),
      );
    }
    sheetTools({
      create: async (source, label) => {
        if (ctx.doc !== doc || ctx.view?.revision !== base.revision || !dialog.open)
          throw new Error("The character changed while the sheet was loading.");
        return create(source, label);
      },
      ctx,
      doc,
      part,
      open,
      edit,
      controls,
      read: async (digest) => {
        const bundled = bundledAsset(digest);
        const file = bundled
          ? { bytes: await ctx.api.bundledImage(digest), mediaType: bundled.mediaType }
          : await readImageChunks(digest, (offset) =>
              ctx.host.call("project.image", { digest, offset }),
            );
        return createImageBitmap(new Blob([file.bytes.slice()], { type: file.mediaType }));
      },
    });
    if (!part)
      controls.append(
        el("p", {
          className: "muted",
          text: "Select a head to match portraits, or a painted part to trace its sheet.",
        }),
      );
  }
  return { render };
}
