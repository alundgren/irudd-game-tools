import { creditedCaptures, captureCredit } from "./human-captured-portraits.js";
import { wearsCastShape } from "./human-surface.js";
import { rocketboxLicense, rocketboxSource } from "./human-rocketbox-credit.js";
import { fieldClothes } from "./human-field-outfits.js";
import { scannedClothes, scannedCredit } from "./human-scanned-tops.js";
import { productionStyles } from "./human-production-hair.js";
import { Scene } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createCharacter, disposeCharacter } from "./model.js";
import { prepareExpressions } from "./expressions.js";
import { skinCharacter } from "./skin.js";
import { optimizeForGame, gameTriangleTarget } from "./game-export.js";
import { wearOutfit } from "./outfit-sets.js";
import { studioCreditFor } from "./human-studio-head.js";
import { scanHairCredit, scanHairSource } from "./human-scan-hair.js";

import { castSources, wornCast } from "./human-cast-looks.js";

export async function exportForm(
  form,
  { wardrobe, motion, game, clay = false, progress, atlasSize = 1024, coverage = false, contact = true },
) {
  const looks = wardrobe ? form.outfitSets?.map((s) => s.name) : [null];
  if (!looks?.length)
    throw new Error("Save an outfit before exporting the wardrobe.");
  const entries = [];
  try {
    for (const [index, name] of looks.entries()) {
      if (progress) await progress(name, index, looks.length);
      const look = name === null ? form : wearOutfit(form, name);
      const scene = new Scene();
      const source = createCharacter(
        look,
        false,
        clay,
        game ? Math.floor(0.4 * gameTriangleTarget) : 0,
      );
      const entry = { scene, source, look };
      entries.push(entry);
      if (name !== null) {
        scene.name = name;
        scene.userData.outfitName = name;
      }
      if (motion) {
        entry.rig = skinCharacter(look, source, { coverage });
        if (wardrobe) {
          // Importers need a distinct, non-joint parent for each skeleton.
          entry.rig.actor.name = name + " rig";
          scene.add(entry.rig.actor);
          // A skinned mesh uses its joints’ world transforms in glTF.
          scene.add(...entry.rig.actor.children.filter((o) => o.isMesh));
        } else scene.add(...entry.rig.actor.children);
      } else {
        prepareExpressions(source);
        scene.add(source);
      }
      if (game) entry.game = await optimizeForGame(scene, { size: atlasSize, contact });
    }
    const clips = entries.map((e) => e.rig?.clips ?? []);
    const exporter=new GLTFExporter();
    if (form.human || form.humanSources || form.referenceRigs?.length) {
      exporter.register(writer=>({afterParse() {
        const credits=[];
        if(form.human || form.humanSources)credits.push("Adult base and selected assets from the MakeHuman community, CC0 1.0.");
        if (form.referenceRigs?.length) {
          const extras = { referenceRigs: form.referenceRigs };
          if (form.referenceRigs.some(id => id.startsWith("mhr-"))) {
            credits.push("Surface measurements derived from Momentum Human Rig v1.0.1, Meta Platforms, Inc. and affiliates, Apache-2.0. Modified by fitting the editable character.");
            extras.license = typeof WORKSHOP_MHR_LICENSE === "string" ? WORKSHOP_MHR_LICENSE : "https://www.apache.org/licenses/LICENSE-2.0";
          }
          if (form.referenceRigs.includes("lee-perry-smith")) {
            const credit = "Infinite, 3D Head Scan by Lee Perry-Smith (www.triplegangers.com, www.ir-ltd.net), CC BY 3.0 Unported. Modified by fitting editable facial geometry.";
            credits.push(credit);
            extras.headScan = {credit, source: "https://github.com/mrdoob/three.js/tree/r187/examples/models/gltf/LeePerrySmith", license: "https://creativecommons.org/licenses/by/3.0/"};
          }
          writer.json.asset.extras = extras;
        }
        const creditedLooks = entries.flatMap(({look}) => [look, ...Object.values(look.humanSources ?? {})]);
        const nativeLooks = creditedLooks.filter(look => !wornCast(look));
        // A cast body still follows source-derived measurements. Only the native route wears
        // the saved native hair, complexion maps and wardrobe.
        const captureSources = [...new Set(creditedLooks.flatMap(look =>
          creditedCaptures(wornCast(look) ? {human: look.human} : look)))];
        if (captureSources.length) {
          const { title, author, year, license, source, changes } = captureCredit;
          credits.push(title + ", " + author + " (" + year + "), CC BY 4.0. " + changes + " " + source + " " + license);
          writer.json.asset.extras = { ...writer.json.asset.extras, capturedPortraits: { ...captureCredit, scans: captureSources } };
        }
        const usesEinar = source => source?.humanStyle?.hat === "Ribbed watch cap" || source?.humanStyle?.outfit === "Weathered field coat" || source?.complexion === "Weathered scars"
          || scannedClothes[source?.humanStyle?.outfit]?.some(garment => garment.startsWith("einar_"));
        if (nativeLooks.some(usesEinar)) {
          credits.push("Einar Rig (CC-BY) Blender Foundation | studio.blender.org. Adapted for editable characters. https://studio.blender.org/characters/einar/v1/ | https://creativecommons.org/licenses/by/4.0/");
        }
        if (nativeLooks.some(look => Object.hasOwn(scannedClothes, look.humanStyle?.outfit))) credits.push(scannedCredit);
        const cast = [...new Set(creditedLooks.flatMap(castSources))];
        const usesRocketbox = look => wearsCastShape(look.human)
          || Object.hasOwn(fieldClothes, look.humanStyle?.outfit)
          || productionStyles.includes(look.humanStyle?.hair)
          || look.complexion?.startsWith("Portrait ")
          || ["Stubble", "Clipped beard"].includes(look.humanStyle?.facialHair);
        if (cast.length || creditedLooks.some(usesRocketbox)) {
          credits.push("Character artwork adapted from the Microsoft Rocketbox Avatar Library. Copyright (c) 2020 Microsoft, MIT.");
          writer.json.asset.extras = {...writer.json.asset.extras, rocketbox: {source: rocketboxSource, license: rocketboxLicense, ...(cast.length ? {avatars: cast} : {})}};
        }
        const shaved = source => source?.complexion === "Shaved complexion" ||
          (source?.complexion == null && source?.humanStyle?.facialHair === "Stubble");
        if (nativeLooks.some(shaved)) {
          credits.push("Infinite, 3D Head Scan by Lee Perry-Smith, based on work at www.triplegangers.com. Colour, normal and specular maps adapted to the editable skin. CC BY 3.0 Unported. https://creativecommons.org/licenses/by/3.0/");
        }
        const studio = nativeLooks.map(studioCreditFor).find(Boolean);
        if (studio) {
          const { name, credit, source, license, changes } = studio;
          credits.push(credit + ", CC BY 4.0. " + changes + " " + source + " " + license);
          writer.json.asset.extras = { ...writer.json.asset.extras, [name === "Studio Rain" ? "faceFamily" : "studioHair"]: { name, credit, source, license, changes } };
        }
        const scans = [...new Set(nativeLooks.map((look) => scanHairSource(look?.humanStyle)).filter(Boolean))];
        if (scans.length) {
          const { credit, source, license, revision, changes } = scanHairCredit;
          credits.push(credit + ", CC BY 4.0. Scan " + scans.join(", ") + ". " + changes + " " + source + " " + license);
          writer.json.asset.extras = { ...writer.json.asset.extras, scanHair: { scans, credit, source, revision, license, changes } };
        }
        writer.json.asset.copyright=credits.join(" ");
      }}));
    }
    const bytes = await exporter.parseAsync(
      entries.map((e) => e.scene),
      {
        binary: true,
        animations: entries.length === 1 ? clips[0] : clips,
      },
    );
    return {
      bytes,
      looks: entries.length,
      triangles: entries[0].game?.triangles,
    };
  } finally {
    for (const { source, scene, rig, game } of entries) {
      if (rig) rig.actor.add(...scene.children.filter((o) => o !== rig.actor));
      game?.dispose();
      rig?.dispose();
      disposeCharacter(source);
    }
  }
}
