import { at, clamp, mix, smooth, type Shell, type Landmarks } from "./kit.js";
import { field } from "./plate-shell.js";
export function fairChest(s: Shell, m: Landmarks, hem: number) {
  const k = m.k,
    n = s.count,
    cell = 0.006 * k;
  let zc = 0;
  for (let i = 0; i < n; i++) zc += at(s.pos, i * 3 + 2) / n;
  const weight = Float32Array.from(
    { length: n },
    (_, i) =>
      smooth(0.01 * k, 0.06 * k, at(s.pos, i * 3 + 2) - zc) *
      smooth(hem - 0.01 * k, hem + 0.05 * k, at(s.pos, i * 3 + 1)) *
      smooth(m.neck[1] - 0.03 * k, m.neck[1] - 0.1 * k, at(s.pos, i * 3 + 1)) *
      (1 - smooth(0.3, 0.7, field(s, "wArm", i))),
  );
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < n; i++)
    if (at(weight, i)) {
      x0 = Math.min(x0, at(s.pos, i * 3));
      x1 = Math.max(x1, at(s.pos, i * 3));
      y0 = Math.min(y0, at(s.pos, i * 3 + 1));
      y1 = Math.max(y1, at(s.pos, i * 3 + 1));
    }
  if (!(x1 > x0)) return;
  const pad = 8,
    w = Math.ceil((x1 - x0) / cell) + 2 * pad + 1,
    h = Math.ceil((y1 - y0) / cell) + 2 * pad + 1;
  const col = (x: number) => (x - x0) / cell + pad,
    row = (y: number) => (y - y0) / cell + pad;
  let high = new Float32Array(w * h).fill(-Infinity);
  const tris = s.tri.length / 3;
  for (let t = 0; t < tris; t++) {
    const a = at(s.tri, t * 3),
      b = at(s.tri, t * 3 + 1),
      c = at(s.tri, t * 3 + 2);
    if (!at(weight, a) && !at(weight, b) && !at(weight, c)) continue;
    for (let u = 0; u <= 4; u++)
      for (let v = 0; v <= 4 - u; v++) {
        const wa = u / 4,
          wb = v / 4,
          wc = 1 - wa - wb,
          coordinate = (d: number) =>
            at(s.pos, a * 3 + d) * wa + at(s.pos, b * 3 + d) * wb + at(s.pos, c * 3 + d) * wc;
        const i = Math.round(col(coordinate(0))),
          j = Math.round(row(coordinate(1)));
        if (i >= 0 && i < w && j >= 0 && j < h)
          high[j * w + i] = Math.max(at(high, j * w + i), coordinate(2));
      }
  }
  for (let left = true, guard = 0; left && guard < w + h; guard++) {
    left = false;
    const next = high.slice();
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        if (at(high, j * w + i) > -Infinity) continue;
        let sum = 0,
          count = 0;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const v = at(high, (j + dj) * w + i + di);
          if (i + di >= 0 && i + di < w && j + dj >= 0 && j + dj < h && v > -Infinity) {
            sum += v;
            count++;
          }
        }
        if (count) next[j * w + i] = sum / count;
        else left = true;
      }
    high = next;
  }
  const box = (field: Float32Array<ArrayBuffer>, r: number, pick: boolean) => {
    for (const [di, dj] of [
      [1, 0],
      [0, 1],
    ] as const) {
      const next = new Float32Array(w * h);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          let sum = 0,
            most = -Infinity,
            count = 0;
          for (let q = -r; q <= r; q++) {
            const ii = clamp(i + di * q, 0, w - 1),
              jj = clamp(j + dj * q, 0, h - 1),
              v = at(field, jj * w + ii);
            sum += v;
            most = Math.max(most, v);
            count++;
          }
          next[j * w + i] = pick ? most : sum / count;
        }
      field = next;
    }
    return field;
  };
  let even = high;
  for (let pass = 0; pass < 3; pass++) even = box(even, 6, false);
  let over = high.map((v, i) => Math.max(0, v - at(even, i)));
  over = box(box(box(over, 6, true), 2, false), 2, false);
  const sample = (field: Float32Array, x: number, y: number) => {
    const fi = clamp(col(x), 0, w - 1.001),
      fj = clamp(row(y), 0, h - 1.001),
      i = Math.floor(fi),
      j = Math.floor(fj),
      u = fi - i,
      v = fj - j;
    return mix(
      mix(at(field, j * w + i), at(field, j * w + i + 1), u),
      mix(at(field, (j + 1) * w + i), at(field, (j + 1) * w + i + 1), u),
      v,
    );
  };
  for (let i = 0; i < n; i++)
    if (at(weight, i)) {
      const x = at(s.pos, i * 3),
        y = at(s.pos, i * 3 + 1),
        target = sample(even, x, y) + sample(over, x, y) + 0.001 * k;
      s.pos[i * 3 + 2] = at(s.pos, i * 3 + 2) + at(weight, i) * (target - at(s.pos, i * 3 + 2));
    }
}
