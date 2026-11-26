
import { add, clamp, dot, hash1, length, mix, noise3, smooth, sub, unit, cross } from "./human-style-kit.js";

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const aimAt = (phi, eps) => [Math.cos(eps) * Math.sin(phi), Math.sin(eps), Math.cos(eps) * Math.cos(phi)];
const slerp = (a, b, t) => {
  const w = Math.acos(clamp(dot(a, b), -1, 1));
  if (w < 1e-5) return a;
  const s = Math.sin(w), x = Math.sin((1 - t) * w) / s, y = Math.sin(t * w) / s;
  return unit([a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y]);
};

const partSide = (locks, fringe) => locks.part ?? (fringe === "Swept left" ? -1 : fringe === "Swept right" ? 1 : 0);

export function lockParting(locks, fringe) {
  const side = partSide(locks, fringe);
  return [aimAt(side * 17 * DEG, 33 * DEG), unit([side * .2, .8, -.58])];
}

function bodyReach(body, axis, top, low, k) {
  const cell = .012 * k, rows = Math.ceil((top - low) / cell) + 1, cols = 48, R = new Float32Array(rows * cols);
  for (let v = 0; v < body.count; v++) {
    const p = body.point(v);
    if (p[1] > top || p[1] < low) continue;
    const row = Math.round((top - p[1]) / cell), col = Math.floor((Math.atan2(p[0] - axis[0], p[2] - axis[1]) + Math.PI) / TAU * cols) % cols, r = Math.hypot(p[0] - axis[0], p[2] - axis[1]);
    if (r > R[row * cols + col]) R[row * cols + col] = r;
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) if (!R[row * cols + col]) R[row * cols + col] = Math.max(R[row * cols + (col + 1) % cols], R[row * cols + (col + cols - 1) % cols]);
  return (y, bearing) => {
    const fr = clamp((top - y) / cell, 0, rows - 1.001), fc = ((bearing + Math.PI) / TAU * cols - .5 + cols) % cols, r0 = Math.floor(fr), c0 = Math.floor(fc), s = fr - r0, t = fc - c0, c1 = (c0 + 1) % cols;
    return mix(mix(R[r0 * cols + c0], R[r0 * cols + c1], t), mix(R[(r0 + 1) * cols + c0], R[(r0 + 1) * cols + c1], t), s);
  };
}

export function lockCards(cards, { locks, fringe, f, k, m, body, seat, skinOf, tiles, hair, game, tucked = false }) {
  const mm = k / 1000, side0 = partSide(locks, fringe), [front, crown] = lockParting(locks, fringe);
  const axis = [0, (f.centre[2] + m.neck[2]) / 2], shoulder = m.shoulder + .035 * k, low = m.shoulder - .34 * k;
  const reach = bodyReach(body, axis, f.centre[1] + .02 * k, low, k);
  const light = clamp(.2126 * hair.r + .7152 * hair.g + .0722 * hair.b), depth = mix(.13, .24, smooth(.05, .6, light));
  const wave = (locks.wave ?? 0) * k, period = .1 * k;
  const share = .5;

  const lockPath = (side, a, L) => {
    const start = slerp(front, crown, clamp(a / share)), q0 = unit(add(start, [side, 0, 0], .016));
    const leave = aimAt(side * mix(60, 180, a ** .92) * DEG, mix(-3, -25, smooth(.3, 1, a)) * DEG);
    const far = side0 && side !== side0 ? 1 : 0, bow = (.13 + .08 * far) * (1 - smooth(0, .55, a));
    const stations = [];
    for (let i = 0; i <= L.headSteps; i++) {
      const u = mix(L.from, 1, i / L.headSteps);
      let q = slerp(q0, leave, u);
      q = unit(add(q, [0, 1, 0], bow * Math.sin(Math.PI * u) * (1 - .4 * u)));
      const rise = smooth(L.from, L.from + .42, u), h = mix(.7 * mm, L.volume * mm * (1 + .12 * Math.sin(Math.PI * u)), rise) + L.out * rise;
      const at = seat(q, h);
      stations.push({ p: at.p, n: at.n });
    }
    const last = stations[stations.length - 1].p, bearing0 = Math.atan2(last[0] - axis[0], last[2] - axis[1]), r0 = Math.hypot(last[0] - axis[0], last[2] - axis[1]), y0 = last[1];
    const tipY = tucked ? y0 - .02 * k : Math.min(y0 - .03 * k, m.shoulder + (mix(locks.tip[0], locks.tip[1], smooth(.1, .8, a)) + (locks.tip[0] > 0 ? .03 * Math.sin(Math.PI * smooth(.05, .8, a)) : 0)) * k + L.long), steps = tucked ? 1 : L.hangSteps;
    const turned = side * (Math.abs(bearing0) < 86 * DEG ? 26 : 158) * DEG;
    const hung = [];
    for (let j = 1; j <= steps; j++) {
      const y = mix(y0, tipY, j / steps), drop = y0 - y, bearing = mix(bearing0, turned, .9 * smooth(shoulder + .1 * k, shoulder - .02 * k, y));
      const sway = wave * smooth(0, .07 * k, drop), turn = L.phase + TAU * drop / period;
      const clear = (y > m.neck[1] ? 5 : 12) * mm + L.out;
      let r = Math.max(r0 * (1 - .14 * smooth(0, .11 * k, drop)) + .55 * sway * Math.cos(turn), reach(y, bearing) + clear);
      hung.push({ y, r, bearing: bearing + sway * Math.sin(turn) / Math.max(r, .05 * k), drop });
    }
    for (let j = hung.length - 2; j >= 0; j--) hung[j].r = Math.max(hung[j].r, hung[j + 1].r - 1.8 * (hung[j].y - hung[j + 1].y));
    let before = r0;
    for (const s of hung) {
      const p = [axis[0] + s.r * Math.sin(s.bearing), s.y, axis[1] + s.r * Math.cos(s.bearing)];
      stations.push({ p, n: unit([Math.sin(s.bearing), .15, Math.cos(s.bearing)]) });
      before = s.r;
    }
    if (locks.curl && !tucked && stations.length > 3) {
      const tip = stations[stations.length - 1], n = tip.n;
      tip.p = add(add(tip.p, n, -locks.curl * .012 * k), [0, 1, 0], locks.curl * .012 * k);
    }
    let run = 0;
    stations.forEach((s, i) => { if (i) run += length(sub(s.p, stations[i - 1].p)); s.run = run; });
    for (const s of stations) s.t = s.run / run;
    return stations;
  };

  const push = (p, n, tone, uv) => {
    const [bones, weights] = skinOf(p);
    cards.position.push(p[0], p[1], p[2]); cards.normal.push(n[0], n[1], n[2]);
    cards.color.push(Math.min(1, hair.r * tone), Math.min(1, hair.g * tone), Math.min(1, hair.b * tone));
    cards.uv.push(uv[0], uv[1]); cards.bones.push(...bones); cards.weights.push(...weights);
  };
  const picture = (tile, x, t) => {
    const row = t < .76 ? mix(.2, .5, t / .76) : mix(.5, 1, (t - .76) / .24);
    return [(tile[0] + 2.5 + (tile[2] - 5) * x) / 256, 1 - (tile[1] + 1.5 + (tile[3] - 3) * (1 - row)) / 256];
  };

  const layer = (index, count, { from, volume, out, headSteps, hangSteps, shade, round, lengths = .03, widen = 1.5, shift = 0 }) => {
    for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
      const rnd = n => hash1(index * 7919 + (side > 0 ? 4001 : 0) + i * 131 + n), gap = 1 / count, a = clamp((i + .5 + shift + .5 * (rnd(1) - .5)) * gap, .004, .996);
      const phase = TAU * (.4 * noise3(a * 2.2 + 7, side * 3.3, index * 1.7) + .05 * rnd(2)) + (side > 0 ? 0 : 1.1) + index * .5;
      const L = { from: from * (.75 + .5 * rnd(3)), volume: volume * (.8 + .4 * rnd(4)), out: out + 2.4 * mm * (rnd(5) - .5), headSteps, hangSteps, long: lengths * k * (rnd(6) - .6), phase };
      const stations = lockPath(side, a, L), left = lockPath(side, clamp(a - gap * .5, 0, 1), L), right = lockPath(side, clamp(a + gap * .5, 0, 1), L);
      const tile = tiles.long[Math.floor(rnd(7) * tiles.long.length) % tiles.long.length], flip = rnd(8) < .5, roll = (rnd(9) - .3) * .5;
      const lockTone = shade * (1 + depth * (1.6 * (noise3(a * 9 + 3, side * 5.1, index * 2.3) - .5) + .5 * (rnd(10) - .5)));
      const first = cards.position.length / 3, across = round ? 3 : 2, n = stations.length;
      stations.forEach((s, j) => {
        const along = unit(sub(stations[Math.min(n - 1, j + 1)].p, stations[Math.max(0, j - 1)].p));
        let side = unit(cross(s.n, along));
        const normal = unit(cross(along, side));
        const turn = roll * smooth(.12, .5, s.t);
        side = unit(add(side.map(x => x * Math.cos(turn)), normal, Math.sin(turn)));
        const room = length(sub(left[j].p, right[j].p)), half = clamp(room * widen, 6 * mm, mix(17, 26, smooth(.4, .8, s.t)) * mm) * (1 - .18 * smooth(.8, 1, s.t));
        const value = lockTone * mix(.66, 1.06, smooth(0, .75, s.t));
        for (let c = 0; c < across; c++) {
          const x = across === 3 ? c / 2 : c, off = (x - .5) * 2;
          const p = add(add(s.p, side, off * half), normal, across === 3 && c === 1 ? .3 * half : 0);
          push(p, unit(add(normal, side, off * .3)), value * (c === 1 && across === 3 ? 1 : .95), picture(tile, flip ? 1 - x : x, s.t));
        }
        if (j) for (let c = 0; c + 1 < across; c++) { const b = first + j * across + c, e = b - across; cards.index.push(e, b + 1, e + 1, e, b, b + 1); }
      });
    }
  };

  {
    const columns = game ? 14 : 22, rows = [], solid = tiles.solid, first = cards.position.length / 3, over = game ? 6 : 8;
    const L = { from: .02, volume: locks.volume * .45, out: -1 * mm, headSteps: over, hangSteps: 5, long: 0, phase: 0 };
    for (const side of [-1, 1]) for (let i = 0; i <= columns; i++) {
      if (side > 0 && i === 0) continue;
      const a = side < 0 ? i / columns : 1 - i / columns, stations = lockPath(side, clamp(a, .002, 1), L), y0 = stations[over].p[1];
      const end = Math.max(shoulder + .012 * k, mix(y0, stations[stations.length - 1].p[1], .62)), column = stations.slice(0, over);
      const hang = stations.slice(over);
      for (let r = 0; r <= 4; r++) {
        const y = mix(y0, Math.min(y0, end), r / 4);
        let j = 0;
        while (j + 2 < hang.length && hang[j + 1].p[1] > y) j++;
        const t = clamp((hang[j].p[1] - y) / Math.max(1e-6, hang[j].p[1] - hang[j + 1].p[1]));
        column.push({ p: [0, 1, 2].map(d => mix(hang[j].p[d], hang[j + 1].p[d], t)), n: hang[j].n });
      }
      rows.push(column);
    }
    rows.forEach((column, c) => column.forEach((s, r) => {
      const [left, top, wide, tall] = solid;
      push(s.p, s.n, .5 * (1 - .25 * depth), [(left + 2 + (wide - 4) * ((c * .37) % 1)) / 256, 1 - (top + 2 + (tall - 4) * (r / (column.length - 1))) / 256]);
    }));
    const tall = rows[0].length;
    for (let c = 0; c + 1 < rows.length; c++) for (let r = 0; r + 1 < tall; r++) { const a = first + c * tall + r, b = a + tall; cards.index.push(a, b, a + 1, a + 1, b, b + 1); }
  }

  const waved = wave > 0, hang = game ? (waved ? 10 : 6) : (waved ? 16 : 10), over = game ? 7 : 9;
  const volume = locks.volume;
  if (!tucked) layer(3, game ? 12 : 18, { from: .82, volume: volume * .35, out: -.5 * mm, headSteps: 1, hangSteps: hang, shade: .7, round: false, lengths: .05, widen: 1.3, shift: .25 });
  layer(2, game ? (waved ? 13 : 18) : 26, { from: .34, volume: volume * .6, out: .5 * mm, headSteps: over - 2, hangSteps: hang, shade: .86, round: !game || !waved, lengths: .045, shift: .5 });
  layer(1, game ? (waved ? 15 : 20) : 28, { from: 0, volume, out: 3 * mm, headSteps: over, hangSteps: hang, shade: 1, round: true });
}

export function sweptTail(cards, { gather, tail = null, f, k, m, body, seat, skinOf, tiles, hair, game, tucked = false }) {
  if (!tail || tucked) return;
  const mm = k / 1000, to = unit(gather), size = tiles.size ?? 256, light = clamp(.2126 * hair.r + .7152 * hair.g + .0722 * hair.b), depth = mix(.13, .24, smooth(.05, .6, light));
  const push = (p, n, tone, uv, dye = hair) => {
    const [bones, weights] = skinOf(p);
    cards.position.push(p[0], p[1], p[2]); cards.normal.push(n[0], n[1], n[2]);
    cards.color.push(Math.min(1, dye.r * tone), Math.min(1, dye.g * tone), Math.min(1, dye.b * tone));
    cards.uv.push(uv[0], uv[1]); cards.bones.push(...bones); cards.weights.push(...weights);
  };
  const picture = (tile, x, row) => [(tile[0] + 2.5 + (tile[2] - 5) * x) / size, 1 - (tile[1] + 1.5 + (tile[3] - 3) * (1 - row)) / size];
  const solidAt = (x, y) => [(tiles.solid[0] + 2 + (tiles.solid[2] - 4) * x) / size, 1 - (tiles.solid[1] + 2 + (tiles.solid[3] - 4) * y) / size];
  const ribbon = (stations, left, right, { tone, tile, flip, rows, widest, widen = 1.4, least = 4, taper = 0, roll = 0, narrow = 1 }) => {
    const first = cards.position.length / 3, n = stations.length;
    let run = 0;
    const far = stations.map((s, j) => j ? run += length(sub(s.p, stations[j - 1].p)) : 0);
    stations.forEach((s, j) => {
      const t = far[j] / run, along = unit(sub(stations[Math.min(n - 1, j + 1)].p, stations[Math.max(0, j - 1)].p));
      let side = unit(cross(s.n, along));
      const normal = unit(cross(along, side)), turn = roll * smooth(.1, .5, t);
      side = unit(add(side.map(x => x * Math.cos(turn)), normal, Math.sin(turn)));
      const half = clamp(length(sub(left[j].p, right[j].p)) * widen, least * mm, widest * mm) * (1 - taper * smooth(.75, 1, t)) * mix(narrow, 1, smooth(0, .25, t));
      for (let c = 0; c < 3; c++) {
        const off = c - 1, p = add(add(s.p, side, off * half), normal, c === 1 ? .16 * half : 0);
        push(p, unit(add(normal, side, off * .3)), tone(t) * (c === 1 ? 1 : .95), picture(tile, flip ? 1 - c / 2 : c / 2, mix(rows[0], rows[1], t)));
      }
      if (j) for (let c = 0; c < 2; c++) { const b = first + j * 3 + c, e = b - 3; cards.index.push(e, b + 1, e + 1, e, b, b + 1); }
    });
  };

  const tie = seat(to, 5 * mm);

  const axis = [0, (f.centre[2] + m.neck[2]) / 2], reach = bodyReach(body, axis, f.centre[1] + .02 * k, m.shoulder - .5 * k, k);
  const out = unit([tie.p[0] - f.centre[0], 0, tie.p[2] - f.centre[2]]), across = [out[2], 0, -out[0]], long = tail.long * k, thick = tail.thick * k / 1.72;
  const steps = game ? 7 : 12;
  const middle = s => {
    const drop = long * s, back = .03 * k * smooth(0, .12, s) * (1 - .5 * smooth(.15, .6, s));
    const p = [tie.p[0] + out[0] * back, tie.p[1] - drop, tie.p[2] + out[2] * back];
    const bearing = Math.atan2(p[0] - axis[0], p[2] - axis[1]), r = Math.hypot(p[0] - axis[0], p[2] - axis[1]), need = reach(p[1], bearing) + 10 * mm + thick * .6;
    if (r < need) { p[0] = axis[0] + need * Math.sin(bearing); p[2] = axis[1] + need * Math.cos(bearing); }
    return p;
  };
  const spine = Array.from({ length: steps + 1 }, (_, j) => middle(j / steps));
  for (let pass = 0; pass < 2; pass++) for (let j = 1; j < steps; j++) for (const d of [0, 2]) spine[j][d] = (spine[j - 1][d] + 2 * spine[j][d] + spine[j + 1][d]) / 4;
  const strand = (angle, ring, grow, sway) => spine.map((c, j) => {
    const s = j / steps, r = thick * ring * mix(.45, 1, smooth(0, .25, s)) * mix(1, .55, smooth(.6, 1, s)) * (1 + .1 * Math.sin(sway + 7 * s));
    const a = angle + .5 * Math.sin(sway + 3.1 * s), n = unit(add(across.map(x => x * Math.cos(a)), out, Math.sin(a)));
    return { p: [c[0] + n[0] * r, c[1] - grow * s, c[2] + n[2] * r], n: unit(add(n, [0, .2, 0], 1)) };
  });
  for (const [index, count, ring, shade] of [[1, game ? 5 : 7, .45, .78], [2, game ? 10 : 14, 1, 1]]) for (let i = 0; i < count; i++) {
    const rnd = n => hash1(index * 3571 + i * 149 + n), gap = TAU / count, angle = (i + .5 * index + .3 * (rnd(1) - .5)) * gap, grow = .05 * k * (rnd(2) - .5), sway = TAU * rnd(3);
    const lockTone = shade * (1 + depth * 1.4 * (rnd(4) - .5));
    ribbon(strand(angle, ring, grow, sway), strand(angle - gap * .5, ring, grow, sway), strand(angle + gap * .5, ring, grow, sway), {
      tone: t => lockTone * mix(.8, 1.06, smooth(0, .6, t)), tile: tiles.long[Math.floor(rnd(5) * tiles.long.length) % tiles.long.length], flip: rnd(6) < .5,
      rows: [.22, 1], widest: 22, widen: 1.5, least: 5, taper: .25, roll: (rnd(7) - .5) * .5,
    });
  }
  {
    const first = cards.position.length / 3, band = { r: .05, g: .045, b: .05 }, sides = 10, at = [spine[0], middle(.045)];
    for (let ring = 0; ring < 2; ring++) for (let i = 0; i <= sides; i++) {
      const a = TAU * i / sides, n = unit(add(across.map(x => x * Math.cos(a)), out, Math.sin(a))), r = thick * .62;
      push([at[ring][0] + n[0] * r, at[ring][1], at[ring][2] + n[2] * r], n, 1, solidAt(.5, .5), band);
    }
    for (let i = 0; i < sides; i++) { const a = first + i, b = a + sides + 1; cards.index.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  return tie.p;
}

const haloLine = bearing => (mix(41, 4, (1 - Math.cos(bearing)) / 2)
  + 3 * Math.sin(bearing) - 2 * Math.sin(2*bearing)) * DEG;
export const haloGather = aimAt(Math.PI, haloLine(Math.PI));

export function haloTubes(seat, k, game) {
  const mm = k / 1000, steps = game ? 78 : 108, sides = game ? 5 : 8, turns = 6, tubes = [];
  const line = Array.from({ length: steps + 1 }, (_, i) => { const bearing = -Math.PI + TAU * i / steps, at = seat(aimAt(bearing, haloLine(bearing)), (6.5 + 3.2 * Math.max(0, Math.cos(bearing))) * mm); return { p: at.p, n: at.n }; });
  line.forEach((s, i) => { const along = unit(sub(line[Math.min(steps, i + 1)].p, line[Math.max(0, i - 1)].p)); s.along = along; s.across = unit(cross(s.n, along)); });
  for (let strand = 0; strand < 3; strand++) {
    const path = line.map((s, i) => { const a = i / steps * TAU * turns + strand * TAU / 3; return add(add(s.p, s.across, Math.sin(a) * 7.6 * mm), s.n, Math.sin(2 * a) * 3.2 * mm); });
    const rings = path.map((p, i) => {
      const s = line[i], along = unit(sub(path[Math.min(steps, i + 1)], path[Math.max(0, i - 1)])), out = unit(sub(s.n, along.map(x => x * dot(s.n, along)))), side = cross(along, out);
      return Array.from({ length: sides }, (_, j) => { const a = j / sides * TAU; return add(add(p, out, Math.cos(a) * 5.8 * mm), side, Math.sin(a) * 7.1 * mm); });
    });
    tubes.push({ rings, plait: true });
  }
  return tubes;
}
