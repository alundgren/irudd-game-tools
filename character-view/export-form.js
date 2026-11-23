import { Scene } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { createCharacter, disposeCharacter } from "./model.js";
import { prepareExpressions } from "./expressions.js";
import { skinCharacter } from "./skin.js";
import { optimizeForGame, gameTriangleTarget } from "./game-export.js";
import { wearOutfit } from "./outfit-sets.js";

export async function exportForm(
  form,
  { wardrobe, motion, game, progress, atlasSize = 1024 },
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
        false,
        game ? Math.floor(0.4 * gameTriangleTarget) : 0,
      );
      const entry = { scene, source };
      entries.push(entry);
      if (name !== null) {
        scene.name = name;
        scene.userData.outfitName = name;
      }
      if (motion) {
        entry.rig = skinCharacter(look, source);
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
      if (game) entry.game = await optimizeForGame(scene, { size: atlasSize });
    }
    const clips = entries.map((e) => e.rig?.clips ?? []);
    const bytes = await new GLTFExporter().parseAsync(
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
