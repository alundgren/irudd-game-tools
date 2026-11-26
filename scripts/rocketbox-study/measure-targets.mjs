import { poseReadings } from "../../character-view/human-reference-align.js";
import { readGlb } from "./glb.mjs";
import { need } from "./local.mjs";

need("targets/female-adult-04.glb", "targets/gardener-male-01.glb");

for (const name of ["female-adult-04", "gardener-male-01"]) {
  const glb = readGlb(".reference-cache/rocketbox/targets/" + name + ".glb");
  console.log(name, poseReadings(glb.positions));
  for (const p of glb.parts) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3], p.positions[i]); hi[i % 3] = Math.max(hi[i % 3], p.positions[i]); }
    console.log("  ", p.material, p.positions.length / 3, lo.map(x => x.toFixed(3)).join(" "), "|", hi.map(x => x.toFixed(3)).join(" "));
  }
  const rows = [];
  for (let y = 0.05; y < 1.85; y += 0.1) {
    let x = 0, zf = -9, zb = 9, xin = 0;
    for (let i = 0; i < glb.positions.length; i += 3) {
      if (Math.abs(glb.positions[i + 1] - y) > 0.012) continue;
      x = Math.max(x, Math.abs(glb.positions[i]));
      if (Math.abs(glb.positions[i]) < 0.3) { xin = Math.max(xin, Math.abs(glb.positions[i])); zf = Math.max(zf, glb.positions[i + 2]); zb = Math.min(zb, glb.positions[i + 2]); }
    }
    rows.push(y.toFixed(2) + ": halfwidth<.3 " + xin.toFixed(3) + " max " + x.toFixed(3) + " z " + zb.toFixed(3) + ".." + zf.toFixed(3));
  }
  console.log(rows.join("\n"));
}
