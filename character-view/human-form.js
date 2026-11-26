import { drawCastSkin } from "./human-cast-wardrobe.js";
import { castDonor, drawCastIdentity } from "./human-cast-looks.js";
import { drawCapturedPortrait } from "./human-captured-portraits.js";
import { portraitAxes, castShapeAxes, humanIdentityAxes, evaluateHuman, humanAxes, humanRange, randomHuman, validHuman } from "./human-surface.js";
import { randomStream } from "./random.js";
import {transportHumanFit} from "./human-fit-frame.js";
import { reseatCreatureLimbs } from "./human-creature-mount.js";
import { drawIdentityMarks } from "./human-face-marks.js";
import { skinLightness } from "./human-identity.js";
import { drawPosture } from "./human-posture.js";

const label = {
  pelvis: "pelvis",
  spine_01: "abdomen",
  spine_02: "rib cage",
  spine_03: "chest",
  neck_01: "neck",
  upperarm: "upper arm",
  lowerarm: "forearm",
  calf: "shin",
  ball: "toes",
  clavicle: "collarbone",
};
export function regionId(name) {
  const side = /_([lr])$/.exec(name);
  if (!side) return label[name] ?? name;
  const base = name.slice(0, -2);
  return (
    (side[1] === "l" ? "left " : "right ") +
    (label[base] ?? base.replace("_0", " "))
  );
}
function role(name) {
  const base = name.replace(/_[lr]$/, "");
  return (
    {
      upperarm: "upper arm",
      lowerarm: "forearm",
      hand: "hand",
      thigh: "thigh",
      calf: "shin",
      foot: "foot",
      head: "head",
      spine_03: "torso",
    }[base] ?? "rigid"
  );
}
function makeParts(surface, color) {
  const bounds = surface.names.map(() => [
    [Infinity, Infinity, Infinity],
    [-Infinity, -Infinity, -Infinity],
  ]);
  for (let v = 0; v < surface.bodyVertices; v++) {
    const k = surface.boneIndices[v * 4],
      b = bounds[k];
    for (let d = 0; d < 3; d++) {
      const x = surface.positions[v * 3 + d] - surface.joints[k * 3 + d];
      b[0][d] = Math.min(b[0][d], x);
      b[1][d] = Math.max(b[1][d], x);
    }
  }
  return surface.names.map((name, i) => {
    const pi = surface.names.indexOf(surface.parents[i]);
    const position = [0, 1, 2].map(
      (d) =>
        surface.joints[i * 3 + d] - (pi < 0 ? 0 : surface.joints[pi * 3 + d]),
    );
    return {
      id: regionId(name),
      shape: "human region",
      humanBone: name,
      motionRole: role(name),
      humanBounds: Number.isFinite(bounds[i][0][0])
        ? bounds[i]
        : [
            [-0.002, -0.002, -0.002],
            [0.002, 0.002, 0.002],
          ],
      ...(pi < 0 ? {} : { parent: regionId(surface.parents[i]) }),
      position,
      size: [1, 1, 1],
      rotation: [0, 0, 0],
      color,
    };
  });
}
export function humanForm(parameters = {}, seed = 0) {
  const draw = randomStream(seed);
  const skin = [
    "#8e5f46",
    "#b08566",
    "#654235",
    "#c69e85",
    "#be8c68",
    "#93755f",
    "#d5ac94",
  ][Math.floor(draw() * 7)];
  return {
    human: { ...parameters },
    origin: { kind: "human surface", seed },
    outfit: "Anatomy",
    appearance: {
      palette: "Clay",
      skin,
      face: 0,
      hairColor: "#45352e",
      hair: "Crop",
    },
    parts: makeParts(evaluateHuman(parameters), skin),
  };
}
export function tintHumanSkin(form, skin, previousSkin = form.appearance.skin) {
  return {
    ...form,
    appearance: { ...form.appearance, skin },
    ...(form.humanStyle?.castSkin ? { humanStyle: { ...form.humanStyle, castSkin: skin } } : {}),
    parts: form.parts.map((p) =>
      p.shape === "human region" && !p.humanSource && p.color === previousSkin
        ? { ...p, color: skin }
        : p,
    ),
  };
}
export const adultColourRanges = ["Mixed", "Natural", "Fantasy"];

const fantasyTones = [
  ["#705069", "#b891b1", "green"],
  ["#415f55", "#a4bb9c", "amber"],
  ["#804e45", "#cb8e79", "hazel"],
  ["#414c6b", "#a0afc9", "grey"],
];

function characterPalette(seed, range) {
  if (!adultColourRanges.includes(range)) throw new Error("Unknown adult colour range.");
  const draw = randomStream(seed ^ 0x76802da3);
  const rare = draw() < .085;
  if (range === "Natural" || (range === "Mixed" && !rare)) return null;
  const [dark, light, eyeColor] = fantasyTones[Math.floor(draw()*fantasyTones.length)];
  const t = .12 + .78*draw();
  const rgb = [1,3,5].map(i => {
    const a = parseInt(dark.slice(i,i+2),16), b = parseInt(light.slice(i,i+2),16);
    return Math.round(a+(b-a)*t).toString(16).padStart(2,"0");
  });
  return {skin: "#" + rgb.join(""), eyeColor, earTip: .48+.46*draw()};
}

export function drawHumanIdentity(seed, archetype, { fitRestingLips = true, colourRange = "Mixed" } = {}) {
  const gesture = randomStream(seed ^ 0xaef228d3);
  const side = gesture() < .5 ? -1 : 1;
  const params = randomHuman(seed, archetype, { fitRestingLips });
  if (gesture() < .2) params[side > 0 ? "leftArmLift" : "rightArmLift"] = .2 + .48*gesture();
  const draw = randomStream(seed ^ 0x2631894b);
  const tones = [[72, 48, 41], [108, 73, 56], [146, 101, 76],
    [177, 132, 105], [206, 166, 139], [231, 198, 177]];
  const { faceA = 0, faceB = 0 } = params;
  const at = skinLightness([Math.exp(2.6 * faceA), Math.exp(2.6 * faceB), 1], draw()) * (tones.length - 1) * 0.9999;
  const i = Math.floor(at);
  const t = at - i;
  const warmth = (draw() * 2 - 1) * 5;
  const undertone = [warmth, 0, -warmth];
  const rgb = tones[i].map((v, channel) =>
    Math.round(v + (tones[i + 1][channel] - v) * t + undertone[channel]));
  const palette = characterPalette(seed, colourRange);
  if (palette) params.earTip = palette.earTip;
  const skin = palette?.skin ?? "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
  const faceMarks = drawIdentityMarks(seed, { skin, age: params.age });
  const personal = randomStream(seed ^ 0xb53042af);
  const humanStyle = {};
  if (personal() < .14) {
    const styles = ["Diving swift", "Fern frond", "Botanical sleeve", "Engraved sleeve", "Cartographic sleeve"];
    humanStyle.armInk = styles[Math.floor(personal() * styles.length)];
  }
  const browDraw = randomStream(seed ^ 0x3ab057ce);
  const shapes = ["Soft taper", "Lifted arch", "Straight", "Feathered", "Feathered", "Fine arch", "Full and brushed", "Untrimmed"];
  const browStyle = shapes[Math.floor(browDraw()*shapes.length)];
  humanStyle.browStyle = browStyle;
  return {
    human: params,
    posture: drawPosture(seed, params),
    appearance: { skin },
    ...(palette ? { eyeColor: palette.eyeColor } : {}),
    humanStyle,
    ...(faceMarks.length ? { faceMarks } : {}),
  };
}
export function generatedHuman(seed, archetype, colourRange = "Mixed") {
  const { human, posture, appearance, humanStyle, faceMarks, eyeColor } = drawHumanIdentity(seed, archetype, { colourRange });
  const cast = drawCastIdentity(human, (seed ^ 0x1e18ae83) >>> 0);
  if (cast) {
    humanStyle.cast = cast;
    if (castDonor(cast)) {
      const vary = randomStream(seed ^ 0xb661e8af);
      humanStyle.castShape = Math.round(vary() * 100) / 100;
      humanStyle.castPigment = Math.round((.65 * humanStyle.castShape + .35 * vary()) * 100) / 100;
    }
  }
  const artist = randomStream(seed ^ 0x620ddbf1);
  const finishes = human.age < .42 ? ["Portrait Rose", "Portrait Honey", "Portrait Fair", "Portrait Umber"] : ["Portrait Ruddy", "Portrait Sunworn"];
  let complexion = human.age < .68 && artist() < .29 ? finishes[Math.floor(artist()*finishes.length)] : null;
  const capture = drawCapturedPortrait(human, randomStream(seed ^ 0x61e3be17));
  if (capture) {
    for (const axis of [...portraitAxes, ...castShapeAxes]) human[axis] = 0;
    for (const axis of humanIdentityAxes) human[axis] *= .55;
    human[capture.axis] = capture.amount;
    complexion = capture.complexion;
    humanStyle.browStyle = "As drawn";
  }
  const form = { ...humanForm(human, seed), posture, humanStyle, ...(complexion ? { complexion } : {}), ...(eyeColor ? { eyeColor } : {}), ...(faceMarks ? { faceMarks } : {}) };
  const tinted = tintHumanSkin(form, appearance.skin);
  if (cast) tinted.humanStyle.castSkin = eyeColor ? appearance.skin : drawCastSkin(cast, appearance.skin, seed);
  return tinted;
}
export function rerollHuman(form, axes, seed, amount = 1) {
  if (!Array.isArray(axes) || !axes.length || !axes.every(key => humanAxes.includes(key)))
    throw new Error("Choose the adult measurements to reroll.");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("An adult reroll needs the editor's variation seed.");
  if (!Number.isFinite(amount) || amount < 0 || amount > 1)
    throw new Error("Reroll amount must be between zero and one.");
  if (!form.human) throw new Error("Choose an editable adult first.");
  const draw = randomHuman(seed, "any", { relaxed: false });
  const next = {};
  for (const key of axes) {
    const current = form.human[key] ?? humanRange(key)[2];
    next[key] = amount === 1 ? draw[key] : current + (draw[key] - current) * amount;
  }
  return amount === 0 ? form : changeHuman(form, next);
}

export function nudgeHuman(form, deltas) {
  if (!form.human || !deltas || typeof deltas !== "object" || Array.isArray(deltas))
    throw new Error("Choose an editable adult and named measurement nudges.");
  const next = {};
  for (const [key, delta] of Object.entries(deltas)) {
    if (!humanAxes.includes(key) || !Number.isFinite(delta))
      throw new Error("Unknown adult measurement or invalid nudge.");
    const [min, max, initial] = humanRange(key);
    next[key] = Math.min(max, Math.max(min, (form.human[key] ?? initial) + delta));
  }
  return changeHuman(form, next);
}
export function changeHuman(form, patch) {
  if (!form.human || !validHuman(patch))
    throw new Error("Choose an editable human and valid shape controls.");
  const next = { ...form.human, ...patch };
  const oldSurface=evaluateHuman(form.human),newSurface=evaluateHuman(next);
  const humanFit=transportHumanFit(form.humanFit,oldSurface,newSurface);
  const oldParts=makeParts(oldSurface,form.appearance.skin);
  const fitted = humanFit || form.humanDetail ? evaluateHuman(next, humanFit, form.humanDetail) : newSurface;
  const newParts=makeParts(fitted,form.appearance.skin);
  return {
    ...form,
    human: next,
    ...(humanFit?{humanFit}:{}),
    parts: (form.parts.some(p => p.scapulaMount) ? reseatCreatureLimbs(
      form.parts, form.humanFit || form.humanDetail ? evaluateHuman(form.human, form.humanFit, form.humanDetail) : oldSurface, fitted,
    ) : form.parts).map((p) => {
      if (p.shape !== "human region" || p.humanSource) return p;
      const index = oldParts.findIndex((row) => row.humanBone === p.humanBone);
      const old = oldParts[index],
        fresh = newParts[index];
      return {
        ...p,
        humanBounds: fresh.humanBounds,
        position: p.position.map(
          (x, i) => x + fresh.position[i] - old.position[i],
        ),
      };
    }),
  };
}
