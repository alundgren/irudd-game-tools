import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHuman,
  humanAxes,
  humanRestPositions,
  randomHuman,
  validHuman,
} from "./human-surface.js";
import { neckBuild, neckFields, neckSettings } from "./human-neck.js";

function donor(parameters) {
  neckSettings.strength = 0;
  try {
    return evaluateHuman(parameters);
  } finally {
    neckSettings.strength = 1;
  }
}
const at = (surface, v) =>
  Array.from(surface.positions.subarray(v * 3, v * 3 + 3));
function normal(surface, v) {
  const n = [0, 0, 0],
    p = surface.positions;
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    const [a, b, c] = surface.indices.subarray(i, i + 3);
    if (a !== v && b !== v && c !== v) continue;
    const u = [0, 1, 2].map((d) => p[b * 3 + d] - p[a * 3 + d]),
      w = [0, 1, 2].map((d) => p[c * 3 + d] - p[a * 3 + d]);
    n[0] += u[1] * w[2] - u[2] * w[1];
    n[1] += u[2] * w[0] - u[0] * w[2];
    n[2] += u[0] * w[1] - u[1] * w[0];
  }
  const size = Math.hypot(...n);
  return n.map((x) => x / size);
}
function raised(parameters, v) {
  const before = donor(parameters),
    after = evaluateHuman(parameters),
    n = normal(before, v);
  return (
    1000 *
    at(after, v).reduce(
      (sum, x, d) => sum + (x - before.positions[v * 3 + d]) * n[d],
      0,
    )
  );
}
evaluateHuman({});
const fields = neckFields({ rest: humanRestPositions() });
function peak(name) {
  let best = -1;
  fields.ids.forEach((v, i) => {
    if (humanRestPositions()[v * 3] < -0.0005) return;
    if (best < 0 || fields.weights[name][i] > fields.weights[name][best])
      best = i;
  });
  return fields.ids[best];
}

test("the landmarks sit where the anatomy is on the donor body", () => {
  const body = evaluateHuman({ height: 1.72 }),
    { pit, collarbone, crest } = fields.landmarks,
    joint = (name) => at({ positions: body.joints }, body.names.indexOf(name));
  const pitVertex = peak("pit"),
    [x, y, z] = at(body, pitVertex);
  assert.ok(Math.abs(x) < 0.002 && z > 0.05, "pit at " + [x, y, z]);
  assert.ok(y > joint("clavicle_l")[1] && y < joint("neck_01")[1]);
  assert.equal(pit[0], 0);
  assert.ok(collarbone[0][0] < 0.035 && collarbone.at(-1)[0] > 0.14);
  for (let k = 1; k < collarbone.length; k++)
    assert.ok(collarbone[k][0] > collarbone[k - 1][0]);
  for (let k = 2; k < collarbone.length - 1; k++) {
    assert.ok(
      crest[k][2] < collarbone[k][2] - 0.015,
      "crest behind the collarbone at " + k,
    );
    assert.ok(
      crest[k][1] > collarbone[k][1],
      "crest above the collarbone at " + k,
    );
  }
});

test("a lean body gains a collarbone ridge, a pit, a hollow above the bone and a trapezius crest", () => {
  const lean = { weight: -0.5, height: 1.72 };
  const ridge = raised(lean, peak("collarbone")),
    pit = raised(lean, peak("pit")),
    hollow = raised(lean, peak("hollow")),
    crest = raised(lean, peak("trapezius"));
  assert.ok(ridge > 2.5 && ridge < 7, "collarbone " + ridge.toFixed(1) + " mm");
  assert.ok(pit < -3 && pit > -8, "pit " + pit.toFixed(1) + " mm");
  assert.ok(
    hollow < -0.5 && hollow > -6,
    "hollow " + hollow.toFixed(1) + " mm",
  );
  assert.ok(crest > 4 && crest < 10, "crest " + crest.toFixed(1) + " mm");
});

test("fat covers the bone, muscle builds the slope, and both sides match", () => {
  const ridge = peak("collarbone"),
    dip = peak("under"),
    crest = peak("trapezius"),
    relief = (body) => raised(body, ridge) - raised(body, dip);
  const lean = relief({ weight: -0.8 }),
    average = relief({}),
    heavy = relief({ weight: 0.9 });
  assert.ok(
    lean > average * 1.2 && heavy < average * 0.8 && heavy > 0,
    [lean, average, heavy].join(" "),
  );
  assert.ok(
    neckBuild({ weight: 0.9 }).collarbone < 0.55 * neckBuild({}).collarbone,
  );
  assert.ok(
    neckBuild({ weight: 0.3, waist: 0.8, belly: 0.8 }).collarbone <
      neckBuild({ weight: 0.3 }).collarbone,
  );
  const slight = raised({ muscle: -0.8, frame: -0.8 }, crest),
    strong = raised({ muscle: 0.9, frame: 0.8 }, crest);
  assert.ok(strong > slight * 2 && slight > 1, [slight, strong].join(" "));
  assert.ok(neckBuild({ weight: 1 }).trapezius > neckBuild({}).trapezius);
  const before = donor({}),
    after = evaluateHuman({}),
    moved = new Map();
  for (const v of fields.ids)
    moved.set(
      at(before, v)
        .map((x) => x.toFixed(4))
        .join(),
      at(after, v).map((x, d) => x - before.positions[v * 3 + d]),
    );
  for (const v of fields.ids) {
    const [x, y, z] = at(before, v),
      twin = moved.get(
        [-x, y, z]
          .map((n) => n.toFixed(4))
          .join()
          .replace("-0.0000", "0.0000"),
      );
    assert.ok(twin, "twin of vertex " + v);
    const mine = moved.get([x, y, z].map((n) => n.toFixed(4)).join());
    assert.ok(
      Math.hypot(mine[0] + twin[0], mine[1] - twin[1], mine[2] - twin[2]) <
        2e-5,
    );
  }
});

test("only the girdle moves, by a bounded amount, on every kind of adult", () => {
  const neutral = donor({});
  for (let seed = 8710; seed < 8730; seed++) {
    const parameters = randomHuman(seed),
      before = donor(parameters),
      after = evaluateHuman(parameters),
      h = before.height;
    let most = 0,
      top = 0;
    for (let v = 0; v < before.bodyVertices; v++) {
      const move = Math.hypot(
        ...at(after, v).map((x, d) => x - before.positions[v * 3 + d]),
      );
      top = Math.max(top, after.positions[v * 3 + 1]);
      if (!move) continue;
      most = Math.max(most, move);
      const bone = before.names[before.boneIndices[v * 4]];
      if (bone === "head")
        assert.ok(
          move < 0.007 * (h / 1.72),
          `seed ${seed}: head vertex ${v} moved ${(move * 1000).toFixed(1)} mm`,
        );
      else
        assert.match(
          bone,
          /^(neck_01|spine_0[23]|clavicle_[lr]|upperarm_[lr])$/,
        );
      const neutralHeight = neutral.positions[v * 3 + 1] / neutral.height;
      assert.ok(
        neutralHeight > 0.66 && neutralHeight < 0.92,
        `seed ${seed}: vertex ${v} outside the girdle`,
      );
    }
    assert.ok(
      most > 0.0015 && most < 0.03 * (h / 1.72),
      `seed ${seed}: largest move ${(most * 1000).toFixed(1)} mm`,
    );
    assert.ok(Math.abs(top - h) < 1e-5, "stature is unchanged");
    assert.deepEqual(Array.from(after.joints), Array.from(before.joints));
  }
});

test("the shaping scales with stature and can be switched off for comparison", () => {
  const v = peak("trapezius");
  const short = raised({ height: 1.5 }, v),
    tall = raised({ height: 1.95 }, v);
  assert.ok(
    Math.abs(tall / short - 1.95 / 1.5) < 0.02,
    [short, tall].join(" "),
  );
  assert.equal(neckSettings.strength, 1);
  assert.notDeepEqual(at(evaluateHuman({}), v), at(donor({}), v));
});

function near(x, y, z) {
  const body = donor({ height: 1.72 });
  let best = 0,
    gap = Infinity;
  for (let v = 0; v < body.bodyVertices; v++) {
    const d = Math.hypot(
      body.positions[v * 3] * 1000 - x,
      body.positions[v * 3 + 1] * 1000 - y,
      body.positions[v * 3 + 2] * 1000 - z,
    );
    if (d < gap) [best, gap] = [v, d];
  }
  return best;
}
const heavyAdult = {
  height: 1.72,
  weight: 0.9,
  waist: 0.55,
  belly: 0.65,
  hips: 0.2,
};

test("a heavy body carries a deeper neck, a fuller shoulder line and a padded upper back on the same skeleton", () => {
  const slope = peak("pad"),
    back = peak("back"),
    more = (v) => raised(heavyAdult, v) - raised({ height: 1.72 }, v);
  const front = more(near(0, 1450, 72)),
    beside = more(near(55, 1500, 26)),
    nape = more(near(0, 1481, -22)),
    line = more(slope),
    pad = more(back);
  assert.ok(front > 5 && front < 13, "throat " + front.toFixed(1) + " mm");
  assert.ok(nape > 5 && nape < 16, "nape " + nape.toFixed(1) + " mm");
  assert.ok(
    beside < 0.5 * Math.min(front, nape),
    "the neck deepens more than it widens: " +
      [front, nape, beside].map((x) => x.toFixed(1)).join(" "),
  );
  assert.ok(line > 9 && line < 19, "shoulder line " + line.toFixed(1) + " mm");
  assert.ok(pad > 10 && pad < 18, "upper back " + pad.toFixed(1) + " mm");
  assert.ok(
    more(near(0, 1375, 95)) < 0.6 * front &&
      Math.abs(more(near(0, 1300, 110))) < 0.5,
  );
  const before = donor(heavyAdult),
    after = evaluateHuman(heavyAdult);
  assert.deepEqual(Array.from(after.joints), Array.from(before.joints));
  for (const v of [
    near(0, 1700, 20),
    near(0, 1530, 150),
    near(75, 1580, 20),
    near(0, 1600, -80),
  ])
    assert.deepEqual(at(after, v), at(before, v), "head vertex " + v);
  assert.ok(neckBuild({ weight: 1 }).column < neckBuild(heavyAdult).column);
  assert.ok(
    raised({ height: 1.72, weight: 1 }, back) < raised(heavyAdult, back),
  );
});

test("lean and average bodies keep the neck they had, whatever their waist", () => {
  for (const body of [
    {},
    { weight: -0.6 },
    { weight: -0.4, waist: 0.5 },
    { muscle: 0.9, frame: 0.8 },
    { age: 0.9 },
  ]) {
    const build = neckBuild(body);
    assert.equal(build.column, 0, JSON.stringify(body));
    assert.equal(build.pad, 0);
    assert.equal(build.back, 0);
  }
  const slight = neckBuild({ weight: -0.1, belly: 0.8, waist: 0.6 });
  assert.ok(
    slight.column > 0 && slight.column < 0.35 * neckBuild(heavyAdult).column,
  );
});

test("the artist can fill or flatten the shoulder line and the upper back on any build", () => {
  for (const key of ["shoulderLine", "upperBack"]) {
    assert.ok(humanAxes.includes(key));
    assert.ok(
      validHuman({ [key]: 1 }) &&
        validHuman({ [key]: -1 }) &&
        !validHuman({ [key]: 1.2 }),
    );
    for (let seed = 8710; seed < 8716; seed++)
      assert.equal(randomHuman(seed)[key], 0);
  }
  const slope = peak("pad"),
    back = peak("back"),
    lean = { height: 1.72, weight: -0.5 };
  const rest = [raised(lean, slope), raised(lean, back)];
  const full = [
      raised({ ...lean, shoulderLine: 1 }, slope),
      raised({ ...lean, upperBack: 1 }, back),
    ],
    flat = [
      raised({ ...lean, shoulderLine: -1 }, slope),
      raised({ ...lean, upperBack: -1 }, back),
    ];
  assert.ok(
    full[0] - rest[0] > 8 && full[0] - rest[0] < 13,
    "shoulder line +" + (full[0] - rest[0]).toFixed(1) + " mm",
  );
  assert.ok(
    rest[0] - flat[0] > 8,
    "shoulder line -" + (rest[0] - flat[0]).toFixed(1) + " mm",
  );
  assert.ok(
    full[1] - rest[1] > 13 && full[1] - rest[1] < 19,
    "upper back +" + (full[1] - rest[1]).toFixed(1) + " mm",
  );
  assert.ok(
    raised({ ...lean, upperBack: 1 }, slope) > rest[0] &&
      raised({ ...lean, shoulderLine: 1 }, back) < rest[1] + 4,
  );
  assert.ok(
    rest[1] - flat[1] > 6 && rest[1] - flat[1] < 10,
    "upper back -" + (rest[1] - flat[1]).toFixed(1) + " mm",
  );
  const throat = near(0, 1450, 72);
  assert.ok(
    Math.abs(
      raised({ ...lean, upperBack: 1, shoulderLine: 1 }, throat) -
        raised(lean, throat),
    ) < 0.5,
  );
  const heavy = raised(heavyAdult, slope),
    fuller = raised({ ...heavyAdult, shoulderLine: 1 }, slope);
  assert.ok(
    fuller > heavy + 5 && fuller < heavy + 9,
    "heavy shoulder line +" + (fuller - heavy).toFixed(1) + " mm",
  );
  assert.equal(neckBuild({ ...heavyAdult, shoulderLine: 1 }).pad, 1.2);
  assert.equal(neckBuild({ ...heavyAdult, upperBack: 1 }).back, 1.3);
  assert.deepEqual(
    Array.from(evaluateHuman({ shoulderLine: 1, upperBack: 1 }).joints),
    Array.from(evaluateHuman({}).joints),
  );
});

test("lower abdominal fullness carries skin and clothes guides forward without shifting the skeleton", () => {
  const base = evaluateHuman({weight:.7,belly:.6});
  const empty = evaluateHuman({weight:.7,belly:.6,abdominalApron:0});
  const full = evaluateHuman({weight:.7,belly:.6,abdominalApron:1});
  assert.deepEqual(base.positions,empty.positions);
  assert.deepEqual(base.joints,full.joints);
  assert.equal(validHuman({abdominalApron:1.01}),false);
  let low = 0, high = 0, guides = 0;
  for(let i=0; i<base.positions.length; i+=3){
    const dy = base.positions[i+1]-full.positions[i+1];
    const dz = full.positions[i+2]-base.positions[i+2];
    if (i>=base.bodyVertices*3 && dz>.005) guides++;
    if (dz>.002) {
      assert.ok(base.positions[i+1]>.65 && base.positions[i+1]<1.42);
      low=Math.max(low,dy);high=Math.max(high,dz);
    }
  }
  assert.ok(low>.015 && high>.025 && guides>0);
});
