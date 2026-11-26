import fs from 'node:fs';
import { humanForm } from '../character-view/human-form.js';
import { evaluateHuman, smoothHumanSurface } from '../character-view/human-surface.js';
import { refineFaceForm } from '../character-view/human-face-anatomy.js';
import { eyeBalls } from '../character-view/human-eyes.js';
const f = humanForm();
const cage = evaluateHuman(f.human, f.humanFit, f.humanDetail), s = refineFaceForm(smoothHumanSurface(cage));
const head = s.names.indexOf('head'), neck = s.names.indexOf('neck');
const tri = [], bone = [];
const totals = new Float32Array(s.names.length);
for (let c = 0; c < s.bodyTriangles * 3; c += 3) {
  totals.fill(0);
  for (let i = 0; i < 3; i++) { const v = s.indices[c + i]; for (let j = v * 4; j < v * 4 + 4; j++) totals[s.boneIndices[j]] += s.weights[j]; }
  let best = 0; for (let i = 1; i < totals.length; i++) if (totals[i] > totals[best]) best = i;
  tri.push(s.indices[c], s.indices[c + 1], s.indices[c + 2]); bone.push(best);
}
const lips = new Float32Array(s.positions.length / 3);
for (let c = 0; c < s.bodyTriangles * 3; c++) lips[s.indices[c]] = Math.max(lips[s.indices[c]], s.pigments[s.uvFaces[c] * 4] / 255);
const positions = cage.positions.slice(); positions.set(s.positions.subarray(0, cage.bodyVertices * 3));
const eyes = eyeBalls({ ...cage, positions }).map(e => ({ centre: e.centre.toArray(), radius: e.radius }));
console.log(s.names.join(' '), 'head', head, 'neck', neck, 'height', s.height, 'verts', s.positions.length / 3, 'tris', s.bodyTriangles, eyes);
fs.writeFileSync(process.argv[2], JSON.stringify({
  positions: Array.from(s.positions), tri, bone, head, neck, names: s.names, joints: Array.from(s.joints), lips: Array.from(lips), eyes, height: s.height,
  eyeGroups: cage.eyeGroups.map(ids => { const at = new Map(Array.from(cage.ids, (v, i) => [v, i])); return ids.map(id => at.get(id) ?? id); }),
}));
