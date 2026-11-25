import { castTops, castBottoms, castSkin, wornCastOutfit } from "./human-cast-wardrobe.js";
import { castDonor, wornCast } from "./human-cast-looks.js";
import { capturedTitles } from "./human-captured-portraits.js";
import { castShapeTitles, humanRange } from "./human-surface.js";
import { adultStyles, chooseAdultStyle, dressHuman } from "./human-wardrobe.js";
import { complexionNames } from "./human-complexion.js";
import { eyeColorNames, defaultEyeColor } from "./human-face.js";
import { tintHumanSkin, changeHuman, rerollHuman } from "./human-form.js";
import { attachCreatureLimbs, adultWingStructures } from "./human-creature-mount.js";
import { faceMarksEditor } from "./human-face-marks-editor.js";
import { lookDirections } from "./human-looks.js";
import { hatColour } from "./human-hats.js";
import { palette, toneFields } from "./human-style.js";
import { nativePortraitEditor } from "./native-portrait-editor.js";
import { postureEditor } from "./human-posture-editor.js";
import { studioHeadCarries, studioHeadHolds, studioHeadNoteFor, studioHeadPresets, wearsStudioHead } from "./human-studio-head.js";
const groups = {
  Limbs: {
    stance: "Arm rest angle",
    armForward: "Shoulder pitch",
    armLead: "Leading arm",
    leftArmLift: "Left arm lift",
    rightArmLift: "Right arm lift",
    footLead: "Leading foot",
    elbowBend: "Elbow bend",
    handTwist: "Hand rotation",
    wristFlex: "Wrist bend",
    fingerCurl: "Finger curl",
    legSpread: "Standing width",
    upperArmLength: "Upper arm length",
    forearmLength: "Forearm length",
    shinLength: "Shin length",
    torsoLength: "Torso length",
    neckLength: "Neck length",
    hands: "Hand size",
    feet: "Foot size",
  },
  Body: {
    height: "Stature",
    frame: "Frame",
    age: "Adult age",
    weight: "Body mass",
    muscle: "Muscle",
    bust: "Bust",
    chest: "Rib cage",
    shoulders: "Shoulders",
    waist: "Waist",
    hips: "Hips",
    belly: "Abdomen",
    abdominalApron: "Lower belly fullness",
    seat: "Seat",
    legs: "Leg length",
    arms: "Upper arms",
    calves: "Calves",
    neck: "Neck",
    shoulderLine: "Neck-to-shoulder fullness",
    upperBack: "Upper back fullness",
    stance: "Arm rest angle",
  },
  "Portrait foundations": {
    portraitSiyanda: "Siyanda",
    portraitHideko: "Hideko",
    portraitTom: "Tom",
    portraitCorine: "Corine",
    portraitEveryman: "Everyman",
    portraitDivorcee: "The Divorcee",
    portraitViking: "Viking",
    ...castShapeTitles,
    ...capturedTitles,
  },
  Face: {
    headWidth: "Head width",
    craniumDepth: "Back of skull",
    faceHeight: "Head height",
    noseTipAngle: "Nose tip angle",
    noseTipWidth: "Nose tip width",
    nostrilWidth: "Nostril width",
    earLevel: "Ear height on the skull",
    earSetback: "Ear position front to back",
    earLength: "Ear length",
    jaw: "Jaw",
    chin: "Chin projection",
    chinHeight: "Chin height",
    jawProjection: "Lower face projection",
    forehead: "Forehead height",
    temples: "Temple width",
    cheeks: "Cheekbones",
    cheekFullness: "Cheek fullness",
    malarHeight: "Upper cheek height",
    jowlFullness: "Lower cheek fullness",
    submentalFullness: "Under-chin fullness",
    nose: "Nose width",
    noseBridge: "Nose projection",
    lips: "Mouth width",
    lipFullness: "Lip fullness",
    lipBalance: "Upper versus lower lip fullness",
    smileLeft: "Left resting smile",
    smileRight: "Right resting smile",
    smileOpenness: "Smile opening",
    smileBias: "Smile asymmetry",
    upperLipHeight: "Upper lip height",
    cupidsBow: "Cupid’s bow",
    mouthCorners: "Mouth corner height",
    mouthProjection: "Mouth projection",
    lipParting: "Lip parting",
    mouthLevel: "Mouth height on face",
    noseLength: "Nose length",
    noseHump: "Bridge curve",
    underEye: "Lower lid fullness",
    eyeSize: "Eye size",
    eyeSpacing: "Eye spacing",
    eyeTilt: "Outer eye angle",
    eyeFold: "Lid fold",
    brow: "Brow height",
    ears: "Ear size",
    earTip: "Ear tip",
    earFlare: "Ear flare",
    faceA: "Face blend A",
    faceB: "Face blend B",
    faceRound: "Outline: long to round",
    faceSquare: "Outline: oval to square",
    faceTaper: "Outline: wide jaw to wide brow",
    faceDiamond: "Outline: diamond",
    faceFlesh: "Face fullness",
    jawAngle: "Jaw corners",
    jawDrop: "Jaw corner height",
    chinPoint: "Chin taper",
    chinCleft: "Chin cleft",
    orbitalRim: "Upper orbital rim",
    zygomaticArch: "Cheekbone arch",
    lidDefinition: "Upper lid crease",
    earDefinition: "Ear cartilage detail",
    alarCrease: "Nostril wing crease",
    orbitCreases: "Outer eye lines",
    foreheadCreases: "Forehead furrows",
    mouthCreases: "Cheek and mouth folds",
    nasolabialFold: "Nose-to-mouth fold",
    cheekHollow: "Cheek hollow",
    lidBag: "Lower lid bag",
    noseVolume: "Nose fullness",
    noseCurve: "Nose profile: scooped to hooked",
    noseRoot: "Nose root depth",
    noseBridgeWidth: "Bridge width",
    nostrilFlare: "Nostril flare",
    noseBase: "Nose base height",
    noseHeight: "Nose height on face",
    eyeOpening: "Eye opening",
    eyeInner: "Inner lid height",
    eyeOuter: "Outer lid height",
    eyeDepth: "Eye depth",
    eyeLevel: "Eye height on face",
    epicanthus: "Inner eye fold",
    browAngle: "Brow slant",
    browRidge: "Brow ridge",
    foreheadSlope: "Forehead slope",
    mouthHeight: "Lip height",
    jawSkew: "Jaw lean",
    noseSkew: "Nose lean",
    mouthSkew: "Mouth lean",
    eyeSkew: "Eye unevenness",
    browSkew: "Brow unevenness",
    cheekSkew: "Cheek unevenness",
  },
};
// The name each shape control carries in this editor.
export const humanControlNames = Object.assign({}, ...Object.values(groups));
export function humanEditor(read, commit) {
  const el = (id) => document.getElementById(id),
    wrap = el("human-controls"),
    group = el("human-group"),
    parameter = el("human-parameter"),
    slider = el("human-delta");
  const options = () =>
    parameter.replaceChildren(
      ...Object.entries(groups[group.value]).map(([k, v]) => new Option(v, k)),
    );
  options();
  group.onchange = () => {
    options();
    reset();
  };
  parameter.onchange = () => reset();
  function reset() {
    slider.value = 0;
    describe();
  }
  function describe() {
    const form = read();
    if (!form.human) return;
    const key = parameter.value,
      [min, max, def] = humanRange(key);
    const current = form.human[key] ?? def,
      delta =
        (Number(slider.value) / 100) *
        (key === "height" ? 0.3 : key === "age" ? 0.5 : 1);
    const next = Math.min(max, Math.max(min, current + delta));
    const value = (x) =>
      key === "height" ? Math.round(x * 100) + " cm" : x.toFixed(2);
    el("human-reading").textContent =
      value(current) + (delta ? " → " + value(next) : "");
    return next;
  }
  slider.oninput = describe;
  el("human-apply").onclick = () => {
    const next = describe();
    if (next === undefined || !Number(slider.value)) return;
    slider.value = 0;
    commit(
      changeHuman(read(), { [parameter.value]: next }),
      "Shape nudge applied.",
    );
  };
  el("human-roll").onclick = () => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    slider.value = 0;
    commit(rerollHuman(read(), Object.keys(groups[group.value]), seed), group.value + " rerolled.");
  };
  const originalIris = new Option("Source eye colour", "");
  el("human-iris").replaceChildren(
    originalIris,
    ...eyeColorNames.map((x) => new Option(x[0].toUpperCase() + x.slice(1), x)),
  );
  el("human-complexion").replaceChildren(
    new Option("Follow age", ""),
    ...complexionNames.map((x) => new Option(x, x)),
  );
  el("human-complexion").onchange = () => {
    const f = { ...read() };
    if (el("human-complexion").value)
      f.complexion = el("human-complexion").value;
    else delete f.complexion;
    commit(f, "Facial detail applied.");
  };
  el("human-dress-toggle").onclick = () => {
    const f = read(),
      show = f.outfit === "Anatomy",
      selected = f.humanStyle?.outfit;
    const outfit = show
      ? selected === "Pressure suit"
        ? "Pressure suit"
        : "Work clothes"
      : "Anatomy";
    const next =
      show && (!selected || selected === "None")
        ? { ...f, humanStyle: { ...f.humanStyle, outfit: "T-shirt and jeans" } }
        : f;
    commit(
      { ...next, outfit },
      show ? "Current outfit shown." : "Base shape shown.",
    );
    document
      .querySelector(show ? '[data-mode="Color"]' : '[data-mode="Clay"]')
      .click();
  };
  // A new look may be asked to lean one way. Each roll is one step of history, so Undo brings the last look back.
  const direction = document.createElement("select");
  direction.id = "human-look-direction";
  direction.replaceChildren(...lookDirections.map((name) => new Option(name === "Any" ? "Any kind of look" : name, name)));
  const directionLabel = document.createElement("label");
  directionLabel.className = "field";
  directionLabel.append("New looks lean", direction);
  el("human-look-roll").before(directionLabel);
  el("human-look-roll").onclick = () => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    commit(dressHuman(read(), seed, direction.value), "Outfit and hairstyle applied.");
    document.querySelector('[data-mode="Color"]').click();
  };
  const styleFields = {};
  for (const [key, title] of Object.entries({
    cast: "Character artwork",
    castTop: "Authored top",
    castBottom: "Authored bottom",
    castShape: "Authored face shape",
    castPigment: "Authored face colour",
    faceFamily: "Face family",
    faceFamilyHair: "Family hair",
    hair: "Hairstyle",
    fringe: "Fringe",
    facePlanes: "Facial plane shading",
    browStyle: "Eyebrows",
    facialHair: "Facial hair",
    makeup: "Makeup",
    armInk: "Arm tattoo",
    eyewear: "Eyewear",
    earrings: "Earrings",
    necklace: "Necklace",
    waistBag: "Waist bag",
    handProp: "Hand prop",
    hat: "Hat",
    hatColor: "Hat colour",
    outfit: "Clothing",
    hairColor: "Hair colour",
    clothColor: "Cloth tint",
    clothDesign: "Cloth design",
    clothAccent: "Print colour",
    secondDesign: "Second piece design",
    clothSecond: "Second cloth",
    clothLight: "Pale cloth",
    accentColor: "Accent piece",
    leatherColor: "Leather",
    soleColor: "Soles",
    metalColor: "Buckles and buttons",
  })) {
    const select = Boolean(adultStyles[key]),
      input = document.createElement(select ? "select" : "input");
    input.id = "adult-" + key;
    if (select)
      input.replaceChildren(...adultStyles[key].map((x) => new Option(x, x)));
    else if (key === "castShape" || key === "castPigment") {
      input.type = "range"; input.min = "0"; input.max = "1"; input.step = ".01";
    } else input.type = "color";
    const label = document.createElement("label");
    label.className = "field";
    label.append(title, input);
    el("human-styling").append(label);
    styleFields[key] = input;
    input.onchange = () => {
      const current = read(),
        humanStyle = chooseAdultStyle(current.humanStyle, { [key]: input.type === "range" ? input.valueAsNumber : input.value });
      const outfit =
        key === "outfit"
          ? input.value === "None"
            ? "Anatomy"
            : "Work clothes"
          : key === "cast" && input.value !== "None" ? "Work clothes" : current.outfit;
      commit({ ...current, humanStyle, outfit }, title + " applied.");
    };
  }
  // A face family draws some choices itself. Say which, and hold those fields while it is worn.
  const familyNote = document.createElement("p");
  familyNote.className = "micro";
  styleFields.faceFamilyHair.parentElement.after(familyNote);
  const familyPreset = document.createElement("button");
  familyPreset.textContent = "Start a Studio Rain person";
  familyPreset.title = "Sets the face family with the build, skin, hair and eye colour its artist drew it for. Clothing is kept.";
  familyPreset.onclick = () => {
    const preset = studioHeadPresets["Studio Rain"], shaped = tintHumanSkin(changeHuman(read(), preset.human), preset.skin);
    commit({ ...shaped, eyeColor: preset.eyeColor, humanStyle: chooseAdultStyle(shaped.humanStyle, preset.humanStyle) }, "Studio Rain person ready. Every control still applies.");
    document.querySelector('[data-mode="Color"]').click();
  };
  familyNote.after(familyPreset);
  const wingStructure = document.createElement("select");
  wingStructure.replaceChildren(...adultWingStructures.map(name => new Option(
    { bat: "Bat", feather: "Feathered", insect: "Insect" }[name], name,
  )));
  wingStructure.value = "feather";
  const wingLabel = document.createElement("label");
  wingLabel.className = "field";
  wingLabel.append("Wing structure", wingStructure);
  const attachWings = document.createElement("button");
  attachWings.textContent = "Grow paired wings";
  attachWings.onclick = () => {
    try {
      commit(attachCreatureLimbs(read(), { wing: { structure: wingStructure.value } }), "Paired wings attached.");
    } catch (error) {
      el("status").textContent = error.message;
    }
  };
  el("human-styling").append(wingLabel, attachWings);
  const updateNativePortrait = nativePortraitEditor(el("human-styling"), read, commit);
  const updatePosture = postureEditor(wrap, el("human-styling").closest("details"), read, commit);
  const showFaceMarks = faceMarksEditor(styleFields.eyewear.parentElement, read, commit);
  const sourceSkin = document.createElement("button");
  sourceSkin.type = "button";
  sourceSkin.textContent = "Restore source skin tone";
  el("human-skin").closest("label").after(sourceSkin);
  sourceSkin.onclick = () => {
    const form = read(), tone = castSkin(wornCast(form));
    if (tone) commit({ ...form, humanStyle: { ...form.humanStyle, castSkin: tone } }, "Source skin tone restored.");
  };
  el("human-skin").onchange = () => {
    const form = read(),
      skin = el("human-skin").value;
    const tinted = wornCast(form) ? { ...form, humanStyle: { ...form.humanStyle, castSkin: skin } } : tintHumanSkin(form, skin);
    commit(tinted, "Skin tone applied.");
  };
  el("human-iris").onchange = () => {
    const form = {...read()}, value = el("human-iris").value;
    if (value) form.eyeColor = value;
    else delete form.eyeColor;
    commit(form, "Eye colour applied.");
  };
  return (form, locked) => {
    wrap.hidden = !form.human;
    for (const item of wrap.querySelectorAll("input,select,button"))
      item.disabled = locked;
    if (form.human) {
      updateNativePortrait(form);
      updatePosture(form);
      el("human-dress-toggle").textContent =
        form.outfit === "Anatomy" ? "Show current outfit" : "Show base shape";
      describe();
      const cast = wornCast(form);
      el("human-skin").value = (cast && form.humanStyle.castSkin) || form.appearance.skin;
      sourceSkin.hidden = !cast;
      el("human-complexion").value = form.complexion ?? "";
      for (const [key, input] of Object.entries(styleFields))
        input.value =
          form.humanStyle?.[key] ??
          {
            hair: "None",
            fringe: "As cut",
            cast: "None", castShape: 0, castPigment: 0,
            faceFamily: "None",
            faceFamilyHair: "Family",
            facePlanes: "None",
            earrings: "None",
            necklace: "None",
            waistBag: "None",
            handProp: "None",
            hat: "None",
            hatColor: hatColour(form.humanStyle),
            facialHair: "None",
            makeup: "None",
            armInk: "None",
            eyewear: "None",
            outfit: "None",
            hairColor: form.appearance.hairColor,
            clothColor: "#ffffff",
            clothDesign: "Plain cloth",
            clothAccent: "#dfd0ae",
            secondDesign: "Plain cloth",
            // A tone the style does not name shows the one its cloth colour gives.
            ...Object.fromEntries(Object.entries(toneFields).map(([field, tone]) => [field, palette(form.humanStyle)[tone]])),
          }[key];
      familyNote.hidden = !wearsStudioHead(form);
      familyNote.textContent = studioHeadNoteFor(form);
      styleFields.faceFamilyHair.disabled = locked || !wearsStudioHead(form);
      const held = studioHeadHolds(form);
      for (const key of studioHeadCarries) {
        styleFields[key].disabled = locked || held.includes(key);
        styleFields[key].title = held.includes(key) ? "Drawn by the face family. Choose Face family: None to use this." : "";
      }
      const outfit = wornCastOutfit(cast, form.humanStyle);
      for (const [key, options] of [["castTop", castTops(cast)], ["castBottom", castBottoms(cast, outfit?.castTop)]]) {
        const field = styleFields[key];
        field.parentElement.hidden = !outfit;
        field.replaceChildren(...options.map(name => new Option(name, name)));
        if (outfit) field.value = outfit[key];
        field.disabled = locked || options.length < 2;
      }
      for (const key of ["castShape","castPigment"])
        styleFields[key].parentElement.hidden = !castDonor(cast);
      if (cast) {
        familyNote.hidden = false;
        familyNote.textContent = "Character artwork supplies the face, hair and clothing. Skin tone, eye colour, body measurements, posture and expressions apply. Select None under Character artwork to use the individual styling controls.";
        for (const [key, input] of Object.entries(styleFields)) if (!["cast", "castShape", "castPigment", "castTop", "castBottom"].includes(key)) input.disabled = true;
        el("human-complexion").disabled = true;
      }
      originalIris.hidden = !cast;
      el("human-iris").value = form.eyeColor ?? (cast ? "" : defaultEyeColor(form));
      showFaceMarks(form, locked);
    }
  };
}
