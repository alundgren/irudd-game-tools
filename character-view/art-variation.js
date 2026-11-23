import { repaintRegions } from "./paint-sources.js";
import { acceptsDepth, depthFromPixels } from "./portrait-depth.js";
import { readReference } from "./visual-references.js";
import { keepSourceHairstyle } from "./graft.js";
import {
  paintGuide,
  calibrateFace,
  sourceHairCap,
  withDepthPairs,
  importArtwork,
  traceHull,
  traceOutline,
} from "./turnaround.js";
import { traceBiped } from "./trace-biped.js";
import { buildTraceMap } from "./trace-map.js";
import { startingForm, validateForm } from "./recipe.js";
import { extractComponent, placeComponent } from "./graft.js";

async function post(path, value, signal) {
  const response = await fetch(path, {
    method: "POST",
    signal,
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
  {
    revision,
    requestId,
    preserve = [],
    isolatedFace = false,
    status = () => {},
    signal,
  },
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
    const map = await post("/trace-map", brief, signal);
    // An isolated portrait fills the whole panel. The agent's outlined head
    // can end just above the chin, especially when it separated the neck.
    const root =
      isolatedFace &&
      map.regions?.find(
        (r) => !r.parent && r.method === "loft" && r.faceLandmarks,
      );
    if (root) {
      const hairRegions =
        root.hairRegions ??
        map.regions
          .filter(
            (r) =>
              /hair|coiffure|fringe|bun|braid|locks/i.test(r.id) &&
              r.front?.length >= 3 &&
              r.side?.length >= 3,
          )
          .map(({ id, front, side }) => ({ id, front, side }));
      const portraitMap = {
        ...map,
        regions: [{ ...root, front: [], side: [], hairRegions }],
      };
      try {
        return {
          form: buildTraceMap(portraitMap, atlas, height),
          map: portraitMap,
        };
      } catch {
        /* Retry the individual outlines below. */
      }
    }
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
      const missed = [],
        uncalibrated = [];
      const form = buildTraceMap(map, atlas, height, { missed, uncalibrated });
      if (
        !form.parts.length ||
        form.parts.length / map.regions.length < 0.7 ||
        preserve.some((id) => !form.parts.some((p) => p.id === id))
      )
        continue;
      if (
        !best ||
        form.parts.length > best.form.parts.length ||
        (form.parts.length === best.form.parts.length &&
          uncalibrated.length < best.uncalibrated.length)
      ) {
        const fittedIds = new Set(form.parts.map((p) => p.id));
        const fittedMap = {
          ...map,
          height,
          regions: map.regions
            .filter((r) => fittedIds.has(r.id))
            .map((r) => {
              const region = {
                ...r,
                parent: form.parts.find((p) => p.id === r.id).parent,
              };
              if (uncalibrated.includes(r.id)) delete region.faceLandmarks;
              return region;
            }),
        };
        best = { form, map: fittedMap, missed, uncalibrated };
      }
    } catch {
      /* Try the other map when its root or graph is invalid. */
    }
  }
  if (best) return best;
  throw problem;
}
async function newDepthCandidate(request, base, target, signal, status) {
  const part = base.parts.find((p) => p.id === target);
  if (!acceptsDepth(part))
    throw new Error(
      "Select a painted portrait with its own front and side pictures.",
    );
  const views = [0, 1].map((i) => {
    const c = document.createElement("canvas");
    c.width = c.height = 640;
    paintGuide(c.getContext("2d"), part.paint.atlas, i);
    return {
      name: i === 0 ? "frontal color" : "profile color",
      jpeg: c.toDataURL("image/jpeg", 0.93).split(",")[1],
    };
  });
  status("Generating a frontal depth pass from the accepted portrait.");
  const reply = await post(
    "/portrait-depth",
    {
      format: request.format,
      requestId: request.requestId,
      revision: request.revision,
      instructions: request.instructions,
      height: Math.max(0.15, part.paint.height),
      views,
    },
    signal,
  );
  if (
    reply.requestId !== request.requestId ||
    reply.revision !== request.revision
  )
    throw new Error("This depth pass belongs to an earlier edit.");
  const blob = new Blob(
    [Uint8Array.from(atob(reply.png), (c) => c.charCodeAt(0))],
    { type: "image/png" },
  );
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 384;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, 384, 384);
  bitmap.close();
  const depthField = depthFromPixels(
    ctx.getImageData(0, 0, 384, 384).data,
    384,
    384,
  );
  const form = {
    ...base,
    parts: base.parts.map((p) =>
      p === part ? { ...p, paint: { ...p.paint, depthField } } : p,
    ),
  };
  validateForm(form);
  return {
    format: "irudd.form-proposal.v1",
    requestId: request.requestId,
    revision: request.revision,
    summary:
      "Fitted frontal depth to " +
      part.id +
      ". Compare the shape in clay and adjust its influence under Sculpt.",
    form,
    painted: true,
  };
}
export async function paintWithAgent(
  request,
  base,
  {
    views,
    height,
    target,
    wearable = false,
    scalp = false,
    depth = false,
    resurface = false,
    sourceRevision = false,
    paintBranch = true,
    status,
    signal,
  },
) {
  if (target && !wearable && request.preserve.includes(target))
    throw new Error(
      "This part is protected. Choose an unlocked part or remove its shape lock.",
    );
  if (depth) return newDepthCandidate(request, base, target, signal, status);
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
    ...(request.references?.length ? { references: request.references } : {}),
    wearable,
  };
  if (scalp || resurface || sourceRevision) {
    const original = base.parts.find((p) => p.id === target),
      binding = original?.paint ?? original?.hull;
    if (!binding?.atlas || (scalp && !original?.hairCap))
      throw new Error("Choose a fitted region with source artwork.");
    const c = document.createElement("canvas");
    c.width = c.height = 960;
    const ctx = c.getContext("2d");
    for (let i = 0; i < 4; i++) {
      const panel = document.createElement("canvas");
      panel.width = panel.height = 480;
      paintGuide(panel.getContext("2d"), binding.atlas, i);
      ctx.drawImage(panel, (i % 2) * 480, Math.floor(i / 2) * 480);
    }
    const blob = await new Promise((resolve) =>
      c.toBlob(resolve, "image/webp", 0.94),
    );
    payload.sourceView = await readReference(
      new File([blob], "accepted-turnaround.webp", { type: "image/webp" }),
      original.anatomy === "face" ? "Face" : "Color and surface",
    );
    payload.scalp = scalp;
    payload.resurface = resurface;
    payload.sourceRevision = sourceRevision;
  }
  status("Generating an original four-view turnaround…");
  const art = await post("/turnaround", payload, signal);
  if (art.requestId !== request.requestId || art.revision !== request.revision)
    throw new Error("This artwork belongs to an earlier edit.");
  const bytes = Uint8Array.from(atob(art.png), (c) => c.charCodeAt(0));
  const { id: atlas, url } = await importArtwork(
    new File([bytes], "turnaround.png", { type: "image/png" }),
  );
  if (resurface) {
    const source = base.parts.find((p) => p.id === target),
      binding = source.paint ?? source.hull;
    const branch = new Set([target]);
    if (paintBranch) {
      let count = 0;
      while (count !== branch.size) {
        count = branch.size;
        for (const p of base.parts)
          if (branch.has(p.parent) && !request.preserve.includes(p.id))
            branch.add(p.id);
      }
    }
    const selected = base.parts
      .filter(
        (p) => branch.has(p.id) && (p.paint ?? p.hull)?.atlas === binding.atlas,
      )
      .map((p) => p.id);
    const changed = selected.length;
    const next = repaintRegions(
      { ...base, artwork: { ...base.artwork, [atlas]: url } },
      selected,
      atlas,
    );
    validateForm(next);
    return {
      format: "irudd.form-proposal.v1",
      requestId: request.requestId,
      revision: request.revision,
      summary:
        "Repainted " +
        changed +
        " region" +
        (changed === 1 ? "" : "s") +
        " on the existing geometry. " +
        (art.summary ?? "").slice(0, 320),
      form: next,
      painted: true,
      art: { atlas, url },
    };
  }
  status("Fitting editable 3D regions to the new front and profile…");
  let form,
    map,
    note = "";
  try {
    let missed, uncalibrated;
    ({ form, map, missed, uncalibrated } = await fitMapWithAgent(
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
        isolatedFace:
          !wearable &&
          !!target &&
          base.parts.some(
            (p) =>
              p.id === target && (p.shape === "head" || p.anatomy === "face"),
          ),
        signal,
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
    if (uncalibrated?.length)
      note +=
        " Mark the pupils, nose, lips and chin to enable facial expressions on " +
        uncalibrated.join(", ") +
        ".";
  } catch (error) {
    signal?.throwIfAborted();
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
  const sourcePart = target && base.parts.find((p) => p.id === target);
  const portraitRoot = map?.regions?.find((r) => !r.parent && r.faceLandmarks);
  if (
    !wearable &&
    portraitRoot &&
    (sourcePart?.shape === "head" || sourcePart?.anatomy === "face")
  ) {
    // An isolated human portrait has complete front/profile contours. A single
    // continuous scalp, jaw and neck avoids gaps between overlapping lofts.
    try {
      const surface = traceOutline(portraitRoot.id, atlas, art.height, [
        [],
        [],
      ]);
      const face = withDepthPairs(
        calibrateFace(surface, portraitRoot.faceLandmarks),
        portraitRoot.depthPairs,
      );
      const hairRegions =
        portraitRoot.hairRegions ??
        map.regions
          .filter(
            (r) =>
              /hair|coiffure|fringe|bun|braid|locks/i.test(r.id) &&
              r.front?.length >= 3 &&
              r.side?.length >= 3,
          )
          .map(({ id, front, side }) => ({ id, front, side }));
      if (!scalp && hairRegions.length) {
        const cap = sourceHairCap(face, hairRegions);
        if (cap) face.hairCap = cap;
      }
      form = { ...form, parts: [face] };
      map = {
        ...map,
        regions: [
          {
            id: portraitRoot.id,
            method: "loft",
            front: [],
            side: [],
            faceLandmarks: portraitRoot.faceLandmarks,
            ...(portraitRoot.depthPairs?.length
              ? { depthPairs: portraitRoot.depthPairs }
              : {}),
            ...(hairRegions.length ? { hairRegions } : {}),
            outfitRole: "head",
            motionRole: "head",
          },
        ],
      };
      note += " Fitted one continuous, sculptable portrait.";
    } catch {
      note += " Kept the individually fitted portrait regions.";
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
    const component = extractComponent(form, roots[0].id, true);
    if (scalp) form = keepSourceHairstyle(base, target, component);
    else
      form = placeComponent(base, component, {
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
