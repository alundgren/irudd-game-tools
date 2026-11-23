import {
  paintGuide,
  importArtwork,
  traceHull,
  traceOutline,
} from "./turnaround.js";
import { traceBiped } from "./trace-biped.js";
import { buildTraceMap } from "./trace-map.js";
import { startingForm, validateForm } from "./recipe.js";
import { extractComponent, placeComponent } from "./graft.js";

async function post(path, value) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(
      json.error || "The local workshop could not complete this step.",
    );
  return json;
}
function coordinateViews(atlas) {
  return [0, 1].map((i) => {
    const c = document.createElement("canvas");
    c.width = c.height = 768;
    const ctx = c.getContext("2d");
    paintGuide(ctx, atlas, i);
    ctx.font = "bold 14px system-ui";
    ctx.textBaseline = "top";
    for (let j = 1; j < 10; j++) {
      const v = j * 76.8;
      ctx.strokeStyle = "#ffffff7a";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(v, 0);
      ctx.lineTo(v, 768);
      ctx.moveTo(0, v);
      ctx.lineTo(768, v);
      ctx.stroke();
      ctx.fillStyle = "#1f302cdf";
      ctx.fillRect(v - 13, 0, 31, 18);
      ctx.fillRect(0, v - 8, 31, 18);
      ctx.fillStyle = "white";
      ctx.fillText((j / 10).toFixed(1), v - 10, 1);
      ctx.fillText((j / 10).toFixed(1), 3, v - 7);
    }
    return {
      name: i === 0 ? "front" : "profile facing left",
      jpeg: c.toDataURL("image/jpeg", 0.88).split(",")[1],
    };
  });
}
export async function fitMapWithAgent(
  atlas,
  height,
  instructions,
  { revision, requestId, preserve = [], status = () => {} },
) {
  const brief = {
    format: "irudd.trace-request.v1",
    revision,
    requestId,
    height,
    instructions,
    preserve,
    views: coordinateViews(atlas),
  };
  let problem;
  const attempts = [];
  for (let i = 0; i < 2; i++) {
    const map = await post("/trace-map", brief);
    attempts.push(map);
    try {
      const form = buildTraceMap(map, atlas, height);
      for (const id of preserve)
        if (!form.parts.some((p) => p.id === id))
          throw new Error(
            "The new map has no region for protected " + id + ".",
          );
      return { form, map };
    } catch (err) {
      problem = err;
      if (i === 0) {
        brief.repair = { problem: err.message, map };
        status("Refitting an outline that missed its profile.");
      }
    }
  }
  let best;
  for (const map of attempts) {
    try {
      const missed = [];
      const form = buildTraceMap(map, atlas, height, { missed });
      if (
        form.parts.length < 2 ||
        form.parts.length / map.regions.length < 0.7 ||
        preserve.some((id) => !form.parts.some((p) => p.id === id))
      )
        continue;
      if (!best || form.parts.length > best.form.parts.length) {
        const fittedIds = new Set(form.parts.map((p) => p.id));
        const fittedMap = {
          ...map,
          height,
          regions: map.regions
            .filter((r) => fittedIds.has(r.id))
            .map((r) => ({
              ...r,
              parent: form.parts.find((p) => p.id === r.id).parent,
            })),
        };
        best = { form, map: fittedMap, missed };
      }
    } catch {
      /* Try the other map when its root or graph is invalid. */
    }
  }
  if (best) return best;
  throw problem;
}
export async function paintWithAgent(
  request,
  base,
  { views, height, target, wearable = false, status },
) {
  if (target && !wearable && request.preserve.includes(target))
    throw new Error(
      "This part is protected. Choose an unlocked part or remove its shape lock.",
    );
  const payload = {
    format: request.format,
    revision: request.revision,
    requestId: request.requestId,
    variation: request.variation,
    instructions: request.instructions,
    nudge: request.nudge,
    views,
    height,
    paintTarget: target,
    wearable,
  };
  status("Generating an original four-view turnaround…");
  const art = await post("/turnaround", payload);
  if (art.requestId !== request.requestId || art.revision !== request.revision)
    throw new Error("This artwork belongs to an earlier edit.");
  const bytes = Uint8Array.from(atob(art.png), (c) => c.charCodeAt(0));
  const { id: atlas, url } = await importArtwork(
    new File([bytes], "turnaround.png", { type: "image/png" }),
  );
  status("Fitting editable 3D regions to the new front and profile…");
  let form,
    map,
    note = "";
  try {
    let missed;
    ({ form, map, missed } = await fitMapWithAgent(
      atlas,
      art.height,
      wearable
        ? "Trace only the isolated wearable. Use its main shell as the root with attachments as children. " +
            request.instructions
        : request.instructions,
      {
        revision: request.revision,
        requestId: request.requestId,
        preserve: target ? [] : request.preserve,
        status,
      },
    ));
    if (missed?.length)
      note =
        " Included " +
        form.parts.length +
        " editable regions. Unresolved outlines: " +
        missed.join(", ") +
        ". ";
  } catch (error) {
    // A failed fit still leaves usable artwork and an editable 3D candidate.
    // Protected whole-form edits require a valid named mapping.
    if (!target && request.preserve.length)
      throw new Error(
        "Could not match the protected regions. " + error.message,
      );
    try {
      form = traceBiped(atlas, art.height);
      note =
        " The part map failed; this candidate uses the automatic biped fit.";
    } catch {
      form = startingForm(() => 0.5);
      form.parts = [traceHull("painted volume", atlas, art.height)];
      note = " The part map failed; this candidate uses one silhouette volume.";
    }
  }
  form.artwork = { [atlas]: url };
  if (target) {
    if (wearable && art.coverage !== "open") {
      let id = "garment shell";
      while (form.parts.some((p) => p.id === id)) id += " outer";
      const shell = traceOutline(id, atlas, art.height, [[], []]);
      delete shell.paint.region;
      form.parts = [
        shell,
        ...form.parts.map((p) =>
          p.parent
            ? p
            : {
                ...p,
                parent: id,
                position: p.position.map((v, i) => v - shell.position[i]),
              },
        ),
      ];
    }
    const roots = form.parts.filter((p) => !p.parent);
    if (roots.length > 1) {
      const root = roots[0];
      form.parts = form.parts.map((p) =>
        p !== root && !p.parent
          ? {
              ...p,
              parent: root.id,
              position: p.position.map((v, i) => v - root.position[i]),
            }
          : p,
      );
    }
    form = placeComponent(base, extractComponent(form, roots[0].id, true), {
      target,
      mode: wearable ? "wear" : "replace",
      fit: true,
    }).form;
  } else {
    for (const id of request.preserve) {
      const original = extractComponent(base, id, false);
      form = placeComponent(form, original, {
        target: id,
        mode: "replace",
        fit: false,
      }).form;
      const old = base.parts.find((p) => p.id === id);
      form.parts = form.parts.map((p) => {
        if (p.id !== id) return p;
        const locked = {
          ...structuredClone(old),
          position: p.position,
          rotation: p.rotation,
        };
        if (p.parent) locked.parent = p.parent;
        else delete locked.parent;
        return locked;
      });
    }
  }
  validateForm(form);
  return {
    format: "irudd.form-proposal.v1",
    requestId: request.requestId,
    revision: request.revision,
    summary: (art.summary + note).slice(0, 500),
    form,
    painted: true,
    art: { atlas, url, map },
  };
}
