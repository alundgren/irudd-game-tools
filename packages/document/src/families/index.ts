import type { FeatureDefinition } from "../registry.js";
import { characterAppearance, characterOrigin } from "./appearance.js";
import { figureCage } from "./cage.js";
import { creatureBlend, creatureSkin } from "./creature.js";
import { creaturePlan } from "./creature-plan.js";
import { creatureCoatZone, creatureEyeSurface, figureUndercoat } from "./creature-coat.js";
import { figureWing } from "./wing.js";
import { creatureLimbChain, creatureOrgan } from "./creature-organ.js";
import { motionOffer } from "./motion-offer.js";
import { figureNativePortrait, figureScapulaMount } from "./human.js";
import {
  figureAssembly,
  figureBuild,
  figureFinish,
  figureMarkings,
  figureScute,
  figureSweep,
} from "./figure.js";
import { motionHold, motionPoses, motionRole } from "./motion.js";
import { figureHand } from "./hand.js";
import { figureHull } from "./hull.js";
import { figureJoin } from "./join.js";
import { figureFoot, figurePulls, figureSeam } from "./seam.js";
import { figureOccluders, figurePaint } from "./paint.js";
import { outfitFit, outfitLayers, outfitLooks, outfitWardrobe, outfitWear } from "./outfit.js";
import { figureAnatomy } from "./anatomy.js";
import { figureMantle } from "./mantle.js";
import { figureGroom } from "./groom.js";
import { figurePiece, figureSculpt } from "./piece.js";
import { figureFibres } from "./fibres.js";
import { figureHairCap, figurePortraitDepth } from "./portrait.js";
import { figureHornSwatch, figurePlateField, figurePlateSite } from "./plates.js";
import {
  figureEyes,
  figureFaceAnchor,
  figureFrontFit,
  figureHeadLayer,
  figureProfileFit,
} from "./head-fit.js";

export * from "./family.js";
export * from "./figure.js";
export * from "./cage.js";
export * from "./motion.js";
export * from "./outfit.js";
export * from "./creature.js";
export * from "./appearance.js";
export * from "./paint.js";
export * from "./hull.js";
export * from "./hand.js";
export * from "./join.js";
export * from "./seam.js";
export * from "./anatomy.js";
export * from "./mantle.js";
export * from "./groom.js";
export * from "./piece.js";
export * from "./head-fit.js";
export * from "./fibres.js";
export * from "./portrait.js";
export * from "./plates.js";
export * from "./figure-recipe.js";
export * from "./creature-plan.js";
export * from "./creature-coat.js";
export * from "./wing.js";
export * from "./creature-organ.js";
export * from "./motion-offer.js";
export * from "./human.js";

export const familyFeatures: ReadonlyArray<FeatureDefinition> = [
  figureAssembly.definition,
  figureSweep.definition,
  figureFinish.definition,
  figureScute.definition,
  figureCage.definition,
  figureMarkings.definition,
  figureBuild.definition,
  figurePaint.definition,
  figureOccluders.definition,
  figureHull.definition,
  figureHand.definition,
  figureJoin.definition,
  figureSeam.definition,
  figurePulls.definition,
  figureFoot.definition,
  motionRole.definition,
  motionPoses.definition,
  motionHold.definition,
  outfitWardrobe.definition,
  outfitWear.definition,
  outfitFit.definition,
  outfitLayers.definition,
  outfitLooks.definition,
  figureAnatomy.definition,
  figureMantle.definition,
  figureGroom.definition,
  figurePiece.definition,
  figureSculpt.definition,
  figureFrontFit.definition,
  figureProfileFit.definition,
  figureHeadLayer.definition,
  figureFaceAnchor.definition,
  figureEyes.definition,
  figureFibres.definition,
  figurePortraitDepth.definition,
  figureHairCap.definition,
  figurePlateField.definition,
  figurePlateSite.definition,
  figureHornSwatch.definition,
  creatureBlend.definition,
  creatureSkin.definition,
  creaturePlan.definition,
  figureUndercoat.definition,
  creatureCoatZone.definition,
  creatureEyeSurface.definition,
  figureWing.definition,
  creatureOrgan.definition,
  creatureLimbChain.definition,
  motionOffer.definition,
  figureScapulaMount.definition,
  figureNativePortrait.definition,
  characterAppearance.definition,
  characterOrigin.definition,
];
