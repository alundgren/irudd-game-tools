/* The joints a source garment hangs from, in the form human-skirt-drape.js describes them, measured on this figure:
   two rings of eight, at mid length and at the hem, standing on the garment's own outline. */
export function castSkirtJoints(s, moved, inSkirt, origin) {
  const joint = (name) => { const i = s.names.indexOf(name) * 3; return [s.joints[i] - origin[0], s.joints[i + 1] - origin[1], s.joints[i + 2] - origin[2]]; };
  const pelvis = joint("pelvis"), k = s.height / 1.75, hip = joint("thigh_l")[1], high = hip + 0.02 * k, low = hip - 0.17 * k, columns = 8;
  const points = [];
  let bottom = Infinity;
  for (let i = 0; i < inSkirt.length; i++) if (inSkirt[i]) {
    const p = [moved[i * 3] - origin[0], moved[i * 3 + 1] - origin[1], moved[i * 3 + 2] - origin[2]];
    points.push(p); bottom = Math.min(bottom, p[1]);
  }
  const cx = pelvis[0], cz = pelvis[2];
  // How far out the garment stands at a height and direction: the points nearest in height within the column.
  const radius = (y, a) => {
    let best = [];
    for (const p of points) {
      let turn = Math.atan2(p[0] - cx, p[2] - cz) - a;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (Math.abs(turn) < Math.PI / columns) best.push([Math.abs(p[1] - y), Math.hypot(p[0] - cx, p[2] - cz)]);
    }
    best.sort((p, q) => p[0] - q[0]);
    const near = best.slice(0, 4);
    return near.length ? near.reduce((sum, p) => sum + p[1], 0) / near.length : 0.15 * k;
  };
  const joints = [];
  [low + (bottom - low) * 0.42, bottom].forEach((y, level) => {
    for (let c = 0; c < columns; c++) {
      const a = (c + 0.5) / columns * Math.PI * 2, r = radius(y, a), from = radius(low, a), dir = [Math.sin(a), Math.cos(a)];
      joints.push({ name: "Source_" + (level + 1) + "_" + (c + 1), level, column: c, at: [cx + dir[0] * r, y, cz + dir[1] * r], from: [cx + dir[0] * from, low, cz + dir[1] * from], dir, free: r });
    }
  });
  // The legs under the cloth as rows of balls. Their thickness is a share of the body's size, not measured.
  const legs = [];
  for (const side of ["l", "r"]) for (const [from, to, radii] of [["thigh", "calf", [0.085, 0.082, 0.076, 0.07, 0.064, 0.06]], ["calf", "foot", [0.058, 0.057, 0.053, 0.047, 0.042, 0.038]], ["foot", "ball", [0.045, 0.045]]])
    legs.push({ from: from + "_" + side, to: to + "_" + side, radii: radii.map((r) => r * k) });
  return { name: "Source", columns, joints, legs, axis: [cx, cz], pelvis, floor: -origin[1], scale: k, low, high };
}
