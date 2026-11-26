import {
  Color,
  Float32BufferAttribute,
  MathUtils,
  Matrix3,
  Vector3,
} from "three";
import { randomStream } from "./random.js";
export const coatFamilies = ["plumage", "pelt", "scutes", "wet skin"];
const { clamp, smoothstep: edge } = MathUtils;
export function readCreatureCoat(raw) {
  if (!raw || !coatFamilies.includes(raw.family)) return null;
  const bounded = (n, a, b, fallback) =>
    Number.isFinite(n) ? clamp(n, a, b) : fallback;
  return {
    family: raw.family,
    ...(raw.graded === true ? { graded: true } : {}),
    contrast: bounded(raw.contrast, 0, 1, 0.76),
    density: bounded(raw.density, 0.55, 1.8, 1),
    seed: Math.floor(bounded(raw.seed, 0, 0xffffffff, 1)),
  };
}
export function drawCreatureCoat(plan, seed) {
  const draw = randomStream((seed ^ 0x4f8b2a13) >>> 0);
  const has = (kind, style) =>
    plan.limbs.some(
      (l) =>
        l.kind === kind &&
        (!style || l.style === style || l.structure === style),
    );
  const options =
    plan.back.kind === "shag mantle"
      ? ["pelt"]
      : has("wing", "feather")
        ? ["plumage"]
        : plan.back.kind === "shingles"
          ? ["scutes", "scutes", "plumage"]
          : has("fin") || plan.back.kind === "gill fans"
            ? ["wet skin", "wet skin", "scutes"]
            : has("leg", "insect")
              ? ["scutes", "wet skin"]
              : plan.head.snout === "beak" || has("leg", "bird")
                ? ["plumage", "plumage", "scutes"]
                : ["pelt", "pelt", "wet skin", "scutes"];
  const family = options[Math.floor(draw() * options.length)];
  return {
    ...plan.skin,
    coat: {
      family, graded: true,
      contrast: 0.68 + 0.27 * draw(),
      density: 0.76 + 0.52 * draw(),
      seed: Math.floor(draw() * 4294967296),
    },
  };
}
export function creatureCoatField(form, objects) {
  const skin = form.origin?.plan?.skin,
    coat = readCreatureCoat(skin?.coat);
  const body = form.parts.find((p) => p.id === "body"),
    root = objects.get("body");
  if (!coat || !body?.knots?.length || !root) return null;
  root.updateWorldMatrix(true, false);
  const knots = body.knots.map((k) => ({
    p: new Vector3(...k.slice(0, 3)).applyMatrix4(root.matrixWorld),
    ry: k[4],
  }));
  const segments = [];
  let length = 0;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1],
      b = knots[i],
      v = b.p.clone().sub(a.p),
      len = v.length();
    if (len < 1e-6) continue;
    segments.push({ a: a.p, dir: v.divideScalar(len), len, at: length });
    length += len;
  }
  if (!segments.length) return null;
  const radius = Math.max(...knots.map((k) => k.ry));
  const p0 = new Vector3(),
    d = new Vector3();
  const yaw = (coat.seed % 104729) * 0.0157;
  const phase = yaw % 6.283,
    density = coat.density;
  const light = new Color(skin.pale),
    dark = new Color(skin.base).multiplyScalar(0.21),
    accent = new Color(skin.accent);
  const ink = new Color(skin.base).lerp(accent, 0.29).multiplyScalar(0.37);

  const eyes = form.parts
    .filter((p) => /(?:^| )eye(?: \d+)?$/.test(p.id))
    .map((p) => {
      const o = objects.get(p.id);
      if (!o) return null;
      return { at: o.getWorldPosition(new Vector3()), r: Math.max(...p.size) };
    })
    .filter(Boolean);
  return {
    ...coat,
    surface: skin.surface,
    motifSize: clamp(length * 0.045, 0.026, 0.077) / density,
    sample(out, base, p, n, part) {
      let near = Infinity,
        t = 0,
        vertical = 0,
        up = 0;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        d.subVectors(p, s.a);
        let travel = d.dot(s.dir);
        if (i > 0) travel = Math.max(0, travel);
        if (i + 1 < segments.length) travel = Math.min(s.len, travel);
        p0.copy(s.a).addScaledVector(s.dir, travel);
        const dy = p.y - p0.y,
          dz = p.z - p0.z,
          q = dy * dy + dz * dz;
        if (q < near) {
          near = q;
          t = (s.at + travel) / length;
          vertical = (dy * s.dir.z - dz * s.dir.y) / radius;
          up = n.y * s.dir.z - n.z * s.dir.y;
        }
      }
      const flank = Math.abs(p.x) / Math.max(0.035, radius),
        y = vertical;
      const flow =
        t * 5.1 * density +
        0.16 * Math.sin(t * 12 + phase) +
        0.08 * Math.sin(y * 3.3 + phase);
      const belly =
        1 -
        edge(y * 0.48 + up * 0.38 + Math.min(0.12, flank * 0.03), -0.68, 0.11);
      const distal =
        1 -
        edge(
          p.y / Math.max(0.1, root.matrixWorld.elements[13] + radius),
          0.11,
          0.57,
        );
      out.copy(base);
      const c = coat.contrast;
      const zone = part?.coatZone ?? "body",
        head = part?.motionRole === "head";
      const limb =
        zone === "end" ||
        ["forearm", "upper arm", "thigh", "shin", "hand", "foot"].includes(
          part?.motionRole,
        );
      const existing = Boolean(skin.markings),
        accentBudget = existing ? (coat.graded ? .64 : .34) : .85;
      const motif =
        coat.family === "wet skin"
          ? 0.14 * Math.sin(t * 14 + phase)
          : coat.family === "pelt"
            ? 0.09 * Math.sin(t * 9 + phase)
            : 0.12 * Math.sin(t * 6 + phase);
      const line = 0.17 + 0.43 * edge(t, 0.51, 0.96) + motif;
      const flankSide = edge(flank, 0.28, 0.67);
      const trace = Math.abs(y - line);
      const outer = (1 - edge(trace, 0.11, 0.22)) * flankSide;
      const core = (1 - edge(trace, 0.058, 0.14)) * flankSide;
      if (!limb) {
        const shoulder = edge(t, 0.46, 0.65) * (1 - edge(t, 1.06, 1.29));
        const rear = edge(t, -0.36, -0.15) * (1 - edge(t, 0.43, 0.63));
        if (coat.graded) {
          const ridge = y * .66 + up * .34;
          const mantle = edge(ridge + .10*Math.sin(flow + phase), -.08, .83);
          const throat = edge(-ridge, -.12, .83) * (.35 + .65*edge(t, .38, .94));
          if (coat.family === "plumage") {
            const bib = throat * edge(t, .47, .96);
            out.lerp(ink, mantle*.36*c).lerp(accent, bib*.62*c).lerp(light, throat*(1-bib)*.39*c);
          } else if (coat.family === "wet skin") {
            out.lerp(dark, mantle*.52*c).lerp(light, throat*.62*c);
          } else if (coat.family === "pelt") {
            const saddle = mantle*(.23+.77*(1-edge(t, .45, 1.02)));
            out.lerp(ink, saddle*.61*c).lerp(light, throat*.54*c);
          } else {
            const crown = mantle*(.28+.72*shoulder);
            out.lerp(accent, crown*.49*c).lerp(dark, mantle*(1-shoulder)*.29*c);
            out.lerp(light, throat*.47*c);
          }
        }
        const duty =
          coat.family === "plumage"
            ? 0.67 + 0.33 * edge(Math.sin(flow * 3.1 + phase), -0.35, 0.2)
            : coat.family === "scutes"
              ? 0.79 + 0.21 * edge(Math.sin(flow * 2.1 + phase), -0.6, -0.1)
              : 1;
        const track =
          (0.36 + 0.48 * shoulder + 0.18 * rear) * duty * c * accentBudget;
        out.lerp(light, outer * track * 0.61).lerp(accent, core * track);
        if (!existing && !head) {
          const cap =
            edge(y * 0.8 + up * 0.25, 0.26, 0.8) * (0.55 + 0.45 * shoulder);
          const edgeTint =
            edge(y * 0.8 + up * 0.25, 0.27, 0.4) *
            (1 - edge(y * 0.8 + up * 0.25, 0.44, 0.59));
          out.lerp(accent, cap * 0.49 * c).lerp(light, edgeTint * 0.18 * c);
        }
      } else {
        const end = distal * skin.socks;
        if (!skin.limbFade) out.lerp(dark, 0.32 * end);
        out.lerp(light, belly * 0.05 * (1 - end));
      }
      for (const eye of eyes) {
        const dx = p.x - eye.at.x,
          dy = (p.y - eye.at.y) * 1.3,
          dz = (p.z - eye.at.z) * 0.65;
        const q =
          Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.015, eye.r);
        if (q < 0.87) {
          out.lerp(light, (1 - edge(q, 0.67, 0.87)) * 0.77 * c);
          out.lerp(ink, (1 - edge(q, 0.49, 0.65)) * 0.78 * c);
        }
      }
      return out;
    },
  };
}
export function applyCreatureCoat(
  mesh,
  part,
  field,
  swatch,
  extraMark,
  underMark,
  limbTint,
) {
  if (
    !field ||
    !part.coatZone ||
    part.paint ||
    part.surface !== field.surface ||
    !mesh?.geometry
  )
    return false;
  mesh.updateWorldMatrix(true, false);
  const geom = mesh.geometry,
    pos = geom.attributes.position,
    normals = geom.attributes.normal;
  if (!pos || !normals) return false;
  const mat = mesh.material.clone(),
    rgb = new Float32Array(pos.count * 3);
  const p = new Vector3(),
    n = new Vector3(),
    nm = new Matrix3().getNormalMatrix(mesh.matrixWorld),
    c = new Color(),
    base = new Color(part.color);
  const under =
    underMark && part.undercoat ? new Color(part.undercoat.color) : null;
  const source = new Color();
  const mark =
    extraMark && part.markings ? new Color(part.markings.color) : null;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normals, i).applyNormalMatrix(nm);
    source.copy(base);
    if (under) source.lerp(under, underMark(p, n));
    field.sample(c, source, p, n, part);
    if (limbTint) limbTint(c,p);
    if (mark) c.lerp(mark, extraMark(p, n) * 0.985);
    c.toArray(rgb, i * 3);
  }
  geom.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  mat.color.set(0xffffff);
  mat.vertexColors = true;
  const textured =
    part.id === "body" ||
    /^(?:head(?: \d+)?|neck(?: \d+)?|shoulders(?: \d+)?|tail)$/.test(part.id) ||
    part.id.endsWith("haunch");
  if (swatch && textured) {
    coatCoordinates(mesh, part, field);
    mat.map = swatch;
    mat.bumpMap = swatch;
    mat.bumpScale = field.family === "wet skin" ? 0.00045 : 0.0012;
  }
  mat.roughness =
    field.family === "wet skin"
      ? 0.56
      : field.family === "scutes"
        ? 0.73
        : 0.91;
  mesh.material = mat;
  return true;
}

function coatCoordinates(mesh, part, field) {
  const geom = mesh.geometry,
    pos = geom.attributes.position;
  if (!pos) return;
  const points = [],
    p = new Vector3(),
    axis = new Vector3(),
    radial = new Vector3();
  mesh.updateWorldMatrix(true, false);
  if (part.knots?.length > 1)
    for (const k of part.knots)
      points.push(new Vector3(...k.slice(0, 3)).applyMatrix4(mesh.matrixWorld));
  else {
    geom.computeBoundingBox();
    const box = geom.boundingBox,
      mid = box.getCenter(new Vector3()),
      size = box.getSize(new Vector3());
    const long =
      part.motionRole === "head"
        ? "z"
        : size.y >= size.z && size.y >= size.x
          ? "y"
          : size.z >= size.x
            ? "z"
            : "x";
    const a = mid.clone(),
      b = mid.clone();
    a[long] = box.min[long];
    b[long] = box.max[long];
    points.push(
      a.applyMatrix4(mesh.matrixWorld),
      b.applyMatrix4(mesh.matrixWorld),
    );
  }
  const seg = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    axis.subVectors(points[i], points[i - 1]);
    const len = axis.length();
    if (len < 1e-6) continue;
    const dir = axis.clone().divideScalar(len),
      up = Math.abs(dir.y) < 0.8 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
    up.addScaledVector(dir, -up.dot(dir)).normalize();
    seg.push({ p: points[i - 1], dir, up, len, start: length });
    length += len;
  }
  if (!seg.length) return;
  const a = new Float32Array(pos.count),
    v = new Float32Array(pos.count);
  let radius = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    let nearest = Infinity;
    for (const s of seg) {
      radial.subVectors(p, s.p);
      const t = clamp(radial.dot(s.dir), 0, s.len);
      radial.addScaledVector(s.dir, -t);
      const r = radial.length();
      if (r >= nearest) continue;
      nearest = r;
      a[i] =
        Math.acos(clamp(radial.dot(s.up) / Math.max(r, 1e-7), -1, 1)) / Math.PI;
      v[i] = (s.start + t) / length;
    }
    radius = Math.max(radius, nearest);
  }
  const wave = (x) => 1 - Math.abs((x % 2) - 1);
  const uSpan = Math.max(0.04, (Math.PI * radius) / (10 * field.motifSize));
  const vSpan = Math.max(0.04, length / (8 * field.motifSize));
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[2 * i] = wave(0.12 + a[i] * uSpan);
    uv[2 * i + 1] = wave(0.08 + v[i] * vSpan);
  }
  geom.setAttribute("uv", new Float32BufferAttribute(uv, 2));
}
