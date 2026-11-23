import { MathUtils } from "three";
const gaussian = (x, center, radius) =>
  Math.exp(-(((x - center) / radius) ** 2));

// A side silhouette contains the nose, lips and chin along its entire outside
// contour. Reconstruct a smooth underlying cheek plane, then retain the profile
// detail locally at its anatomical landmarks.
export function profileCorrection(binding, geometry) {
  const height = binding.height,
    rows = binding.rest;
  const profile = rows.map((row) => [row[1], row[2] + row[4], row[2] - row[4]]);
  const smooth = profile.map(([y, front, back]) => {
    let total = 0,
      fore = 0,
      rear = 0;
    for (const [sampleY, f, b] of profile) {
      const weight = gaussian(sampleY, y, height * 0.095);
      total += weight;
      fore += f * weight;
      rear += b * weight;
    }
    return [fore / total - front, rear / total - back];
  });
  const uv = geometry.attributes.uv;
  return (i, x, y, phi, face) => {
    const t = uv.getY(i) * (rows.length - 1);
    const left = Math.min(rows.length - 2, Math.floor(t)),
      u = t - left;
    const front = MathUtils.lerp(smooth[left][0], smooth[left + 1][0], u);
    const rear = MathUtils.lerp(smooth[left][1], smooth[left + 1][1], u);
    const facing = (1 - Math.sin(phi)) * 0.5;
    const preserve = Math.max(
      gaussian(x, 0, 0.21) * gaussian(y, face.nose + 0.015, 0.1),
      gaussian(x, 0, 0.37) * gaussian(y, face.mouth, 0.055),
      gaussian(x, 0, 0.5) * gaussian(y, face.chin + 0.025, 0.06),
    );
    const faceBand =
      MathUtils.smoothstep(y, face.chin - 0.055, face.chin + 0.04) *
      (1 - MathUtils.smoothstep(y, face.eyes + 0.14, face.eyes + 0.25));
    return (
      (MathUtils.lerp(rear, front, facing) * (1 - preserve) * faceBand) / height
    );
  };
}

export function landmarkRelief(x, y, face) {
  const ax = Math.abs(x),
    ex = (ax - 0.425) / 0.262;
  let relief = 0;
  if (Math.abs(ex) < 1.24) {
    const edge = MathUtils.clamp(1 - ex * ex, 0, 1),
      falloff = 1 - MathUtils.smoothstep(Math.abs(ex), 0.83, 1.23);
    const eyeY = face.eyes + 0.008 * ex,
      dy = y - eyeY,
      upper = 0.031 * Math.sqrt(edge),
      lower = -0.022 * Math.sqrt(edge);
    // Convex cornea, lid margins and the orbital crease are visible in clay.
    relief +=
      falloff *
      (0.028 * gaussian(dy, 0, 0.029) * Math.sqrt(edge) +
        0.015 * gaussian(dy, upper, 0.009) +
        0.009 * gaussian(dy, lower, 0.009) -
        0.012 * gaussian(dy, upper + 0.016, 0.011) -
        0.006 * gaussian(dy, lower - 0.023, 0.015));
  }
  // Separate the nasal wings and nostril rims from the cheeks.
  relief +=
    0.019 * gaussian(ax, 0.19, 0.095) * gaussian(y, face.nose - 0.012, 0.029);
  relief -=
    0.018 * gaussian(ax, 0.135, 0.054) * gaussian(y, face.nose - 0.025, 0.012);
  relief +=
    0.012 * gaussian(x, 0, 0.122) * gaussian(y, face.nose + 0.009, 0.036);
  const mx = x / 0.47;
  if (Math.abs(mx) < 1.15) {
    const fade = 1 - MathUtils.smoothstep(Math.abs(mx), 0.72, 1.13);
    const seam = face.mouth + 0.005 * mx * mx;
    const bow = 0.014 + 0.009 * gaussian(Math.abs(mx), 0.31, 0.2);
    relief +=
      fade *
      (0.016 * gaussian(y, seam + bow, 0.011) +
        0.021 * gaussian(y, seam - 0.018, 0.014) -
        0.017 * gaussian(y, seam, 0.007));
    relief -=
      0.008 *
      gaussian(Math.abs(mx), 0.91, 0.13) *
      gaussian(y, seam - 0.003, 0.015);
  }
  return relief;
}
