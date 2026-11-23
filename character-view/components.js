import { buildFigure, randomFigure } from "./figure.js";
import { bodyRegion } from "./blended-skin.js";
import { markingKinds } from "./markings.js";
import { palmColor } from "./turnaround.js";
import { extractComponent, placeComponent, fitHand } from "./graft.js";
import { paintedStudies } from "../examples/painted-studies.js";
import { studies } from "../examples/studies.js";
import { generateForm, randomStream } from "./generator.js";

const gallery = [...studies, ...paintedStudies];
const entries = [
  [
    "foreman-face",
    "Broad bespectacled head",
    "painted-surveyor",
    "head and neck",
    false,
  ],
  ["relay-face", "Short dark bob", "painted-courier", "head and neck", false],
  [
    "reed-head",
    "Long billed reptilian head",
    "painted-trader",
    "long billed head",
    false,
  ],
  [
    "reed-arm",
    "Reptilian grasping arm",
    "painted-trader",
    "left outer upper arm",
    true,
  ],
  [
    "coast-face",
    "Weathered human head",
    "painted-ranger",
    "head and neck",
    false,
  ],
  [
    "conductor-face",
    "Swept silver head",
    "painted-elder",
    "head and neck",
    false,
  ],
  ["plate-mask", "Armored beak", "painted-porter", "beaked mask", false],
  ["arched-muzzle", "Long green muzzle", "merchant", "long muzzle", false],
  ["pleated-skirt", "Pleated long skirt", "painted-elder", "full skirt", false],
  [
    "cartographer-sleeve",
    "Field sleeve and hand",
    "painted-ranger",
    "left upper sleeve",
    true,
  ],
  [
    "clawed-arm",
    "Armored forearm and talons",
    "painted-porter",
    "left forearm",
    true,
  ],
  ["organic-hand", "Articulated hand", "painted-ranger", "left hand", false],
  [
    "dorsal-plate",
    "Convex bone plate",
    "painted-porter",
    "dorsal scute 3/2",
    false,
  ],
];
let cached;
export function componentShelf() {
  if (cached) return cached;
  const built = new Map();
  const items = entries.map(([key, title, study, id, tree]) => {
    if (!built.has(study))
      built.set(study, gallery.find((s) => s.id === study).make());
    return { key, title, ...extractComponent(built.get(study), id, tree) };
  });
  cached = Object.fromEntries(items.map((item) => [item.key, item]));
  return cached;
}
export function generateWorkshopForm(
  kind = "any",
  seed = crypto.getRandomValues(new Uint32Array(1))[0],
) {
  const draw = randomStream(seed),
    pick = (arr) => arr[Math.floor(draw() * arr.length)];
  const anatomy =
    kind === "any" ? pick(["human", "human", "creature", "hybrid"]) : kind;
  const shelf = componentShelf();
  let form;
  if (anatomy === "figure") {
    form = buildFigure(randomFigure(draw));
    if (draw() < 0.8)
      form = placeComponent(
        form,
        shelf[
          pick(["coast-face", "conductor-face", "foreman-face", "relay-face"])
        ],
        { target: "head" },
      ).form;
    // A painted head brings its own complexion. Carry it to the bare body.
    const tone = form.parts.find((p) => p.id === "head")?.color;
    if (/^#[0-9a-f]{6}$/i.test(tone ?? ""))
      form.parts = form.parts.map((p) =>
        p.bare || p.shape === "hand" ? { ...p, color: tone } : p,
      );
    form.origin = { ...form.origin, seed };
    return form;
  }
  if (anatomy === "human") {
    const body = pick([
      "painted-ranger",
      "painted-elder",
      "painted-surveyor",
      "painted-courier",
      "modular",
      "modular",
    ]);
    form =
      body === "modular"
        ? generateForm("human", seed)
        : paintedStudies.find((s) => s.id === body).make();
    const target = form.parts.find(
      (p) => p.shape === "head" || p.anatomy === "face",
    ).id;
    if (draw() < 0.78)
      form = placeComponent(
        form,
        shelf[
          pick(["coast-face", "conductor-face", "foreman-face", "relay-face"])
        ],
        { target },
      ).form;
    form.outfit = pick([
      "Work clothes",
      "Work clothes",
      "Base layer",
      "Pressure suit",
    ]);
    const face = form.parts.find((p) => p.id === target);
    face.sculpt = {
      ...face.sculpt,
      jaw: 0.66 + draw() * 0.84,
      nose: 0.59 + draw() * 0.97,
      eyes: 0.74 + draw() * 0.51,
      chin: 0.65 + draw() * 0.76,
      cheek: 0.67 + draw() * 0.69,
    };
    form.build = {
      mass: 0.65 + draw() * 0.89,
      shoulders: 0.72 + draw() * 0.6,
      waist: 0.64 + draw() * 0.79,
      hips: 0.71 + draw() * 0.65,
    };
  } else {
    form = generateForm("creature", seed);
    if (anatomy === "hybrid") {
      const component =
        shelf[
          pick([
            "coast-face",
            "conductor-face",
            "foreman-face",
            "relay-face",
            "reed-head",
            "plate-mask",
          ])
        ];
      form = placeComponent(form, component, {
        target: "head",
        mode: "replaceBranch",
      }).form;
      const limb = form.parts.find((p) => p.outfitRole === "thigh");
      if (limb && form.parts.length < 116 && draw() < 0.7)
        form = placeComponent(form, shelf["clawed-arm"], {
          target: limb.id,
          mode: "attach",
          fit: true,
          socket: "front",
        }).form;
    }
  }
  if (anatomy === "human")
    for (const hand of form.parts.filter(
      (p) => p.outfitRole === "hand" && p.shape === "sweep",
    ))
      form = fitHand(form, hand.id, palmColor(hand, form.appearance.skin));
  if (anatomy !== "human" && draw() < 0.72) {
    const markings = {
      kind: pick(markingKinds),
      color: pick(["#e6bd7c", "#2f4241", "#dbc6b6", "#9e6650", "#60746d"]),
      spacing: 0.12 + draw() * 0.3,
      coverage: 0.29 + draw() * 0.37,
      angle: Math.round(-40 + draw() * 80),
      seed: Math.floor(draw() * 4294967296),
    };
    form.parts = form.parts.map((p) =>
      bodyRegion(p) ? { ...p, markings } : p,
    );
  }
  form.origin = { generator: 4, seed, kind: anatomy };
  return form;
}
