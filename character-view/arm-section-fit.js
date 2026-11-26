import { Vector3 } from "three";

export function preserveArmAxes(fit, chains, height) {
  const step = height / 256;
  const radius = 0.068 * height;
  const fields = [];
  for (const chain of chains) {
    const samples = [];
    const fitted = chain.map((p) => fit(p.clone()));
    if (chain.length === 3) {
      const [shoulder, elbow, wrist] = chain;
      const span = shoulder.y - wrist.y;
      if (span > 4 * step) {
        const t = Math.max(0, Math.min(1, (shoulder.y - elbow.y) / span));
        const displacement = fitted[0]
          .clone()
          .sub(shoulder)
          .lerp(fitted[2].clone().sub(wrist), t);
        fitted[1] = elbow.clone().add(displacement);
      }
    }
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i],
        b = chain[i + 1];
      if (a.y - b.y < 2 * step) continue;
      const wa = fitted[i],
        wb = fitted[i + 1];
      for (
        let j = Math.max(0, Math.ceil(b.y / step));
        j <= Math.min(256, Math.floor(a.y / step));
        j++
      ) {
        const t = (a.y - j * step) / (a.y - b.y);
        const mid = new Vector3().lerpVectors(a, b, t);
        const ideal = new Vector3().lerpVectors(wa, wb, t);
        const drift = ideal.sub(fit(mid.clone()));
        samples[j] = [mid.x, mid.z, drift.x, drift.z];
      }
    }
    fields.push(samples);
  }
  return (v) => {
    const level = v.y / step,
      j = Math.floor(level),
      t = level - j;
    let dx = 0,
      dz = 0;
    for (const field of fields) {
      for (let k = 0; k <= 1; k++) {
        const sample = field[j + k];
        if (!sample) continue;
        const [x, z, deltaX, deltaZ] = sample;
        const r2 = ((v.x - x) ** 2 + (v.z - z) ** 2) / (radius * radius);
        const fade = Math.max(0, Math.min(1, (1.7 - r2) / 1.1));
        const w = (k ? t : 1 - t) * fade * fade * (3 - 2 * fade);
        dx += w * deltaX;
        dz += w * deltaZ;
      }
    }
    fit(v);
    v.x += dx;
    v.z += dz;
    return v;
  };
}
