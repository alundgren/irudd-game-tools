import { bindParts, bindHumanoid } from "../character-view/rig.js";
import { startingForm, anchors } from "../character-view/recipe.js";

// Original editable studies. These authoring helpers produce ordinary form data
// accepted by the same importer as an agent's proposal.
function study(look, proportions, empty = false) {
  const form = startingForm(() => 0.5, false);
  Object.assign(form.appearance, look);
  for (const part of form.parts) {
    part.size = [...proportions];
    part.position = anchors[part.shape].map((x, i) => x * proportions[i]);
  }
  if (empty) form.parts = [];
  const add = (id, shape, position, size, color, rotation = [0, 0, 0]) => {
    const part = { id, shape, position, size, color, rotation };
    form.parts.push(part);
    return part;
  };
  const oval = (...args) => add(args[0], "ellipsoid", ...args.slice(1));
  const box = (...args) => add(args[0], "box", ...args.slice(1));
  function sweep(id, color, knots) {
    const pivot = knots[0].slice(0, 3);
    const p = add(id, "sweep", pivot, [1, 1, 1], color);
    p.knots = knots.map((row) => row.map((n, i) => (i < 3 ? n - pivot[i] : n)));
    return p;
  }
  function cloth(p) {
    p.visibleIn = ["Work clothes"];
    return p;
  }
  // Accessories in body-local metres follow each study's chosen proportions.
  function fitted(p) {
    p.position = p.position.map((x, i) => x * proportions[i]);
    p.size = p.size.map((x, i) => x * proportions[i]);
    return p;
  }
  return { form, add, oval, box, sweep, cloth, fitted };
}
const both = [-1, 1];
function bindStudy(form, locate) {
  const links = {};
  for (const p of form.parts)
    if (!Object.hasOwn(anchors, p.shape)) {
      const parent = locate(p.id, p);
      if (parent) links[p.id] = parent;
      if (
        parent === "head" &&
        /^(silver crown|swept lock |sideburn |silver wave |dark bob crown|cut bob |cropped fringe )/.test(
          p.id,
        )
      )
        p.headLayer = "hair";
    }
  // Bind accessories first so anatomical parents are still in world space.
  return bindHumanoid(bindParts(form, links));
}
function ranger() {
  const { form, sweep, oval, box, cloth, fitted } = study(
    {
      face: 0,
      skin: "#a9785c",
      hair: "Bald",
      hairColor: "#9e9890",
      palette: "Tide",
      sculpt: { nose: 1.42, brow: 1.36, jaw: 1.12, cheek: 0.84 },
      tones: {
        cloth: "#474e46",
        pants: "#47433c",
        boots: "#554237",
        panel: "#655848",
        trim: "#a68b63",
      },
    },
    [1.07, 1.075, 1.05],
  );
  fitted(
    oval("silver crown", [0, 1.724, -0.014], [0.202, 0.109, 0.202], "#aaa79d"),
  );
  for (let i = 0; i < 13; i++) {
    const a = (i - 6) * 0.22,
      x = Math.sin(a) * 0.092,
      z = -Math.cos(a) * 0.089;
    fitted(
      sweep("swept lock " + (i + 1), i % 2 ? "#a8a69c" : "#807e76", [
        [x * 0.58, 1.75, z * 0.3, 0.024, 0.016],
        [x, 1.69, z, 0.025, 0.021],
        [x * 0.91, 1.58, z - 0.019, 0.021, 0.022],
        [x * 0.62, 1.49, z - 0.045, 0.006, 0.008],
      ]),
    );
  }
  for (const s of both) {
    fitted(
      sweep("sideburn " + s, "#8e8980", [
        [s * 0.087, 1.65, 0.015, 0.019, 0.015],
        [s * 0.083, 1.59, 0.037, 0.017, 0.012],
        [s * 0.072, 1.56, 0.058, 0.004, 0.005],
      ]),
    );
    cloth(
      fitted(
        oval(
          "leather shoulder " + s,
          [s * 0.206, 1.331, 0],
          [0.216, 0.133, 0.197],
          "#615444",
          [0, 0, -s * 14],
        ),
      ),
    );
    cloth(
      fitted(
        sweep("shoulder binding " + s, "#a49271", [
          [s * 0.142, 1.358, 0.073, 0.009, 0.013],
          [s * 0.204, 1.335, 0.102, 0.009, 0.012],
          [s * 0.282, 1.31, 0.07, 0.008, 0.012],
        ]),
      ),
    );
  }
  cloth(
    fitted(
      sweep("chest baldric", "#72513c", [
        [-0.14, 1.363, 0.089, 0.032, 0.009],
        [-0.055, 1.247, 0.145, 0.034, 0.013],
        [0.05, 1.09, 0.132, 0.036, 0.012],
        [0.118, 0.938, 0.095, 0.033, 0.01],
      ]),
    ),
  );
  cloth(
    fitted(
      box(
        "bronze buckle",
        [-0.045, 1.22, 0.16],
        [0.061, 0.047, 0.013],
        "#ab9667",
        [0, 0, 32],
      ),
    ),
  );
  return bindStudy(form, (id) =>
    id.includes("lock") || id.includes("crown") || id.includes("sideburn")
      ? "head"
      : "torso",
  );
}
function surveyor() {
  const { form, sweep, oval, box, cloth, fitted } = study(
    {
      face: 1,
      skin: "#ac7f60",
      hair: "Bald",
      hairColor: "#706b62",
      palette: "Ochre",
      belly: 1.28,
      sculpt: { jaw: 1.34, nose: 1.52, brow: 0.82, cheek: 1.28 },
      tones: {
        cloth: "#806b52",
        pants: "#56534d",
        boots: "#483b32",
        panel: "#8d7961",
        trim: "#937449",
      },
    },
    [1.24, 0.87, 1.19],
  );
  for (const s of both) {
    fitted(
      sweep("grey horseshoe " + s, "#8b8881", [
        [s * 0.069, 1.727, -0.055, 0.023, 0.021],
        [s * 0.095, 1.666, -0.026, 0.025, 0.029],
        [s * 0.089, 1.605, -0.011, 0.015, 0.023],
      ]),
    );
    const arc = [];
    for (let j = 0; j <= 12; j++) {
      const t = (j * Math.PI * 2) / 12;
      arc.push([
        s * 0.042 + 0.041 * Math.cos(t),
        1.632 + 0.029 * Math.sin(t),
        0.1 + 0.006 * Math.cos(t) * -s,
        0.0035,
        0.0035,
      ]);
    }
    fitted(sweep("round spectacle frame " + s, "#4b443a", arc));
    fitted(
      sweep("spectacle temple " + s, "#605347", [
        [s * 0.082, 1.636, 0.1, 0.003, 0.003],
        [s * 0.1, 1.637, 0.007, 0.003, 0.003],
        [s * 0.09, 1.62, -0.016, 0.003, 0.003],
      ]),
    );
    cloth(
      fitted(
        box(
          "coat pocket " + s,
          [s * 0.111, 1.04, 0.125],
          [0.071, 0.083, 0.017],
          "#70604c",
        ),
      ),
    );
  }
  fitted(
    box(
      "spectacle bridge",
      [0, 1.638, 0.112],
      [0.017, 0.006, 0.007],
      "#53473b",
    ),
  );

  for (let j = 0; j < 3; j++)
    cloth(
      fitted(
        oval(
          "horn button " + j,
          [0.007, 1.055 + j * 0.061, 0.165 - j * 0.006],
          [0.012, 0.014, 0.007],
          "#493d32",
        ),
      ),
    );
  return bindStudy(form, (id) =>
    id.includes("coat") || id.includes("button") ? "torso" : "head",
  );
}
function elder() {
  const { form, sweep, oval, cloth, fitted } = study(
    {
      face: 2,
      collar: false,
      pockets: false,
      skin: "#ad9dbb",
      hair: "Bald",
      hairColor: "#dfd9cf",
      palette: "Polar",
      sculpt: { jaw: 1.03, nose: 0.92, brow: 1.12, cheek: 1.25 },
      tones: {
        cloth: "#343d50",
        trim: "#c9a76b",
        panel: "#485162",
        boots: "#353542",
        pants: "#34384c",
      },
    },
    [1.16, 0.985, 1.11],
  );
  cloth(
    fitted(
      sweep("ink velvet dress", "#363848", [
        [0, 0.035, 0, 0.258, 0.186],
        [0, 0.15, 0, 0.243, 0.181],
        [0, 0.47, 0, 0.205, 0.152],
        [0, 0.78, 0, 0.224, 0.158],
        [0, 0.91, 0, 0.191, 0.144],
        [0, 1.03, 0, 0.167, 0.134],
        [0, 1.2, 0, 0.189, 0.145],
        [0, 1.34, 0, 0.174, 0.124],
        [0, 1.38, 0, 0.111, 0.082],
      ]),
    ),
  );
  for (let i = 0; i < 9; i++) {
    const a = (i * 2 * Math.PI) / 9;
    cloth(
      fitted(
        sweep("skirt fold " + (i + 1), i % 2 ? "#454454" : "#424454", [
          [0.25 * Math.cos(a), 0.043, 0.18 * Math.sin(a), 0.008, 0.01],
          [
            0.219 * Math.cos(a + 0.11),
            0.27,
            0.166 * Math.sin(a + 0.11),
            0.012,
            0.009,
          ],
          [
            0.198 * Math.cos(a + 0.2),
            0.51,
            0.147 * Math.sin(a + 0.2),
            0.009,
            0.007,
          ],
          [
            0.199 * Math.cos(a + 0.34),
            0.7,
            0.145 * Math.sin(a + 0.34),
            0.002,
            0.003,
          ],
        ]),
      ),
    );
  }
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * 0.021;
    fitted(
      sweep("silver wave " + (i + 1), i % 2 ? "#d5d1c7" : "#a6a8a5", [
        [x, 1.683 + 0.015 * Math.cos(i), 0.065, 0.019, 0.021],
        [x + 0.027, 1.752, 0.028, 0.027, 0.029],
        [x + 0.009, 1.762, -0.036, 0.029, 0.027],
        [x - 0.012, 1.692, -0.084, 0.022, 0.023],
        [x - 0.011, 1.64, -0.096, 0.011, 0.015],
      ]),
    );
  }
  for (const s of both)
    fitted(
      oval(
        "drop earring " + s,
        [s * 0.102, 1.564, 0.012],
        [0.014, 0.033, 0.015],
        "#bd9c5b",
      ),
    );
  cloth(
    fitted(
      oval(
        "amber brooch",
        [-0.089, 1.298, 0.133],
        [0.038, 0.046, 0.016],
        "#c89a59",
      ),
    ),
  );
  return bindStudy(form, (id) =>
    id.includes("wave") || id.includes("earring") ? "head" : "torso",
  );
}
function courier() {
  const { form, sweep, oval, cloth, fitted } = study(
    {
      face: 3,
      skin: "#bd8f72",
      hair: "Bald",
      hairColor: "#262524",
      sleeves: "none",
      collar: false,
      pockets: false,
      palette: "Polar",
      sculpt: { jaw: 0.84, nose: 0.75, brow: 0.87, cheek: 1.08 },
      tones: {
        cloth: "#2d3638",
        pants: "#c4c4b9",
        boots: "#a64b38",
        trim: "#c89a75",
        panel: "#373d3d",
      },
    },
    [0.87, 1.01, 0.91],
  );
  fitted(
    oval("dark bob crown", [0, 1.711, -0.009], [0.205, 0.15, 0.216], "#26292a"),
  );
  for (const s of both)
    fitted(
      sweep("cut bob " + s, "#222526", [
        [s * 0.062, 1.74, -0.018, 0.043, 0.064],
        [s * 0.09, 1.67, -0.012, 0.024, 0.073],
        [s * 0.087, 1.578, -0.022, 0.021, 0.065],
        [s * 0.079, 1.552, -0.025, 0.013, 0.048],
      ]),
    );
  for (let i = 0; i < 7; i++)
    fitted(
      sweep("cropped fringe " + i, "#282929", [
        [(i - 3) * 0.02, 1.747, 0.046, 0.02, 0.018],
        [(i - 3) * 0.022, 1.7, 0.082, 0.018, 0.012],
        [
          (i - 3) * 0.023 + 0.006,
          1.672 + 0.006 * Math.sin(i),
          0.093,
          0.01,
          0.006,
        ],
      ]),
    );
  cloth(
    fitted(
      sweep("signal wrist wrap", "#aa4735", [
        [0.294, 0.875, 0.05, 0.046, 0.044],
        [0.292, 0.939, 0.036, 0.051, 0.049],
      ]),
    ),
  );
  for (const s of both)
    cloth(
      fitted(
        oval(
          "trail shoe " + s,
          [s * 0.14, 0.055, 0.058],
          [0.144, 0.098, 0.248],
          "#ae503f",
        ),
      ),
    );
  return bindStudy(form, (id, p) =>
    id.includes("wrist")
      ? "left arm"
      : id.includes("shoe")
        ? p.position[0] > 0
          ? "left leg"
          : "right leg"
        : "head",
  );
}
function merchant() {
  const { form, sweep, oval, box } = study({}, [1, 1, 1], true);
  const green = "#829073",
    deep = "#586d5c",
    linen = "#c9c6aa",
    leather = "#735d46",
    gold = "#aa8956";
  sweep("arched spine", green, [
    [0, 0.67, -0.018, 0.155, 0.143],
    [0, 0.95, -0.008, 0.216, 0.155],
    [0, 1.22, -0.025, 0.184, 0.14],
    [0, 1.47, -0.012, 0.106, 0.095],
    [0, 1.62, 0.04, 0.071, 0.071],
  ]);
  sweep("travel robe", linen, [
    [0, 0.28, 0, 0.239, 0.201],
    [0, 0.58, 0.004, 0.24, 0.188],
    [0, 0.84, 0.006, 0.19, 0.161],
    [0, 1.08, -0.005, 0.201, 0.158],
    [0, 1.24, -0.018, 0.182, 0.14],
  ]);
  sweep("wrapped belt", leather, [
    [0, 0.885, 0, 0.211, 0.168],
    [0, 0.97, 0, 0.21, 0.165],
  ]);
  sweep("long muzzle", green, [
    [0, 1.54, 0.01, 0.071, 0.075],
    [0, 1.64, 0.035, 0.127, 0.128],
    [0, 1.68, 0.124, 0.108, 0.087],
    [0, 1.62, 0.22, 0.077, 0.065],
    [0, 1.608, 0.256, 0.054, 0.042],
  ]);
  for (const s of both) {
    oval(
      "watchful eye " + s,
      [s * 0.092, 1.701, 0.102],
      [0.077, 0.068, 0.062],
      "#d5bd6b",
    );
    oval(
      "vertical pupil " + s,
      [s * 0.106, 1.704, 0.127],
      [0.022, 0.048, 0.022],
      "#27352f",
    );
    sweep("folded ear " + s, deep, [
      [s * 0.096, 1.66, 0.002, 0.04, 0.04],
      [s * 0.155, 1.681, -0.05, 0.032, 0.071],
      [s * 0.205, 1.724, -0.089, 0.006, 0.013],
    ]);
    sweep("long shin " + s, deep, [
      [s * 0.127, 0.65, 0, 0.084, 0.085],
      [s * 0.143, 0.38, 0.054, 0.071, 0.069],
      [s * 0.143, 0.11, -0.012, 0.058, 0.056],
    ]);
    oval(
      "splayed foot " + s,
      [s * 0.145, 0.075, 0.046],
      [0.17, 0.14, 0.24],
      green,
    );
    for (let level = 0; level < 2; level++) {
      const y = 1.31 - level * 0.25,
        reach = 0.37 + level * 0.047;
      sweep("bent arm " + s + " " + level, green, [
        [s * 0.143, y, -0.018, 0.074, 0.071],
        [s * 0.273, y - 0.096, -0.013, 0.063, 0.061],
        [s * reach, y - 0.234, 0.046, 0.045, 0.044],
        [s * (reach - 0.014), y - 0.334, 0.138, 0.032, 0.034],
      ]);
      oval(
        "palm " + s + " " + level,
        [s * (reach - 0.014), y - 0.352, 0.156],
        [0.084, 0.096, 0.073],
        deep,
      );
      for (let f = 0; f < 3; f++)
        sweep("finger " + s + " " + level + " " + f, green, [
          [s * (reach - 0.05 + f * 0.03), y - 0.37, 0.163, 0.012, 0.014],
          [s * (reach - 0.05 + f * 0.032), y - 0.409, 0.187, 0.011, 0.012],
          [s * (reach - 0.043 + f * 0.032), y - 0.419, 0.212, 0.005, 0.007],
        ]);
    }
  }
  sweep("traveller hood", deep, [
    [0, 1.7, -0.03, 0.131, 0.129],
    [-0.004, 1.77, -0.039, 0.127, 0.126],
    [-0.013, 1.865, -0.056, 0.09, 0.095],
    [-0.034, 1.9, -0.065, 0.083, 0.082],
  ]);
  sweep("woven hatband", gold, [
    [0, 1.758, -0.032, 0.131, 0.129],
    [0, 1.781, -0.037, 0.127, 0.124],
  ]);
  for (let i = 0; i < 5; i++)
    box(
      "belt case " + i,
      [(i - 2) * 0.068, 0.899, 0.142 - Math.abs(i - 2) * 0.013],
      [0.057, 0.091, 0.042],
      i % 2 ? gold : leather,
    );
  for (const p of form.parts)
    p.surface =
      p.color === green || p.color === deep
        ? "scales"
        : p.color === linen
          ? "canvas"
          : p.color === leather
            ? "leather"
            : "plain";
  const links = {};
  for (const p of form.parts) {
    const [sign, level] = p.id.match(/-?\d+/g) ?? [];
    const limb = " " + sign + " " + level;
    if (p.id === "arched spine") {
      p.outfitRole = "torso";
      continue;
    }
    let parent = "arched spine";
    if (p.id.startsWith("finger")) parent = "palm" + limb;
    else if (p.id.startsWith("palm")) {
      parent = "bent arm" + limb;
      p.outfitRole = "hand";
    } else if (p.id.startsWith("bent arm")) p.outfitRole = "upper arm";
    else if (p.id.startsWith("long shin")) p.outfitRole = "thigh";
    else if (p.id.startsWith("splayed foot")) {
      p.outfitRole = "foot";
      parent = "long shin " + sign;
    } else if (
      p.id.startsWith("watchful eye") ||
      p.id.startsWith("folded ear") ||
      p.id === "traveller hood"
    )
      parent = "long muzzle";
    else if (p.id.startsWith("vertical pupil")) parent = "watchful eye " + sign;
    else if (p.id === "woven hatband") parent = "traveller hood";
    else if (p.id.startsWith("belt case")) parent = "wrapped belt";
    else if (p.id === "long muzzle") p.outfitRole = "head";
    else if (p.id === "travel robe") p.outfitRole = "skirt";
    if (/robe|belt|hood|hatband/.test(p.id)) p.visibleIn = ["Work clothes"];
    links[p.id] = parent;
  }
  form.appearance.skin = green;
  return bindParts(form, links, { metric: true });
}
function carapace() {
  const { form, sweep, oval } = study({}, [1, 1, 1], true);
  const stone = "#b1a995",
    dark = "#454a43",
    rim = "#837e6e",
    skin = "#726f62";
  sweep("hunched trunk", skin, [
    [0, 0.68, 0.025, 0.165, 0.147],
    [0, 0.9, 0, 0.244, 0.195],
    [0, 1.12, -0.038, 0.302, 0.222],
    [0, 1.29, -0.031, 0.312, 0.237],
    [0, 1.48, 0.025, 0.218, 0.19],
    [0, 1.56, 0.11, 0.119, 0.123],
  ]);
  oval("low projecting skull", [0, 1.49, 0.163], [0.323, 0.27, 0.274], dark);
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.5;
    oval(
      "brow shield " + i,
      [0.125 * Math.sin(a), 1.543, 0.168 + 0.098 * Math.cos(a)],
      [0.071, 0.11, 0.069],
      stone,
      [10, 0, (i - 2) * -12],
    );
  }
  for (const s of both) {
    oval(
      "amber eye " + s,
      [s * 0.097, 1.473, 0.259],
      [0.044, 0.025, 0.025],
      "#cbaa68",
    );
    sweep("load bearing leg " + s, dark, [
      [s * 0.137, 0.77, 0, 0.124, 0.113],
      [s * 0.174, 0.48, 0.085, 0.107, 0.111],
      [s * 0.195, 0.22, 0.016, 0.083, 0.09],
      [s * 0.205, 0.08, 0.037, 0.084, 0.087],
    ]);
    oval(
      "load foot " + s,
      [s * 0.208, 0.085, 0.091],
      [0.234, 0.17, 0.305],
      rim,
    );
    sweep("power arm " + s, skin, [
      [s * 0.252, 1.31, -0.03, 0.136, 0.132],
      [s * 0.341, 1.132, 0.003, 0.116, 0.12],
      [s * 0.424, 0.92, 0.063, 0.101, 0.107],
      [s * 0.442, 0.71, 0.118, 0.077, 0.082],
    ]);
    oval("hand " + s, [s * 0.446, 0.664, 0.132], [0.175, 0.197, 0.169], dark);
    for (let i = 0; i < 3; i++)
      sweep("hook digit " + s + "/" + i, stone, [
        [s * (0.386 + i * 0.056), 0.64, 0.14, 0.029, 0.028],
        [s * (0.386 + i * 0.057), 0.565, 0.17, 0.026, 0.024],
        [s * (0.382 + i * 0.057), 0.53, 0.207, 0.007, 0.006],
      ]);
    for (let i = 0; i < 4; i++)
      oval(
        "shoulder scute " + s + "/" + i,
        [s * (0.245 + 0.039 * i), 1.332 - i * 0.075, -0.005],
        [0.22 - i * 0.011, 0.158, 0.249 - i * 0.012],
        i % 2 ? rim : stone,
        [0, 0, s * 20],
      );
    for (let i = 0; i < 3; i++)
      oval(
        "gauntlet ridge " + s + "/" + i,
        [s * (0.421 + 0.006 * i), 0.873 - 0.054 * i, 0.09],
        [0.206, 0.072, 0.208],
        i % 2 ? rim : stone,
      );
    for (let i = 0; i < 3; i++)
      oval(
        "shin scute " + s + "/" + i,
        [s * (0.175 + 0.011 * i), 0.473 - 0.096 * i, 0.127 - i * 0.015],
        [0.162 - i * 0.012, 0.132, 0.085],
        stone,
        [10, 0, 0],
      );
  }
  for (let r = 0; r < 4; r++)
    for (let c = -1; c <= 1; c++)
      oval(
        "back plate " + r + "/" + c,
        [
          c * (0.144 + 0.008 * r),
          0.938 + r * 0.122,
          -0.161 - 0.017 * r + 0.054 * Math.abs(c),
        ],
        [0.177, 0.18, 0.106],
        (r + c) % 2 ? stone : rim,
        [12, 0, c * -9],
      );
  for (let i = 0; i < 4; i++)
    oval(
      "chest plate " + i,
      [0, 0.936 + i * 0.095, 0.169 + i * 0.005],
      [0.312 + i * 0.019, 0.134, 0.092],
      i % 2 ? stone : rim,
    );
  for (const p of form.parts)
    p.surface = p.color === stone || p.color === rim ? "scales" : "leather";
  const links = {};
  for (const p of form.parts) {
    const sign = p.id.match(/-?\d+/)?.[0];
    if (p.id === "hunched trunk") {
      p.outfitRole = "torso";
      continue;
    }
    let parent = "hunched trunk";
    if (p.id === "low projecting skull") p.outfitRole = "head";
    else if (/^(brow shield|amber eye)/.test(p.id))
      parent = "low projecting skull";
    else if (p.id.startsWith("load bearing leg")) p.outfitRole = "thigh";
    else if (/^(load foot|shin scute)/.test(p.id)) {
      parent = "load bearing leg " + sign;
      if (p.id.startsWith("load foot")) p.outfitRole = "foot";
    } else if (p.id.startsWith("power arm")) p.outfitRole = "upper arm";
    else if (/^(hand|shoulder scute|gauntlet ridge)/.test(p.id)) {
      parent = "power arm " + sign;
      if (p.id.startsWith("hand")) p.outfitRole = "hand";
    } else if (p.id.startsWith("hook digit")) parent = "hand " + sign;
    links[p.id] = parent;
  }
  form.appearance.skin = skin;
  return bindParts(form, links, { metric: true });
}
export const studies = [
  {
    id: "ranger",
    title: "Scarred ranger",
    game: "Portrait study",
    make: ranger,
  },
  {
    id: "surveyor",
    title: "Dock surveyor",
    game: "Portrait study",
    make: surveyor,
  },
  { id: "merchant", title: "Marsh trader", game: "Creature study", make: merchant },
  { id: "carapace", title: "Ridgeback porter", game: "Creature study", make: carapace },
  { id: "elder", title: "Estuary elder", game: "Wardrobe study", make: elder },
  { id: "courier", title: "Relay runner", game: "Wardrobe study", make: courier },
];
