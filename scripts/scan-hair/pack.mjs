import fs from 'node:fs';
import { zlibSync } from 'three/addons/libs/fflate.module.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { evaluateHuman } from '../../character-view/human-surface.js';
import { surfaceFrame } from '../../character-view/human-fringe.js';
import { hatHead } from '../../character-view/human-hats.js';
await MeshoptSimplifier.ready;
const work = new URL('../../.reference-cache/scan-hair11/work/', import.meta.url), frame = surfaceFrame(evaluateHuman({})), skull = hatHead(frame);
const b64 = (bytes) => Buffer.from(zlibSync(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), { level: 9 })).toString('base64');
const credits = JSON.parse(fs.readFileSync(new URL('./credits.json', import.meta.url), 'utf8'));
const out = {};
for (const arg of process.argv.slice(2)) {
  const [style, rest] = arg.split('='), [scan, budget, fall] = rest.split(':');
  const read = (suffix, Type) => { const b = fs.readFileSync(new URL(scan + suffix, work)); return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
  const inland = read('-inland.f32', Float32Array), points = read('-points.f32', Float32Array), tri = read('-tri.u32', Uint32Array), rgba = read('-rgba.u8', Uint8Array), meta = JSON.parse(fs.readFileSync(new URL(scan + '-meta.json', work), 'utf8'));
  const target = Math.min(tri.length, 3 * Number(budget ?? 5000));
  const [kept] = MeshoptSimplifier.simplify(tri, points, 3, target, 0.02, ['LockBorder']);
  const used = [...new Set(kept)].sort((a, b) => a - b), remap = new Map(used.map((v, i) => [v, i]));
  const q = new Int16Array(used.length * 6), heights = [];
  used.forEach((v, i) => {
    const p = [points[v * 3], points[v * 3 + 1], points[v * 3 + 2]];
    {
      const at = skull.over(p), smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const face = (1 - smooth(0.9, 1.35, Math.abs(at.phi))) * (1 - smooth(0.42, 0.8, at.eps)), cap = 0.004 + (1 - face) * 0.06;
      if (fall !== 'long' && at.h > cap) for (let k = 0; k < 3; k++) p[k] -= at.u[k] * (at.h - cap) * face;
      const rooted = skull.over(p), temple = smooth(0.8, 1.2, Math.abs(rooted.phi)) * (1 - smooth(1.9, 2.3, Math.abs(rooted.phi))) * (1 - smooth(0.3, 0.7, rooted.eps)), most = 0.0012 + (0.0009 - 0.0005 * temple) * inland[v];
      if (rooted.h > most) for (let k = 0; k < 3; k++) p[k] -= rooted.u[k] * (rooted.h - most);
    }
    for (let k = 0; k < 3; k++) q[i * 6 + k] = Math.round((p[k] - frame.centre[k]) / frame.radii[k] * 4000);
    const r = p.map((x, k) => x - frame.centre[k]), len = Math.hypot(...r), theta = Math.acos(r[1] / len) * 180 / Math.PI, az = Math.atan2(r[0], r[2]);
    q[i * 6 + 3] = Math.round((0.5 + 0.5 * theta / meta.theta * Math.sin(az)) * 4000);
    q[i * 6 + 4] = Math.round((0.5 - 0.5 * theta / meta.theta * Math.cos(az)) * 4000);
    q[i * 6 + 5] = Math.round(skull.over(p).h * 1e5);
    heights.push(skull.over(p).h * 1000);
  });
  heights.sort((a, b) => a - b);
  const pick = (f) => heights[Math.floor(f * (heights.length - 1))].toFixed(1);
  console.log(style, scan, 'vertices', used.length, 'triangles', kept.length / 3, 'height over native skull mm: min', pick(0), '10%', pick(.1), 'median', pick(.5), '90%', pick(.9), 'max', pick(1));
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }, light = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b, ratios = [];
  const tone = [0, 1, 2].map((k) => { const all = []; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 153) all.push(lin(rgba[i + k])); all.sort((a, b) => a - b); return Number(all[all.length >> 1].toFixed(5)); });
  const middle = light(...tone);
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 153) ratios.push(light(lin(rgba[i]), lin(rgba[i + 1]), lin(rgba[i + 2])) / middle);
  ratios.sort((a, b) => a - b);
  const spread = Number(ratios[Math.floor(0.9 * (ratios.length - 1))].toFixed(3));
  console.log(style, 'light strands at', spread, 'of the middle; median', ratios[ratios.length >> 1].toFixed(2));
  out[style] = { source: scan, ...credits.sources[scan.slice(0, 7)], vertices: used.length, triangles: kept.length / 3, tone, spread, side: 512,
    points: b64(q), index: b64(Uint16Array.from(kept, (v) => remap.get(v))), texture: b64(rgba) };
}
const file = new URL('../../character-view/human-scan-hair-data.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify({ credit: credits.credit, license: credits.license, source: credits.source, revision: credits.revision, changes: credits.changes, cuts: out }));
console.log('wrote', (fs.statSync(file).size / 1e6).toFixed(2), 'MB');
