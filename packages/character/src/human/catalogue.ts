export const boneNames = [
  "ball_l",
  "ball_r",
  "calf_l",
  "calf_r",
  "clavicle_l",
  "clavicle_r",
  "foot_l",
  "foot_r",
  "hand_l",
  "hand_r",
  "head",
  "index_01_l",
  "index_01_r",
  "index_02_l",
  "index_02_r",
  "index_03_l",
  "index_03_r",
  "lowerarm_l",
  "lowerarm_r",
  "middle_01_l",
  "middle_01_r",
  "middle_02_l",
  "middle_02_r",
  "middle_03_l",
  "middle_03_r",
  "neck_01",
  "pelvis",
  "pinky_01_l",
  "pinky_01_r",
  "pinky_02_l",
  "pinky_02_r",
  "pinky_03_l",
  "pinky_03_r",
  "ring_01_l",
  "ring_01_r",
  "ring_02_l",
  "ring_02_r",
  "ring_03_l",
  "ring_03_r",
  "spine_01",
  "spine_02",
  "spine_03",
  "thigh_l",
  "thigh_r",
  "thumb_01_l",
  "thumb_01_r",
  "thumb_02_l",
  "thumb_02_r",
  "thumb_03_l",
  "thumb_03_r",
  "upperarm_l",
  "upperarm_r",
] as const;
export type BoneName = (typeof boneNames)[number];

export const boneParents: ReadonlyArray<BoneName | "Root"> = [
  "foot_l",
  "foot_r",
  "thigh_l",
  "thigh_r",
  "spine_03",
  "spine_03",
  "calf_l",
  "calf_r",
  "lowerarm_l",
  "lowerarm_r",
  "neck_01",
  "hand_l",
  "hand_r",
  "index_01_l",
  "index_01_r",
  "index_02_l",
  "index_02_r",
  "upperarm_l",
  "upperarm_r",
  "hand_l",
  "hand_r",
  "middle_01_l",
  "middle_01_r",
  "middle_02_l",
  "middle_02_r",
  "spine_03",
  "Root",
  "hand_l",
  "hand_r",
  "pinky_01_l",
  "pinky_01_r",
  "pinky_02_l",
  "pinky_02_r",
  "hand_l",
  "hand_r",
  "ring_01_l",
  "ring_01_r",
  "ring_02_l",
  "ring_02_r",
  "pelvis",
  "spine_01",
  "spine_02",
  "pelvis",
  "pelvis",
  "hand_l",
  "hand_r",
  "thumb_01_l",
  "thumb_01_r",
  "thumb_02_l",
  "thumb_02_r",
  "clavicle_l",
  "clavicle_r",
];

export const surfaceVertices = 17596;
export const bodyVertices = 13380;
export const bodyTriangles = 26756;
export const packedVertices = surfaceVertices + boneNames.length;

export const bodyAxes = [
  "shoulders",
  "waist",
  "hips",
  "belly",
  "chest",
  "legs",
  "neck",
  "jaw",
  "nose",
  "noseBridge",
  "cheeks",
  "lips",
  "chin",
  "jawProjection",
  "chinHeight",
  "forehead",
  "temples",
  "noseLength",
  "noseTipWidth",
  "nostrilWidth",
  "craniumDepth",
  "faceHeight",
  "noseHump",
  "lipFullness",
  "upperLipHeight",
  "cupidsBow",
  "underEye",
  "headWidth",
  "eyeSize",
  "brow",
  "ears",
  "seat",
  "arms",
  "calves",
  "upperArmLength",
  "forearmLength",
  "shinLength",
  "torsoLength",
  "neckLength",
  "bust",
  "mouthCorners",
  "mouthProjection",
  "mouthLevel",
  "noseTipAngle",
  "lipParting",
  "lipBalance",
  "smileLeft",
  "smileRight",
  "eyeSpacing",
  "eyeTilt",
  "eyeFold",
  "earTip",
  "earLevel",
  "earSetback",
  "earLength",
  "earFlare",
  "cheekFullness",
  "hands",
  "feet",
  "malarHeight",
  "jowlFullness",
  "submentalFullness",
] as const;

export const identityAxes = [
  "faceTaper",
  "faceRound",
  "faceSquare",
  "faceDiamond",
  "faceFlesh",
  "nasolabialFold",
  "cheekHollow",
  "lidBag",
  "jawAngle",
  "jawDrop",
  "chinCleft",
  "chinPoint",
  "noseVolume",
  "noseCurve",
  "noseRoot",
  "noseBridgeWidth",
  "nostrilFlare",
  "noseBase",
  "noseHeight",
  "eyeOpening",
  "eyeInner",
  "eyeOuter",
  "eyeDepth",
  "eyeLevel",
  "epicanthus",
  "browAngle",
  "browRidge",
  "foreheadSlope",
  "mouthHeight",
  "jawSkew",
  "noseSkew",
  "mouthSkew",
  "eyeSkew",
  "browSkew",
  "cheekSkew",
] as const;

export const sculptAxes = [
  "lidDefinition",
  "earDefinition",
  "alarCrease",
  "orbitCreases",
  "foreheadCreases",
  "mouthCreases",
] as const;

export interface Credit {
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly url: string;
}

export const sculptSources: ReadonlyArray<Credit> = [
  {
    title: "realistic eyelids",
    author: "jujube",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/370/real_eyelids1.target",
  },
  {
    title: "eye outer corner crease",
    author: "jujube",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/370/eye_corner_crease.target",
  },
  {
    title: "Ear details",
    author: "Mindfront",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/1422/Ear_details.target",
  },
  {
    title: "ear canal",
    author: "jujube",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/370/ear_canal.target",
  },
  {
    title: "Nose alar crease",
    author: "Mindfront",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/1422/Nose_alar_crease.target",
  },
  {
    title: "Elvs Crowsfeet 1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_crowsfeet1b.target",
  },
  {
    title: "Elvs Eye bags1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_eyebags1a.target",
  },
  {
    title: "Elvs Eye wrinkle extension1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_eyewrinkle_extension1.target",
  },
  {
    title: "Elvs Forehead wrinkles1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_forhead_wrinkles1.target",
  },
  {
    title: "Elvs Brow Frown Line1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_browfrownline1.target",
  },
  {
    title: "Elvs Marionette marks1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_marionette_marks1.target",
  },
  {
    title: "Elvs Nasolabial Fold1",
    author: "Elvaerwyn",
    license: "CC0",
    url: "http://files.makehumancommunity.org/sites/default/files/targets/2512/elvs_nasolabial_fold1.target",
  },
];

export interface FieldLayout {
  readonly origin: readonly [number, number, number];
  readonly shape: readonly [number, number, number];
  readonly pitch: number;
  readonly anchor: readonly [number, number, number];
}

export const portraitAxes = [
  "portraitSiyanda",
  "portraitHideko",
  "portraitTom",
  "portraitCorine",
  "portraitEveryman",
  "portraitDivorcee",
  "portraitViking",
] as const;
export const portraitLayout: FieldLayout = {
  origin: [-0.12, 0.528, -0.072],
  shape: [21, 31, 24],
  pitch: 0.012,
  anchor: [0.0, 0.6974949836730957, 0.016075000166893005],
};
export const portraitCredits: Readonly<Record<(typeof portraitAxes)[number], Credit>> = {
  portraitSiyanda: {
    title: "Siyanda",
    author: "filous77",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/1753/Siyanda_def.mhm",
  },
  portraitHideko: {
    title: "Sasano Hideko",
    author: "viscaeleus",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/2401/Sasano%20Hideko.mhm",
  },
  portraitTom: {
    title: "Tom The politician",
    author: "dragonhamster",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/3964/tom.mhm",
  },
  portraitCorine: {
    title: "Corine regular girl",
    author: "dragonhamster",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/3964/corine.mhm",
  },
  portraitEveryman: {
    title: "Averagedude",
    author: "dragonhamster",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/3964/averagedude.mhm",
  },
  portraitDivorcee: {
    title: "The Divorcee",
    author: "TonyFlanagan",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/1242/The%20Divorcee_male.mhm",
  },
  portraitViking: {
    title: "Viking Project",
    author: "RehmanPolanski",
    license: "CC0",
    url: "https://files.makehumancommunity.org/sites/default/files/models/536/Viking.mhm",
  },
};

export const castShapeAxes = [
  "castM03",
  "castM04",
  "castM05",
  "castM12",
  "castM14",
  "castM16",
] as const;
export const castShapeLayout: FieldLayout = {
  origin: [-0.08290973938049129, -0.0955266631303232, 0.028923332138856242],
  shape: [29, 37, 20],
  pitch: 0.006,
  anchor: [0, 0, 0],
};
export const rocketboxCredit = {
  library: "Microsoft Rocketbox Avatar Library",
  license: "MIT",
  copyright: "Copyright (c) 2020 Microsoft",
  commit: "0943055db6ec570bcef9f2c8b41c9e5467c808f9",
} as const;

export const capturedAxes = [
  "scan0023",
  "scan0028",
  "scan0102",
  "scan0040",
  "scan0042",
  "scan0112",
  "scan0015",
  "scan0027",
  "scan0081",
] as const;
export type CapturedAxis = (typeof capturedAxes)[number];
export const capturedSources: Readonly<Record<CapturedAxis, string>> = {
  scan0023: "HSR0023-Body-017",
  scan0028: "HSR0028-Body-058",
  scan0102: "HSR0102-Body-052",
  scan0040: "HSR0040-Body-004",
  scan0042: "HSR0042-Body-018",
  scan0112: "HSR0112-Body-036",
  scan0015: "HSR0015-Body-054",
  scan0027: "HSR0027-Body-053",
  scan0081: "HSR0081-Body-074",
};
export const captureCredit = {
  title: "HSRD-100: 100 High-Quality 3D Human Scans Dataset",
  author: "Digital Reality Lab",
  year: 2025,
  source:
    "https://huggingface.co/datasets/digitalrealitylab/HSRD-100/tree/9cc5e9c138dd310dc88c95c80e5db0a3ecb7971a",
  license: "https://creativecommons.org/licenses/by/4.0/",
  changes:
    "Registered face and iris photographs and fitted facial measurements to the editable adult mesh.",
} as const;

export const expressionNames = [
  "Blink",
  "BroadSmile",
  "BrowLift",
  "ReservedSmile",
  "Smile",
] as const;

export const ancestryFamilies = ["african", "asian", "caucasian"] as const;
export const sexes = ["female", "male"] as const;
export const stages = ["young", "old"] as const;
export const buildMorphs: ReadonlyArray<string> = sexes.flatMap((sex) =>
  stages.flatMap((stage) =>
    (["min", "average", "max"] as const).flatMap((m) =>
      (["min", "average", "max"] as const)
        .filter((w) => m !== "average" || w !== "average")
        .map((w) => `${sex}-${stage}-${m}muscle-${w}weight`),
    ),
  ),
);
export const ancestryMorphs: ReadonlyArray<string> = ancestryFamilies.flatMap((family) =>
  sexes.flatMap((sex) => stages.map((stage) => `${family}-${sex}-${stage}`)),
);

export interface CastPerson {
  readonly subject: string;
  readonly rig: "female" | "male";
  readonly age: number | undefined;
  readonly donor: string | undefined;
  readonly tone: readonly [number, number, number];
}

export const castPeople: Readonly<Record<string, CastPerson>> = {
  Gardener: {
    subject: "Professions/Gardener_Male_01",
    rig: "male",
    age: 0.7,
    donor: "Adults/Male_Adult_01",
    tone: [0.55834, 0.283149, 0.181164],
  },
  "Cropped jacket": {
    subject: "Adults/Female_Adult_04",
    rig: "female",
    age: undefined,
    donor: "Adults/Female_Adult_08",
    tone: [0.617207, 0.304987, 0.187821],
  },
  "Striped polo": {
    subject: "Adults/Male_Adult_01",
    rig: "male",
    age: 0.35,
    donor: undefined,
    tone: [0.533276, 0.283149, 0.181164],
  },
  "Pink shirt": {
    subject: "Adults/Female_Adult_01",
    rig: "female",
    age: 0.3,
    donor: undefined,
    tone: [0.603827, 0.313989, 0.191202],
  },
  "Grey tee": {
    subject: "Adults/Female_Adult_08",
    rig: "female",
    age: 0.3,
    donor: undefined,
    tone: [0.564712, 0.291771, 0.171441],
  },
  "Denim jacket": {
    subject: "Adults/Female_Adult_13",
    rig: "female",
    age: 0.3,
    donor: undefined,
    tone: [0.539479, 0.258183, 0.141263],
  },
  "Blue shirt": {
    subject: "Adults/Male_Adult_08",
    rig: "male",
    age: 0.35,
    donor: undefined,
    tone: [0.533276, 0.258183, 0.147027],
  },
  "Long tunic": {
    subject: "Adults/Male_Adult_15",
    rig: "male",
    age: 0.35,
    donor: "Adults/Male_Adult_01",
    tone: [0.381326, 0.171441, 0.07036],
  },
};
export const castNames = Object.keys(castPeople);
