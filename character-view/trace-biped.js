import { startingForm } from "./recipe.js";
import { bindParts } from "./rig.js";
import { silhouetteRuns, traceRegion } from "./turnaround.js";

import { bipedTracks } from "../packages/character/src/paint/biped-tracks.ts";

export function traceBiped(atlas, height) {
  const form = startingForm(() => 0.5);
  const links = {};
  form.parts = bipedTracks((view,h)=>silhouetteRuns(atlas,view,h)).map(({id,role,parent,track,options})=>{
    const part = traceRegion(id, atlas, height, track, null, options);
    part.outfitRole = role;
    if (role === "head") part.anatomy = "face";
    if (parent) links[id] = parent;
    return part;
  });
  return bindParts(form,links);
}
