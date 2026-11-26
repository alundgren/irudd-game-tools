import { Envelope, Piece, add, clamp, mergeSkin, mix, raycaster, smooth, unit, sub } from "./human-style-kit.js";

const ARMS = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)/, TAU = Math.PI * 2;

function shoulderYoke(body, m, shells, envelopePoint) {
  const k = m.k, centre = add(m.neck, [0, -.13 * k, 0]);
  const neckCast = raycaster(body.P, body.tri);
  const head = body.weight(/^head/), triangles = [];
  for (let i = 0; i < body.tri.length; i += 3) {
    const a = body.tri[i], b = body.tri[i + 1], c = body.tri[i + 2];
    if ([a, b, c].some(v => head[v] < .4 && Math.abs(body.P[v*3 + 1] - m.neck[1]) < .24*k))
      triangles.push(a, b, c);
  }
  const surfaces = [raycaster(body.P, triangles), ...shells.map(s => raycaster(s.pos, s.tri))];
  return (h, angle, ease, inset) => {
    const length = .135 * k, rad = [-Math.sin(angle), 0, Math.cos(angle)];
    const throat = [m.neck[0], m.neck[1] + (.023 - .041 * Math.max(0, rad[2])) * k, m.neck[2]];
    const skin = neckCast(throat, rad, .19*k);
    const rim = add(throat, rad, (Number.isFinite(skin) ? skin : .065*k) + .013*k);
    const hem = envelopePoint(length, angle);
    const t = clamp(h / length);
    const target = rim.map((x, i) => mix(x, hem[i], t)), dir = unit(sub(target, centre));
    const distance = p => Math.hypot(...sub(p, centre));
    const reach = .46*k, origin = add(centre, dir, reach), inward = dir.map(x => -x);
    const hit = Math.min(...surfaces.map(cast => cast(origin, inward, reach)));
    const measured = Number.isFinite(hit) ? reach - hit + (.008*k + ease) : distance(target);
    const radius = mix(mix(distance(rim), measured, smooth(0, .18, t)), distance(hem), smooth(.65, 1, t));
    return add(centre, dir, radius - inset);
  };
}

export function mantle(body, m, shells, { drop, open, swing, ease = .018, fold = .011, facing = .1, cols = 60, armLow = m.waist, split = 0, flare = 0 }) {
  const k = m.k, top = m.neck[1] + .006 * k, arm = body.weight(ARMS), head = body.weight(/^head/), points = [];
  let depth = 0;
  for (let j = 0; j <= 32; j++) {
    const angle = j / 32 * Math.PI;
    depth = Math.max(depth, drop(angle, 1), drop(angle, -1));
  }
  const bottom = top - depth;
  for (let v = 0; v < body.count; v++) { const y = body.P[v * 3 + 1]; if (head[v] < .5 && y < top + .03 * k && y > bottom - .03 * k && (arm[v] < .1 || y > armLow)) points.push(body.point(v)); }
  for (const s of shells) for (let i = 0; i < s.pos.length; i += 3) { const y = s.pos[i + 1]; if (y < top + .03 * k && y > bottom - .03 * k && ((s.f?.wArm?.[i / 3] ?? 0) < .1 || y > armLow)) points.push([s.pos[i], y, s.pos[i + 2]]); }
  const rows = Math.max(6, Math.round(depth / (.028 * k)));
  const env = new Envelope([0, top, m.chest[2]], [0, -1, 0], 0, depth, rows + 1, 64).measure(points).taut(1).hang(swing ? .16 : -.035, swing ? 5 : .7).soften(swing ? 1 : 3);
  const chest = body.bone("spine_03"), mid = body.bone("spine_01"), pelvis = body.bone("pelvis"), long = top - m.knee;
  const left = Math.sign(body.joint("upperarm_l")[0]) || 1, upper = { l: body.bone("upperarm_l"), r: body.bone("upperarm_r") };
  const skin = p => {
    const t = clamp((top - p[1]) / long), low = smooth(.15, .6, t), far = smooth(.5, 1, t) * .6, v = body.nearest(p, 3);
    const lifted = v >= 0 ? .8 * smooth(.3, .8, arm[v]) * smooth(armLow - .06 * k, armLow + .04 * k, p[1]) : 0;
    return mergeSkin([[chest, (1 - low) * (1 - lifted)], [mid, low * (1 - far) * (1 - lifted)], [pelvis, low * far * (1 - lifted)], [p[0] * left > 0 ? upper.l : upper.r, lifted]]);
  };
  const widest = new Map(), reach = (h, angle) => { const key = Math.round(angle * 40), r = Math.max(env.sample(h, angle), widest.get(key) ?? 0); widest.set(key, r); return r; };
  const hangRadius = (h, angle) => {
    if (!swing) return reach(h, angle);
    let radius = env.sample(h, angle);
    for (let row = 0; row < rows; row++) {
      const above = row * depth / rows;
      if (above >= h) break;
      radius = Math.max(radius, env.sample(above, angle) - .025 * (h-above));
    }
    return radius;
  };
  const yoke = swing && shoulderYoke(body, m, shells, (h, angle) =>
    env.point(h, angle, hangRadius(h, angle) + ease*k*.55));
  const point = (v, cutAngle, inset) => {
    const angle = cutAngle + (swing ? swing(v) : 0);
    const around = Math.min(angle, TAU - angle), h = drop(around, angle <= Math.PI ? 1 : -1) * v;
    const fullness = swing ? .26 + .94 * smooth(0,.55,v) : 1 + 1.2*v;
    const pleats = swing
      ? .68*Math.cos(7*cutAngle - 1.9*v + .77*Math.sin(cutAngle*2)) +
        .32*Math.cos(12*cutAngle + 1.6*v + .5*Math.sin(cutAngle*3))
      : Math.sin(angle*9 + 1.7*Math.sin(angle*2.3));
    const foldDepth = swing ? smooth(.01,.42,v)*(.30+.70*smooth(0,.65,around)) : smooth(.15,.9,v)*smooth(0,.25,around-open(v));
    const r = hangRadius(h,angle) + ease*k*fullness + flare*k*v*v*smooth(1.2,2.2,around) + fold*k*foldDepth*pleats;
    const hanging = env.point(h, angle, r - inset);
    if (!yoke || h >= .135*k) return hanging;
    const fitted = yoke(h, angle, .007*k*foldDepth*(1+pleats), inset);
    const blend = smooth(.09*k, .135*k, h);
    return fitted.map((coord, i) => mix(coord, hanging[i], blend));
  };
  const cloth = new Piece(), lining = new Piece(), turned = v => facing * (1 + 1.4 * v), part = v => split * smooth(.3, 1, v);
  const spans = [[lining, open, v => open(v) + turned(v), 5], [lining, v => TAU - open(v) - turned(v), v => TAU - open(v), 5]];
  if (split) spans.push([cloth, v => open(v) + turned(v), v => Math.PI - part(v), Math.round(cols / 2)], [cloth, v => Math.PI + part(v), v => TAU - open(v) - turned(v), Math.round(cols / 2)]);
  else spans.push([cloth, v => open(v) + turned(v), v => TAU - open(v) - turned(v), cols]);
  const grids = spans.map(() => [[], []]);
  for (let row = 0; row <= rows; row++) spans.forEach(([, from, to, n], at) => {
    const v = row / rows;
    grids[at][0].push(Array.from({ length: n + 1 }, (_, j) => point(v, mix(from(v), to(v), j / n), 0)));
    grids[at][1].push(Array.from({ length: n + 1 }, (_, j) => point(v, mix(from(v), to(v), j / n), .006 * k)));
  });
  spans.forEach(([piece, , , columns], at) => {
    piece.slab(grids[at][0], grids[at][1], skin);
    if (swing && piece === cloth) {
      piece.mantleUV ??= [];
      for (let face = 0; face < 2; face++) for (let row = 0; row <= rows; row++)
        for (let col = 0; col <= columns; col++) piece.mantleUV.push(col / columns, 1 - row / rows);
    }
  });
  return { cloth, lining, env, top, at: (v, side, lift = 0) => {
    const gap = open(v) + turned(v) * .5, angle = side > 0 ? gap : TAU - gap;
    if (!swing) {
      const h = drop(gap, side) * v;
      return env.point(h, angle, env.sample(h, angle) + ease * k + lift);
    }
    const row = Math.round(rows * v);
    const grid = grids[side > 0 ? 0 : 1][0][row];
    const point = grid[Math.floor(grid.length / 2)].slice();
    const actual = angle + swing(row / rows);
    point[0] -= lift * Math.sin(actual);
    point[2] += lift * Math.cos(actual);
    return point;
  } };
}
