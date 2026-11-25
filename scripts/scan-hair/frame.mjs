// The native default head frame, for the packer.
import fs from 'node:fs';
import { evaluateHuman } from '../../character-view/human-surface.js';
import { surfaceFrame } from '../../character-view/human-fringe.js';
import { hatHead } from '../../character-view/human-hats.js';
const s = evaluateHuman({}), f = surfaceFrame(s), skull = hatHead(f);
const out = {};
for (const [k, v] of Object.entries(f)) if (typeof v !== 'function') out[k] = v;
console.log(Object.keys(f).join(' '));
console.log(JSON.stringify(out).slice(0, 900));
console.log(Object.keys(skull).join(' '), JSON.stringify(skull.over([0, f.centre[1] + 0.2, f.centre[2]])));
fs.writeFileSync(new URL('../../.reference-cache/scan-hair11/work/frame.json', import.meta.url), JSON.stringify(out));
