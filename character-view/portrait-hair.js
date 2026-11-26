import {
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  Vector3,
  CanvasTexture,
  SRGBColorSpace,
} from "three";
import { sweepGeometry } from "./surface.js";
import { headSpace } from "./portrait-frame.js";
const width = 128,
  height = 96,
  bytes = width * height;
const fields = new Map(),
  maps = new WeakMap();
export function validHairCap(cap) {
  return (
    cap &&
    /^[0-9a-f]{6}$/i.test(cap.scalp) &&
    [cap.mask, cap.relief].every(
      (s) =>
        typeof s === "string" &&
        s.length === (bytes * 4) / 3 &&
        /^[A-Za-z0-9+/]+$/.test(s),
    )
  );
}
function encode(a) {
  return btoa(String.fromCharCode(...a));
}
function read(s) {
  if (!fields.has(s)) {
    if (fields.size > 18) fields.delete(fields.keys().next().value);
    fields.set(
      s,
      Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
    );
  }
  return fields.get(s);
}
function value(field, u, v) {
  const x = (u - Math.floor(u)) * width,
    y = MathUtils.clamp(v, 0, 1) * (height - 1),
    ix = Math.floor(x),
    iy = Math.floor(y),
    jx = (ix + 1) % width,
    jy = Math.min(height - 1, iy + 1);
  return (
    MathUtils.lerp(
      MathUtils.lerp(field[iy * width + ix], field[iy * width + jx], x - ix),
      MathUtils.lerp(field[jy * width + ix], field[jy * width + jx], x - ix),
      y - iy,
    ) / 255
  );
}
function coverage(x, y, polygons) {
  let best = 0;
  for (const poly of polygons) {
    let inside = false,
      dist = 1;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[i],
        [bx, by] = poly[j],
        dx = bx - ax,
        dy = by - ay;
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
        inside = !inside;
      const t = MathUtils.clamp(
        ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1),
        0,
        1,
      );
      dist = Math.min(dist, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
    best = Math.max(
      best,
      MathUtils.smoothstep(inside ? dist : -dist, -0.023, 0.023),
    );
  }
  return best;
}
function hairMask(panel, polygons) {
  const n = 128,
    len = n * n,
    prior = new Float32Array(len),
    rgb = new Float32Array(len * 3);
  const frozen = new Uint8Array(len),
    next = new Float32Array(len),
    hist = [new Float32Array(512), new Float32Array(512)],
    counts = [0, 0],
    subject = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const x = ((i % n) + 0.5) / n,
      y = (Math.floor(i / n) + 0.5) / n;
    let count = 0;
    for (const [dx, dy] of [
      [0, 0],
      [-0.022, 0],
      [0.022, 0],
      [0, -0.022],
      [0, 0.022],
    ])
      count += coverage(x + dx, y + dy, polygons);
    const p = (prior[i] = count / 5);

    const j =
      4 *
      (Math.min(panel.size - 1, Math.floor(y * panel.size)) * panel.size +
        Math.min(panel.size - 1, Math.floor(x * panel.size)));
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = panel.pixels[j + k] / 255;
    subject[i] = panel.mask[j / 4];
    if (subject[i] && (p > 0.86 || p < 0.02)) {
      const side = p > 0.86 ? 1 : 0;
      hist[side][colorBin(i)]++;
      counts[side]++;
    }
  }
  function colorBin(i) {
    const r = rgb[3 * i],
      g = rgb[3 * i + 1],
      b = rgb[3 * i + 2],
      s = r + g + b + 0.03,
      bin = (v) => MathUtils.clamp(Math.floor(v * 8), 0, 7);
    return (
      bin(((r - g) / s) * 2.6 + 0.4) * 64 +
      bin(((g - b) / s) * 2.6 + 0.4) * 8 +
      bin(s / 3)
    );
  }
  const geometric = prior.slice();
  for (let i = 0; i < len; i++) {
    const x = ((i % n) + 0.5) / n,
      y = (Math.floor(i / n) + 0.5) / n;
    if (!subject[i]) continue;
    const key = colorBin(i),
      hair = (hist[1][key] + 0.25) / (counts[1] + 128),
      skin = (hist[0][key] + 0.25) / (counts[0] + 128);
    let near = false;
    for (const [dx, dy] of [
      [0, -0.075],
      [0, 0.075],
      [-0.075, 0],
      [0.075, 0],
    ]) {
      const k =
        MathUtils.clamp(Math.floor((y + dy) * n), 0, n - 1) * n +
        MathUtils.clamp(Math.floor((x + dx) * n), 0, n - 1);
      if (geometric[i] > 0.5 !== geometric[k] > 0.5) {
        near = true;
        break;
      }
    }
    if (!near) {
      frozen[i] = geometric[i] < 0.025 || geometric[i] > 0.975;
      continue;
    }
    const odds = MathUtils.clamp(Math.log(hair / skin), -5, 5);
    prior[i] = 1 / (1 + Math.exp(-((geometric[i] - 0.5) * 3.0 + odds)));
    frozen[i] = Math.abs(odds) > 2.6;
  }
  let a = prior.slice(),
    b = next;
  for (let pass = 0; pass < 24; pass++) {
    for (let i = 0; i < len; i++) {
      if (frozen[i]) {
        b[i] = prior[i];
        continue;
      }
      const x = i % n,
        y = Math.floor(i / n);
      let sum = 0.12 * prior[i],
        weight = 0.12;
      for (const j of [
        x ? i - 1 : i,
        x < n - 1 ? i + 1 : i,
        y ? i - n : i,
        y < n - 1 ? i + n : i,
      ]) {
        let diff = 0;
        for (let k = 0; k < 3; k++)
          diff += (rgb[i * 3 + k] - rgb[j * 3 + k]) ** 2;
        const w = 0.002 + Math.exp(-diff / 0.004);
        sum += a[j] * w;
        weight += w;
      }
      b[i] = sum / weight;
    }
    [a, b] = [b, a];
  }
  return (x, y) =>
    a[
      MathUtils.clamp(Math.round(y * n - 0.5), 0, n - 1) * n +
        MathUtils.clamp(Math.round(x * n - 0.5), 0, n - 1)
    ];
}
function lightAt(panel, x, y) {
  const i =
      4 *
      (MathUtils.clamp(Math.round(y * panel.size), 0, panel.size - 1) *
        panel.size +
        MathUtils.clamp(Math.round(x * panel.size), 0, panel.size - 1)),
    p = panel.pixels;
  return (0.25 * p[i] + 0.55 * p[i + 1] + 0.2 * p[i + 2]) / 255;
}
export function fitHairCap(part, panels, regions) {
  const shapes = regions.filter(
    (r) =>
      /hair|coiffure|fringe|bun|braid|locks/i.test(r.id) &&
      r.front?.length >= 3 &&
      r.side?.length >= 3,
  );
  if (!shapes.length) return null;
  const front = shapes.map((r) => r.front),
    side = shapes.map((r) => r.side);
  const mask = new Uint8Array(bytes),
    texture = new Float32Array(bytes),
    relief = new Uint8Array(bytes);
  const binding = part.paint,
    rest = sweepGeometry(binding.rest, true, width),
    positions = rest.attributes.position;
  const rows = positions.count / (width + 1) - 1,
    [f, s] = panels;
  const frontMask = hairMask(f, front),
    sideMask = hairMask(s, side);
  let area = 0;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const row = Math.min(rows, Math.round((j / (height - 1)) * rows)),
        k = row * (width + 1) + i;
      const x = (positions.getX(k) + binding.offset[0]) / binding.height,
        y = (positions.getY(k) + binding.offset[1]) / binding.height,
        z = (positions.getZ(k) + binding.offset[2]) / binding.height;
      const fx = (f.mid + x * f.span) / f.size,
        fy = (f.feet - y * f.span) / f.size,
        sx = (s.mid - z * s.span) / s.size,
        sy = (s.feet - y * s.span) / s.size;
      const theta = (i / width) * Math.PI * 2,
        zNormal = -Math.sin(theta),
        frontWeight = MathUtils.smoothstep(zNormal, 0.08, 0.78);
      const amount = MathUtils.lerp(
        sideMask(sx, sy),
        frontMask(fx, fy),
        frontWeight,
      );
      mask[j * width + i] = Math.round(255 * amount);
      area += amount;
      const panel = zNormal < -0.4 ? panels[2] : f;
      const px = panel === f ? fx : (panel.mid - x * panel.span) / panel.size,
        py = (panel.feet - y * panel.span) / panel.size;
      texture[j * width + i] = MathUtils.lerp(
        lightAt(s, sx, sy),
        lightAt(panel, px, py),
        Math.max(frontWeight, MathUtils.smoothstep(-zNormal, 0.15, 0.9)),
      );
    }
  rest.dispose();
  if (area < bytes * 0.025 || area > bytes * 0.85) return null;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      let surround = 0;
      for (const [dx, dy] of [
        [-3, 0],
        [3, 0],
        [0, -3],
        [0, 3],
        [-2, 2],
        [2, -2],
      ])
        surround +=
          texture[
            MathUtils.clamp(j + dy, 0, height - 1) * width +
              ((i + dx + width) % width)
          ];
      const u = (i / width) * Math.PI * 2,
        v = j / (height - 1);
      const locks =
        Math.sin(17 * u + v * 24 + 2.3 * Math.sin(3 * u + v * 7)) * 0.18 +
        0.1 * Math.sin(29 * u - v * 21 + 1.5 * Math.sin(5 * u));
      relief[j * width + i] = Math.round(
        255 *
          MathUtils.clamp(
            0.5 + 2.1 * (texture[j * width + i] - surround / 6) + locks,
            0,
            1,
          ),
      );
    }
  const head = headSpace(binding),
    face = head.portrait;
  const nx =
    (face.center * head.height - head.offset[0] + binding.offset[0]) /
    binding.height;
  const ny =
    ((face.eyes + 0.085) * head.height - head.offset[1] + binding.offset[1]) /
    binding.height;
  const index =
    4 *
    (MathUtils.clamp(Math.round(f.feet - ny * f.span), 0, f.size - 1) * f.size +
      MathUtils.clamp(Math.round(f.mid + nx * f.span), 0, f.size - 1));
  return {
    mask: encode(mask),
    relief: encode(relief),
    scalp: Array.from(f.pixels.slice(index, index + 3), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join(""),
  };
}

export function separateHair(geometry, binding, cap, needShell = true) {
  const mask = read(cap.mask),
    relief = read(cap.relief),
    pos = geometry.attributes.position,
    normal = geometry.attributes.normal,
    uv = geometry.attributes.uv;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox,
    extent = box.getSize(new Vector3()),
    center = box.getCenter(new Vector3()),
    H = extent.y;
  const p = new Vector3(),
    n = new Vector3(),
    coords = [],
    tex = [],
    indices = [],
    edgeLookup = new Map(),
    vertices = new Map(),
    weights = new Float32Array(pos.count);
  const shell = new Float32Array(pos.count * 3),
    innerIndices = [],
    innerPoints = new Map();
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i),
      v = uv.getY(i),
      weight = value(mask, u, v),
      detail = value(relief, u, v);
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(normal, i);
    weights[i] = weight;
    const lift = H * (0.004 + 0.024 * (detail - 0.4));
    p.clone()
      .addScaledVector(n, lift)
      .toArray(shell, 3 * i);
    const band = MathUtils.smoothstep((p.y - box.min.y) / H, 0.28, 0.65);
    const under = Math.max(
      band * 0.82,
      MathUtils.smoothstep(weight, 0.04, 0.9),
    );
    const side = p.x - center.x,
      back = p.z - center.z,
      above = Math.max(0, p.y - (box.min.y + H * 0.47));
    const faceFront =
      MathUtils.smoothstep(-Math.sin(u * Math.PI * 2), 0.25, 0.8) *
      (1 - weight);
    const inset = under * (1 - faceFront);
    pos.setXYZ(
      i,
      p.x - side * 0.205 * inset,
      p.y - above * 0.24 * inset,
      p.z - back * 0.16 * inset,
    );
  }
  function append(x, y, z, u, v) {
    const index = coords.length / 3;
    coords.push(x, y, z);
    tex.push(u, v);
    return index;
  }
  function add(i) {
    if (!vertices.has(i))
      vertices.set(
        i,
        append(
          shell[i * 3],
          shell[i * 3 + 1],
          shell[i * 3 + 2],
          uv.getX(i),
          uv.getY(i),
        ),
      );
    return vertices.get(i);
  }
  function innerVertex(outer, point) {
    const idx = append(
      point.x,
      point.y,
      point.z,
      tex[outer * 2],
      tex[outer * 2 + 1],
    );
    innerIndices.push(idx);
    innerPoints.set(outer, idx);
    return idx;
  }
  function insideOriginal(i) {
    const a = add(i);
    if (!innerPoints.has(a))
      innerVertex(a, new Vector3().fromBufferAttribute(pos, i));
    return innerPoints.get(a);
  }
  function edge(i, j) {
    const key = Math.min(i, j) * pos.count + Math.max(i, j);
    if (edgeLookup.has(key)) return edgeLookup.get(key);
    const t = (0.48 - weights[i]) / (weights[j] - weights[i]),
      lerp = (a, b) => MathUtils.lerp(a, b, t);
    const u = lerp(uv.getX(i), uv.getX(j)),
      v = lerp(uv.getY(i), uv.getY(j));
    const top = append(
      lerp(shell[i * 3], shell[j * 3]),
      lerp(shell[i * 3 + 1], shell[j * 3 + 1]),
      lerp(shell[i * 3 + 2], shell[j * 3 + 2]),
      u,
      v,
    );
    const inner = innerVertex(
      top,
      new Vector3(
        lerp(pos.getX(i), pos.getX(j)),
        lerp(pos.getY(i), pos.getY(j)),
        lerp(pos.getZ(i), pos.getZ(j)),
      ),
    );
    const pair = [top, inner];
    edgeLookup.set(key, pair);
    return pair;
  }
  if (needShell) {
    const source = geometry.index.array;
    for (let k = 0; k < source.length; k += 3) {
      const poly = [],
        cuts = [];
      for (let j = 0; j < 3; j++) {
        const i = source[k + j],
          next = source[k + ((j + 1) % 3)],
          inside = weights[i] >= 0.48;
        if (inside) {
          poly.push(add(i));
          insideOriginal(i);
        }
        if (inside !== weights[next] >= 0.48) {
          const cross = edge(i, next);
          poly.push(cross[0]);
          cuts.push({ cross, exit: inside });
        }
      }
      for (let j = 1; j + 1 < poly.length; j++)
        indices.push(
          poly[0],
          poly[j],
          poly[j + 1],
          innerPoints.get(poly[j + 1]),
          innerPoints.get(poly[j]),
          innerPoints.get(poly[0]),
        );
      if (cuts.length === 2) {
        const [a, b] = cuts[0].exit
          ? [cuts[0].cross, cuts[1].cross]
          : [cuts[1].cross, cuts[0].cross];
        indices.push(b[0], a[0], a[1], b[0], a[1], b[1]);
      }
    }
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (!indices.length) return null;
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(coords, 3));
  g.setAttribute("uv", new Float32BufferAttribute(tex, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.hairLining = innerIndices;
  return g;
}
export function seatHair(hair, head, part, cap) {
  const lining = hair.geometry.hairLining;
  if (!lining?.length || !part.knots) return;
  head.updateWorldMatrix(true, false);
  hair.updateWorldMatrix(true, false);
  const toHead = head.matrixWorld.clone().invert().multiply(hair.matrixWorld),
    toHair = toHead.clone().invert(),
    rows = part.knots;
  const p = new Vector3(),
    original = new Vector3(),
    pos = hair.geometry.attributes.position,
    uv = hair.geometry.attributes.uv;
  const inner = new Set(lining),
    margin = hairMargin(cap.mask);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(toHead);
    original.copy(p);
    const coverage = inner.has(i) ? 0 : value(margin, uv.getX(i), uv.getY(i));
    if (coverage > 0.999) continue;
    let lo = 0,
      hi = rows.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rows[mid][1] < p.y) lo = mid;
      else hi = mid;
    }
    const a = rows[lo],
      b = rows[hi],
      t = MathUtils.clamp((p.y - a[1]) / (b[1] - a[1] || 1), 0, 1);
    const at = (k) => MathUtils.lerp(a[k], b[k], t),
      dx = p.x - at(0),
      dz = p.z - at(2);
    const radius = Math.hypot(dx / at(3), dz / at(4));
    if (radius > 0.91) {
      p.x = at(0) + (dx * 0.91) / radius;
      p.z = at(2) + (dz * 0.91) / radius;
    }
    p.lerp(original, coverage).applyMatrix4(toHair);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  hair.geometry.computeVertexNormals();
  hair.geometry.computeBoundingBox();
  hair.geometry.computeBoundingSphere();
}
const margins = new Map();
function hairMargin(key) {
  if (margins.has(key)) return margins.get(key);
  const mask = read(key),
    a = Uint8Array.from(mask, (v) => (v >= 123 ? 255 : 0));
  for (let k = 0; k < 8; k++) {
    const prev = a.slice();
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!prev[i]) continue;
        const near = Math.min(
          prev[y * width + ((x + 1) % width)],
          prev[y * width + ((x + width - 1) % width)],
          prev[Math.max(0, y - 1) * width + x],
          prev[Math.min(height - 1, y + 1) * width + x],
        );
        a[i] = Math.min(prev[i], near + 32);
      }
  }
  for (let i = 0; i < a.length; i++)
    a[i] = Math.round(255 * MathUtils.smoothstep(a[i] / 255, 0, 1));
  if (margins.size >= 8) margins.delete(margins.keys().next().value);
  margins.set(key, a);
  return a;
}
export function scalpMaterial(source, cap) {
  if (!source.map?.image) return source;
  let choices = maps.get(source.map);
  if (!choices) {
    choices = new Map();
    maps.set(source.map, choices);
  }
  let texture = choices.get(cap.mask);
  if (!texture) {
    const c = document.createElement("canvas");
    c.width = source.map.image.width;
    c.height = source.map.image.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source.map.image, 0, 0);
    const im = ctx.getImageData(0, 0, c.width, c.height),
      rgb = [0, 2, 4].map((i) => parseInt(cap.scalp.slice(i, i + 2), 16)),
      mask = read(cap.mask);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = 4 * (y * c.width + x),
          weight = MathUtils.smoothstep(
            value(mask, (x + 0.5) / c.width, 1 - (y + 0.5) / c.height),
            0.19,
            0.69,
          );
        for (let k = 0; k < 3; k++)
          im.data[i + k] = MathUtils.lerp(im.data[i + k], rgb[k], weight);
      }
    ctx.putImageData(im, 0, 0);
    texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = source.map.wrapS;
    texture.wrapT = source.map.wrapT;
    choices.set(cap.mask, texture);
  }
  const m = source.clone();
  m.map = texture;
  if (m.emissiveMap) m.emissiveMap = texture;
  return m;
}
