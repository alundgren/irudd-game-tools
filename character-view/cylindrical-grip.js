export const palmDimensions = [0.085, 0.18, 0.039];
export const gripCentre = [0, -0.095, 0.026];
export const gripRadius = 0.015;
export function closedDigitRows(rows, thumb, side) {
  const cy = gripCentre[1],
    cz = gripCentre[2],
    r = gripRadius;
  if (thumb) {
    const controls = [
      [-0.023, -0.033, 0.009],
      [-0.038, -0.049, 0.019],
      [-0.047, -0.065, 0.031],
      [-0.043, cy + 0.01, cz + 0.016],
      [-0.026, cy + 0.006, cz + 0.009],
    ];
    return rows.map((row, i) => [
      controls[i][0] * side,
      controls[i][1],
      controls[i][2],
      row[3],
      row[4],
    ]);
  }
  const angles = [-90, -131, -174, -219, -251].map((d) => (d * Math.PI) / 180);
  return rows.map((row, i) => {
    if (!i) return [row[0], -0.083, 0.004, row[3], row[4]];
    const ring = r + 0.43 * (row[3] + row[4]) * 0.5;
    return [
      row[0],
      cy + ring * Math.cos(angles[i]),
      cz + ring * Math.sin(angles[i]),
      row[3],
      row[4],
    ];
  });
}
