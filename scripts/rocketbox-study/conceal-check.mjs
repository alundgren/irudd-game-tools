import * as T from "three";
import { evaluateHuman, smoothHumanSurface } from "../../character-view/human-surface.js";
import { dressedHuman } from "../../character-view/human-wardrobe.js";
import { loadStudies } from "./local.mjs";
const material = (color) => new T.MeshStandardMaterial({ color });
function hit(pos, tri, o, d) {
  let best = Infinity, face = 0, at = -1;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2], e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const tx = o[0] - pos[a], ty = o[1] - pos[a + 1], tz = o[2] - pos[a + 2], u = (tx * px + ty * py + tz * pz) / det;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) / det;
    if (dist > 1e-6 && dist < best) { best = dist; face = det > 0 ? 1 : -1; at = t; }
  }
  return { best, face, at };
}
const selftest = process.argv.includes("--selftest");
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (const study of await loadStudies()) {
  const form = study.stages.final(), cage = evaluateHuman(form.human, form.humanFit), s = smoothHumanSurface(cage);
  const meshes = dressedHuman(cage, form, material, true), hidden = meshes.hidden, skip = new Set();
  for (let j = 0; j < s.quadIds.length; j += 4) if ([0, 1, 2, 3].every((k) => hidden.has(cage.ids[s.quadIds[j + k]]))) skip.add(j / 4);
  const pos = [], tri = [], owner = [];
  const names = ["skin"];
  let base = 0;
  for (let i = 0; i < s.positions.length; i++) pos.push(s.positions[i]);
  for (let c = 0; c < s.bodyTriangles * 3; c += 3) if (!skip.has(s.parentFaces[c / 3])) { tri.push(s.indices[c], s.indices[c + 1], s.indices[c + 2]); owner.push(0); }
  base = s.positions.length / 3;
  for (const m of meshes) {
    if (!m.userData.styleRegion || /Bun|Swept|Crop|hair/i.test(m.name)) continue;
    const p = m.geometry.attributes.position.array, ix = m.geometry.index.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    names.push(m.name);
    for (let i = 0; i < ix.length; i += 3) {
      const y = p[ix[i] * 3 + 1];
      if (selftest && m.name === "Trousers" && y > 0.6 && y < 0.72) continue;
      tri.push(base + ix[i], base + ix[i + 1], base + ix[i + 2]); owner.push(names.length - 1);
    }
    base += p.length / 3;
  }
  const P = Float64Array.from(pos), rays = +process.argv[2] || 3000, bad = new Map(), where = [];
  let hits = 0, back = 0;
  for (let r = 0; r < rays; r++) {
    const yaw = rnd() * Math.PI * 2, pitch = (rnd() - 0.5) * 1.2, d = [-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const aim = [(rnd() - 0.5) * 0.9, 0.05 + rnd() * 1.4, (rnd() - 0.5) * 0.3], o = [aim[0] - d[0] * 3, aim[1] - d[1] * 3, aim[2] - d[2] * 3];
    const h = hit(P, tri, o, d);
    if (!Number.isFinite(h.best)) continue;
    hits++;
    const t = h.at, a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const n = [(P[b + 1] - P[a + 1]) * (P[c + 2] - P[a + 2]) - (P[b + 2] - P[a + 2]) * (P[c + 1] - P[a + 1]), (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]), (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a])];
    if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0) {
      back++;
      const name = names[owner[t / 3]]; bad.set(name, (bad.get(name) ?? 0) + 1);
      if (where.length < 12) where.push(name + " y " + (o[1] + d[1] * h.best).toFixed(2) + " x " + (o[0] + d[0] * h.best).toFixed(2) + " z " + (o[2] + d[2] * h.best).toFixed(2));
    }
  }
  console.log(study.id, "rays that hit", hits, "first surface is a back face", back, [...bad].map(([k, v]) => k + " " + v).join(", "));
  for (const w of where) console.log("   ", w);
}
