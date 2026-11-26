import { buildFigure } from "../character-view/figure.js";
import { fitHand } from "../character-view/graft.js";
import { eyeDefaults } from "../character-view/ocular.js";
import {
  paintSources,
  retainPaintSources,
} from "../character-view/paint-sources.js";
import { traceBiped } from "../character-view/trace-biped.js";
import { startingForm } from "../character-view/recipe.js";
import { bindParts } from "../character-view/rig.js";
import { repeatOnSpine } from "../character-view/scutes.js";
import { traceRegion } from "../character-view/turnaround.js";

function tracedForm(atlas, height) {
  const form = startingForm(() => 0.5);
  form.parts = [];
  const links = {};
  function add(id, rows, parent, options) {
    form.parts.push(traceRegion(id, atlas, height, rows, null, options));
    if (parent) links[id] = parent;
  }
  function pair(id, rows, parent, options) {
    for (const sign of [-1, 1]) {
      const side = sign === 1 ? "left " : "right ";
      const mirrored = rows.map(([y, l, r, b, f]) => [
        y,
        sign === 1 ? l : -r,
        sign === 1 ? r : -l,
        b,
        f,
      ]);
      add(
        side + id,
        mirrored,
        parent?.startsWith("@") ? side + parent.slice(1) : parent,
        options,
      );
    }
  }
  return { add, pair, finish: () => bindParts(form, links) };
}
function trader() {
  const { add, pair, finish } = tracedForm("trader", 1.81);
  add("coat and thorax", [
    [0.43, -0.105, 0.105, -0.042, 0.14],
    [0.52, -0.1, 0.1, -0.024, 0.139],
    [0.62, -0.094, 0.094, -0.022, 0.13],
    [0.7, -0.11, 0.11, -0.031, 0.114],
    [0.759, -0.073, 0.073, -0.039, 0.106],
    [0.798, -0.038, 0.038, -0.01, 0.08],
  ]);
  add(
    "long billed head",
    [
      [0.753, -0.041, 0.041, -0.018, 0.1],
      [0.81, -0.06, 0.06, -0.034, 0.13],
      [0.85, -0.097, 0.097, -0.102, 0.21],
      [0.885, -0.125, 0.125, -0.094, 0.21],
      [0.927, -0.12, 0.12, -0.091, 0.155],
      [0.958, -0.106, 0.106, -0.1, 0.09],
      [0.998, -0.09, 0.09, -0.095, 0.075],
    ],
    "coat and thorax",
    { samples: 44, profile: 0.68 },
  );
  add(
    "split riding coat",
    [
      [0.16, -0.175, 0.175, -0.077, 0.153],
      [0.22, -0.19, 0.19, -0.1, 0.16],
      [0.32, -0.165, 0.165, -0.083, 0.154],
      [0.44, -0.13, 0.13, -0.049, 0.15],
      [0.53, -0.1, 0.1, -0.025, 0.14],
    ],
    "coat and thorax",
    { pivot: "top" },
  );
  add(
    "trailing tail",
    [
      [0.179, -0.035, 0.035, -0.14, -0.035],
      [0.205, -0.034, 0.034, -0.21, -0.064],
      [0.233, -0.041, 0.041, -0.213, -0.107],
      [0.269, -0.04, 0.04, -0.174, -0.073],
      [0.33, -0.048, 0.048, -0.099, -0.04],
      [0.409, -0.052, 0.052, -0.063, 0.018],
    ],
    "coat and thorax",
    { pivot: "top" },
  );
  pair(
    "long leg",
    [
      [0.033, 0.045, 0.098, -0.003, 0.084],
      [0.14, 0.02, 0.104, -0.01, 0.086],
      [0.26, 0.012, 0.104, -0.004, 0.098],
      [0.38, 0.016, 0.095, 0.001, 0.101],
      [0.47, 0.015, 0.085, 0.005, 0.1],
    ],
    "coat and thorax",
    { pivot: "top" },
  );
  pair(
    "splayed toes",
    [
      [0.003, 0.032, 0.18, -0.012, 0.19],
      [0.025, 0.032, 0.147, 0.003, 0.17],
      [0.066, 0.046, 0.095, 0.004, 0.087],
    ],
    "@long leg",
    { pivot: "top" },
  );
  pair(
    "outer upper arm",
    [
      [0.593, 0.219, 0.287, -0.023, 0.066],
      [0.63, 0.161, 0.237, -0.037, 0.072],
      [0.684, 0.106, 0.176, -0.03, 0.072],
      [0.722, 0.067, 0.129, -0.025, 0.092],
    ],
    "coat and thorax",
    { pivot: "top" },
  );
  pair(
    "outer forearm",
    [
      [0.53, 0.299, 0.364, -0.079, 0.004],
      [0.556, 0.282, 0.344, -0.058, 0.023],
      [0.616, 0.201, 0.278, -0.04, 0.06],
    ],
    "@outer upper arm",
    { pivot: "top" },
  );
  pair(
    "outer hand",
    [
      [0.454, 0.31, 0.414, -0.117, -0.026],
      [0.498, 0.293, 0.416, -0.117, -0.014],
      [0.547, 0.292, 0.353, -0.077, 0.001],
    ],
    "@outer forearm",
    { pivot: "top" },
  );
  pair(
    "inner upper arm",
    [
      [0.512, 0.121, 0.177, 0.092, 0.158],
      [0.555, 0.102, 0.168, 0.069, 0.137],
      [0.605, 0.068, 0.131, 0.052, 0.127],
      [0.639, 0.06, 0.111, 0.041, 0.117],
    ],
    "coat and thorax",
    { pivot: "top" },
  );
  pair(
    "inner forearm",
    [
      [0.457, 0.156, 0.209, 0.143, 0.217],
      [0.491, 0.14, 0.192, 0.115, 0.184],
      [0.542, 0.116, 0.167, 0.087, 0.151],
    ],
    "@inner upper arm",
    { pivot: "top" },
  );
  pair(
    "inner hand",
    [
      [0.38, 0.157, 0.241, 0.164, 0.26],
      [0.426, 0.15, 0.233, 0.153, 0.242],
      [0.473, 0.151, 0.204, 0.139, 0.209],
    ],
    "@inner forearm",
    { pivot: "top" },
  );
  const form = finish();
  form.parts.find((p) => p.id === "split riding coat").drape = {
    folds: 6,
    depth: 0.04,
    twist: 0.1,
    slit: 0.18,
    slitHeight: 0.7,
  };
  form.appearance.skin = "#91a36a";
  form.appearance.palette = "Ochre";
  for (const p of form.parts) {
    p.outfitRole =
      p.id === "coat and thorax"
        ? "torso"
        : p.id.includes("head")
          ? "head"
          : p.id.includes("tail")
            ? "tail"
            : p.id.includes("coat")
              ? "skirt"
              : p.id.includes("leg")
                ? "thigh"
                : p.id.includes("toes")
                  ? "foot"
                  : p.id.includes("forearm")
                    ? "forearm"
                    : p.id.includes("upper arm")
                      ? "upper arm"
                      : "hand";
  }
  return form;
}
function porter() {
  const { add, pair, finish } = tracedForm("ridgeback", 1.92);
  add("dorsal mantle", [
    [0.23, -0.025, 0.025, -0.065, 0.02],
    [0.36, -0.19, 0.19, -0.19, 0.12],
    [0.47, -0.235, 0.235, -0.35, 0.18],
    [0.62, -0.217, 0.217, -0.4, 0.19],
    [0.77, -0.258, 0.258, -0.4, 0.21],
    [0.86, -0.23, 0.23, -0.29, 0.21],
    [0.94, -0.13, 0.13, -0.21, 0.18],
    [0.989, -0.03, 0.03, -0.1, 0.08],
  ]);
  add(
    "beaked mask",
    [
      [0.59, -0.022, 0.022, 0.12, 0.166],
      [0.64, -0.09, 0.09, 0.05, 0.2],
      [0.7, -0.139, 0.139, 0.04, 0.32],
      [0.75, -0.155, 0.155, 0.045, 0.419],
      [0.81, -0.15, 0.15, 0.058, 0.405],
      [0.885, -0.11, 0.11, 0.05, 0.245],
      [0.961, -0.048, 0.048, 0.05, 0.16],
      [0.992, -0.015, 0.016, 0.039, 0.075],
    ],
    "dorsal mantle",
    { profile: 0.78 },
  );
  pair(
    "pillar leg",
    [
      [0.009, 0.02, 0.34, -0.2, 0.21],
      [0.055, 0.03, 0.3, -0.2, 0.21],
      [0.13, 0.055, 0.26, -0.19, 0.08],
      [0.24, 0.068, 0.27, -0.157, 0.16],
      [0.34, 0.058, 0.285, -0.18, 0.19],
      [0.46, 0.05, 0.285, -0.16, 0.13],
      [0.514, 0.076, 0.23, -0.12, 0.075],
    ],
    "dorsal mantle",
    { pivot: "top" },
  );
  pair(
    "shoulder shield",
    [
      [0.6, 0.235, 0.398, -0.1, 0.22],
      [0.67, 0.174, 0.373, -0.136, 0.25],
      [0.74, 0.138, 0.392, -0.14, 0.26],
      [0.81, 0.14, 0.35, -0.137, 0.218],
      [0.888, 0.146, 0.282, -0.08, 0.14],
      [0.93, 0.175, 0.221, -0.035, 0.09],
    ],
    "dorsal mantle",
    { pivot: "top" },
  );
  pair(
    "forearm",
    [
      [0.357, 0.374, 0.5, 0.085, 0.316],
      [0.405, 0.343, 0.51, 0.045, 0.337],
      [0.49, 0.284, 0.47, 0.023, 0.321],
      [0.56, 0.245, 0.45, -0.012, 0.277],
      [0.629, 0.203, 0.375, -0.031, 0.234],
      [0.716, 0.176, 0.33, -0.07, 0.2],
    ],
    "@shoulder shield",
    { pivot: "top" },
  );
  pair(
    "outer talons",
    [
      [0.238, 0.39, 0.446, 0.245, 0.338],
      [0.285, 0.412, 0.484, 0.176, 0.366],
      [0.338, 0.404, 0.5, 0.138, 0.349],
      [0.4, 0.398, 0.51, 0.09, 0.309],
    ],
    "@forearm",
    { pivot: "top" },
  );
  pair(
    "inner hook",
    [
      [0.322, 0.33, 0.37, 0.232, 0.285],
      [0.35, 0.336, 0.385, 0.192, 0.3],
      [0.385, 0.34, 0.402, 0.139, 0.277],
      [0.427, 0.353, 0.438, 0.1, 0.251],
    ],
    "@forearm",
    { pivot: "top" },
  );
  const form = finish();
  for (const p of form.parts)
    p.outfitRole =
      p.id === "dorsal mantle"
        ? "torso"
        : p.id === "beaked mask"
          ? "head"
          : p.id.includes("leg")
            ? "thigh"
            : p.id.includes("shoulder")
              ? "upper arm"
              : p.id.includes("forearm")
                ? "forearm"
                : "hand";
  form.appearance.skin = "#766550";
  const plates = repeatOnSpine(form, "dorsal mantle", {
    count: 5,
    columns: 3,
    face: "Back",
    width: 0.285,
    length: 0.36,
    depth: 0.12,
    start: 0.2,
    end: 0.91,
    color: "#aa9676",
    name: "dorsal scute",
    lift: 0.018,
  }).form;
  return plates;
}
function human(atlas, height, gown) {
  const { add, pair, finish } = tracedForm(atlas, height);
  const torso = gown ? "silk bodice" : "field jacket";
  const shoulder = gown ? 0.141 : 0.125;
  const hip = gown ? 0.135 : 0.107;
  add(torso, [
    [gown ? 0.583 : 0.493, -hip, hip, -0.105, 0.107],
    [0.59, -hip, hip, -0.097, 0.104],
    [0.669, -0.085, 0.085, -0.095, 0.115],
    [0.751, -0.104, 0.104, -0.102, 0.139],
    [0.798, -shoulder, shoulder, -0.103, 0.103],
    [0.825, -shoulder * 0.65, shoulder * 0.65, -0.069, 0.05],
    [0.844, -0.033, 0.033, -0.041, 0.041],
  ]);
  add(
    "head and neck",
    [
      [0.815, -0.029, 0.029, -0.046, 0.044],
      [0.846, -0.038, 0.038, -0.052, 0.057],
      [0.879, -0.12, 0.12, -0.25, 0.25],
      [0.929, -0.12, 0.12, -0.25, 0.25],
      [0.986, -0.12, 0.12, -0.25, 0.25],
      [0.999, -0.12, 0.12, -0.25, 0.25],
    ],
    torso,
    { samples: 36, profile: 0.5, smooth: 6 },
  );
  if (gown) {
    add(
      "full skirt",
      [
        [0.004, -0.3, 0.3, -0.25, 0.25],
        [0.12, -0.28, 0.28, -0.24, 0.24],
        [0.29, -0.23, 0.23, -0.22, 0.22],
        [0.43, -0.183, 0.183, -0.19, 0.19],
        [0.52, -0.158, 0.158, -0.18, 0.18],
        [0.595, -0.145, 0.145, -0.16, 0.16],
        [0.639, -0.089, 0.089, -0.12, 0.12],
      ],
      torso,
      { pivot: "top", samples: 40 },
    );
  } else {
    pair(
      "trouser leg",
      [
        [0.187, 0.032, 0.139, -0.1, 0.085],
        [0.27, 0.026, 0.145, -0.105, 0.095],
        [0.375, 0.012, 0.131, -0.115, 0.108],
        [0.469, 0.002, 0.13, -0.12, 0.11],
        [0.52, 0.002, 0.117, -0.12, 0.106],
      ],
      torso,
      { pivot: "top" },
    );
    pair(
      "field boot",
      [
        [0.003, 0.032, 0.17, -0.15, 0.16],
        [0.058, 0.042, 0.16, -0.14, 0.15],
        [0.12, 0.043, 0.147, -0.11, 0.096],
        [0.179, 0.039, 0.145, -0.108, 0.096],
        [0.231, 0.035, 0.14, -0.11, 0.098],
      ],
      "@trouser leg",
      { pivot: "top" },
    );
  }
  const handY = gown ? 0.431 : 0.448;
  const armX = gown ? 0.224 : 0.187,
    wristX = gown ? 0.237 : 0.194,
    endX = gown ? 0.248 : 0.201;
  pair(
    "upper sleeve",
    [
      [0.678, gown ? 0.149 : 0.133, gown ? 0.212 : 0.185, -0.057, 0.052],
      [0.739, gown ? 0.106 : 0.09, gown ? 0.189 : 0.164, -0.071, 0.052],
      [0.796, gown ? 0.091 : 0.082, gown ? 0.154 : 0.147, -0.08, 0.064],
      [0.832, gown ? 0.087 : 0.069, gown ? 0.146 : 0.141, -0.076, 0.052],
      [0.844, 0.065, shoulder, -0.058, 0.033],
    ],
    torso,
    { pivot: "top", profile: 0.7 },
  );
  pair(
    "lower sleeve",
    [
      [0.544, armX - 0.026, armX + 0.04, -0.022, 0.064],
      [0.588, armX - 0.045, armX + 0.023, -0.036, 0.064],
      [0.642, armX - 0.07, armX + 0.01, -0.049, 0.056],
      [0.697, gown ? 0.14 : 0.123, gown ? 0.202 : 0.18, -0.06, 0.055],
    ],
    "@upper sleeve",
    { pivot: "top", profile: 0.9 },
  );
  pair(
    "hand",
    [
      [handY, endX - 0.023, endX + 0.026, -0.012, 0.07],
      [handY + 0.043, wristX - 0.033, wristX + 0.038, -0.01, 0.08],
      [0.519, wristX - 0.031, wristX + 0.043, -0.016, 0.078],
      [0.558, wristX - 0.037, wristX + 0.021, -0.017, 0.062],
    ],
    "@lower sleeve",
    { pivot: "top", profile: 0.85 },
  );
  let form = finish();
  const originalPaint = paintSources(form);
  const body = form.parts.find((p) => p.id === torso);
  const skullHeight = height / (gown ? 7.15 : 7.65);
  const scale = skullHeight / 0.294;
  const crownAbovePivot = 1.76 - 1.42;
  const head = {
    id: "head and neck",
    shape: "head",
    parent: body.id,
    position: [
      -body.position[0],
      height - crownAbovePivot * scale - body.position[1],
      -body.position[2],
    ],
    rotation: [0, 0, 0],
    size: [scale, scale, scale],
    eyesRig: { ...eyeDefaults },
    sculpt: gown
      ? { cheek: 1.15, jaw: 1.09 }
      : { jaw: 1.08, brow: 1.08, nose: 1.1 },
  };
  form.parts[form.parts.findIndex((p) => p.id === head.id)] = head;
  form.appearance.face = gown ? 2 : 0;
  form.appearance.hair = "Bald";
  if (gown)
    head.groom = {
      pattern: "Side part",
      color: "#b8b2ad",
      seed: 31,
      length: 0.4,
      curl: 0.3,
      gather: 0.3,
      volume: 0.48,
      sweep: 0.8,
    };
  form.appearance.skin = gown ? "#a293c1" : "#ba8c73";
  form.appearance.palette = gown ? "Polar" : "Tide";
  for (const p of form.parts) {
    if (p.id === "head and neck") {
      p.outfitRole = "head";
    } else
      p.outfitRole =
        p.id === torso
          ? "torso"
          : p.id.includes("skirt")
            ? "skirt"
            : p.id.includes("upper sleeve")
              ? "upper arm"
              : p.id.includes("lower sleeve")
                ? "forearm"
                : p.id.includes("hand")
                  ? "hand"
                  : p.id.includes("boot")
                    ? "foot"
                    : "thigh";
  }
  for (const p of form.parts) {
    if (p.outfitRole === "skirt")
      p.drape = { folds: 15, depth: 0.095, twist: 0.34 };
  }
  for (const hand of form.parts.filter((p) => p.outfitRole === "hand"))
    form = fitHand(form, hand.id, form.appearance.skin);
  if (gown) {
    form.build = { mass: 1.2, waist: 1.27, hips: 1.22, belly: 1.12 };
    const base = form.parts.find((p) => p.id === torso);
    form.parts.push({
      id: "inner hip layer",
      shape: "sweep",
      parent: base.id,
      position: [
        -base.position[0],
        height * 0.46 - base.position[1],
        -base.position[2],
      ],
      size: [1, 1, 1],
      rotation: [0, 0, 0],
      color: "#44534e",
      outfitRole: "pelvis",
      visibleIn: ["Base layer", "Pressure suit"],
      knots: [
        [0, 0, 0, 0.146, 0.1],
        [0, height * 0.06, 0, 0.192, 0.139],
        [0, height * 0.155, 0, 0.137, 0.112],
      ],
    });
    for (const s of [-1, 1]) {
      const side = s === 1 ? "left" : "right",
        x = s * 0.096;
      const hip = [x, height * 0.5, 0],
        rows = [
          [0, -height * 0.44, 0.014, 0.042, 0.045],
          [s * 0.017, -height * 0.31, -0.008, 0.061, 0.077],
          [s * 0.008, -height * 0.22, 0.021, 0.067, 0.071],
          [s * 0.005, -height * 0.12, 0.006, 0.092, 0.099],
          [0, 0, 0, 0.103, 0.11],
        ];
      form.parts.push({
        id: side + " inner leg",
        shape: "sweep",
        parent: base.id,
        position: hip.map((v, i) => v - base.position[i]),
        rotation: [0, 0, 0],
        size: [1, 1, 1],
        knots: rows,
        color: form.appearance.skin,
        outfitRole: "thigh",
        visibleIn: ["Base layer", "Pressure suit"],
      });
      form.parts.push({
        id: side + " inner foot",
        shape: "ellipsoid",
        parent: side + " inner leg",
        position: [0, -height * 0.462, 0.045],
        size: [0.125, height * 0.07, 0.225],
        rotation: [0, 0, 0],
        color: "#453e43",
        outfitRole: "foot",
        visibleIn: ["Base layer", "Pressure suit"],
      });
    }
  }
  return retainPaintSources(form, originalPaint);
}
function scanHuman(atlas, height, skin, palette) {
  const form = traceBiped(atlas, height);
  const originalPaint = paintSources(form);
  const wide = atlas === "surveyor",
    headHeight = height * (wide ? 0.182 : 0.177);
  const portrait = traceRegion(
    "head and neck",
    wide ? "foremanPortrait" : "relayPortrait",
    headHeight,
    [
      [0.005, -0.62, 0.62, -0.55, 0.56],
      [0.2, -0.62, 0.62, -0.55, 0.56],
      [0.48, -0.62, 0.62, -0.55, 0.56],
      [0.78, -0.62, 0.62, -0.55, 0.56],
      [0.998, -0.62, 0.62, -0.55, 0.56],
    ],
    null,
    { samples: 48, profile: 0.65, smooth: 3 },
  );
  portrait.paint.portrait = {
    center: wide ? 0 : 0.035,
    width: wide ? 0.29 : 0.248,
    eyes: wide ? 0.685 : 0.633,
    nose: wide ? 0.534 : 0.52,
    mouth: wide ? 0.443 : 0.405,
    chin: wide ? 0.298 : 0.274,
  };
  const root = form.parts.find((p) => p.id === "body");
  portrait.parent = root.id;
  portrait.anatomy = "face";
  portrait.outfitRole = "head";
  portrait.position = [
    -root.position[0],
    height - headHeight - root.position[1],
    -root.position[2] + (wide ? -0.018 : -0.032) * height,
  ];
  form.parts[form.parts.findIndex((p) => p.id === portrait.id)] = portrait;
  form.appearance.skin = skin;
  form.appearance.palette = palette;
  return retainPaintSources(form, originalPaint);
}
function cartographer() {
  const form = buildFigure({
    height: 1.88,
    heads: 7.65,
    face: 0,
    hair: "Bald",
    skin: "#ba8c73",
    shoulders: 1.1,
    chest: 1.13,
    waist: 0.98,
    hips: 1.03,
    limbs: 1.05,
    stance: { arms: 18, elbows: 14, feet: 1.08, curl: 0.32 },
    top: {
      kind: "tee",
      sleeves: "short",
      color: "#70685c",
      ease: 0.12,
      length: 0.06,
    },
    bottom: { kind: "trousers", ease: 0.12, color: "#484840", belt: "#524737" },
    shoes: { kind: "boots", color: "#54493d" },
  });
  const head = form.parts.find((p) => p.shape === "head");
  head.id = "head and neck";
  head.sculpt = { jaw: 1.08, brow: 1.08, nose: 1.1 };
  return form;
}

export const paintedStudies = [
  {
    id: "painted-trader",
    title: "Reed trader · painted volume",
    game: "Creature study",
    make: trader,
  },
  {
    id: "painted-surveyor",
    title: "Dock foreman · painted volume",
    game: "Portrait study",
    make: () => scanHuman("surveyor", 1.52, "#bd8b71", "Ochre"),
  },
  {
    id: "painted-courier",
    title: "Relay scout · painted volume",
    game: "Wardrobe study",
    make: () => scanHuman("courier", 1.77, "#b6977d", "Polar"),
  },
  {
    id: "painted-porter",
    title: "Plateback · painted volume",
    game: "Creature study",
    make: porter,
  },
  {
    id: "painted-ranger",
    title: "Coast cartographer · anatomy",
    game: "Portrait study",
    make: cartographer,
  },
  {
    id: "traced-coast-body",
    title: "Coast cartographer · earlier traced body",
    game: "Portrait study",
    make: () => human("cartographer", 1.88, false),
  },
  {
    id: "painted-elder",
    title: "Opera conductor · painted volume",
    game: "Wardrobe study",
    make: () => human("conductor", 1.71, true),
  },
];
