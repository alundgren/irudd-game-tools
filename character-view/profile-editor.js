import { importArtwork } from "./turnaround.js";
import { traceSkirt } from "./skirt-pattern.js";
import { profileTrace } from "./profile-fit.js";

export function profileEditor(save) {
  const byId = (id) => document.getElementById(id),
    dialog = byId("profile-room"),
    canvas = byId("profile-image"),
    ctx = canvas.getContext("2d"),
    readout = byId("profile-reading"),
    picker = byId("profile-file"),
    apply = byId("profile-apply");
  let picture = null,
    points = [],
    dragging = -1,
    revision = 0;
  let skirtSave = null,
    ear = null,
    choosingEar = false,
    saving = false;
  const usePaint = () => !skirtSave && byId("profile-side-paint").checked;
  const defaultHelp = byId("profile-help").textContent;
  const read = () =>
    skirtSave
      ? traceSkirt(points)
      : profileTrace(points, byId("profile-facing").value);
  function draw(message) {
    canvas.hidden = !picture;
    const scale = picture ? canvas.width / picture.naturalWidth : 1;
    if (picture) {
      ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#00dec0";
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      points.forEach(([x, y], i) =>
        i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale),
      );
      ctx.stroke();
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(x * scale, y * scale, 3, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (picture && ear && usePaint()) {
      ctx.fillStyle = "#f9a740";
      ctx.beginPath();
      ctx.arc(ear[0] * scale, ear[1] * scale, 5, 0, 2 * Math.PI);
      ctx.fill();
    }
    byId("profile-ear").hidden = !usePaint();
    apply.disabled = true;
    if (points.length >= 4) {
      try {
        read();
        apply.disabled = saving || (usePaint() && !ear);
      } catch (e) {
        message ??= e.message;
      }
    }
    byId("profile-undo").disabled = !points.length;
    readout.textContent =
      message ??
      (choosingEar
        ? "Click the ear opening in the side portrait."
        : undefined) ??
      (skirtSave
        ? !picture
          ? "Choose a front view of the garment."
          : points.length === 0
            ? "Mark the centre of the waistband."
            : points.length === 1
              ? "Mark its left or right edge."
              : "Mark the same edge down to the hem. " +
                points.length +
                " points."
        : picture
          ? points.length +
            " points. Finish at the forward edge of the lower chin."
          : "Choose a cropped side view of the face.");
  }
  function point(e) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) *
        picture.naturalWidth,
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) *
        picture.naturalHeight,
    ];
  }
  picker.onchange = async () => {
    const file = picker.files[0];
    if (!file) return;
    const token = ++revision,
      url = URL.createObjectURL(file);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      if (revision !== token) return;
      picture = im;
      points = [];
      ear = null;
      choosingEar = false;
      const ratio = Math.min(1200 / im.naturalWidth, 850 / im.naturalHeight);
      canvas.width = Math.max(1, Math.round(im.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(im.naturalHeight * ratio));
      draw();
    } catch {
      if (token === revision) draw("This image could not be opened.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  canvas.onpointerdown = (e) => {
    if (!picture || e.button !== 0) return;
    if (choosingEar) {
      ear = point(e);
      choosingEar = false;
      draw();
      return;
    }
    const at = point(e),
      rect = canvas.getBoundingClientRect();
    dragging = points.findIndex(
      ([x, y]) =>
        Math.hypot(
          ((x - at[0]) * rect.width) / picture.naturalWidth,
          ((y - at[1]) * rect.height) / picture.naturalHeight,
        ) < 6,
    );
    if (dragging < 0) {
      if (
        points.length >= (skirtSave ? 65 : 96) ||
        (points.length > (skirtSave ? 1 : 0) && at[1] <= points.at(-1)[1])
      )
        return draw(
          "Place the next point below the previous one, or drag a point to adjust it.",
        );
      dragging = points.push(at) - 1;
    }
    canvas.setPointerCapture(e.pointerId);
    draw();
  };
  canvas.onpointermove = (e) => {
    if (dragging >= 0) {
      points[dragging] = point(e);
      draw();
    }
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    dragging = -1;
  };
  byId("profile-undo").onclick = () => {
    points.pop();
    draw();
  };
  byId("profile-facing").onchange = () => draw();
  byId("profile-close").onclick = () => dialog.close();
  byId("profile-side-paint").onchange = () => {
    choosingEar = false;
    byId("profile-last").disabled = usePaint();
    if (usePaint()) byId("profile-last").checked = true;
    draw();
  };
  byId("profile-ear").onclick = () => {
    choosingEar = true;
    draw();
  };
  apply.onclick = async () => {
    if (saving) return;
    const token = revision;
    try {
      const trace = read();
      if (skirtSave) {
        skirtSave(trace);
        dialog.close();
        return;
      }
      if (byId("profile-last").checked || usePaint()) trace.stage = "finish";
      let artwork;
      if (usePaint()) {
        saving = true;
        draw("Preparing the side portrait.");
        const w = picture.naturalWidth,
          h = picture.naturalHeight;
        const brow = [points[0][0] / w, points[0][1] / h],
          chinY = points.at(-1)[1] / h;
        const registration = {
          brow,
          chinY,
          ear: [ear[0] / w, ear[1] / h],
          facing: byId("profile-facing").value,
        };
        artwork = await importArtwork(picker.files[0], "side");
        if (token !== revision) return;
        trace.paint = { atlas: artwork.id, ...registration };
      }
      const error = save(trace, artwork);
      if (error) throw new Error(error);
      dialog.close();
    } catch (error) {
      saving = false;
      if (token === revision) draw(error.message);
    } finally {
      saving = false;
    }
  };
  dialog.addEventListener("close", () => {
    revision++;
    picture = null;
    points = [];
    picker.value = "";
    dragging = -1;
    canvas.width = 1;
    canvas.height = 1;
  });
  return (onSkirt = null) => {
    byId("profile-options").hidden = typeof onSkirt === "function";
    byId("profile-last").checked = false;
    byId("profile-last").disabled = false;
    byId("profile-side-paint").checked = false;
    ear = null;
    choosingEar = false;
    skirtSave = typeof onSkirt === "function" ? onSkirt : null;
    byId("profile-title").textContent = skirtSave
      ? "Trace a skirt silhouette"
      : "Trace the face in profile";
    byId("profile-help").textContent = skirtSave
      ? "Mark the centre and one edge of the waistband, then follow that edge down to the hem. The trace scales to the wearer’s waist and chosen garment length."
      : defaultHelp;
    byId("profile-file-label").textContent = skirtSave
      ? "Garment reference"
      : "Side portrait";
    byId("profile-facing").parentElement.hidden = !!skirtSave;
    apply.textContent = skirtSave ? "Use this outline" : "Fit selected face";
    canvas.setAttribute(
      "aria-label",
      skirtSave
        ? "Trace the waist and garment edge"
        : "Trace points on the reference portrait",
    );
    draw();
    dialog.showModal();
  };
}
