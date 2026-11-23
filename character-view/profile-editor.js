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
    apply.disabled = true;
    if (points.length >= 4) {
      try {
        profileTrace(points, byId("profile-facing").value);
        apply.disabled = false;
      } catch (e) {
        message ??= e.message;
      }
    }
    byId("profile-undo").disabled = !points.length;
    readout.textContent =
      message ??
      (picture
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
      if (points.length >= 96 || (points.length && at[1] <= points.at(-1)[1]))
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
  apply.onclick = () => {
    const fit = profileTrace(points, byId("profile-facing").value);
    save(fit);
    dialog.close();
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
  return () => {
    draw();
    dialog.showModal();
  };
}
