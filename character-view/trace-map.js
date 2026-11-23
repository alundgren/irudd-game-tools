import { startingForm, validateForm, motionRoles } from "./recipe.js";
import { outfitRoles } from "./wardrobe.js";
import { bindParts } from "./rig.js";
import { traceOutline, traceHull, tracePath } from "./turnaround.js";

function polygon(points) {
  if (
    !Array.isArray(points) ||
    points.length > 64 ||
    (points.length > 0 && points.length < 3) ||
    !points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
    )
  )
    throw new Error(
      "Use 3 to 64 normalized points per outline, or an empty full-view outline.",
    );
  return points;
}
export function buildTraceMap(
  map,
  atlas,
  height = map.height,
  { missed } = {},
) {
  if (
    map?.format !== "irudd.trace-map.v1" ||
    !Array.isArray(map.regions) ||
    !map.regions.length ||
    map.regions.length > 48 ||
    !Number.isFinite(height) ||
    height < 0.15 ||
    height > 6
  )
    throw new Error(
      "Choose a trace map with 1 to 48 regions and height between 0.15 and 6 metres.",
    );
  const ids = new Set(map.regions.map((r) => r.id));
  if (ids.size !== map.regions.length)
    throw new Error("Trace region IDs must be unique.");
  const form = startingForm(() => 0.5);
  form.parts = [];
  const links = Object.create(null),
    parents = new Map(map.regions.map((r) => [r.id, r.parent]));
  for (const r of map.regions) {
    if (
      typeof r.id !== "string" ||
      !r.id.trim() ||
      r.id.length > 64 ||
      !["volume", "loft", "path", "membrane"].includes(r.method)
    )
      throw new Error(
        "Each region needs a name and a supported reconstruction method.",
      );
    if (r.parent && !ids.has(r.parent))
      throw new Error("Unknown parent for " + r.id + ".");
    if (
      (r.motionRole && !motionRoles.includes(r.motionRole)) ||
      (r.outfitRole && !outfitRoles.includes(r.outfitRole))
    )
      throw new Error("Unknown role on " + r.id + ".");
    let part;
    try {
      if (r.method === "path") part = tracePath(r.id, atlas, height, r.spine);
      else
        part = (r.method !== "loft" ? traceHull : traceOutline)(
          r.id,
          atlas,
          height,
          [polygon(r.front), polygon(r.side)],
        );
      if (r.method === "membrane") {
        if (!["same", "opposite"].includes(r.correspondence))
          throw new Error(
            "Choose same or opposite edge correspondence in the two pictures.",
          );
        part.hull.membrane = {
          slope: r.correspondence === "same" ? -1 : 1,
          thickness: r.thickness ?? 0.016,
        };
      }
    } catch (error) {
      if (!missed || !r.parent) throw new Error(r.id + ": " + error.message);
      missed.push(r.id);
      continue;
    }
    if (r.parent) links[r.id] = r.parent;
    if (r.outfitRole) part.outfitRole = r.outfitRole;
    if (r.motionRole) part.motionRole = r.motionRole;
    form.parts.push(part);
  }
  if (missed?.length) {
    const included = new Set(form.parts.map((p) => p.id));
    for (const id of Object.keys(links)) {
      const seen = new Set();
      let parent = links[id];
      while (parent && !included.has(parent)) {
        if (seen.has(parent)) throw new Error("Cycle in the part map.");
        seen.add(parent);
        parent = parents.get(parent);
      }
      if (parent) links[id] = parent;
      else delete links[id];
    }
  }
  return validateForm(bindParts(form, links));
}
