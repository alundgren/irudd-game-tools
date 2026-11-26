import { poseReadings } from "../../character-view/human-reference-align.js";
import { evaluateHuman } from "../../character-view/human-surface.js";
import { readGlb } from "./glb.mjs";
import { loadStudies, need } from "./local.mjs";

need("targets/female-adult-04.glb");
const rocketboxStudies = await loadStudies();

const skin = (human) => { const s = evaluateHuman(human); return s.positions.subarray(0, s.bodyVertices * 3); };
function solve(read, want, lo, hi) {
  let a = lo, fa = read(a), b = hi, fb = read(b);
  for (let i = 0; i < 12 && fa !== fb; i++) {
    const next = Math.min(hi, Math.max(lo, a + ((want - fa) * (b - a)) / (fb - fa))), f = read(next);
    [a, fa, b, fb] = [b, fb, next, f];
    if (Math.abs(f - want) < 0.002) break;
  }
  return b;
}
for (const study of rocketboxStudies) {
  const want = poseReadings(readGlb(".reference-cache/rocketbox/targets/" + study.id.replace("rocketbox-", "") + ".glb").positions), human = { ...study.make().human };
  human.stance = +solve((stance) => poseReadings(skin({ ...human, stance })).armsBelowHorizontal, want.armsBelowHorizontal, -1, 1).toFixed(2);
  human.legSpread = +solve((legSpread) => poseReadings(skin({ ...human, legSpread })).footSpacing, want.footSpacing, -1, 1).toFixed(2);
  const got = poseReadings(skin(human));
  console.log(study.id, "target arms", want.armsBelowHorizontal.toFixed(1) + "°", "feet", want.footSpacing.toFixed(3), "→ stance", human.stance, "legSpread", human.legSpread, "gives", got.armsBelowHorizontal.toFixed(1) + "°", got.footSpacing.toFixed(3));
}
