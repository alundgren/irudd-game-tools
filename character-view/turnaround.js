import { registerFace } from "./portrait-frame.js";
import * as T from "three";
import tidebell from "./tidebell.atlas.webp";
import expedition from "./expedition.atlas.webp";
import ridgeback from "./ridgeback.atlas.webp";
import { sweepGeometry } from "./surface.js";

import cartographer from "./cartographer.atlas.webp";
import conductor from "./conductor.atlas.webp";
import coastPortrait from "./coast-portrait.atlas.webp";
import conductorPortrait from "./conductor-portrait.atlas.webp";
import { portraitSurface } from "./facial-sculpt.js";
import foremanPortrait from "./foreman-portrait.atlas.webp";
import relayPortrait from "./relay-portrait.atlas.webp";
import trader from "./trader.atlas.webp";
import surveyor from "./surveyor.atlas.webp";
import courier from "./courier.atlas.webp";
const sources = {
  tidebell,
  trader,
  surveyor,
  courier,
  foremanPortrait,
  relayPortrait,
  expedition,
  ridgeback,
  cartographer,
  conductor,
  coastPortrait,
  conductorPortrait,
};
const atlases = new Map(),
  artworkImages = new Map(),
  baked = new Map(),
  viewsByAtlas = new Map();
export const hasTurnaround = (id) => atlases.has(id);

// Dilation supplies the nearest foreground colour outside thin silhouettes.
// It keeps the chroma key out of texture filtering at the edge of a claw.
function preparePanel(image, tile) {
  const size = 640;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    image,
    ((tile % 2) * image.width) / 2,
    (Math.floor(tile / 2) * image.height) / 2,
    image.width / 2,
    image.height / 2,
    0,
    0,
    size,
    size,
  );
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size),
    subject = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let minX = size,
    minY = size,
    maxX = -1,
    maxY = -1,
    tail = 0;
  for (let i = 0; i < mask.length; i++) {
    const off = i * 4,
      r = pixels[off],
      g = pixels[off + 1],
      b = pixels[off + 2];
    const keyed = Math.min(r, b) > 108 && Math.min(r, b) > g * 1.7 + 32;
    if (pixels[off + 3] >= 190 && !keyed) subject[i] = 1;
  }
  for (let i = 2 * size + 2; i < mask.length - 2 * size - 2; i++) {
    if (!subject[i]) continue;
    // Exclude antialiased key-colour spill before extending surface colours.
    if (
      !subject[i - 2] ||
      !subject[i + 2] ||
      !subject[i - size * 2] ||
      !subject[i + size * 2]
    )
      continue;
    mask[i] = 1;
    queue[tail++] = i;
    const x = i % size,
      y = Math.floor(i / size);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (maxY - minY < size * 0.15 || maxX - minX < size * 0.04)
    throw new Error(
      "Each view needs a visible subject on magenta or transparency.",
    );
  const filled = mask.slice();
  for (let i = 0; i < tail; i++) {
    const at = queue[i],
      x = at % size;
    for (const next of [
      x > 0 ? at - 1 : -1,
      x < size - 1 ? at + 1 : -1,
      at - size,
      at + size,
    ]) {
      if (next < 0 || next >= mask.length || filled[next]) continue;
      filled[next] = 1;
      queue[tail++] = next;
      const a = at * 4,
        b = next * 4;
      pixels[b] = pixels[a];
      pixels[b + 1] = pixels[a + 1];
      pixels[b + 2] = pixels[a + 2];
      pixels[b + 3] = 255;
    }
  }
  return {
    size,
    pixels,
    mask,
    mid: (minX + maxX) / 2,
    feet: maxY,
    span: maxY - minY,
  };
}
export async function registerTurnaround(id, url) {
  if (atlases.has(id)) return;
  const image = await new T.ImageLoader().loadAsync(url);
  if (image.width / image.height < 0.65 || image.width / image.height > 1.5)
    throw new Error("Use a two-by-two turnaround.");
  atlases.set(
    id,
    Array.from({ length: 4 }, (_, i) => preparePanel(image, i)),
  );
  artworkImages.set(id, image);
}
export function loadTurnarounds() {
  return Promise.all(
    Object.entries(sources).map(([id, url]) => registerTurnaround(id, url)),
  );
}
export function registeredArtwork() {
  return [...atlases.keys()];
}
export async function restoreArtwork(form) {
  await Promise.all(
    Object.entries(form.artwork ?? {}).map(async ([id, url]) => {
      if (!/^data:image\/webp;base64,/i.test(url))
        throw new Error("Invalid portable artwork.");
      const bytes = Uint8Array.from(
        atob(url.slice(url.indexOf(",") + 1)),
        (c) => c.charCodeAt(0),
      );
      if (id !== (await artworkId(bytes)))
        throw new Error("The saved artwork does not match its content hash.");
      await registerTurnaround(id, url);
    }),
  );
}
export function paintGuide(ctx, id, index) {
  const image = artworkImages.get(id);
  if (image)
    ctx.drawImage(
      image,
      ((index % 2) * image.width) / 2,
      (Math.floor(index / 2) * image.height) / 2,
      image.width / 2,
      image.height / 2,
      0,
      0,
      ctx.canvas.width,
      ctx.canvas.height,
    );
}
async function artworkId(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "art-" +
    Array.from(new Uint8Array(hash), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function importArtwork(file) {
  if (file.size > 12_000_000)
    throw new Error("Choose an image smaller than 12 MB.");
  const source = URL.createObjectURL(file);
  let image;
  try {
    image = await new T.ImageLoader().loadAsync(source);
  } finally {
    URL.revokeObjectURL(source);
  }
  const factor = Math.min(1, 1800 / Math.max(image.width, image.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.round(factor * image.width);
  canvas.height = Math.round(factor * image.height);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.92),
  );
  if (!blob || blob.size > 2_400_000)
    throw new Error("Resize this turnaround to fit the 2.4 MB image limit.");
  const id = await artworkId(await blob.arrayBuffer());
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  await registerTurnaround(id, url);
  return { id, url };
}
export function palmColor(part, fallback) {
  const b = part.paint,
    p = atlases.get(b?.atlas)?.[0];
  if (!p || !b?.rest?.length) return fallback;
  const samples = [];
  for (const f of [0.25, 0.38, 0.5, 0.62, 0.75]) {
    const k = b.rest[Math.round(f * (b.rest.length - 1))];
    for (const u of [-0.35, 0, 0.35]) {
      const i = projected(
        p,
        (b.offset[0] + k[0] + k[3] * u) / b.height,
        (b.offset[1] + k[1]) / b.height,
      );
      if (p.mask[i]) samples.push([...p.pixels.slice(4 * i, 4 * i + 3)]);
    }
  }
  if (!samples.length) return fallback;
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return (
    "#" +
    samples[Math.floor(samples.length / 2)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}
export function calibrateFace(part, marks) {
  const panel = atlases.get(part?.paint?.atlas)?.[0];
  if (!panel) throw new Error("Load the source art before fitting a face.");
  return registerFace(part, marks, panel);
}
export function guideHeight(atlas, view, y) {
  const p = atlases.get(atlas)[view];
  return (p.feet - y * p.size) / p.span;
}
export function guidePosition(atlas, view, h) {
  const p = atlases.get(atlas)[view];
  return (p.feet - h * p.span) / p.size;
}
// The same landmarks, measured in both pictures, define a curved axis in metres.
export function tracePath(id, atlas, height, spine) {
  const panels = atlases.get(atlas);
  if (!panels || !Array.isArray(spine) || spine.length < 2 || spine.length > 48)
    throw new Error("Mark 2 to 48 matching centreline points.");
  const knots = spine.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== 6 ||
      !row.every(Number.isFinite) ||
      row.slice(0, 4).some((v) => v < 0 || v > 1) ||
      row.slice(4).some((v) => v <= 0 || v > 0.6)
    )
      throw new Error(
        "Each path point needs matching front/profile coordinates and two positive radii.",
      );
    const [fx, fy, sx, sy, rw, rd] = row,
      [f, s] = panels;
    const yf = guideHeight(atlas, 0, fy),
      ys = guideHeight(atlas, 1, sy);
    if (Math.abs(yf - ys) > 0.15)
      throw new Error(
        "A paired path landmark lies at different heights in the two views.",
      );
    return [
      ((fx * f.size - f.mid) / f.span) * height,
      (yf + ys) * 0.5 * height,
      ((s.mid - sx * s.size) / s.span) * height,
      Math.max(0.0006, rw * height),
      Math.max(0.0006, rd * height),
    ];
  });
  const pivot = knots[0].slice(0, 3),
    local = knots.map((row) => row.map((x, i) => (i < 3 ? x - pivot[i] : x)));
  return {
    id,
    shape: "sweep",
    position: pivot,
    size: [1, 1, 1],
    rotation: [0, 0, 0],
    color: "#ffffff",
    knots: local,
    paint: { atlas, height, offset: pivot, rest: local, frame: "path" },
  };
}
function polygonInterval(points, y) {
  const hits = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
      hits.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
  }
  return hits.length >= 2 ? [Math.min(...hits), Math.max(...hits)] : null;
}
function outlineHeights(atlas, outlines) {
  let low = 0.001,
    high = 0.999;
  for (const [view, points] of outlines.entries()) {
    if (!points.length) continue;
    const ys = points.map((p) => guideHeight(atlas, view, p[1]));
    low = Math.max(low, Math.min(...ys));
    high = Math.min(high, Math.max(...ys));
  }
  if (high <= low)
    throw new Error("The front and profile outlines must overlap in height.");
  return [low, high];
}
export function traceHull(id, atlas, height, outlines = [[], []]) {
  const panels = atlases.get(atlas);
  if (!panels) throw new Error("Choose a loaded turnaround.");
  const rows = [],
    [low, high] = outlineHeights(atlas, outlines);
  for (let j = 0; j < 89; j++) {
    const h = low + ((high - low) * (j + 0.01)) / 88.02,
      spans = [];
    for (let v = 0; v < 2; v++) {
      const p = panels[v];
      const span = outlines[v].length
        ? polygonInterval(outlines[v], guidePosition(atlas, v, h))
        : [0, 1];
      if (!span) break;
      const [a, b] = span.map((u) => (u * p.size - p.mid) / p.span);
      const runs = silhouetteRuns(atlas, v, h, 0.005)
        .map(([l, r]) => [Math.max(a, l), Math.min(b, r)])
        .filter(([l, r]) => r - l > 0.005);
      spans.push(v === 0 ? runs : runs.reverse().map(([l, r]) => [-r, -l]));
    }
    rows.push(
      spans.length === 2 && spans.every((s) => s.length)
        ? [h, ...spans]
        : [h, [], []],
    );
  }
  while (rows.length && !rows[0][1].length) rows.shift();
  while (rows.length && !rows.at(-1)[1].length) rows.pop();
  if (rows.filter((r) => r[1].length).length < 3)
    throw new Error("Select a larger overlapping region.");
  const middle = (intervals) =>
    (Math.min(...intervals.map((x) => x[0])) +
      Math.max(...intervals.map((x) => x[1]))) /
    2;
  const pivot = [
    middle(rows.flatMap((r) => r[1])),
    rows[0][0],
    middle(rows.flatMap((r) => r[2])),
  ];
  const frames = panels.map((p) => [
    p.mid / p.size,
    p.feet / p.size,
    p.span / p.size,
  ]);
  return {
    id,
    shape: "volume",
    size: [1, 1, 1],
    rotation: [0, 0, 0],
    position: pivot.map((v) => v * height),
    color: "#ffffff",
    hull: { atlas, height, rows, pivot, frames, resolution: 64 },
  };
}
const sheetTextures = new Map();
export function volumeMaterial(part) {
  const id = part.hull.atlas,
    panels = atlases.get(id);
  if (!panels) return new T.MeshStandardMaterial({ color: part.color });
  if (!sheetTextures.has(id)) {
    const n = panels[0].size,
      c = document.createElement("canvas");
    c.width = c.height = n * 2;
    const ctx = c.getContext("2d");
    panels.forEach((p, i) =>
      ctx.putImageData(
        new ImageData(p.pixels, n, n),
        (i % 2) * n,
        Math.floor(i / 2) * n,
      ),
    );
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    sheetTextures.set(id, tex);
  }
  return new T.MeshStandardMaterial({
    map: sheetTextures.get(id),
    color: part.color,
    roughness: 0.85,
  });
}
export function traceOutline(id, atlas, height, outlines) {
  const panels = atlases.get(atlas);
  if (!panels) throw new Error("Choose an available turnaround.");
  const tracks = [],
    [low, high] = outlineHeights(atlas, outlines);
  for (let i = 0; i < 42; i++) {
    const h = low + ((high - low) * (i + 0.01)) / 41.02,
      edges = [];
    for (let v = 0; v < 2; v++) {
      const p = panels[v],
        y = guidePosition(atlas, v, h);
      const interval = outlines[v].length
        ? polygonInterval(outlines[v], y)
        : [0, 1];
      if (!interval) break;
      const [l, r] = interval.map((u) => (u * p.size - p.mid) / p.span);
      edges.push(...(v === 0 ? [l, r] : [-r, -l]));
    }
    if (edges.length === 4) tracks.push([h, ...edges]);
  }
  if (tracks.length < 2)
    throw new Error(
      "The front and profile outlines must overlap in height. Widen the selected region.",
    );
  return traceRegion(id, atlas, height, tracks, null, {
    samples: Math.min(42, Math.max(12, tracks.length)),
  });
}

function projected(panel, horizontal, height) {
  const px = Math.max(
    0,
    Math.min(panel.size - 1, Math.round(panel.mid + horizontal * panel.span)),
  );
  const py = Math.max(
    0,
    Math.min(panel.size - 1, Math.round(panel.feet - height * panel.span)),
  );
  return py * panel.size + px;
}
// Occupied horizontal intervals in standing-height units, independent of image padding.
export function silhouetteRuns(atlas, view, height, bridge = 0.011) {
  const p = atlases.get(atlas)?.[view];
  if (!p) throw new Error("Choose a loaded turnaround.");
  const y = Math.max(
    0,
    Math.min(p.size - 1, Math.round(p.feet - height * p.span)),
  );
  const runs = [];
  for (let x = 0; x < p.size; x++) {
    if (!p.mask[y * p.size + x]) continue;
    const u = (x - p.mid) / p.span,
      last = runs.at(-1);
    if (last && u - last[1] <= bridge) last[1] = u;
    else runs.push([u, u]);
  }
  return runs.filter(([a, b]) => b - a >= 0.003);
}
function section(panel, low, high, y, reverse = false) {
  const sign = reverse ? -1 : 1,
    step = 1 / panel.span;
  let a = low,
    b = high;
  while (a < b && !panel.mask[projected(panel, sign * a, y)]) a += step;
  while (b > a && !panel.mask[projected(panel, sign * b, y)]) b -= step;
  return a < b ? [a, b] : null;
}

// A track describes a body region in calibrated front and profile views.
// Each row holds height, left, right, rear and fore limits in standing-height units.
export function traceRegion(id, atlas, height, track, parent, options = {}) {
  const panels = atlases.get(atlas);
  if (!panels) throw new Error("The turnaround is still loading.");
  const knots = [],
    samples = options.samples ?? 26;
  for (let n = 0; n < samples; n++) {
    const y = T.MathUtils.lerp(track[0][0], track.at(-1)[0], n / (samples - 1));
    let k = 1;
    while (k < track.length - 1 && track[k][0] < y) k++;
    const a = track[k - 1],
      b = track[k],
      t = (y - a[0]) / (b[0] - a[0]);
    const bounds = [1, 2, 3, 4].map((i) => T.MathUtils.lerp(a[i], b[i], t));
    const front = section(panels[0], bounds[0], bounds[1], y);
    const profile = section(panels[1], bounds[2], bounds[3], y, true);
    if (!front || !profile) continue;
    const [left, right] = front,
      [rear, fore] = profile;
    knots.push([
      ((left + right) * height) / 2,
      y * height,
      ((rear + fore) * height) / 2,
      Math.max(0.001, ((right - left) * height) / 2),
      Math.max(0.001, ((fore - rear) * height) / 2),
    ]);
  }
  if (knots.length < 2)
    throw new Error("A region must cover at least two visible cross sections.");
  // A few source pixels can move a silhouette sideways at a hair tip or an
  // overlapping plate. Regularise the cross sections before fitting the loft.
  for (let pass = 0; pass < (options.smooth ?? 2); pass++) {
    const prev = knots.map((v) => v.slice());
    for (let i = 1; i < knots.length - 1; i++)
      for (const j of [0, 2, 3, 4])
        knots[i][j] =
          0.25 * prev[i - 1][j] + 0.5 * prev[i][j] + 0.25 * prev[i + 1][j];
  }
  const pivot = knots[options.pivot === "top" ? knots.length - 1 : 0].slice(
    0,
    3,
  );
  const local = knots.map((row) =>
    row.map((v, i) => (i < 3 ? v - pivot[i] : v)),
  );
  const paint = {
    atlas,
    region: id,
    height,
    offset: pivot,
    rest: local,
    profile: options.profile ?? 1,
  };
  return {
    id,
    shape: "sweep",
    position: pivot,
    size: [1, 1, 1],
    rotation: [0, 0, 0],
    knots: local,
    color: "#ffffff",
    paint,
    ...(parent ? { parent } : {}),
  };
}

// Estimate visibility in the original standing pose. A camera looking past a
// sleeve must sample the adjacent garment, even after that sleeve is moved.
function regionalViews(panels, bindings) {
  const result = new Map(bindings.map((b) => [b.region, []]));
  for (let view = 0; view < 4; view++) {
    const panel = panels[view],
      n = panel.size,
      profile = view % 2 === 1;
    const depth = new Float32Array(n * n).fill(-Infinity),
      owner = new Uint16Array(n * n);
    const boxes = [];
    for (const [index, binding] of bindings.entries()) {
      const rows = binding.rest.map(([x, y, z, w, d]) => [
        (x + binding.offset[0]) / binding.height,
        (y + binding.offset[1]) / binding.height,
        (z + binding.offset[2]) / binding.height,
        w / binding.height,
        d / binding.height,
      ]);
      const minY = Math.max(
        0,
        Math.floor(panel.feet - rows.at(-1)[1] * panel.span),
      );
      const maxY = Math.min(
        n - 1,
        Math.ceil(panel.feet - rows[0][1] * panel.span),
      );
      let minX = n - 1,
        maxX = 0;
      for (let py = minY; py <= maxY; py++) {
        const h = (panel.feet - py) / panel.span;
        let i = 1;
        while (i < rows.length - 1 && rows[i][1] < h) i++;
        const a = rows[i - 1],
          b = rows[i],
          v = T.MathUtils.clamp((h - a[1]) / (b[1] - a[1]), 0, 1);
        const sample = (j) => T.MathUtils.lerp(a[j], b[j], v);
        const ax = sample(0),
          az = sample(2),
          rw = sample(3),
          rd = sample(4);
        const centre = [ax, -az, -ax, az][view],
          toward = [az, ax, -az, -ax][view];
        const radius = profile ? rd : rw,
          thickness = profile ? rw : rd;
        const left = Math.max(
          0,
          Math.floor(panel.mid + (centre - radius) * panel.span),
        );
        const right = Math.min(
          n - 1,
          Math.ceil(panel.mid + (centre + radius) * panel.span),
        );
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
        for (let px = left; px <= right; px++) {
          const u = ((px - panel.mid) / panel.span - centre) / radius;
          const z = toward + thickness * Math.sqrt(Math.max(0, 1 - u * u)),
            off = py * n + px;
          if (depth[off] < z) {
            depth[off] = z;
            owner[off] = index + 1;
          }
        }
      }
      boxes.push([minX, minY, maxX, maxY]);
    }
    for (const [index, binding] of bindings.entries()) {
      let [xmin, ymin, xmax, ymax] = boxes[index];
      xmin = Math.max(0, xmin - 5);
      ymin = Math.max(0, ymin - 5);
      xmax = Math.min(n - 1, xmax + 5);
      ymax = Math.min(n - 1, ymax + 5);
      const width = xmax - xmin + 1,
        height = ymax - ymin + 1;
      if (width < 1 || height < 1) {
        result.get(binding.region).push(null);
        continue;
      }
      const nearest = new Int32Array(width * height).fill(-1),
        queue = new Int32Array(nearest.length);
      let tail = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x,
            source = (y + ymin) * n + x + xmin;
          // Trim a few boundary pixels of other regions, which often contain
          // antialiasing or imperfectly registered fingers on a garment.
          if (owner[source] !== index + 1 || !panel.mask[source]) continue;
          if (
            [source - 2, source + 2, source - 2 * n, source + 2 * n].some(
              (j) => owner[j] && owner[j] !== index + 1,
            )
          )
            continue;
          nearest[i] = source;
          queue[tail++] = i;
        }
      if (!tail) {
        result.get(binding.region).push(null);
        continue;
      }
      for (let i = 0; i < tail; i++) {
        const at = queue[i],
          x = at % width;
        for (const next of [
          x ? at - 1 : -1,
          x < width - 1 ? at + 1 : -1,
          at - width,
          at + width,
        ]) {
          if (next < 0 || next >= nearest.length || nearest[next] >= 0)
            continue;
          nearest[next] = nearest[at];
          queue[tail++] = next;
        }
      }
      result.get(binding.region).push({ nearest, xmin, ymin, width, height });
    }
  }
  return result;
}
export function preparePaintRegions(sources) {
  const groups = new Map();
  for (const paint of sources) {
    if (!paint?.region || !atlases.has(paint.atlas)) continue;
    if (!groups.has(paint.atlas)) groups.set(paint.atlas, new Map());
    groups.get(paint.atlas).set(paint.region, paint);
  }
  for (const [id, group] of groups) {
    const previous = viewsByAtlas.get(id);
    const ordered = [...group.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, p]) => p);
    const signature = JSON.stringify(
      ordered.map((p) => [p.region, p.height, p.offset, p.rest]),
    );
    if (previous?.signature === signature) continue;
    const views = regionalViews(atlases.get(id), ordered);
    viewsByAtlas.set(id, { signature, views });
    for (const [key, texture] of baked)
      if (JSON.parse(key).atlas === id) {
        texture.dispose();
        baked.delete(key);
      }
  }
}
function unobscured(index, panel, region) {
  if (!region) return index;
  const x = T.MathUtils.clamp(
    (index % panel.size) - region.xmin,
    0,
    region.width - 1,
  );
  const y = T.MathUtils.clamp(
    Math.floor(index / panel.size) - region.ymin,
    0,
    region.height - 1,
  );
  return region.nearest[y * region.width + x];
}

// Bake four projections into an ordinary UV texture. The result survives
// export and remains attached when the artist moves or reshapes the part.
export function paintedMaterial(part) {
  const binding = part.paint,
    panels = atlases.get(binding.atlas);
  if (!panels) return new T.MeshStandardMaterial({ color: part.color });
  const cacheKey = JSON.stringify(binding);
  if (!baked.has(cacheKey)) {
    const region = viewsByAtlas.get(binding.atlas)?.views.get(binding.region);
    const sides = binding.portrait ? 80 : 20;
    const rest = portraitSurface(
      sweepGeometry(binding.rest, binding.frame !== "path", sides),
      binding,
    );
    const positions = rest.attributes.position,
      normals = rest.attributes.normal;
    const columns = sides + 1,
      bands = positions.count / columns - 1;
    const canvas = document.createElement("canvas");
    canvas.width = binding.portrait ? 1024 : 512;
    canvas.height = binding.portrait ? 640 : 512;
    const ctx = canvas.getContext("2d"),
      out = ctx.createImageData(canvas.width, canvas.height);
    const corners = [0, 0, 0, 0],
      weights = [0, 0, 0, 0];
    for (let y = 0; y < canvas.height; y++) {
      const row = (1 - (y + 0.5) / canvas.height) * bands,
        r = Math.floor(row),
        v = row - r;
      for (let x = 0; x < canvas.width; x++) {
        const col = ((x + 0.5) / canvas.width) * (columns - 1),
          c = Math.floor(col),
          u = col - c;
        corners[0] = r * columns + c;
        corners[1] = corners[0] + 1;
        corners[2] = corners[0] + columns;
        corners[3] = corners[2] + 1;
        weights[0] = (1 - u) * (1 - v);
        weights[1] = u * (1 - v);
        weights[2] = (1 - u) * v;
        weights[3] = u * v;
        let px = binding.offset[0],
          py = binding.offset[1],
          pz = binding.offset[2],
          nx = 0,
          nz = 0;
        for (let i = 0; i < 4; i++) {
          const j = corners[i],
            w = weights[i];
          px += positions.getX(j) * w;
          py += positions.getY(j) * w;
          pz += positions.getZ(j) * w;
          nx += normals.getX(j) * w;
          nz += normals.getZ(j) * w;
        }
        if (binding.portrait) {
          const a = ((x + 0.5) / canvas.width) * 2 * Math.PI;
          nx = Math.cos(a);
          nz = -Math.sin(a);
        }
        const face = nz >= 0 ? 0 : 2,
          side = nx >= 0 ? 1 : 3;
        const f = panels[face],
          s = panels[side],
          height = py / binding.height;
        const fi =
          unobscured(
            projected(f, (face === 0 ? px : -px) / binding.height, height),
            f,
            region?.[face],
          ) * 4;
        const si =
          unobscured(
            projected(s, (side === 1 ? -pz : pz) / binding.height, height),
            s,
            region?.[side],
          ) * 4;
        const fw = Math.abs(nz) ** 4,
          sw = Math.abs(nx) ** 4 * (binding.profile ?? 1);
        const mix = sw / (fw + sw + 1e-8),
          off = (y * canvas.width + x) * 4;
        for (let k = 0; k < 3; k++)
          out.data[off + k] = T.MathUtils.lerp(
            f.pixels[fi + k],
            s.pixels[si + k],
            mix,
          );
        out.data[off + 3] = 255;
      }
    }
    rest.dispose();
    ctx.putImageData(out, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    if (baked.size >= 96) {
      const oldest = baked.keys().next().value;
      baked.get(oldest).dispose();
      baked.delete(oldest);
    }
    baked.set(cacheKey, texture);
  }
  const texture = baked.get(cacheKey);
  return new T.MeshStandardMaterial({
    color: new T.Color(part.color).multiplyScalar(0.46),
    map: texture,
    emissive: part.color,
    emissiveMap: texture,
    emissiveIntensity: 0.49,
    roughness: 1,
  });
}
