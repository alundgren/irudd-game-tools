import {
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  SRGBColorSpace,
  Uint8BufferAttribute,
} from "three";
import { clothChart } from "./human-cloth-swatch.js";

import { Piece, add, mix, raycaster } from "./human-style-kit.js";

// Real mail is small: a ring every eleven millimetres along a course and a course every five and a half. A whole
// collar drawn once into a game atlas would leave each ring a texel or two, which shimmers. The standard is
// therefore built from square cells of two rings by four courses, and every cell shows the same small picture,
// turned over at each cell line. The picture is the same on both sides of such a line, so the rings run on
// unbroken, and each keeps tens of texels however small the atlas is.
export const mailPitch = 0.011, mailCourse = 0.0055, mailCell = [2 * mailPitch, 4 * mailCourse];

/**
 * A mail standard: a short mantle of mail that hangs from a leather band round the base of the neck, open at the
 * throat, and lies over the collarbones, the shoulders and the top of the breastplate. Returns the mail, the
 * leather band with its strap across the opening, and the buckle.
 */
export function mailStandard(body, m, shells, columns) {
  const k = m.k,
    neck = m.neck,
    centre = add(neck, [0, -0.115 * k, 0]);
  const neckRay = raycaster(body.P,body.tri),
    head = body.weight(/^head/),
    upper = [];
  for (let i = 0; i < body.tri.length; i += 3) {
    const ids = body.tri.slice(i, i + 3);
    if (
      ids.some(
        (v) =>
          head[v] < 0.38 && Math.abs(body.P[v * 3 + 1] - neck[1]) < 0.2 * k,
      )
    )
      upper.push(...ids);
  }
  const cast = [
    raycaster(body.P, upper),
    ...shells.map((s) => raycaster(s.pos, s.tri)),
  ];
  const outer = [],
    rows = 10;
  // The opening at the throat is widest at the band and closes a third of the way down.
  const opening = v => 0.012 + 0.2 * Math.max(0, 1 - v / 0.36) ** 1.4;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows,
      frontGap = opening(v);
    const outside = [];
    for (let j = 0; j <= columns; j++) {
      const a = mix(frontGap, 2 * Math.PI - frontGap, j / columns);
      const x = Math.sin(a),
        z = Math.cos(a);
      // The band lies at the base of the neck: a little over the joint behind, under it at the throat.
      const throatY=neck[1]+(.02-.036*Math.max(0,z)**2)*k;
      const skinRadius=neckRay([neck[0],throatY,neck[2]],[x,0,z],.18*k);
      const r=(Number.isFinite(skinRadius)?skinRadius:.065*k)+.009*k;
      const start = Math.atan2(r, throatY-centre[1]);
      const slope = mix(
        start,
        0.91 + 0.61 * Math.max(0, z) ** 2 + 0.25 * Math.max(0, -z) ** 2,
        v,
      );
      const dir = [x * Math.sin(slope), Math.cos(slope), z * Math.sin(slope)];
      const reach = 0.42 * k,
        origin = add(centre, dir, reach),
        inward = dir.map((t) => -t);
      const hit = Math.min(...cast.map((fn) => fn(origin, inward, reach)));
      const throat = r / Math.sin(start);
      const measured = Number.isFinite(hit) ? reach - hit : throat;
      const dist = mix(throat, Math.max(measured, throat * 0.6), Math.min(1, v * 4)) + 0.0045 * k;
      outside.push(add(centre, dir, dist));
    }
    outer.push(outside);
  }
  // Each link bridges a small hollow in the layer below. Preserve the largest
  // clearances over the ridges, including when the plate is simplified.
  for (let pass = 0; pass < 3; pass++) {
    const radius = outer.map((row) =>
      row.map((p) =>
        Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]),
      ),
    );
    for (let i = 1; i <= rows; i++)
      for (let j = 0; j <= columns; j++) {
        const mid = radius[i][j];
        const average =
          (radius[i - 1][j] +
            radius[Math.min(rows, i + 1)][j] +
            radius[i][Math.max(0, j - 1)] +
            radius[i][Math.min(columns, j + 1)]) /
          4;
        const lift = Math.max(0, average - mid) + (pass === 0 ? 0.004 * k : 0);
        const dir = outer[i][j].map((x, axis) => (x - centre[axis]) / mid);
        outer[i][j] = add(outer[i][j], dir, lift);
      }
  }
  // The measured surface, anywhere on it: v from the band down, t round from one side of the opening to the other.
  const surface = (v, t) => {
    const fi = Math.min(rows - 1e-6, Math.max(0, v * rows)), fj = Math.min(columns - 1e-6, Math.max(0, t * columns)), i = Math.floor(fi), j = Math.floor(fj), p = fi - i, q = fj - j;
    return [0, 1, 2].map(d => mix(mix(outer[i][j][d], outer[i][j + 1][d], q), mix(outer[i + 1][j][d], outer[i + 1][j + 1][d], q), p));
  };
  const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const skin = body.rigid("spine_03"), mail = new Piece();
  mail.mailUV = [];
  // Bands of whole cells from the band down. Each band has as many cells round as its own length asks, so the
  // rings keep their size where the mantle spreads over the shoulders. The last band is a brass border of half a cell.
  // The mantle is as deep all round as its shallowest place allows, so its hem is even and every cell as tall.
  const fine = 40, run = Array.from({ length: columns + 1 }, (_, j) => {
    const sum = [0];
    for (let i = 0; i < fine; i++) sum.push(sum[i] + far(surface(i / fine, j / columns), surface((i + 1) / fine, j / columns)));
    return sum;
  });
  const depth = Math.min(5 * mailCell[1] * k, ...run.map(sum => sum[fine])), bands = Math.max(3, Math.round(depth / (mailCell[1] * k)));
  const lines = run.map(sum => Array.from({ length: bands + 1 }, (_, n) => {
    const want = depth * Math.min(n, bands - 0.5) / (bands - 0.5);
    let i = 1;
    while (i < fine && sum[i] < want) i++;
    return (i - 1 + Math.min(1, (want - sum[i - 1]) / (sum[i] - sum[i - 1] || 1))) / fine;
  }));
  const hung = (n, t) => {
    const fj = Math.min(columns - 1e-6, Math.max(0, t * columns)), j = Math.floor(fj);
    return surface(mix(lines[j][n], lines[j + 1][n], fj - j), t);
  };
  for (let band = 0; band < bands; band++) {
    const brass = band === bands - 1;
    let round = 0;
    for (let j = 0; j < 48; j++) round += (far(hung(band, j / 48), hung(band, (j + 1) / 48)) + far(hung(band + 1, j / 48), hung(band + 1, (j + 1) / 48))) / 2;
    const cells = Math.max(6, Math.round(round / (mailCell[0] * k))), base = mail.count;
    for (const row of [0, 1]) for (let j = 0; j <= cells; j++) {
      // Each band lies a hair over the one above it at their shared line, as a course of rings does.
      const p = hung(band + row, j / cells), out = [0, 1, 2].map(d => p[d] - centre[d]), long = Math.hypot(...out) || 1;
      mail.vertex(add(p, out, (row ? 0 : 0.0006 * k) / long), skin);
      mail.mailUV.push((brass ? 0.5 : 0) + 0.5 * (0.02 + 0.96 * (j % 2)), brass && row ? 0.5 : 0.01 + 0.98 * ((band + row) % 2));
    }
    for (let j = 0; j < cells; j++) {
      const a = base + j, b = a + 1, c = base + cells + 1 + j, d = c + 1;
      mail.tri.push(a, b, c, b, d, c);
    }
  }
  // The leather band the mail hangs from, and its strap across the opening with a buckle.
  const band = new Piece(), buckle = new Piece(), steps = Math.max(12, Math.round(columns * 0.6));
  const line = Array.from({ length: steps + 1 }, (_, j) => surface(0, j / steps)), under = Array.from({ length: steps + 1 }, (_, j) => surface(0.07, j / steps));
  const rings = line.map((p, j) => {
    const t = [0, 1, 2].map(d => line[Math.min(steps, j + 1)][d] - line[Math.max(0, j - 1)][d]), tl = Math.hypot(...t) || 1;
    const down = [0, 1, 2].map(d => under[j][d] - p[d]), dl = Math.hypot(...down) || 1, along = down.map(x => x / dl), tangent = t.map(x => x / tl);
    const out = [along[1] * tangent[2] - along[2] * tangent[1], along[2] * tangent[0] - along[0] * tangent[2], along[0] * tangent[1] - along[1] * tangent[0]];
    const side = (out[0] * (p[0] - centre[0]) + out[2] * (p[2] - centre[2])) < 0 ? -1 : 1, wide = 0.0085 * k, proud = 0.0034 * k;
    return [[-0.9, 0.25], [-0.5, 1], [0.6, 1], [1.1, 0.2], [0.5, -0.5], [-0.6, -0.5]].map(([x, y]) => add(add(p, along, x * wide), out, side * y * proud));
  });
  band.loft(rings, skin, { closed: true, capStart: true, capEnd: true });
  const strapAt = 0.2, left = surface(strapAt, 0.012), right = surface(strapAt, 0.988), across = [0, 1, 2].map(d => right[d] - left[d]), wide = Math.hypot(...across) || 1;
  const forward = [0, 0.2, 1], tall = 0.0075 * k, strap = (from, to, lift, half, piece) => {
    const outerRow = [], innerRow = [];
    for (const y of [half, -half]) {
      const o = [], n = [];
      for (const t of [from, (from + to) / 2, to]) {
        const p = add(add(left, across, t), [0, 1, 0], y), bow = lift + 0.004 * k * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
        o.push(add(p, forward, bow)); n.push(add(p, forward, bow - 0.0028 * k));
      }
      outerRow.push(o); innerRow.push(n);
    }
    piece.slab(outerRow, innerRow, skin);
  };
  strap(-0.9 * 0.012 * k / wide - 0.55, 1.55, 0.003 * k, tall, band);
  strap(0.5 - 0.011 * k / wide, 0.5 + 0.011 * k / wide, 0.006 * k, tall * 1.5, buckle);
  return { mail, band, buckle };
}

// The picture of one cell: two rings by four courses of riveted rings, seen flat. Alternate courses are set half a
// ring along and lie a little lower, as the rings of real mail lean one way and then the other. The picture is
// its own mirror image at every edge. Returns the height of the wire at a place, 0 in the gaps.
export function ringCell(u, v) {
  const x = u * 2, y = v * 4;
  let high = 0;
  for (let j = -1; j <= 5; j++) {
    const odd = (j & 1) === 1, sx = x - (odd ? 0.5 : 0), dx = sx - Math.round(sx), dy = (y - j) * mailCourse / mailPitch;
    const d = (Math.hypot(dx / 0.56, dy / 0.5) - 1) / 0.2;
    if (Math.abs(d) >= 1) continue;
    high = Math.max(high, Math.sqrt(1 - d * d) * (odd ? 0.74 : 1));
  }
  return high;
}

// Adjacent courses of mail lean in opposite directions. At each crossing
// choose the wire nearest the viewer, leaving the dark lining in the gaps.
function link(x, y) {
  const pitch = 0.0144,
    step = 0.0066;
  const course = Math.round(y / step);
  let highest = -1,
    shade = 0,
    ridge = 0;
  for (let j = course - 1; j <= course + 1; j++) {
    const odd = (j & 1) === 1;
    const u = x / pitch - (odd ? 0.5 : 0),
      dx = (u - Math.round(u)) * pitch;
    const dy = y - j * step,
      tilt = odd ? -0.24 : 0.24;
    const ex = (dx + tilt * dy) / 0.0072,
      ey = dy / 0.0053;
    const d = (Math.hypot(ex, ey) - 1) / 0.24;
    if (Math.abs(d) >= 1) continue;
    const rounded = Math.sqrt(1 - d * d);
    const z = rounded * 0.43 + (odd ? -1 : 1) * ey * 0.47;
    if (z < highest) continue;
    highest = z;
    shade = 0.48 + 0.3 * rounded + 0.22 * z;
    ridge = 0.32 + 0.44 * rounded + 0.2 * z;
  }
  return { shade, ridge };
}

// Unroll each course with its measured circumference. As the standard spreads
// over the shoulders it gains links instead of stretching the ones at the neck.
function standardChart(position, columns) {
  const outer = position.count / 2,
    rows = outer / columns,
    lengths = [],
    depths = new Float32Array(columns);
  const uv = new Float32Array(2 * position.count);
  const distance = (a, b) =>
    Math.hypot(
      position.getX(a) - position.getX(b),
      position.getY(a) - position.getY(b),
      position.getZ(a) - position.getZ(b),
    );
  for (let i = 0; i < rows; i++) {
    let arc = 0;
    for (let j = 0; j < columns; j++) {
      const at = i * columns + j;
      if (j) arc += distance(at, at - 1);
      if (i) depths[j] += distance(at, at - columns);
      uv[2 * at] = arc;
      uv[2 * at + 1] = depths[j];
    }
    lengths.push(arc);
  }
  const du = Math.max(...lengths) * 1.02,
    dv = Math.max(...depths) * 1.02;
  for (let i = 0; i < outer; i++) {
    uv[2 * i] = 0.5 + (uv[2 * i] - 0.5 * lengths[Math.floor(i / columns)]) / du;
    uv[2 * i + 1] =
      0.99 - (0.98 * uv[2 * i + 1]) / Math.max(0.001, depths[i % columns]);
  }
  uv.set(uv.subarray(0, outer * 2), outer * 2);
  return {
    uv: new Float32BufferAttribute(uv, 2),
    du,
    dv,
    u0: -du * 0.5,
    v0: 0,
  };
}

/** The standard: every cell of the mesh shows the one cell picture, in iron or, on the right half, in brass. */
function finishStandard(mesh, coordinates) {
  const mat = mesh.material.clone(), lining = mat.color.clone(), wire = new Color("#a3a3a0").lerp(lining, 0.14);
  mat.name = "Mail standard";
  mat.userData.foldedCloth = true;
  mat.roughness = 0.8;
  mat.metalness = 0.85;
  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(coordinates, 2));
  // The cell lines carry the picture's mirror lines, so a game model keeps every point of the standard.
  mesh.geometry.setAttribute("lodAnchor", new Uint8BufferAttribute(new Uint8Array(mesh.geometry.attributes.position.count).fill(1), 1));
  if (typeof document !== "undefined") {
    const size = 256, texture = surface => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d"), image = ctx.createImageData(size, size);
      const dye = lining.clone().convertLinearToSRGB().toArray(), steel = wire.clone().convertLinearToSRGB().toArray(), brass = [0.76, 0.6, 0.36];
      for (let y = 0, p = 0; y < size; y++) for (let x = 0; x < size; x++, p += 4) {
        const half = size / 2, golden = x >= half, u = ((x % half) + 0.5) / half, v = 1 - (y + 0.5) / size;
        // Four samples to a texel keep the thin wire even at this size.
        let high = 0, cover = 0;
        for (const [ox, oy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) { const h = ringCell(u + ox / half, v + oy / size); high += h / 4; cover += (h > 0) / 4; }
        const metal = golden ? brass : steel;
        if (surface) {
          image.data[p] = 30 + 215 * high;
          image.data[p + 1] = mix(250, 150 - 50 * high, cover);
          image.data[p + 2] = mix(8, 232, cover);
        } else for (let c = 0; c < 3; c++) image.data[p + c] = 255 * mix(dye[c] * 0.42, metal[c] * (0.5 + 0.5 * high), cover);
        image.data[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const tex = new CanvasTexture(canvas);
      if (!surface) tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };
    const paint = texture(false), relief = texture(true);
    mat.color.set(0xffffff);
    mat.map = paint;
    mat.bumpMap = mat.roughnessMap = mat.metalnessMap = relief;
    mat.bumpScale = 0.0012;
    mat.addEventListener("dispose", () => { paint.dispose(); relief.dispose(); });
  }
  mesh.material = mat;
}

/**
 * `game` draws the shirt for the small place it has in a game atlas: at a third of the size, each texel the
 * average of nine places, so the courses arrive there even instead of beating against the texels.
 */
export function finishMail(mesh, landmarks, columns, coordinates = null, game = false) {
  if (coordinates) return finishStandard(mesh, coordinates);
  const mat = mesh.material.clone();
  const lining = mat.color.clone(),
    wire = new Color("#9c9c99").lerp(lining, 0.18);
  mat.name = columns ? "Mail standard" : "Riveted mail";
  if (columns) mat.userData.foldedCloth = true;
  mat.roughness = 0.8;
  mat.metalness = 0.85;
  const position = mesh.geometry.attributes.position;
  const standard = columns ? standardChart(position, columns) : null;
  if (standard) mesh.geometry.setAttribute("uv", standard.uv);
  if (typeof document !== "undefined") {
    const chart = standard ?? clothChart(position, landmarks);
    if (!standard) mesh.geometry.setAttribute("uv", chart.uv);
    const texture = (surface) => {
      const canvas = document.createElement("canvas");
      const scale = game ? 360 : 1100, taps = game ? [-1 / 3, 0, 1 / 3] : [0];
      canvas.width = Math.min(1024, Math.max(128, Math.ceil(chart.du * scale)));
      canvas.height = Math.min(1024, Math.max(128, Math.ceil(chart.dv * scale)));
      const ctx = canvas.getContext("2d"),
        image = ctx.createImageData(canvas.width, canvas.height);
      const dye = lining.clone().convertLinearToSRGB().toArray(),
        steel = wire.clone().convertLinearToSRGB().toArray();
      const brass = [0.74, 0.58, 0.36];
      for (let y = 0, p = 0; y < canvas.height; y++) {
        const v = chart.v0 + chart.dv * (1 - (y + 0.5) / canvas.height);
        for (let x = 0; x < canvas.width; x++, p += 4) {
          const u = chart.u0 + (chart.du * (x + 0.5)) / canvas.width;
          // Alternate a brass and iron course along the edge of the standard.
          const course = Math.round((v - 0.01 * chart.dv) / 0.0066);
          const bound = columns && (course === 1 || course === 3);
          if (game) {
            let cover = 0, light = 0, high = 0;
            for (const oy of taps) for (const ox of taps) {
              const one = link(u + ox * chart.du / canvas.width, v + oy * chart.dv / canvas.height);
              if (one.shade) { cover += 1 / 9; light += one.shade / 9; high += one.ridge / 9; }
            }
            if (surface) {
              image.data[p] = 28 + 211 * high;
              image.data[p + 1] = mix(250, 178, cover) - 61 * high;
              image.data[p + 2] = mix(8, 230, cover);
            } else for (let c = 0; c < 3; c++) image.data[p + c] = 255 * (steel[c] * light + dye[c] * 0.53 * (1 - cover));
            image.data[p + 3] = 255;
            continue;
          }
          const { shade, ridge } = link(u, v);
          if (surface) {
            image.data[p] = 28 + 211 * ridge;
            image.data[p + 1] = shade ? 178 - 61 * ridge : 250;
            image.data[p + 2] = shade ? 230 : 8;
          } else {
            for (let c = 0; c < 3; c++)
              image.data[p + c] =
                255 *
                (shade ? (bound ? brass[c] : steel[c]) * shade : dye[c] * 0.53);
          }
          image.data[p + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      const tex = new CanvasTexture(canvas);
      if (!surface) tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };
    const paint = texture(false),
      relief = texture(true);
    mat.color.set(0xffffff);
    mat.map = paint;
    mat.bumpMap = mat.roughnessMap = mat.metalnessMap = relief;
    mat.bumpScale = 0.0019;
    mat.addEventListener("dispose", () => {
      paint.dispose();
      relief.dispose();
    });
  }
  mesh.material = mat;
}
