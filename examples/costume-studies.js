import { humanForm, tintHumanSkin } from "../character-view/human-form.js";
import runnerPortrait from "./runner-portrait.json" with { type: "json" };
import wardenPortrait from "./warden-portrait.json" with { type: "json" };
import { setNativePortrait } from "../character-view/native-portrait.js";
import { faceMark } from "../character-view/human-face-marks.js";

// Four characters directed with the same controls and pieces as an artist uses.
// Each keeps its face, clothing, silhouette and expression editable independently.
// How each of them stands and walks, on the posture controls of the adult panel.
const postures = {
  "salt-road-warden": { style: "Planted", weight: -0.3, hip: 0.3, slouch: -0.2, shoulders: -0.15, arms: 0.9, elbows: 0.4, hands: 0.55, feet: 0.4, toes: 0.5, headTurn: 0.2, chin: -0.1, stride: 0.2, swing: 0 },
  "dock-assessor": { style: "Sway-back", handAtWaist: 1, weight: 0.35, hip: 0.3, lean: -0.6, slouch: 0.35, hands: 0.6, feet: 0.3, toes: 0.55, headTilt: -0.15, chin: 0.1, stride: -0.3, swing: 0.15 },
  "tidal-contralto": { style: "Poised", weight: -0.7, hip: 0.5, slouch: -0.4, twist: 0.2, elbows: 0.4, hands: 0.4, feet: -0.3, toes: 0.35, step: 0.4, headTilt: -0.2, headTurn: -0.2, chin: 0.2, stride: -0.1, swing: -0.2 },
  "tramline-runner": { style: "Hip-shot", weight: 0.9, hip: 0.85, twist: 0.2, shoulders: 0.25, hands: 0.6, feet: 0.05, toes: 0.5, step: 0.45, headTilt: 0.25, headTurn: -0.2, stride: 0.6, swing: 0.6 },
};
function character(id, title, seed, skin, eyeColor, anatomy, style, marks, portrait) {
  return {
    id, title, game: "Character designs", mode: "Color", angle: "3/4",
    make() {
      const form = tintHumanSkin(humanForm({
        stance: .94, elbowBend: -.38, fingerCurl: .28, wristFlex: .32, ...anatomy,
      }, seed), skin);
      const dressed = {
        ...form, outfit: "Work clothes", eyeColor,
        ...(id === "salt-road-warden" ? { complexion: "Weathered scars" } : {}),
        ...(postures[id] ? { posture: { ...postures[id] } } : {}),
        humanStyle: structuredClone(style),
        faceMarks: marks.map(([kind, settings], index) => faceMark(kind, seed + index, settings)),
      };
      return portrait ? setNativePortrait(dressed, portrait) : dressed;
    },
  };
}

export const costumeStudies = [
  character("salt-road-warden", "Salt-road warden", 1701, "#aa8069", "grey", {
    orbitalRim: 1, zygomaticArch: .96, portraitViking: .92, malarHeight: .94, cheekFullness: -.35, eyeOpening: -.43, eyeSkew: .3,
    lidDefinition: .76, earDefinition: .82, alarCrease: .93, orbitCreases: .68, foreheadCreases: .72, mouthCreases: .51,
    leftArmLift: .43, legSpread: .38, footLead: .46, armLead: -.4, smileOpenness: -.74, smileBias: -.64, height: 1.89, frame: .78, muscle: .43, age: .38, shoulders: .51,
    faceHeight: .47, faceTaper: .25, chinHeight: .29, faceDiamond: .68, headWidth: -.39, brow: -.46, browAngle: -.58, browRidge: .91, eyeDepth: -.61, eyeSize: .22, noseHump: .7,
    noseLength: .60, jawAngle: .84, lipFullness: -.64, mouthHeight: -.25, cheekHollow: .72, nasolabialFold: .56,
    smileRight: -.12, smileLeft: .06, mouthProjection: -.26,
  }, {
    browStyle: "Untrimmed", hair: "Low ponytail", hairColor: "#bcb2a3", fringe: "Off the face", facialHair: "Short beard",
    earrings: "Single ear pendant", metalColor: "#a98a50", outfit: "None", facePlanes: "Sculpted",
    armour: { look: "Light fantasy", seed: 72, pieces: {
      top: { material: "mail", color: "#434039", collar: "none" },
      travellingMantle: { color: "#353e4c", trim: "#85816c", shoulder: "right", length: .71 },
      cuirass: { device: "Reed heron", material: "leather", color: "#493a32", trim: "#9c8260", build: "segmented", collar: "mail standard" },
      pauldrons: { balance: "left only", color: "#747b76", trim: "#ac9058", lames: 3 },
      armguards: { color: "#4a3731", material: "leather" },
    } },
  }, [["Scar", {place: "Across the eye", side: "Right", strength: .94, size: .93, turn: 6}], ["Sun spots", {strength: .42}]], wardenPortrait),
  character("dock-assessor", "Dock assessor", 1717, "#c9a58a", "brown", {
    orbitalRim: .56, zygomaticArch: .26, portraitDivorcee: .48,
    lidDefinition: .54, earDefinition: .84, alarCrease: .64, orbitCreases: .95, foreheadCreases: .86, mouthCreases: .89,
    rightArmLift: .32, footLead: -.28, armLead: .26, smileOpenness: -.41, smileBias: .38, height: 1.54, frame: .54, age: .87, weight: 1, muscle: -.97, chest: .83, bust: .57,
    waist: 1, hips: .63, belly: .87, abdominalApron: 1, upperBack: .6, shoulderLine: .37, legs: -.57,
    smileLeft: .12, smileRight: -.05, cheekFullness: .62,
    submentalFullness: .92, jowlFullness: .94, faceRound: .78, chinHeight: -.58, noseVolume: .85, eyeOpening: -.35,
    noseTipWidth: .63, browRidge: .26, ears: .46,
  }, {
    outfit: "Striped shirt and jeans", waistBag: "Dispatch folio", browStyle: "Full and brushed", hair: "Horseshoe crop", hairColor: "#817c71", fringe: "As cut",
    eyewear: "Square acetate", facialHair: "Moustache", clothColor: "#65746a", clothSecond: "#3d5060",
    clothLight: "#d6ccad", accentColor: "#875945", leatherColor: "#564235", metalColor: "#a18b60",
  }, [["Sun spots", {place: "Temples", size: .72, strength: .77}], ["Beauty mark", {side: "Left", place: "Cheek"}]]),
  character("tidal-contralto", "Tidal contralto", 1723, "#ad87b2", "green", {
    orbitalRim: .42, zygomaticArch: .61, portraitSiyanda: .65,
    lidDefinition: .57, earDefinition: .61, alarCrease: .67, orbitCreases: .47, foreheadCreases: .38, mouthCreases: .44,
    leftArmLift: .83, rightArmLift: .24, footLead: -.55, armLead: .7, smileOpenness: .65, smileBias: .12, armForward: .1, height: 1.73, frame: -.75, age: .59, weight: .93, muscle: -.78, hips: .94, bust: .71,
    chest: .62, waist: .66, belly: .56, abdominalApron: .48, upperBack: .33,
    smileLeft: .21, smileRight: .30,
    faceTaper: -.5, cheeks: .68, chinPoint: .46, eyeTilt: .45, eyeSize: .32, lipFullness: .76,
    brow: .53, noseTipAngle: .31,
  }, {
    outfit: "Evening gown", handProp: "Painted folding fan", makeup: "Plum stage", browStyle: "Fine arch", hair: "Tied bun", hairColor: "#d3cbd0", fringe: "Off the face",
    clothColor: "#392637", clothSecond: "#67385a", clothLight: "#cebfa0", accentColor: "#99744d",
    clothDesign: "Scallop brocade", clothAccent: "#a77d98", earrings: "Sea fan ear cuffs", necklace: "Fan collar", metalColor: "#c1a161",
    leatherColor: "#4a363e",
  }, [["Eyeliner", {place: "Winged", size: .94, strength: .96}], ["Beauty mark", {place: "Above lip", side: "Left", size: .59}]]),
  character("tramline-runner", "Tramline runner", 1751, "#bd8e76", "dark brown", {
    orbitalRim: .24, zygomaticArch: .72, portraitHideko: .94,
    lidDefinition: .68, earDefinition: .71, alarCrease: .46, orbitCreases: .14, foreheadCreases: .09, mouthCreases: .12,
    rightArmLift: .67, leftArmLift: .12, legSpread: .16, footLead: .86, armLead: -.82, smileOpenness: .24, smileBias: -.35, height: 1.64, frame: -.62, weight: -.53, muscle: .61, legs: .47, bust: -.43,
    faceDiamond: .5, malarHeight: .57, headWidth: -.17, eyeFold: -.48, eyeTilt: .31,
    noseBridge: -.43, lipFullness: .18, chinPoint: .42,
  }, {
    outfit: "Track top and leggings", waistBag: "Running belt", armInk: "Cartographic sleeve", browStyle: "Straight", hair: "Sleek bob", hairColor: "#222128", fringe: "Swept left",
    clothColor: "#293039", clothSecond: "#c4c6c3", accentColor: "#bf482c", clothLight: "#dad7c9",
    earrings: "Pearl studs", metalColor: "#9e9c98", leatherColor: "#5b433e",
  }, [["Paint streaks", {side: "Left", place: "Under eye", size: .68, strength: .84, tone: "#7d3029"}]], runnerPortrait),
];
