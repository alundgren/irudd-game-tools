const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Range = readonly [number, number];
type Span = readonly [number, number, number, number];
type Track = readonly [number, number, number, number, number][];
interface Options {
  pivot?: "top" | "bottom";
  samples?: number;
  profile?: number;
}
export function bipedTracks(runsAt: (view: 0 | 1, h: number) => Range[]) {
  const output: {
    id: string;
    role: string;
    parent: string | null;
    track: Track;
    options: Options;
  }[] = [];
  const front = (h: number) => runsAt(0, h);
  const profile = (h: number): Range => {
    const runs = runsAt(1, h),
      first = runs[0],
      last = runs.at(-1);
    return first && last ? [-last[1] - 0.009, -first[0] + 0.009] : [-0.15, 0.15];
  };
  const rows = (start: number, end: number, fn: (h: number) => Span, n = 19): Track =>
    Array.from({ length: n }, (_, i) => {
      const h = lerp(start, end, i / (n - 1));
      return [h, ...fn(h)];
    });
  const add = (
    id: string,
    role: string,
    parent: string | null,
    track: Track,
    options: Options = {},
  ) => output.push({ id, role, parent, track, options: { pivot: "top", samples: 32, ...options } });
  const torsoAt = (h: number): Range => {
    const runs = front(h),
      center = runs.find(([a, b]) => a <= 0.01 && b >= -0.01);
    return center || [-0.1, 0.1];
  };
  const arms = [];
  for (const sign of [-1, 1]) {
    const measurements: { h: number; inner: number; outer: number }[] = [];
    for (let i = 0; i <= 56; i++) {
      const h = 0.32 + i * 0.008,
        runs = front(h);
      const core = runs.find(([a, b]) => a <= 0.016 && b >= -0.016);
      if (!core) continue;
      const islands = runs.filter(([a, b]) =>
        sign > 0 ? a > core[1] + 0.009 : b < core[0] - 0.009,
      );
      const edge = sign > 0 ? islands.at(-1)?.[1] : islands[0]?.[0];
      if (edge === undefined) continue;
      const outside = islands.filter(([a, b]) => (sign > 0 ? edge - b < 0.053 : a - edge < 0.053));
      const start = outside[0],
        end = outside.at(-1);
      if (!start || !end) continue;
      const inner = sign > 0 ? start[0] : -end[1];
      const outer = sign > 0 ? end[1] : -start[0];
      if (outer - inner < 0.014 || outer < 0.13) continue;
      measurements.push({ h, inner, outer });
    }
    const first = measurements[0],
      last = measurements.at(-1);
    if (measurements.length < 8 || !first || !last)
      throw new Error(
        "The biped fit needs visible gaps between both arms and the torso. Use a front A-pose or trace individual regions.",
      );

    const rootWidth = clamp(Math.max(...torsoAt(0.795).map(Math.abs)) * 0.81, 0.07, 0.22);
    const shoulder = 0.82;
    const interval = (h: number): Range => {
      if (h >= last.h) {
        const t = clamp((h - last.h) / (shoulder - last.h), 0, 1);
        return [lerp(last.inner, rootWidth * 0.62, t), lerp(last.outer, rootWidth * 1.19, t)];
      }
      const nearest = measurements.reduce(
        (best, p) => (Math.abs(p.h - h) < Math.abs(best.h - h) ? p : best),
        first,
      );
      return [nearest.inner - 0.005, nearest.outer + 0.005];
    };
    arms.push({ sign, first, last, interval, shoulder });
  }
  let crotch = 0.2;
  for (let i = 0; i < 40; i++) {
    const h = 0.16 + i * 0.01;
    if (front(h).some(([a, b]) => a < -0.025 && b > 0.025)) break;
    crotch = h;
  }
  const hip = clamp(crotch + 0.09, 0.4, 0.56);
  const [leftArm, rightArm] = arms;
  if (!leftArm || !rightArm) throw new Error("Both arms need a measurable gap.");
  add(
    "body",
    "torso",
    null,
    rows(hip - 0.025, 0.855, (h) => {
      const [back, fore] = profile(h);
      const [l, r] = torsoAt(h);
      const left = leftArm.interval(h)[0],
        right = rightArm.interval(h)[0];
      const shoulders = h > 0.77 ? clamp((h - 0.77) / 0.075, 0, 1) : 0;
      return [
        Math.max(l, -left * (1 + 0.09 + shoulders * 0.2)),
        Math.min(r, right * (1 + 0.09 + shoulders * 0.2)),
        back,
        fore,
      ];
    }),
    { pivot: "bottom" },
  );
  add(
    "head and neck",
    "head",
    "body",
    rows(0.827, 0.998, (h) => {
      const r = h < 0.859 ? lerp(0.035, 0.072, (h - 0.827) / 0.032) : 0.17;
      return [-r, r, ...profile(h)];
    }),
    { samples: 44, profile: 0.63, pivot: "bottom" },
  );
  for (const { sign, first, interval, shoulder } of arms) {
    const side = sign > 0 ? "left " : "right ";
    const wrist = first.h + 0.068,
      elbow = lerp(wrist, shoulder, 0.48);
    const signed = ([a, b]: Range): Range => (sign > 0 ? [a, b] : [-b, -a]);
    const arm = (low: number, high: number, role: string, id: string, parent: string) =>
      add(
        side + id,
        role,
        parent,
        rows(low, high, (h) => {
          const [a, b] = interval(h),
            [back, fore] = profile(h);
          const t = clamp((h - first.h) / (shoulder - first.h), 0, 1);
          const z = lerp(fore - (fore - back) * 0.35, back + (fore - back) * 0.44, t);
          const radius = clamp((b - a) * 0.49, 0.019, 0.069);
          return [...signed([a, b]), Math.max(back, z - radius), Math.min(fore, z + radius)];
        }),
        { profile: 0.85 },
      );
    arm(elbow - 0.01, shoulder, "upper arm", "upper arm", "body");
    arm(wrist - 0.008, elbow + 0.012, "forearm", "forearm", side + "upper arm");
    arm(first.h - 0.012, wrist + 0.009, "hand", "hand", side + "forearm");
    function leg(low: number, high: number, role: string, id: string, parent: string) {
      add(
        side + id,
        role,
        parent,
        rows(low, high, (h) => {
          const list = front(h)
            .map(([a, b]): Range => (sign > 0 ? [a, b] : [-b, -a]))
            .filter(([a, b]) => b > 0 && a < 0.21);
          const lower = list
            .filter(([a, b]) => a >= -0.011 && a < 0.135 && b - a > 0.017)
            .sort((a, b) => a[0] - b[0])[0];
          const fallback = Math.max(0.05, Math.abs(torsoAt(hip)[sign > 0 ? 1 : 0]));
          const range: Range = lower
            ? [Math.max(0.001, lower[0] - 0.007), lower[1] + 0.008]
            : [0.001, fallback];
          return [...signed(range), ...profile(h)];
        }),
      );
    }
    leg(hip * 0.5 - 0.009, hip + 0.017, "thigh", "thigh", "body");
    leg(0.062, hip * 0.5 + 0.012, "shin", "shin", side + "thigh");
    leg(0.002, 0.078, "foot", "foot", side + "shin");
  }
  return output;
}
