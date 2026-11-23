import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { faceProjector } from "./eyelids.js";

export const gazeNames = ["LookLeft", "LookRight", "LookUp", "LookDown"];
export function setGaze(root, x, y) {
  const values = [
    Math.max(0, x),
    Math.max(0, -x),
    Math.max(0, y),
    Math.max(0, -y),
  ];
  root?.traverse((o) => {
    if (!o.morphTargetDictionary) return;
    for (const [i, k] of gazeNames.entries()) {
      const index = o.morphTargetDictionary[k];
      if (index !== undefined)
        o.morphTargetInfluences[index] = Math.min(1, values[i]);
    }
  });
}
export const eyeDefaults = {
  color: "#574331",
  opening: 1,
  width: 1,
  spacing: 1,
  lift: 0,
  iris: 1,
};
export function validEyes(settings) {
  return (
    settings &&
    typeof settings === "object" &&
    /^#[a-f\d]{6}$/i.test(settings.color) &&
    Object.entries({
      opening: [0.42, 1.8],
      width: [0.62, 1.6],
      spacing: [0.7, 1.3],
      lift: [-0.1, 0.1],
      iris: [0.55, 1.45],
    }).every(
      ([k, [lo, hi]]) =>
        Number.isFinite(settings[k]) && settings[k] >= lo && settings[k] <= hi,
    ) &&
    (settings.source === undefined || typeof settings.source === "boolean") &&
    (settings.contours === undefined ||
      (Array.isArray(settings.contours) &&
        settings.contours.length === 2 &&
        settings.contours.every(
          (c) =>
            c &&
            ["upper", "lower"].every(
              (k) =>
                Array.isArray(c[k]) &&
                c[k].length === 9 &&
                c[k].every(
                  (n) =>
                    Number.isFinite(n) &&
                    Math.abs(n) <= 0.07 &&
                    (k === "upper" ? n >= 0 : n <= 0),
                ),
            ),
        ))) &&
    (settings.offsets === undefined ||
      (Array.isArray(settings.offsets) &&
        settings.offsets.length === 2 &&
        settings.offsets.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.09),
        )))
  );
}
function frame(mesh) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const box = g.boundingBox,
    dim = box.getSize(new Vector3()),
    c = box.getCenter(new Vector3()),
    paint = mesh.facePaint,
    face = paint?.portrait;
  const h = face ? paint.height : dim.y;
  return {
    h,
    half: face ? face.width * h : dim.x * 0.5,
    cx: face ? face.center * h - paint.offset[0] : c.x,
    cy: face ? face.eyes * h - paint.offset[1] : box.min.y + 0.566 * h,
    probe: faceProjector(g),
  };
}
function readFace(mesh, probe) {
  const map = mesh.material?.map,
    im = map?.image;
  if (!im?.width || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = im.width;
  canvas.height = im.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, im.width, im.height).data;
  return (x, y) => {
    const p = probe(x, y);
    if (!p) return [80, 68, 57];
    const u = MathUtils.clamp(p.u * (im.width - 1), 0, im.width - 1),
      v = MathUtils.clamp(
        (map.flipY ? 1 - p.v : p.v) * (im.height - 1),
        0,
        im.height - 1,
      );
    const a = Math.floor(u),
      b = Math.floor(v),
      dx = u - a,
      dy = v - b;
    const rgba = (i, j, k) =>
      data[
        4 *
          (Math.min(j, im.height - 1) * im.width + Math.min(i, im.width - 1)) +
          k
      ];
    return [0, 1, 2].map((k) =>
      MathUtils.lerp(
        MathUtils.lerp(rgba(a, b, k), rgba(a + 1, b, k), dx),
        MathUtils.lerp(rgba(a, b + 1, k), rgba(a + 1, b + 1, k), dx),
        dy,
      ),
    );
  };
}
// Sample the two pupil centres while the source artwork is available. Save the
// measured offsets in the recipe so clay and textured geometry agree.
export function fitEyeSettings(mesh) {
  const settings = { ...eyeDefaults };
  const { h, half, cx, cy, probe } = frame(mesh),
    pixel = readFace(mesh, probe);
  if (!pixel) return settings;
  const luminance = (x, y) => {
    const [r, g, b] = pixel(x, y);
    return (0.21 * r + 0.72 * g + 0.07 * b) / 255;
  };
  settings.source = true;
  settings.offsets = [-1, 1].map((sign) => {
    const x0 = cx + sign * 0.425 * half;
    let best = -Infinity,
      offset = [0, 0];
    for (let iy = -6; iy <= 6; iy++)
      for (let ix = -7; ix <= 7; ix++) {
        const dx = ix * 0.003,
          dy = iy * 0.0027,
          x = x0 + dx * h,
          y = cy + dy * h;
        const core =
          (2 * luminance(x, y) +
            luminance(x - 0.003 * h, y) +
            luminance(x + 0.003 * h, y) +
            luminance(x, y + 0.003 * h)) /
          5;
        const surround =
          (luminance(x - 0.022 * h, y) +
            luminance(x + 0.022 * h, y) +
            luminance(x, y - 0.016 * h)) /
          3;
        const score =
          surround -
          core -
          0.16 * core -
          0.045 * ((ix / 7) ** 2 + (iy / 6) ** 2);
        if (score > best) {
          best = score;
          offset = [dx, dy];
        }
      }
    return offset;
  });
  settings.contours = settings.offsets.map(([dx, dy], side) => {
    const sign = side ? 1 : -1,
      ex = cx + sign * 0.425 * half + dx * h,
      ey = cy + dy * h;
    function trace(direction) {
      const line = [];
      for (let i = 0; i < 9; i++) {
        const u = i / 4 - 1,
          arc = Math.max(0, 1 - u * u) ** 0.66;
        const prior = arc * (direction > 0 ? 0.021 : 0.015),
          x = ex + u * 0.205 * half;
        let best = -Infinity,
          edge = prior;
        for (let j = -5; j <= 5; j++) {
          const distance = Math.max(0.002, prior + j * 0.0019 * arc),
            y = ey + (0.006 * sign * u + direction * distance) * h;
          const outside = luminance(x, y + direction * 0.004 * h),
            inside = luminance(x, y - direction * 0.003 * h),
            middle = luminance(x, y);
          const score =
            0.65 * Math.abs(inside - outside) +
            0.35 * (Math.max(inside, outside) - middle) -
            0.08 * (j / 5) ** 2;
          if (score > best) {
            best = score;
            edge = distance;
          }
        }
        line.push(direction * (arc ? edge : 0));
      }
      return line.map((v, i) =>
        i && i < 8
          ? Number(
              (0.22 * line[i - 1] + 0.56 * v + 0.22 * line[i + 1]).toFixed(5),
            )
          : v,
      );
    }
    return { upper: trace(1), lower: trace(-1) };
  });
  return settings;
}
function surface(targets = []) {
  return {
    p: [],
    uv: [],
    rgb: [],
    idx: [],
    targets: Object.fromEntries(targets.map((n) => [n, []])),
  };
}
function put(s, p, uv, rgb, poses = {}) {
  const i = s.p.length / 3;
  s.p.push(...p);
  s.uv.push(...uv);
  if (rgb) s.rgb.push(...rgb.toArray());
  for (const [name, row] of Object.entries(s.targets)) {
    const next = poses[name] ?? p;
    row.push(...p.map((x, k) => next[k] - x));
  }
  return i;
}
function quad(s, a, b, c, d) {
  s.idx.push(a, b, d, b, c, d);
}
function geometry(s) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(s.p, 3));
  g.setAttribute("uv", new Float32BufferAttribute(s.uv, 2));
  if (s.rgb.length)
    g.setAttribute("color", new Float32BufferAttribute(s.rgb, 3));
  g.setIndex(s.idx);
  g.computeVertexNormals();
  const poses = Object.entries(s.targets);
  if (poses.length) {
    g.morphTargetsRelative = true;
    g.morphAttributes.position = poses.map(([name, arr]) => {
      const a = new Float32BufferAttribute(arr, 3);
      a.name = name;
      return a;
    });
    g.morphAttributes.normal = poses.map(([name, arr]) => {
      const posed = new BufferGeometry();
      posed.setAttribute(
        "position",
        new Float32BufferAttribute(
          s.p.map((v, i) => v + arr[i]),
          3,
        ),
      );
      posed.setIndex(g.index);
      posed.computeVertexNormals();
      const base = g.attributes.normal.array,
        after = posed.attributes.normal.array;
      const delta = new Float32BufferAttribute(
        after.map((v, i) => v - base[i]),
        3,
      );
      delta.name = name;
      posed.dispose();
      return delta;
    });
  }
  return g;
}
export function attachEyes(mesh, settings, uniform = null) {
  const { h, half, cx, cy, probe } = frame(mesh);
  const lids = surface(["Blink"]),
    whites = surface(),
    irises = surface(gazeNames);
  const pigment = new Color(settings.color),
    sclera = new Color("#c1b6a7"),
    corner = new Color("#9f7870");
  const preservePaint = Boolean(settings.source);
  const aperture = surface(gazeNames);
  const width = 0.205 * half * settings.width,
    irisRadius = Math.min(0.024 * h * settings.iris, width * 0.62);
  for (const [side, sign] of [-1, 1].entries()) {
    const shift = settings.offsets?.[side] ?? [0, 0],
      ex = cx + 0.425 * half * settings.spacing * sign + shift[0] * h,
      ey = cy + (shift[1] + settings.lift) * h;
    // The curved ocular surface stays just ahead of the source eye paint.
    const eyeDepth = (x, y) => {
      const hit = probe(x, y);
      if (!hit) return null;
      const nx = (x - ex) / width,
        ny = (y - ey) / width;
      return (
        hit.z + h * (0.0018 + 0.008 * Math.max(0, 1 - nx * nx - 0.8 * ny * ny))
      );
    };
    const at = (x, y, bias = 0) => [x, y, (eyeDepth(x, y) ?? 0) + h * bias];
    if (!probe(ex - width * 1.3, ey) || !probe(ex + width * 1.3, ey))
      return false;
    const rows = 10,
      cols = 36;
    const margin = (u) => Math.max(0.0004, 1 - u * u) ** 0.66;
    const line = (u) => ey + h * 0.006 * sign * u;
    const profile = (u, sideName, defaultHeight) => {
      const samples = settings.contours?.[side]?.[sideName];
      if (!samples) return defaultHeight * margin(u);
      const t = MathUtils.clamp((u + 1) * 4, 0, 8),
        lo = Math.min(7, Math.floor(t));
      return MathUtils.lerp(samples[lo], samples[lo + 1], t - lo);
    };
    const upper = (u) =>
      line(u) + h * settings.opening * profile(u, "upper", 0.021);
    const lower = (u) =>
      line(u) + h * settings.opening * profile(u, "lower", -0.015);
    const shut = (u) => MathUtils.lerp(lower(u), upper(u), 0.25);
    const eye = preservePaint ? aperture : whites,
      start = eye.p.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const u = (2 * i) / cols - 1,
          t = j / rows,
          x = ex + width * u,
          y = MathUtils.lerp(lower(u), upper(u), t);
        const xy = (u, t) =>
          at(ex + width * u, MathUtils.lerp(lower(u), upper(u), t));
        if (preservePaint) {
          // Move the original painted iris by deforming a patch bounded by the
          // measured lid opening. The canthi stay fixed and no second pupil can
          // emerge from under an eyelid when horizontal and vertical gaze combine.
          const scale = settings.iris - 1;
          const fittedU = u + scale * u * (1 - Math.abs(u)),
            fittedT = t + scale * (t - 0.5) * (1 - Math.abs(2 * t - 1));
          const shiftX = 0.43 * (1 - fittedU * fittedU),
            shiftY = 0.23 * Math.sin(Math.PI * fittedT);
          const hit = probe(x, y);
          if (!hit) return false;
          const poses = [
            xy(fittedU + shiftX, fittedT),
            xy(fittedU - shiftX, fittedT),
            xy(fittedU, fittedT + shiftY),
            xy(fittedU, fittedT - shiftY),
          ];
          put(
            eye,
            xy(fittedU, fittedT),
            [hit.u, hit.v],
            null,
            Object.fromEntries(gazeNames.map((name, k) => [name, poses[k]])),
          );
        } else {
          const edge =
            Math.abs(u) ** 3 * 0.4 + (1 - Math.sin(t * Math.PI)) * 0.16;
          put(eye, at(x, y), [i / cols, t], sclera.clone().lerp(corner, edge));
        }
        if (j < rows && i < cols) {
          const a = start + j * (cols + 1) + i;
          quad(eye, a, a + 1, a + cols + 2, a + cols + 1);
        }
      }
    // Join the cut eye opening to the original textured face with upper and
    // lower skin patches. The peripheral samples retain the source complexion.
    for (const direction of [1, -1]) {
      const start = lids.p.length / 3,
        rings = 8;
      for (let j = 0; j <= rings; j++)
        for (let i = 0; i <= cols; i++) {
          const u = (2 * i) / cols - 1,
            t = j / rings,
            v = margin(u),
            outer = Math.sqrt(Math.max(0.0001, 1 - u * u));
          const x = ex + u * width * (1 + 0.39 * t),
            rim = direction === 1 ? upper(u) : lower(u);
          const outerY =
            line(u) +
            direction * h * (0.052 + 0.019 * settings.opening) * outer;
          const y = MathUtils.lerp(rim, outerY, t),
            closed = MathUtils.lerp(shut(u), outerY, t);
          const flat = probe(x, y);
          if (!flat) return false;
          const sampleY =
              y +
              direction * h * (settings.source ? 0.001 : 0.009) * (1 - t) * v,
            skin = probe(x, sampleY) ?? flat;
          const lidDepth = (Y) => {
            const p = probe(x, Y) ?? flat;
            const relief = (eyeDepth(x, Y) ?? p.z) - p.z;
            return (
              p.z +
              (relief + h * 0.0045) * (1 - MathUtils.smoothstep(t, 0.57, 1)) +
              h * 0.003 * Math.sin(Math.PI * t) * v +
              h * 0.0004
            );
          };
          put(lids, [x, y, lidDepth(y)], [skin.u, skin.v], null, {
            Blink: [x, closed, lidDepth(closed) + h * 0.0005 * v * (1 - t)],
          });
          if (j < rings && i < cols) {
            const a = start + j * (cols + 1) + i;
            if (direction === 1)
              quad(lids, a, a + 1, a + cols + 2, a + cols + 1);
            else quad(lids, a, a + cols + 1, a + cols + 2, a + 1);
          }
        }
    }
    if (preservePaint) continue;
    // A separate radial iris moves over the ocular surface and behind the
    // opaque lids. All four gaze directions are ordinary glTF morph targets.
    const radial = [0, 0.27, 0.34, 0.38, 0.51, 0.68, 0.84, 0.93, 1],
      segments = 64,
      startI = irises.p.length / 3;
    const gaze = [
      [width * 0.45, 0],
      [-width * 0.45, 0],
      [0, h * 0.014],
      [0, -h * 0.014],
    ];
    for (const [j, r] of radial.entries())
      for (let k = 0; k <= segments; k++) {
        const theta = (2 * Math.PI * k) / segments,
          dx = irisRadius * r * Math.cos(theta),
          dy = irisRadius * r * Math.sin(theta);
        const x = ex + dx,
          y = ey + dy;
        const fibre =
          0.82 +
          0.2 * Math.sin(19 * theta + Math.sin(7 * theta) + 1.9 * r) +
          0.12 * Math.cos(31 * theta - 2 * r);
        const color =
          r <= 0.34
            ? new Color("#171514")
            : pigment
                .clone()
                .multiplyScalar(
                  (r >= 0.93 ? 0.55 : r <= 0.51 ? 1.28 : 1.0) * fibre,
                );
        const bias = 0.0018 + 0.0015 * (1 - r * r);
        put(
          irises,
          at(x, y, bias),
          [0.5 + 0.5 * r * Math.cos(theta), 0.5 + 0.5 * r * Math.sin(theta)],
          color,
          Object.fromEntries(
            gazeNames.map((n, i) => [
              n,
              at(x + gaze[i][0], y + gaze[i][1], bias),
            ]),
          ),
        );
        if (j < radial.length - 1 && k < segments) {
          const a = startI + j * (segments + 1) + k;
          if (j === 0) irises.idx.push(a, a + segments + 1, a + segments + 2);
          else quad(irises, a, a + segments + 1, a + segments + 2, a + 1);
        }
      }
  }
  function add(data, material, id) {
    const piece = new Mesh(geometry(data), material);
    piece.name = id;
    piece.userData.eyePiece = id;
    mesh.add(piece);
  }
  add(lids, mesh.material, "Lids");
  if (preservePaint) add(aperture, uniform ?? mesh.material, "Iris");
  else {
    add(
      whites,
      uniform ??
        new MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.43,
        }),
      "Sclera",
    );
    add(
      irises,
      uniform ??
        new MeshStandardMaterial({
          color: 0xffffff,
          vertexColors: true,
          roughness: 0.36,
        }),
      "Iris",
    );
  }
  mesh.userData.fittedEyes = true;
  return true;
}
