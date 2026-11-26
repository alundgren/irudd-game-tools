import { Envelope, Piece, add, bodyShell, clamp, connected, cross, cut, dot, hash1, length, lerp3 as lerp, mix, noise3, smooth, sub, subdivide, unit } from "./human-style-kit.js";
import { combFringe, hairline, headFrame } from "./human-fringe.js";

const TAU = Math.PI * 2, DEG = Math.PI / 180;

function lumps(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    const n = (xi + a) * 73856093 ^ (yi + b) * 19349663 ^ (zi + c) * 83492791;
    const d = (xi + a + hash1(n) - x) ** 2 + (yi + b + hash1(n + 1) - y) ** 2 + (zi + c + hash1(n + 2) - z) ** 2;
    if (d < best) best = d;
  }
  return Math.max(0, 1 - best * 1.6);
}

function cap(body, m, f, { thick, lip = .002, edge = .26, round = 1, pole = [0, 1, 0], grooves = 0, depth = .0015, twist = 0, curl = null, part = null, levels = 2, raise = 0, ragged = 2.4, within = null } = {}) {
  const k = f.k, head = body.weight(/^head/);
  let s = bodyShell(body, { head });
  s.f.line = s.pos.map(() => 0).slice(0, s.count);
  for (let i = 0; i < s.count; i++) { const { phi, eps, q } = f.aim(s.anchor(i)); s.f.line[i] = s.f.head[i] > .5 ? eps - hairline(phi) - raise * DEG + ragged * DEG * (noise3(q[0] * 13 + 3, q[1] * 13, q[2] * 13) - .5) : -1;
    if (within && s.f.line[i] > -1) s.f.line[i] = Math.min(s.f.line[i] + 7 * DEG, within(i));
  }
  s = cut(s, i => s.f.line[i]);
  s = connected(s, [0, f.top, f.centre[2]]);
  for (let level = 0; level < levels; level++) s = subdivide(s);
  const axis = unit(pole), e1 = unit(cross(axis, Math.abs(axis[0]) > .9 ? [0, 0, 1] : [1, 0, 0])), e2 = cross(axis, e1);
  const toward = part && unit(part), across = part && unit(cross(axis, toward));
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i), out = sub(a, f.centre), r = length(out), u = [out[0] / r, out[1] / r, out[2] / r], dir = f.aim(a);
    const line = s.f.line[i] / Math.hypot(1, (hairline(dir.phi + DEG) - hairline(dir.phi - DEG)) / (2 * DEG * Math.max(.3, Math.cos(dir.eps))));
    let t = thick(dir) * k * (round ? smooth(0, edge, line) ** round : Math.sqrt(1 - (1 - clamp(line / edge)) ** 2)) + lip * k * smooth(0, .1, line);
    const polar = Math.acos(clamp(dot(dir.q, axis), -1, 1)), around = Math.atan2(dot(dir.q, e2), dot(dir.q, e1));
    if (grooves) {
      const wobble = .5 * noise3(dir.q[0] * 3 + 7, dir.q[1] * 3, dir.q[2] * 3) + .25 * noise3(dir.q[0] * 9, dir.q[1] * 9 + 3, dir.q[2] * 9);
      const x = around / TAU * grooves + twist * polar + wobble * 1.3, lock = Math.floor(x), strength = .55 + .45 * hash1(lock * 7 + 3);
      t += depth * k * strength * (Math.abs(Math.cos(Math.PI * (x - lock))) ** .7 - .55) * smooth(.12, .5, polar) * smooth(0, .06, line);
    }
    if (curl) t += curl.height * k * (lumps(a[0] / (curl.size * k), a[1] / (curl.size * k), a[2] / (curl.size * k)) - .4) * smooth(0, .05, line);
    if (part) {
      const side = dot(dir.q, across), along = dot(dir.q, toward);
      if (along > -.1) t -= part.depth * k * Math.exp(-((side / .045) ** 2)) * smooth(-.1, .15, along) * smooth(0, .1, line);
    }
    s.set(i, add(f.centre, u, r + Math.max(.0012 * k, t)));
  }
  return s;
}

function tubeRings(path, radius, { sides = 10, ridges = 0, twist = 0, flat = 1 } = {}) {
  const rings = [];
  let normal = null;
  path.forEach((p, i) => {
    const tangent = unit(sub(path[Math.min(path.length - 1, i + 1)], path[Math.max(0, i - 1)]));
    normal = unit(normal ? sub(normal, tangent.map(x => x * dot(normal, tangent))) : cross(tangent, [1, 0, 0]));
    const side = cross(tangent, normal), t = i / (path.length - 1), r = radius(t);
    rings.push(Array.from({ length: sides }, (_, j) => {
      const a = j / sides * TAU, groove = ridges ? 1 - .16 * (1 - Math.abs(Math.cos((a * ridges / 2) + twist * t * TAU))) : 1;
      return add(add(p, normal, Math.cos(a) * r * groove * flat), side, Math.sin(a) * r * groove);
    }));
  });
  return rings;
}
function tube(piece, path, radius, skin, options = {}) {
  piece.loft(tubeRings(path, radius, options), skin, { capStart: true, capEnd: true, flip: true });
}
const bezier = (a, b, c, d, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [0, 1, 2].map(x => u * u * u * a[x] + 3 * u * u * t * b[x] + 3 * u * t * t * c[x] + t * t * t * d[x]); });

function hangSkin(body, m) {
  const head = body.bone("head"), neck = body.bone("neck_01"), chest = body.bone("spine_03"), k = m.k;
  return p => {
    const low = smooth(m.head[1] + .02 * k, m.neck[1] - .02 * k, p[1]), lower = smooth(m.neck[1] + .02 * k, m.neck[1] - .1 * k, p[1]);
    return [[head, neck, chest, 0], [1 - low, low * (1 - lower), low * lower, 0]];
  };
}

function reach(points, cell, key, pick) {
  const grid = new Map(), id = (a, b) => a * 4096 + b;
  for (const p of points) { const [a, b] = key(p), n = id(Math.round(a / cell), Math.round(b / cell)), value = pick(p); if (!(grid.get(n) >= value)) grid.set(n, value); }
  return (a, b) => {
    const fa = a / cell, fb = b / cell, ia = Math.floor(fa), ib = Math.floor(fb);
    let best = -Infinity;
    for (let da = -1; da <= 2; da++) for (let db = -1; db <= 2; db++) {
      const value = grid.get(id(ia + da, ib + db));
      if (value === undefined) continue;
      const far = Math.hypot(ia + da - fa, ib + db - fb), kept = value - cell * 1.2 * smooth(.6, 1.9, far);
      if (far < 1.9 && kept > best) best = kept;
    }
    return best;
  };
}

function sheetGrid(body, m, f, { tip, pole = [0, .78, .62], spread = 100, leave = 8, over = .012, volume = .012, tuck = 0, wave = 0, locks = 30, depth = .0025, clump = .006, ragged = .03, cols = 96, rows = 40, fall = .2 } = {}) {
  const k = f.k, head = body.weight(/^(head|neck)/), skull = [], torso = [];
  for (let v = 0; v < body.count; v++) {
    const p = body.point(v);
    if (head[v] > .5) skull.push(p); else if (body.arm[v] < .7 && p[1] > m.chest[1] - .3 * k) torso.push(p);
  }
  const topY = f.top + .01 * k, deep = topY - (m.chest[1] - .3 * k), cz = f.centre[2];
  const env = new Envelope([0, topY, cz], [0, -1, 0], 0, deep, Math.round(deep / (.01 * k)), 72);
  env.fixed = true;
  env.measure(skull).taut(1, 1.6).hang(9, .7).soften(3);
  const back = reach(torso, .012 * k, p => [p[0], p[1]], p => -p[2]), floor = reach(torso, .012 * k, p => [p[0], p[2]], p => p[1]), bone = f.bone;
  const P = unit(pole), away = [0, .3, -1], t0 = unit(sub(away, P.map(x => x * dot(away, P)))), e = cross(t0, P), dip = Math.sin(leave * DEG), stride = 2 * DEG;
  const lanes = Array.from({ length: cols + 1 }, (_, j) => {
    const w = mix(-spread, spread, j / cols) * DEG, heading = t0.map((x, n) => x * Math.cos(w) + e[n] * Math.sin(w)), walk = [];
    let run = 0;
    for (let turn = 0; turn < Math.PI; turn += stride) {
      const q = P.map((x, n) => x * Math.cos(turn) + heading[n] * Math.sin(turn));
      if (walk.length) run += (bone(q) + over * k) * stride;
      walk.push({ run, q });
      if (q[1] < dip && turn > .15) break;
    }
    const last = walk.at(-1), start = add(f.centre, last.q, bone(last.q)), side = Math.abs(Math.atan2(start[0], start[2] - cz)) / DEG;
    const stripe = t => { const x = (w / TAU + .5) * locks + wave * .45 * Math.sin(t * 7 + w * 3), lock = ((Math.floor(x) % locks) + locks) % locks; return { lock, across: Math.abs(Math.cos(Math.PI * (x - lock))) }; };
    const { lock, across } = stripe(1);
    let end = tip(side) + ragged * k * (hash1(lock * 5 + 1) - .5) + ragged * .5 * k * (1 - across);
    if (side < 118) end = Math.max(end, floor(start[0] * 1.15, cz + (start[2] - cz) * 1.15) + .012 * k);
    return { walk, start, stripe, angle: env.polar(start)[1], total: last.run + Math.max(.02 * k, start[1] - end), lead: spread < 180 ? smooth(0, 34 * DEG, spread * DEG - Math.abs(w)) : 1 };
  });
  const longest = Math.max(...lanes.map(lane => lane.total)), grid = [];
  const outer = Array.from({ length: rows + 1 }, () => []), inner = Array.from({ length: rows + 1 }, () => []);
  for (const { walk, start, stripe, angle, total, lead } of lanes) {
    const column = [], onSkull = walk.at(-1).run;
    let rest = 0, y = 0;
    for (let i = 0; i <= rows; i++) {
      const along = Math.min(total, longest * (i / rows) ** 1.1), t = along / total, { lock, across } = stripe(t), out = smooth(0, .1, t);
      const thin = Math.max(.0022, mix(.013, .0035, smooth(.45, 1, t)) * mix(.12, 1, lead)) * k;
      const gap = (depth * (.55 + .45 * hash1(lock * 7 + 3)) + clump * smooth(.3, 1, t)) * k * (across ** .7 - .55) * out;
      const full = lead * smooth(.08, .5, t) * (volume * k * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** .7 + wave * .006 * k * Math.sin(t * 9 + lock * 1.3));
      const off = mix(over, mix(.0025, over, lead), out) * k + full + gap * mix(.3, 1, lead);
      if (along <= onSkull) {
        const n = Math.min(walk.length - 2, Math.max(0, walk.findIndex(step => step.run > along) - 1)), u = clamp((along - walk[n].run) / (walk[n + 1].run - walk[n].run)), q = unit(lerp(walk[n].q, walk[n + 1].q, u)), far = bone(q);
        const p = add(f.centre, q, far + off);
        rest = Math.hypot(p[0], p[2] - cz); y = p[1];
        column.push({ y, p, inner: add(f.centre, q, far + Math.max(.0015 * k, off - thin)), room: 0, push: 0 });
        continue;
      }
      const before = y;
      y = start[1] - (along - onSkull);
      const h = topY - y, base = env.sample(h, angle);
      rest = Math.max(base + off, rest - fall * Math.max(0, before - y));
      const r = Math.max(base + .003 * k, rest - tuck * k * smooth(.5, 1, t));
      column.push({ y, p: env.point(h, angle, r), base, thin, room: thin + .003 * k + Math.max(0, full) * .5, push: 0 });
    }
    for (const c of column) c.push = c.room && Math.abs(Math.atan2(c.p[0], c.p[2] - cz)) > 108 * DEG ? Math.max(0, c.p[2] + back(c.p[0], c.y) + c.room) : 0;
    grid.push(column);
  }
  const ease = (a, b, slope) => { if (a.room) a.push = Math.max(a.push, b.push - slope * Math.hypot(a.p[0] - b.p[0], a.y - b.y, a.p[2] - b.p[2])); };
  for (const column of grid) {
    for (let i = 1; i <= rows; i++) ease(column[i], column[i - 1], .5);
    for (let i = rows - 1; i >= 0; i--) ease(column[i], column[i + 1], .9);
  }
  for (let i = 0; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) ease(grid[j][i], grid[j - 1][i], .45);
    for (let j = cols - 1; j >= 0; j--) ease(grid[j][i], grid[j + 1][i], .45);
  }
  for (const column of grid) column.forEach((c, i) => {
    if (c.inner) { outer[i].push(c.p); inner[i].push(c.inner); return; }
    const p = [c.p[0], c.y, c.p[2] - c.push], far = Math.hypot(p[0], p[2] - cz), near = Math.max(c.base + .0015 * k, far - c.thin) / far;
    outer[i].push(p); inner[i].push([p[0] * near, c.y, cz + (p[2] - cz) * near]);
  });
  return { outer, inner };
}
function sheet(body, m, f, options) {
  const { outer, inner } = sheetGrid(body, m, f, options);
  return new Piece().slab(outer, inner, hangSkin(body, m));
}

const SHORT = dir => mix(.005, .011, smooth(-10 * DEG, 55 * DEG, dir.eps));

const cuts = {
  "Buzz cut"(body, m) {
    const f = headFrame(body, m), s = cap(body, m, f, { thick: () => .003, lip: .0016, edge: .05, levels: 1 });
    return [{ piece: new Piece().shell(s, { thickness: .002 }), name: "Buzz cut" }];
  },
  "Crop"(body, m) {
    const f = headFrame(body, m);
    const s = cap(body, m, f, { thick: dir => SHORT(dir) + .006 * smooth(.3, .9, dir.q[2]) * smooth(.3, .8, dir.q[1]), pole: [0, .8, -.6], grooves: 34, depth: .0022, twist: .5 });
    return [{ piece: new Piece().shell(s), name: "Crop" }];
  },
  "Side part"(body, m) {
    const f = headFrame(body, m);
    const s = cap(body, m, f, {
      thick: dir => mix(.006, .013, smooth(0, 50 * DEG, dir.eps)) + .012 * Math.exp(-(((dir.q[0] + .25) / .4) ** 2 + ((dir.q[2] - .65) / .4) ** 2)) * smooth(.2, .7, dir.q[1]),
      pole: [.42, .78, -.46], grooves: 30, depth: .0024, twist: -.25, part: Object.assign([.1, -.25, 1], { depth: .005 }),
    });
    return [{ piece: new Piece().shell(s), name: "Side part" }];
  },
  "Swept back"(body, m) {
    const f = headFrame(body, m);
    const s = cap(body, m, f, { thick: dir => mix(.005, .012, smooth(0, 55 * DEG, dir.eps)) + .014 * smooth(.2, .9, dir.q[2]) * smooth(.35, .8, dir.q[1]), pole: [0, .5, .87], grooves: 32, depth: .0026, edge: .2 });
    return [{ piece: new Piece().shell(s), name: "Swept back" }];
  },
  "Curls"(body, m) {
    const f = headFrame(body, m);
    const s = cap(body, m, f, { thick: dir => mix(.008, .022, smooth(-5 * DEG, 50 * DEG, dir.eps)), edge: .22, curl: { size: .014, height: .006 } });
    return [{ piece: new Piece().shell(s), name: "Curls" }];
  },
  "Afro"(body, m) {
    const f = headFrame(body, m);
    const ball = f.size + .04 * f.k, middle = add(f.centre, [0, .006 * f.k, -.006 * f.k]), shift = sub(f.centre, middle);
    const thick = dir => { const span = [dir.q[0] * f.radii[0], dir.q[1] * f.radii[1], dir.q[2] * f.radii[2]], u = unit(span), b = dot(u, shift); return Math.max(.01, (-b + Math.sqrt(Math.max(0, b * b - dot(shift, shift) + ball * ball)) - length(span)) / f.k); };
    const s = cap(body, m, f, { thick, edge: .42, round: 0, lip: .004, raise: -9, curl: { size: .02, height: .007 } });
    return [{ piece: new Piece().shell(s), name: "Afro" }];
  },
  "Bob"(body, m) {
    const f = headFrame(body, m), o = LENGTHS.Bob(f, m);
    const s = cap(body, m, f, { thick: () => .006, pole: o.pole, grooves: 30, depth: .0015 });
    return [{ piece: new Piece().shell(s), name: "Bob" }, { piece: sheet(body, m, f, o), name: "Bob lengths", fringe: true }];
  },
  "Long"(body, m) {
    const f = headFrame(body, m), o = LENGTHS.Long(f, m);
    const s = cap(body, m, f, { thick: () => .006, pole: o.pole, grooves: 30, depth: .0018 });
    return [{ piece: new Piece().shell(s), name: "Long hair" }, { piece: sheet(body, m, f, o), name: "Long lengths", loose: true }];
  },
  "Wavy"(body, m) {
    const f = headFrame(body, m), o = LENGTHS.Wavy(f, m);
    const s = cap(body, m, f, { thick: () => .007, pole: o.pole, grooves: 26, depth: .002 });
    return [{ piece: new Piece().shell(s), name: "Wavy hair" }, { piece: sheet(body, m, f, o), name: "Wavy lengths", loose: true }];
  },
  "Ponytail"(body, m) {
    const f = headFrame(body, m), skin = hangSkin(body, m), t = TIED.Ponytail(body, m, f);
    const s = cap(body, m, f, { thick: dir => .006 + .004 * smooth(.2, .9, dir.q[2]), pole: [0, .55, .84], grooves: 34, depth: .002 });
    const tail = new Piece();
    tail.loft(t.tubes[0].rings, skin, { capStart: true, capEnd: true, flip: true });
    return [{ piece: new Piece().shell(s), name: "Ponytail" }, { piece: tail, name: "Ponytail tail", loose: true }, ...t.ties];
  },
  "Bun"(body, m) {
    const f = headFrame(body, m), t = TIED.Bun(body, m, f);
    const s = cap(body, m, f, { thick: dir => .006 + .003 * smooth(.2, .9, dir.q[2]), pole: [0, .55, .84], grooves: 34, depth: .002 });
    const bun = new Piece();
    bun.loft(t.tubes[0].rings, body.rigid("head"), { capEnd: true, flip: true });
    return [{ piece: new Piece().shell(s), name: "Bun" }, { piece: bun, name: "Bun knot", loose: true }];
  },
  "Braid"(body, m) {
    const f = headFrame(body, m), skin = hangSkin(body, m), t = TIED.Braid(body, m, f);
    const s = cap(body, m, f, { thick: dir => .007 + .004 * smooth(.2, .9, dir.q[2]), pole: [0, .6, .8], grooves: 32, depth: .002, part: Object.assign([0, 1, -.2], { depth: .003 }) });
    const braid = new Piece();
    for (const { rings, tuft } of t.tubes) braid.loft(rings, tuft ? skin(rings[0][0]) : skin, { capStart: true, capEnd: true, flip: true });
    return [{ piece: new Piece().shell(s), name: "Braid" }, { piece: braid, name: "Braid plait", loose: true }, ...t.ties];
  },
};

const LENGTHS = {
  Bob: (f, m, k = f.k, jaw = f.eye[1] - .095 * k) => ({ pole: [0, .97, -.24], spread: 180, tip: side => mix(f.eye[1] + .05 * k, jaw, smooth(40, 72, side) ** 1.3), over: .012, volume: .007, tuck: .014, locks: 40, clump: .0045, ragged: .016, rows: 30 }),
  Long: (f, m, k = f.k) => ({ pole: [0, .8, .6], spread: 98, tip: side => mix(m.shoulder + .035 * k, m.chest[1] + .07 * k, smooth(112, 150, side)), over: .012, volume: .006, locks: 34 }),
  Wavy: (f, m, k = f.k) => ({ pole: [.3, .8, .5], spread: 104, tip: side => mix(m.neck[1] + .0 * k, m.shoulder - .01 * k, smooth(100, 150, side)), over: .014, volume: .012, wave: 1, depth: .004, locks: 24, clump: .008 }),
};
const TIED = {
  Ponytail(body, m, f) {
    const k = f.k, at = [0, .55 * f.radii[1], -.83 * f.radii[2]], root = add(f.centre, unit(at), f.size * 1.02), tie = new Piece();
    const rings = tubeRings(bezier(root, add(root, [0, .035 * k, -.06 * k]), add(root, [0, -.08 * k, -.1 * k]), [0, m.neck[1] - .04 * k, root[2] - .05 * k], 18), t => k * mix(.02, .027, Math.sin(Math.PI * Math.min(1, t * 1.6))) * (1 - smooth(.6, 1, t) * .8), { ridges: 9, twist: .4, sides: 18 });
    tube(tie, [add(root, [0, -.004 * k, .008 * k]), add(root, [0, .008 * k, -.016 * k])], () => .024 * k, body.rigid("head"), { sides: 14 });
    return { gather: [0, .55, -.83], tubes: [{ rings }], ties: [{ piece: tie, name: "Hair tie", loose: true, tone: "#3a3331", type: "cloth" }] };
  },
  Bun(body, m, f) {
    const k = f.k, out = unit([0, .5 * f.radii[1], -.86 * f.radii[2]]), root = add(f.centre, out, f.size * 1.08), side = [1, 0, 0], up = cross(out, side), rings = [];
    for (let i = 0; i <= 12; i++) {
      const lat = mix(-.42, .5, i / 12) * Math.PI, r = .043 * k * Math.cos(lat), h = .034 * k * Math.sin(lat);
      rings.push(Array.from({ length: 28 }, (_, j) => { const a = j / 28 * TAU, groove = 1 - .1 * (1 - Math.abs(Math.cos(a * 3.5 + i * .55))); return add(add(add(root, out, h), side, Math.cos(a) * r * groove), up, Math.sin(a) * r * groove); }));
    }
    return { gather: [0, .5, -.86], tubes: [{ rings, wound: true, rigid: true }], ties: [] };
  },
  Braid(body, m, f) {
    const k = f.k, skin = hangSkin(body, m), start = f.place(Math.PI, -.42, -.004 * k), end = [0, m.chest[1] + .04 * k, 0], spine = [], tubes = [];
    for (let i = 0; i <= 44; i++) { const t = i / 44, y = mix(start[1], end[1], t); const p = [0, y, mix(start[2], m.chest[2] - .14 * k, smooth(0, .5, t))];
      const cleared = body.clear(p, .026 * k);
      spine.push(lerp(p, cleared, smooth(.01, .28, t))); }
    for (let strand = 0; strand < 3; strand++) {
      const path = spine.map((p, i) => { const t = i / 44, a = t * TAU * 5.5 + strand * TAU / 3, thin = 1 - .35 * smooth(.6, 1, t); return [p[0] + Math.sin(a) * .014 * k * thin, p[1], p[2] + Math.sin(2 * a) * .007 * k * thin]; });
      tubes.push({ rings: tubeRings(path, t => k * .0125 * (1 - .4 * smooth(.6, 1, t)) * smooth(-.02, .06, t), { sides: 8 }), plait: true });
    }
    const last = spine.at(-1), tie = new Piece();
    tube(tie, [add(last, [0, .012 * k, 0]), add(last, [0, -.006 * k, 0])], () => .014 * k, skin(last), { sides: 12 });
    tubes.push({ rings: tubeRings([add(last, [0, -.004 * k, 0]), add(last, [0, -.05 * k, .004 * k])], t => k * mix(.013, .003, t), { ridges: 7, sides: 14 }), tuft: true });
    return { gather: [0, -.5, -.86], tubes, ties: [{ piece: tie, name: "Hair tie", loose: true, tone: "#3a3331", type: "cloth" }] };
  },
};

export function hairLengths(body, m, name, style = {}) {
  const f = headFrame(body, m), skin = hangSkin(body, m);
  if (LENGTHS[name]) {
    const options = LENGTHS[name](f, m), { outer } = sheetGrid(body, m, f, options);
    if (name === "Bob" && style.fringe && style.fringe !== "As cut") {
      const flat = outer.flat(2);
      combFringe(flat, f, style.fringe);
      outer.forEach((row, i) => row.forEach((p, j) => { const at = (i * row.length + j) * 3; p[0] = flat[at]; p[1] = flat[at + 1]; p[2] = flat[at + 2]; }));
    }
    return { sheets: [{ rows: outer, wave: options.wave ?? 0, around: options.spread >= 180 }], tubes: [], ties: [], gather: null, pole: options.pole, skin };
  }
  if (TIED[name]) return { sheets: [], ...TIED[name](body, m, f), skin, rigid: body.rigid("head") };
  return null;
}

export function hairRoots(body, within = null) {
  const m = { k: body.scale }, f = headFrame(body, m), s = cap(body, m, f, { thick: () => .0016, lip: .0008, edge: .12, levels: 1, within, ragged: within ? 0 : 2.4 });
  return new Piece().shell(s, { thickness: .0012 });
}

export const hairstyles = Object.fromEntries(Object.entries(cuts).map(([name, make]) => [name, (body, m, style = {}) => {
  const parts = make(body, m);
  if (parts.some(part => part.fringe) && style.fringe && style.fringe !== "As cut") {
    const f = headFrame(body, m);
    for (const part of parts) if (part.fringe) combFringe(part.piece.pos, f, style.fringe);
  }
  return parts;
}]));
