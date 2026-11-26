import {
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  Matrix4,
  Quaternion,
  Euler,
  MathUtils,
  CatmullRomCurve3,
} from "three";

export function scuteGeometry() {
  const pos = [],
    uv = [],
    idx = [],
    rows = 24,
    cols = 40;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const width =
      0.5 * Math.max(0.012, Math.sin(Math.PI * t) ** 0.66 * (1.3 - 0.85 * t));
    for (let c = 0; c <= cols; c++) {
      const a = (c / cols) * Math.PI * 2,
        side = Math.sin(a),
        front = Math.cos(a),
        x = side * width;
      const lip = Math.sin(t * Math.PI) ** 0.75;
      const crown =
        front > 0
          ? (0.22 + 0.28 * (1 - Math.abs(side)) ** 2) * front
          : -0.19 * Math.abs(front);
      const z =
        lip * crown + 0.23 * t * t + 0.028 * Math.cos(3 * Math.PI * t) * lip;
      pos.push(x, 0.5 - t, z);
      uv.push(c / cols, 1 - t);
      if (r < rows && c < cols) {
        const i = r * (cols + 1) + c,
          j = i + cols + 1;
        idx.push(i, j, i + 1, i + 1, j, j + 1);
      }
    }
  }
  for (let i = 1; i < cols - 1; i++) {
    idx.push(0, i + 1, i);
    const end = rows * (cols + 1);
    idx.push(end, end + i, end + i + 1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
export function fittedScute(part, carrier) {
  const geometry = scuteGeometry(),
    mount = part.mount;
  if (!mount || !carrier?.paint) return geometry;
  const euler = new Euler(...mount.rotation.map(MathUtils.degToRad));
  const matrix = new Matrix4().compose(
    new Vector3(...mount.position),
    new Quaternion().setFromEuler(euler),
    new Vector3(...mount.size),
  );
  const inverse = matrix.clone().invert(),
    rest = carrier.knots,
    position = geometry.attributes.position,
    uv = geometry.attributes.uv;
  const v = new Vector3(),
    normal = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const lift = (v.z - 0.09) * mount.size[2] + 0.003;
    v.applyMatrix4(matrix);
    let k = 1;
    while (k < rest.length - 1 && rest[k][1] < v.y) k++;
    const a = rest[k - 1],
      b = rest[k],
      t = MathUtils.clamp((v.y - a[1]) / (b[1] - a[1]), 0, 1);
    const sample = (j) => MathUtils.lerp(a[j], b[j], t);
    const cx = sample(0),
      cz = sample(2),
      w = sample(3),
      d = sample(4);
    const theta = Math.atan2(-(v.z - cz) / d, (v.x - cx) / w),
      co = Math.cos(theta),
      si = Math.sin(theta);
    normal.set(co / w, 0, -si / d).normalize();
    v.set(cx + w * co, v.y, cz - d * si)
      .addScaledVector(normal, lift)
      .applyMatrix4(inverse);
    position.setXYZ(i, v.x, v.y, v.z);
    uv.setXY(
      i,
      (theta / (2 * Math.PI) + 1) % 1,
      (k - 1 + t) / (rest.length - 1),
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}
const directions = {
  Front: [0, 0, 1],
  Back: [0, 0, -1],
  Left: [1, 0, 0],
  Right: [-1, 0, 0],
  Top: [0, 1, 0],
};
export function equipPlateRows(form, id, settings = {}) {
  const {
    count = 4,
    columns = 1,
    face = "Front",
    width = 0.12,
    length = width * 1.3,
    depth = width * 0.32,
    start = 0.15,
    end = 0.9,
    taper = 0.2,
    color = "#d4c6a7",
    surface = "plain",
    name = "armour scale",
  } = settings;
  if (
    !Object.hasOwn(directions, face) ||
    ![width, length, depth, start, end, taper].every(Number.isFinite) ||
    width < 0.01 ||
    width > 1 ||
    length < 0.01 ||
    length > 1.5 ||
    depth < 0.003 ||
    depth > 0.5 ||
    start < 0 ||
    end > 1 ||
    start > end ||
    Math.abs(taper) > 0.8 ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 44 ||
    !/^#[a-f0-9]{6}$/i.test(color) ||
    !["plain", "metal", "leather", "scales", "canvas"].includes(surface)
  )
    throw new Error("Choose valid plate dimensions, finish and path limits.");
  return repeatOnSpine(form, id, {
    count,
    columns,
    face,
    width,
    length,
    depth,
    start,
    end,
    taper,
    color,
    surface,
    name,
    equipped: true,
  });
}
export function repeatOnSpine(
  form,
  carrierId,
  {
    count = 4,
    columns = 1,
    face = "Back",
    width = 0.18,
    length = 0.19,
    depth = 0.042,
    taper = 0.2,
    start = 0.18,
    end = 0.88,
    color = "#ab9877",
    surface = "scales",
    shape = "scute",
    name = "plate",
    lift = 0.0,
    equipped = false,
  } = {},
) {
  const carrier = form.parts.find((p) => p.id === carrierId);
  if (carrier?.shape !== "sweep")
    throw new Error("Choose a swept part as the attachment path.");
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 16 ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 7 ||
    form.parts.length + count * columns > 128
  )
    throw new Error("This arrangement exceeds the part limit.");
  const path = new CatmullRomCurve3(
    carrier.knots.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    "centripetal",
  );
  const used = new Set(form.parts.map((p) => p.id)),
    parts = [];
  const forward = new Vector3(...directions[face]);
  for (let r = 0; r < count; r++) {
    const u = count === 1 ? 0.5 : r / (count - 1),
      t = MathUtils.lerp(start, end, u),
      centre = path.getPoint(t);
    const along = carrier.paint
      ? new Vector3(0, 1, 0)
      : path.getTangent(t).normalize();
    let axis = forward.clone().addScaledVector(along, -along.dot(forward));
    if (axis.lengthSq() < 0.001) {
      const fallback =
        Math.abs(along.z) < 0.8 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      axis = fallback.addScaledVector(along, -along.dot(fallback));
    }
    axis.normalize();
    const f = t * (carrier.knots.length - 1),
      i = Math.min(carrier.knots.length - 2, Math.floor(f)),
      fraction = f - i;
    const w = MathUtils.lerp(
        carrier.knots[i][3],
        carrier.knots[i + 1][3],
        fraction,
      ),
      d = MathUtils.lerp(
        carrier.knots[i][4],
        carrier.knots[i + 1][4],
        fraction,
      );
    for (let c = 0; c < columns; c++) {
      const azimuth = columns === 1 ? 0 : (c / (columns - 1) - 0.5) * 1.65;
      const outward = axis.clone().applyAxisAngle(along, azimuth),
        across = new Vector3().crossVectors(along, outward).normalize();
      const radius =
        1 /
        Math.sqrt(
          (outward.x / w) ** 2 + (Math.hypot(outward.y, outward.z) / d) ** 2,
        );
      const pos = centre.clone().addScaledVector(outward, radius + lift);
      const rot = new Euler().setFromRotationMatrix(
        new Matrix4().makeBasis(across, along, outward),
      );
      const factor = 1 - taper * (1 - u);
      let id = name + " " + (r + 1) + (columns > 1 ? "/" + (c + 1) : ""),
        n = 2,
        base = id;
      while (used.has(id)) id = base + " " + n++;
      used.add(id);
      const tilt = new Matrix4()
        .makeBasis(across, along, outward)
        .multiply(new Matrix4().makeRotationX(-0.15));
      rot.setFromRotationMatrix(tilt);
      parts.push({
        id,
        shape,
        parent: carrier.id,
        ...(equipped
          ? {
              visibleIn: [form.outfit],
              motionRole: "rigid",
              surfaceJoin: {
                end: "base",
                depth: MathUtils.clamp(depth * 0.14, 0.001, 0.008),
              },
            }
          : {}),
        position: pos.toArray(),
        size: [width * factor, length * factor, depth * factor],
        rotation: [rot.x, rot.y, rot.z].map(MathUtils.radToDeg),
        color,
        surface,
      });
    }
  }
  if (!equipped && carrier.paint && shape === "scute")
    for (const p of parts) {
      p.mount = {
        position: [...p.position],
        rotation: [...p.rotation],
        size: [...p.size],
      };
      p.color = "#f9f5e9";
    }
  return {
    form: { ...form, parts: [...form.parts, ...parts] },
    id: parts[0].id,
  };
}
