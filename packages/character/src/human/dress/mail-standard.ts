import {
  Piece,
  add,
  mix,
  raycaster,
  at,
  lerp3,
  sub,
  cross,
  unit,
  type DressBody,
  type Landmarks,
  type Vec,
} from "./kit.js";
const mailPitch = 0.011,
  mailCourse = 0.0055,
  mailCell = [2 * mailPitch, 4 * mailCourse] as const;

export function mailStandard(
  body: DressBody,
  m: Landmarks,
  shells: readonly { pos: ArrayLike<number>; tri: ArrayLike<number> }[],
  columns: number,
) {
  const k = m.k,
    neck = m.neck,
    centre = add(neck, [0, -0.115 * k, 0]);
  const neckRay = raycaster(body.P, body.tri),
    head = body.weight(/^head/),
    upper = [];
  for (let i = 0; i < body.tri.length; i += 3) {
    const ids = body.tri.slice(i, i + 3);
    if (ids.some((v) => at(head, v) < 0.38 && Math.abs(at(body.P, v * 3 + 1) - neck[1]) < 0.2 * k))
      upper.push(...ids);
  }
  const cast = [raycaster(body.P, upper), ...shells.map((s) => raycaster(s.pos, s.tri))];
  const outer: Vec[][] = [],
    rows = 10;
  const opening = (v: number) => 0.012 + 0.2 * Math.max(0, 1 - v / 0.36) ** 1.4;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows,
      frontGap = opening(v);
    const outside = [];
    for (let j = 0; j <= columns; j++) {
      const a = mix(frontGap, 2 * Math.PI - frontGap, j / columns);
      const x = Math.sin(a),
        z = Math.cos(a);
      const throatY = neck[1] + (0.02 - 0.036 * Math.max(0, z) ** 2) * k;
      const skinRadius = neckRay([neck[0], throatY, neck[2]], [x, 0, z], 0.18 * k);
      const r = (Number.isFinite(skinRadius) ? skinRadius : 0.065 * k) + 0.009 * k;
      const start = Math.atan2(r, throatY - centre[1]);
      const slope = mix(start, 0.91 + 0.61 * Math.max(0, z) ** 2 + 0.25 * Math.max(0, -z) ** 2, v);
      const dir: Vec = [x * Math.sin(slope), Math.cos(slope), z * Math.sin(slope)];
      const reach = 0.42 * k,
        origin = add(centre, dir, reach),
        inward: Vec = [-dir[0], -dir[1], -dir[2]];
      const hit = Math.min(...cast.map((fn) => fn(origin, inward, reach)));
      const throat = r / Math.sin(start);
      const measured = Number.isFinite(hit) ? reach - hit : throat;
      const dist = mix(throat, Math.max(measured, throat * 0.6), Math.min(1, v * 4)) + 0.0045 * k;
      outside.push(add(centre, dir, dist));
    }
    outer.push(outside);
  }
  const point = (i: number, j: number): Vec => outer[i]?.[j] ?? centre;
  for (let pass = 0; pass < 3; pass++) {
    const radius = outer.map((row) =>
      row.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])),
    );
    const r = (i: number, j: number) => radius[i]?.[j] ?? 0;
    for (let i = 1; i <= rows; i++)
      for (let j = 0; j <= columns; j++) {
        const mid = r(i, j);
        const average =
          (r(i - 1, j) +
            r(Math.min(rows, i + 1), j) +
            r(i, Math.max(0, j - 1)) +
            r(i, Math.min(columns, j + 1))) /
          4;
        const lift = Math.max(0, average - mid) + (pass === 0 ? 0.004 * k : 0);
        const dir = unit(sub(point(i, j), centre));
        const row = outer[i];
        if (row) row[j] = add(point(i, j), dir, lift);
      }
  }
  const surface = (v: number, t: number) => {
    const fi = Math.min(rows - 1e-6, Math.max(0, v * rows)),
      fj = Math.min(columns - 1e-6, Math.max(0, t * columns)),
      i = Math.floor(fi),
      j = Math.floor(fj),
      p = fi - i,
      q = fj - j;
    return lerp3(
      lerp3(point(i, j), point(i, j + 1), q),
      lerp3(point(i + 1, j), point(i + 1, j + 1), q),
      p,
    );
  };
  const far = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const skin = body.rigid("spine_03"),
    mail = new Piece();
  mail.mailUV = [];
  const fine = 40,
    run = Array.from({ length: columns + 1 }, (_, j) => {
      const sum = [0];
      for (let i = 0; i < fine; i++)
        sum.push(
          at(sum, i) + far(surface(i / fine, j / columns), surface((i + 1) / fine, j / columns)),
        );
      return sum;
    });
  const depth = Math.min(5 * mailCell[1] * k, ...run.map((sum) => at(sum, fine))),
    bands = Math.max(3, Math.round(depth / (mailCell[1] * k)));
  const lines = run.map((sum) =>
    Array.from({ length: bands + 1 }, (_, n) => {
      const want = (depth * Math.min(n, bands - 0.5)) / (bands - 0.5);
      let i = 1;
      while (i < fine && at(sum, i) < want) i++;
      return (
        (i - 1 + Math.min(1, (want - at(sum, i - 1)) / (at(sum, i) - at(sum, i - 1) || 1))) / fine
      );
    }),
  );
  const hung = (n: number, t: number) => {
    const fj = Math.min(columns - 1e-6, Math.max(0, t * columns)),
      j = Math.floor(fj);
    return surface(mix(lines[j]?.[n] ?? 0, lines[j + 1]?.[n] ?? 0, fj - j), t);
  };
  for (let band = 0; band < bands; band++) {
    const brass = band === bands - 1;
    let round = 0;
    for (let j = 0; j < 48; j++)
      round +=
        (far(hung(band, j / 48), hung(band, (j + 1) / 48)) +
          far(hung(band + 1, j / 48), hung(band + 1, (j + 1) / 48))) /
        2;
    const cells = Math.max(6, Math.round(round / (mailCell[0] * k))),
      base = mail.count;
    for (const row of [0, 1])
      for (let j = 0; j <= cells; j++) {
        const p = hung(band + row, j / cells),
          out = sub(p, centre),
          long = Math.hypot(...out) || 1;
        mail.vertex(add(p, out, (row ? 0 : 0.0006 * k) / long), skin);
        mail.mailUV.push(
          (brass ? 0.5 : 0) + 0.5 * (0.02 + 0.96 * (j % 2)),
          brass && row ? 0.5 : 0.01 + 0.98 * ((band + row) % 2),
        );
      }
    for (let j = 0; j < cells; j++) {
      const a = base + j,
        b = a + 1,
        c = base + cells + 1 + j,
        d = c + 1;
      mail.tri.push(a, b, c, b, d, c);
    }
  }
  const band = new Piece(),
    buckle = new Piece(),
    steps = Math.max(12, Math.round(columns * 0.6));
  const line = Array.from({ length: steps + 1 }, (_, j) => surface(0, j / steps)),
    under = Array.from({ length: steps + 1 }, (_, j) => surface(0.07, j / steps));
  const rings = line.map((p, j) => {
    const tangent = unit(sub(line[Math.min(steps, j + 1)] ?? p, line[Math.max(0, j - 1)] ?? p));
    const along = unit(sub(under[j] ?? p, p)),
      out = cross(along, tangent);
    const side = out[0] * (p[0] - centre[0]) + out[2] * (p[2] - centre[2]) < 0 ? -1 : 1,
      wide = 0.0085 * k,
      proud = 0.0034 * k;
    return (
      [
        [-0.9, 0.25],
        [-0.5, 1],
        [0.6, 1],
        [1.1, 0.2],
        [0.5, -0.5],
        [-0.6, -0.5],
      ] as const
    ).map(([x, y]) => add(add(p, along, x * wide), out, side * y * proud));
  });
  band.loft(rings, skin, { closed: true, capStart: true, capEnd: true });
  const strapAt = 0.2,
    left = surface(strapAt, 0.012),
    right = surface(strapAt, 0.988),
    across = sub(right, left),
    wide = Math.hypot(...across) || 1;
  const forward: Vec = [0, 0.2, 1],
    tall = 0.0075 * k,
    strap = (from: number, to: number, lift: number, half: number, piece: Piece) => {
      const outerRow = [],
        innerRow = [];
      for (const y of [half, -half]) {
        const o = [],
          n = [];
        for (const t of [from, (from + to) / 2, to]) {
          const p = add(add(left, across, t), [0, 1, 0], y),
            bow = lift + 0.004 * k * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
          o.push(add(p, forward, bow));
          n.push(add(p, forward, bow - 0.0028 * k));
        }
        outerRow.push(o);
        innerRow.push(n);
      }
      piece.slab(outerRow, innerRow, skin);
    };
  strap((-0.9 * 0.012 * k) / wide - 0.55, 1.55, 0.003 * k, tall, band);
  strap(0.5 - (0.011 * k) / wide, 0.5 + (0.011 * k) / wide, 0.006 * k, tall * 1.5, buckle);
  return { mail, band, buckle };
}
