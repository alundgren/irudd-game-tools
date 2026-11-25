import assert from "node:assert/strict";
import test from "node:test";
import { classifyCreatureRelief, evaluateBiologicalRelief } from "./creature-relief.js";

const plans = { chitin: { head: { snout: "mandibles" } }, scales: { family: "tank" },
  wet: { family: "drifter" }, pelt: { back: { kind: "shag mantle" } },
  plumage: { family: "wader" }, pebbled: { family: "brute" } };

test("each anatomy selects a distinct material, and an authored coat overrides it", () => {
  for (const [family, plan] of Object.entries(plans)) {
    assert.equal(classifyCreatureRelief(plan).family, family);
    assert.equal(classifyCreatureRelief(plan, { coat: { family: "wet skin" } }).family, "wet");
  }
});

test("material and limb location survive sampling as finite, distinct relief and roughness", () => {
  const output = new Array(4), cells = new Array(5), worley = new Array(3);
  const context = { seed: 2351, scaleRef: 1, px: .26, py: .36, pz: .13, tSpine: .41,
    sAlong: .22, uAcross: .14, flankNorm: .65, dorsal: .54, ventral: .12, dorsalCoord: .36,
    shoulder: .27, fbmMac: .37, nMac2: .53, markGuard: .8, mAlpha: .2,
    isHead: false, isMuzzle: false, isLimb: true, isTail: false, isTentacle: false,
    isBirdLeg: false, isExtremity: false, hasAxis: true, limbT: .42, limbAlong: .12,
    limbArc: .09, limbUp: .77, jointProx: .33 };
  const signatures = new Set();
  function sample(plan, jointProx) {
    evaluateBiologicalRelief(output, { ...context, jointProx, profile: classifyCreatureRelief(plan) }, cells, worley);
    assert.ok(output.every(Number.isFinite));
    assert.ok(output[0] >= 0 && output[0] <= 1);
    assert.ok(output[1] >= .11 && output[1] <= .93);
    return [...output];
  }
  for (const plan of Object.values(plans)) signatures.add(JSON.stringify(sample(plan, .33)));
  assert.equal(signatures.size, 6);
  const shield = sample(plans.chitin, .1), joint = sample(plans.chitin, .97);
  assert.ok(joint[1] > shield[1]);
});
