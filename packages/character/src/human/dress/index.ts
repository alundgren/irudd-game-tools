// Clothes cut from the adult's own body: the geometry behind a tailored
// outfit, for the builder and for checks against the reference. Hosts that
// only read or validate an outfit use the plain data in "@irudd/character/human".

export { analyse as dressBody, type DressBody, type DressMesh } from "./kit.js";
export { landmarks as dressLandmarks, type Landmarks } from "./cloth.js";
export {
  tailorHuman,
  tailorParts,
  type Tailored,
  type TailoredMesh,
  type TailoredPart,
  type TailoredParts,
} from "./tailor.js";
export { fittedHair, type FittedHair, type HairStyle } from "./hair.js";
