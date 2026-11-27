import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { garmentCoverage } from "./coverage-review.js";
import { createCharacter, disposeCharacter } from "./model.js";
import { skinCharacter } from "./skin.js";
import { exportForm } from "./export-form.js";
import { releaseGLTFScenes } from "./release-gltf.js";

import {renderGameExport} from "../packages/character/src/review/exports.ts";
export {compareExportViews} from "../packages/character/src/review/exports.ts";

export async function inspectGameExport(form, renderer, previous) {
  const {bytes,triangles} = await exportForm(form,{game:true,motion:true,wardrobe:false,coverage:Boolean(form.human)});
  const gltf = await new GLTFLoader().parseAsync(bytes,"");
  let source, full;
  try {
    if (form.human && form.outfit !== "Anatomy") {
      source = createCharacter(form,false,false);
      full = skinCharacter(form,source,{coverage:true});
    }
    return renderGameExport(gltf,triangles,form.parts.some(p=>(p.motionRole ?? p.outfitRole ?? p.shape).includes("arm")),renderer,
      model=>garmentCoverage(form,model),full,previous);
  } finally {
    full?.dispose();
    if (source) disposeCharacter(source);
    releaseGLTFScenes(gltf.scenes);
  }
}
