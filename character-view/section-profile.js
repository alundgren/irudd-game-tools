export const sectionHeights = [
  0.035, 0.11, 0.2, 0.29, 0.38, 0.47, 0.54, 0.61, 0.68, 0.75, 0.81, 0.86, 0.92,
  0.97,
];

export function validSectionProfile(p) {
  return (
    p &&
    Number.isFinite(p.height) &&
    p.height > 0 &&
    p.height <= 1000 &&
    Array.isArray(p.stations) &&
    p.stations.length === sectionHeights.length &&
    p.stations.every(
      (row) =>
        Array.isArray(row) &&
        row.length === 4 &&
        row.every(
          (n, i) =>
            Number.isFinite(n) &&
            (i < 2 ? n >= 0.72 && n <= 1.32 : Math.abs(n) <= 0.038),
        ),
    )
  );
}

export function sectionWarp(profile) {
  const { height, stations } = profile;
  const slopes = stations.map((row, i) =>
    row.map((v, k) => {
      const a = i
        ? (v - stations[i - 1][k]) / (sectionHeights[i] - sectionHeights[i - 1])
        : 0;
      const b =
        i + 1 < stations.length
          ? (stations[i + 1][k] - v) /
            (sectionHeights[i + 1] - sectionHeights[i])
          : 0;
      return a * b > 0 ? (2 * a * b) / (a + b) : 0;
    }),
  );
  return function apply(v) {
    const y = v.y / height;
    let i = 0;
    while (i < stations.length - 2 && y > sectionHeights[i + 1]) i++;
    const d = sectionHeights[i + 1] - sectionHeights[i];
    const t = Math.max(0, Math.min(1, (y - sectionHeights[i]) / d));
    const b = t * t * (3 - 2 * t),
      m = d * t * (1 - t);
    const at = (k) =>
      (1 - b) * stations[i][k] +
      b * stations[i + 1][k] +
      m * ((1 - t) * slopes[i][k] - t * slopes[i + 1][k]);
    v.x = v.x * at(0) + height * at(2);
    v.z = v.z * at(1) + height * at(3);
    return v;
  };
}
