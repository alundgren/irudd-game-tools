import { costumeStudies } from "./costume-studies.js";
import { humanForm } from "../character-view/human-form.js";
import { applyOperations } from "../character-view/variations.js";
import tidalProposal from "./tidal-naturalist.proposal.json" with { type: "json" };

const descriptors = [
  [
    "adult-f1",
    "Compact, strong adult",
    {
      height: 1.54,
      frame: -0.86,
      weight: 0.2,
      muscle: 0.8,
      bust: -0.38,
      shoulders: 0.35,
      legs: -0.56,
      faceA: 0.9,
      eyeSize: -0.45,
      cheeks: 0.68,
      jaw: 0.31,
    },
  ],
  [
    "adult-f2",
    "Tall, angular adult",
    {
      height: 1.84,
      frame: -0.74,
      weight: -0.65,
      muscle: 0.07,
      bust: -0.18,
      legs: 0.64,
      faceB: 0.86,
      noseBridge: 0.58,
      lips: -0.48,
      cheeks: 0.6,
      chin: 0.52,
    },
  ],
  [
    "adult-f3",
    "Fuller, older adult",
    {
      height: 1.67,
      frame: -0.94,
      age: 0.83,
      weight: 0.82,
      muscle: -0.35,
      bust: 0.4,
      hips: 0.31,
      belly: 0.4,
      faceA: -0.82,
      faceB: -0.7,
      jaw: -0.33,
      nose: 0.42,
    },
  ],
  [
    "adult-m1",
    "Broad, sturdy adult",
    {
      height: 1.71,
      frame: 0.95,
      weight: 0.66,
      muscle: 0.77,
      legs: -0.26,
      neck: 0.55,
      shoulders: 0.45,
      jaw: 0.75,
      faceA: 0.56,
      nose: 0.52,
      headWidth: 0.43,
    },
  ],
  [
    "adult-m2",
    "Tall, lean adult",
    {
      height: 1.96,
      frame: 0.76,
      weight: -0.75,
      muscle: 0.08,
      legs: 0.64,
      chest: -0.44,
      faceB: -0.72,
      faceA: -0.81,
      chin: 0.67,
      noseBridge: 0.71,
      eyeSize: -0.32,
    },
  ],
  [
    "adult-m3",
    "Compact older adult",
    {
      height: 1.58,
      frame: 0.83,
      weight: 0.21,
      age: 0.91,
      muscle: -0.45,
      waist: 0.59,
      legs: -0.4,
      faceB: 0.89,
      jaw: -0.5,
      nose: 0.42,
      ears: 0.45,
    },
  ],
  [
    "adult-neutral",
    "Androgynous adult",
    {
      height: 1.73,
      frame: 0,
      weight: -0.2,
      muscle: 0.18,
      bust: -0.13,
      faceB: 0.72,
      cheeks: 0.4,
      jaw: -0.2,
    },
  ],
];
const shapes = descriptors.map(([id, title, parameters], i) => ({
  id,
  title,
  game: "Adult shapes",
  source: "https://github.com/naver/anny",
  mode: "Clay",
  angle: "Front",
  make: () =>
    humanForm(
      {
        stance: 0.98,
        armForward: -0.12,
        elbowBend: -0.49,
        wristFlex: 0.44,
        fingerCurl: 0.3,
        ...parameters,
      },
      401 + i,
    ),
}));
const looks = [
  [
    "field-mechanic",
    "Field mechanic",
    "Workshop overalls",
    "Crown braid",
    "#362926",
    "#ac7859",
  ],
  [
    "gallery-host",
    "Gallery host",
    "Tailored suit",
    "Swept crop",
    "#4b3933",
    "#bd9279",
  ],
  [
    "archive-director",
    "Archive director",
    "Striped blouse and skirt",
    "Bun",
    "#a9a4a0",
    "#896755",
  ],
  [
    "field-engineer",
    "Field engineer",
    "Field jacket and denim",
    "Coiled crop",
    "#362923",
    "#714f3b",
  ],
  [
    "orchard-keeper",
    "Orchard keeper",
    "Workshop overalls",
    "Swept crop",
    "#744e38",
    "#d0ab90",
  ],
  [
    "night-archivist",
    "Night archivist",
    "Tailored suit",
    "Rounded bob",
    "#77716c",
    "#9a7560",
    "Swept left",
  ],
  [
    "studio-assistant",
    "Studio assistant",
    "Field jacket and denim",
    "Crown braid",
    "#302b32",
    "#9d7260",
  ],
];
// Fits to private reference bodies and heads. Both are empty in a fresh checkout.
import { workshopFits, headFits } from "./local-references.js";
const scannedHead = headFits["lee-perry-smith"];

export const humanStudies = [
  ...(!scannedHead ? [] : [{
    id: "lee-perry-smith", title: "Lee Perry-Smith · editable head", game: "3D reference fits",
    mode: "Clay", angle: "Portrait", source: "https://www.triplegangers.com/",
    make: () => ({
      ...humanForm({height: 1.72, ...scannedHead.human}, 1776),
      humanFit: structuredClone(scannedHead.humanFit), referenceRigs: [scannedHead.target],
    }),
  }]),
  ...Object.entries(workshopFits?.fits ?? {}).map(([key,{human,humanFit}])=>({
    id:"mhr-"+key,title:"MHR "+key.toUpperCase()+" · editable fit",game:"3D reference fits",mode:"Clay",angle:"Front",
    source:"https://github.com/facebookresearch/MHR",make:()=>({
      ...humanForm({...human},1776),humanFit:structuredClone(humanFit),referenceRigs:["mhr-"+key],
    }),
  })),
  ...shapes,
  ...costumeStudies,
  ...looks.map(([id, title, outfit, hair, hairColor, skin, fringe], i) => ({
    id,
    title,
    game: "Styled adults",
    mode: "Color",
    angle: "Portrait",
    make: () => {
      const form = shapes[i].make();
      return {
        ...form,
        outfit: "Work clothes",
        humanStyle: { outfit, hair, hairColor, ...(fringe ? { fringe } : {}) },
        appearance: { ...form.appearance, skin, hairColor },
        parts: form.parts.map((p) => ({ ...p, color: skin })),
      };
    },
  })),
];
humanStudies.push({
  id:"expedition-suit",title:"Field engineer · pressure suit",game:"Styled adults",mode:"Color",angle:"Portrait",
  make:()=>{
    const form=humanStudies.find(study=>study.id==="field-engineer").make();
    return {...form,outfit:"Pressure suit",humanStyle:{...form.humanStyle,outfit:"Pressure suit",clothColor:"#536d71"}};
  },
});
humanStudies.push({
  id: "tidal-naturalist",
  title: "Tide-pool naturalist",
  game: "AI variations",
  angle: "3/4",
  mode: "Color",
  make: () =>
    applyOperations(
      humanStudies.find((study) => study.id === "field-engineer").make(),
      tidalProposal.operations,
      {},
      true,
    ),
});
