import {
  registeredArtwork,
  paintGuide,
  importArtwork,
  guideHeight,
  guidePosition,
  traceOutline,
} from "./turnaround.js";
import { Matrix4, Vector3, Quaternion, Euler } from "three";

const labels = {
  ridgeback: "Plateback",
  cartographer: "Coast cartographer",
  conductor: "Opera conductor",
  coastPortrait: "Cartographer head",
  conductorPortrait: "Conductor head",
};
export function bindTraceEditor({
  getForm,
  getTarget,
  figurePart,
  accept,
  status,
}) {
  const dialog = document.getElementById("trace-dialog"),
    select = document.getElementById("trace-art");
  const canvases = [...dialog.querySelectorAll("canvas")],
    message = document.getElementById("trace-feedback");
  let outlines = [[], []],
    art = null,
    added = {},
    hover = null,
    lastView = 0;
  function draw() {
    canvases.forEach((canvas, view) => {
      const ctx = canvas.getContext("2d"),
        n = canvas.width;
      ctx.clearRect(0, 0, n, n);
      if (!art) return;
      paintGuide(ctx, art, view);
      const poly = outlines[view];
      if (poly.length) {
        ctx.beginPath();
        poly.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x * n, y * n));
        if (poly.length > 2) ctx.closePath();
        ctx.fillStyle = "#153b4780";
        ctx.strokeStyle = "#fffbd8";
        ctx.lineWidth = 2;
        if (poly.length > 2) ctx.fill();
        ctx.stroke();
        for (const [x, y] of poly) {
          ctx.beginPath();
          ctx.arc(x * n, y * n, 3.3, 0, Math.PI * 2);
          ctx.fillStyle = "#f9fbb1";
          ctx.fill();
        }
      }
      if (hover !== null) {
        const line = guidePosition(art, view, hover) * n;
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "#ffffda";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, line);
        ctx.lineTo(n, line);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }
  function refresh(id) {
    select.replaceChildren(
      ...registeredArtwork().map(
        (key, i) => new Option(labels[key] ?? "Imported art " + (i + 1), key),
      ),
    );
    art = registeredArtwork().includes(id) ? id : select.value;
    select.value = art ?? "";
    outlines = [[], []];
    hover = null;
    draw();
  }
  document.getElementById("trace-open").onclick = () => {
    const selected = getForm().parts.find((p) => p.id === getTarget());
    Object.assign(added, getForm().artwork);
    refresh(selected?.paint?.atlas ?? art);
    message.textContent = "";
    document.getElementById("trace-mode").value = "new";
    dialog.showModal();
  };
  select.onchange = () => refresh(select.value);
  document.getElementById("trace-cancel").onclick = () => dialog.close();
  document.getElementById("trace-undo").onclick = () => {
    outlines[lastView].pop();
    draw();
  };
  document.getElementById("trace-clear").onclick = () => {
    outlines = [[], []];
    draw();
  };
  for (const [view, canvas] of canvases.entries()) {
    const point = (e) => {
      const b = canvas.getBoundingClientRect();
      return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
    };
    canvas.onclick = (e) => {
      if (!art) return;
      lastView = view;
      outlines[view].push(point(e));
      draw();
    };
    canvas.onpointermove = (e) => {
      if (art) {
        hover = guideHeight(art, view, point(e)[1]);
        draw();
      }
    };
    canvas.onpointerleave = () => {
      hover = null;
      draw();
    };
  }
  const upload = document.getElementById("trace-file");
  document.getElementById("trace-import").onclick = () => upload.click();
  upload.onchange = async () => {
    const file = upload.files[0];
    upload.value = "";
    if (!file) return;
    try {
      const { id, url } = await importArtwork(file);
      added[id] = url;
      refresh(id);
      message.textContent = "Turnaround ready.";
    } catch (e) {
      message.textContent = e.message;
    }
  };
  document.getElementById("trace-add").onclick = () => {
    try {
      if (outlines.some((p) => p.length > 0 && p.length < 3))
        throw new Error(
          "Close each outline with at least three points, or clear it for the whole silhouette.",
        );
      const height = Number(document.getElementById("trace-height").value);
      if (!Number.isFinite(height) || height < 0.15 || height > 6)
        throw new Error("Enter a standing height between 0.15 and 6 metres.");
      const base = getForm(),
        fresh = document.getElementById("trace-mode").value === "new";
      const parts = fresh ? [] : base.parts,
        used = new Set(parts.map((p) => p.id));
      const name =
        document.getElementById("trace-name").value.trim() || "Painted region";
      let id = name,
        n = 2;
      while (used.has(id)) id = name + " " + n++;
      const part = traceOutline(id, art, height, outlines);
      const parent = fresh ? null : getTarget(),
        object = parent && figurePart(parent);
      if (object) {
        object.updateWorldMatrix(true, false);
        const inverse = object.matrixWorld.clone().invert();
        const matrix = inverse.multiply(
          new Matrix4().makeTranslation(...part.position),
        );
        const q = new Quaternion(),
          p = new Vector3(),
          scale = new Vector3();
        matrix.decompose(p, q, scale);
        const rot = new Euler().setFromQuaternion(q);
        Object.assign(part, {
          parent,
          position: p.toArray(),
          size: scale.toArray(),
          rotation: [rot.x, rot.y, rot.z].map((v) => (v * 180) / Math.PI),
        });
      }
      const artwork = fresh ? {} : { ...base.artwork };
      if (added[art]) artwork[art] = added[art];
      const form = { ...base, parts: [...parts, part], artwork };
      delete form.origin;
      accept(form, id);
      dialog.close();
      status("Traced " + id + " into editable geometry.");
    } catch (e) {
      message.textContent = e.message;
    }
  };
}
