import { portraitMarks } from "./portrait-frame.js";
import {
  registeredArtwork,
  paintGuide,
  importArtwork,
  guideHeight,
  guidePosition,
  traceOutline,
  traceHull,
  tracePath,
  calibrateFace,
} from "./turnaround.js";
import { buildTraceMap } from "./trace-map.js";
import { fitMapWithAgent } from "./art-variation.js";
import { traceBiped } from "./trace-biped.js";
import { Matrix4, Vector3, Quaternion, Euler } from "three";

const labels = {
  tidebell: "Tidebell shell",
  ridgeback: "Plateback",
  trader: "Reed trader",
  surveyor: "Dock foreman",
  courier: "Relay scout",
  expedition: "Expedition suit",
  cartographer: "Coast cartographer",
  conductor: "Opera conductor",
  foremanPortrait: "Foreman head",
  relayPortrait: "Scout head",
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
  const method = document.getElementById("trace-method");
  method.onchange = () => {
    const path = method.value === "path";
    document.getElementById("trace-radius-field").hidden = !path;
    document.getElementById("trace-path-help").hidden = !path;
    draw();
  };
  const canvases = [...dialog.querySelectorAll("canvas")],
    message = document.getElementById("trace-feedback");
  let outlines = [[], []],
    art = null,
    added = {},
    hover = null,
    lastView = 0;
  const markButton = document.getElementById("trace-face"),
    applyMarks = document.getElementById("trace-face-apply");
  let marks = null;
  const selectedHead = () =>
    getForm().parts.find(
      (p) =>
        p.id === getTarget() &&
        p.shape === "sweep" &&
        p.paint?.atlas === art &&
        p.paint.frame !== "path",
    );
  function showMarks() {
    applyMarks.hidden = !marks;
    applyMarks.disabled = marks?.length !== 5;
    markButton.textContent = marks
      ? "Cancel face marks"
      : "Mark facial landmarks";
    markButton.hidden = !selectedHead();
    if (marks)
      message.textContent =
        marks.length < 5
          ? "Mark the " + portraitMarks[marks.length] + " in the front view."
          : "Inspect the five points, then fit the face.";
  }
  markButton.onclick = () => {
    marks = marks ? null : [];
    message.textContent = "";
    showMarks();
    draw();
  };
  applyMarks.onclick = () => {
    try {
      const form = getForm(),
        source = selectedHead(),
        part = calibrateFace(source, marks);
      accept(
        {
          ...form,
          parts: form.parts.map((p) => (p.id === part.id ? part : p)),
        },
        part.id,
      );
      marks = null;
      dialog.close();
      status("Calibrated the face. Facial nudges and expressions are ready.");
    } catch (e) {
      message.textContent = e.message;
    }
  };
  function draw() {
    canvases.forEach((canvas, view) => {
      const ctx = canvas.getContext("2d"),
        n = canvas.width;
      ctx.clearRect(0, 0, n, n);
      if (!art) return;
      paintGuide(ctx, art, view);
      if (marks && view === 0) {
        ctx.font = "bold 15px system-ui";
        marks.forEach(([x, y], i) => {
          ctx.beginPath();
          ctx.arc(x * n, y * n, 4, 0, 2 * Math.PI);
          ctx.fillStyle = "#fff4a0";
          ctx.fill();
          ctx.strokeStyle = "#223c36";
          ctx.stroke();
          ctx.fillText(String(i + 1), x * n + 7, y * n - 3);
        });
      }
      const poly = marks ? [] : outlines[view];
      if (poly.length) {
        ctx.beginPath();
        poly.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x * n, y * n));
        if (poly.length > 2 && method.value !== "path") ctx.closePath();
        ctx.fillStyle = "#153b4780";
        ctx.strokeStyle = "#fffbd8";
        ctx.lineWidth = 2;
        if (poly.length > 2 && method.value !== "path") ctx.fill();
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
    marks = null;
    showMarks();
    outlines = [[], []];
    hover = null;
    draw();
  }
  document.getElementById("trace-open").onclick = () => {
    const selected = getForm().parts.find((p) => p.id === getTarget());
    Object.assign(added, getForm().artwork);
    refresh(selected?.paint?.atlas ?? art);
    message.textContent = "";
    method.onchange();
    document.getElementById("trace-mode").value = "new";
    dialog.showModal();
  };
  select.onchange = () => refresh(select.value);
  document.getElementById("trace-cancel").onclick = () => dialog.close();
  document.getElementById("trace-undo").onclick = () => {
    if (marks) {
      marks.pop();
      showMarks();
    } else outlines[lastView].pop();
    draw();
  };
  document.getElementById("trace-clear").onclick = () => {
    if (marks) {
      marks = [];
      showMarks();
    }
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
      if (marks) {
        if (view === 0 && marks.length < 5) marks.push(point(e));
        showMarks();
        draw();
        return;
      }
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
  const agentFit = document.getElementById("trace-agent-fit");
  agentFit.hidden =
    document.querySelector('meta[name="workshop-agent"]')?.content !== "local";
  document.getElementById("trace-steer-field").hidden = agentFit.hidden;
  agentFit.onclick = async () => {
    const chosen = art,
      height = Number(document.getElementById("trace-height").value);
    agentFit.disabled = true;
    const show = (text) => {
      message.textContent = text;
    };
    try {
      show("Tracing separate parts in front and profile…");
      const { form, missed } = await fitMapWithAgent(
        chosen,
        height,
        document.getElementById("trace-steering").value.trim() ||
          "Identify and articulate the pictured character or item.",
        {
          revision: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          status: show,
        },
      );
      if (!dialog.open || chosen !== art) return;
      if (added[chosen]) form.artwork = { [chosen]: added[chosen] };
      accept(form, form.parts.find((p) => !p.parent)?.id);
      dialog.close();
      status(
        "Built " +
          form.parts.length +
          " AI-fitted parts." +
          (missed?.length ? " Unresolved: " + missed.join(", ") + "." : ""),
      );
    } catch (error) {
      show(error.message);
    } finally {
      agentFit.disabled = false;
    }
  };
  const mapFile = document.getElementById("trace-map-file");
  document.getElementById("trace-map-import").onclick = () => mapFile.click();
  mapFile.onchange = async () => {
    const file = mapFile.files[0];
    mapFile.value = "";
    if (!file) return;
    try {
      if (file.size > 500000) throw new Error("Use a part map under 500 KB.");
      const form = buildTraceMap(JSON.parse(await file.text()), art);
      if (added[art]) form.artwork = { [art]: added[art] };
      accept(form, form.parts.find((p) => !p.parent)?.id);
      dialog.close();
      status(
        "Built " +
          form.parts.length +
          " articulated regions from the part map.",
      );
    } catch (error) {
      message.textContent = error.message;
    }
  };
  document.getElementById("trace-biped").onclick = () => {
    try {
      const h = Number(document.getElementById("trace-height").value);
      if (!Number.isFinite(h) || h < 0.15 || h > 6)
        throw new Error("Enter a standing height between 0.15 and 6 metres.");
      const form = traceBiped(art, h);
      if (added[art]) form.artwork = { [art]: added[art] };
      accept(form, "body");
      dialog.close();
      status(
        "Built an articulated biped. Select a region to refine its contours.",
      );
    } catch (error) {
      message.textContent = error.message;
    }
  };
  document.getElementById("trace-add").onclick = () => {
    try {
      if (
        method.value !== "path" &&
        outlines.some((p) => p.length > 0 && p.length < 3)
      )
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
      let part;
      if (method.value === "path") {
        if (outlines[0].length !== outlines[1].length || outlines[0].length < 2)
          throw new Error(
            "Mark the same number of centreline points in each view.",
          );
        const radius =
          Number(document.getElementById("trace-radius").value) / 100;
        const last = outlines[0].length - 1;
        const spine = outlines[0].map((xy, i) => {
          const r = radius * (1 - (0.9 * i) / last);
          return [...xy, ...outlines[1][i], r, r];
        });
        part = tracePath(id, art, height, spine);
      } else if (method.value === "sweep")
        part = traceOutline(id, art, height, outlines);
      else {
        part = traceHull(id, art, height, outlines);
        if (method.value !== "volume")
          part.hull.membrane = {
            slope: method.value === "same" ? -1 : 1,
            thickness: 0.016,
          };
      }
      const parent = fresh ? null : getTarget(),
        object = parent && figurePart(parent);
      if (object) {
        object.updateWorldMatrix(true, false);
        const mount =
          object.children.find((child) => child.userData.attachmentFrame) ??
          object;
        mount.updateWorldMatrix(true, false);
        const inverse = mount.matrixWorld.clone().invert();
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
