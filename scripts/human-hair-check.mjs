// Measures groomed heads without a renderer: how much of the eyes and face the hair hides,
// how much scalp it leaves bare and how much of it is inside the head.
//   node scripts/human-hair-check.mjs --hair "Bob,Rounded bob" --fringe all --bodies f4,m1
// Lists take commas; `all` means every hairstyle or every way of wearing a fringe.
import * as T from "three";
import { evaluateHuman } from "../character-view/human-surface.js";
import { adultStyles } from "../character-view/human-wardrobe.js";
import { styleHuman } from "../character-view/human-style.js";
import { libraryPieces } from "../character-view/human-library.js";
import { coilGroom } from "../character-view/human-coils.js";
import { strandGroom } from "../character-view/human-groom.js";
import { probeHair } from "../character-view/human-hair-probe.js";
import { bodies } from "./human-style-bodies.mjs";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map(a => { const [k, ...v] = a.trim().split(" "); return [k, v.join(" ") || true]; }));
const list = (value, every, fallback) => value === "all" ? every : (value ?? fallback).split(",");
const percent = x => (100 * x).toFixed(0).padStart(3) + "%", material = () => new T.MeshStandardMaterial();
console.log("figure  hair / fringe".padEnd(40), "eyes hidden: front, from the left, from the right".padEnd(52), "face".padEnd(16), "scalp bare (cards alone)  inside head, deepest  in neck  triangles");
for (const name of list(args.bodies, Object.keys(bodies), "f4,m4")) {
  const surface = evaluateHuman(bodies[name]);
  for (const hair of list(args.hair, adultStyles.hair.slice(1), "Bob")) for (const fringe of list(args.fringe, adultStyles.fringe, "As cut")) {
    const style = { hair, fringe };
    const meshes = [...styleHuman(surface, style, material), ...libraryPieces(surface, style, material, true), ...coilGroom(surface, style, material, true), ...strandGroom(surface, style, material, true)];
    // The roots under hair cards are closed to the skin by design, so depth inside the head is measured on the rest.
    const cards = meshes.filter(mesh => !mesh.userData.hairRoots), all = probeHair(surface, meshes), own = cards.length < meshes.length ? probeHair(surface, cards) : all;
    const views = ["front", "left", "right"];
    console.log((name + "  " + hair + " / " + fringe).padEnd(40), views.map(view => all.eyes[view].map(percent).join(" ")).join("   ").padEnd(52), views.map(view => percent(all.face[view])).join(" ").padEnd(16),
      ((100 * all.scalp.bare).toFixed(1) + "% (" + (100 * own.scalp.bare).toFixed(1) + "%)").padEnd(25), (own.inside.count + ", " + (own.inside.deepest * 1000).toFixed(1) + " mm").padEnd(21), String(own.inside.below).padEnd(8), all.triangles);
  }
}
