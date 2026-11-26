import * as T from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import data from "./human-studio-head-data.json" with { type: "json" };
import { evaluateHuman, smoothHumanSurface } from "./human-surface.js";
import { refineFaceForm } from "./human-face-anatomy.js";
import { defaultEyeColor, irisPixels } from "./human-eyes.js";

export const studioHeadStyles = ["None", "Studio Rain"];
export const studioHeadCredits = {
  "Studio Rain": { credit: data.credit, source: data.source, license: data.license, changes: data.changes },
};
export const studioHeadCarries = ["hair", "fringe", "facePlanes", "browStyle", "facialHair", "makeup", "eyewear", "earrings", "hat", "hatColor"];
export const studioHairStyles = ["Ribbon ponytail"];
export const studioFamilyHair = ["Family", "Chosen"];
const choosesHair = (form) => form?.humanStyle?.faceFamilyHair === "Chosen";
export const studioHeadHolds = (form) => !wearsStudioHead(form) ? [] : choosesHair(form) ? ["facePlanes", "browStyle", "facialHair", "makeup"] : studioHeadCarries;
export const studioHeadNoteFor = (form) => choosesHair(form)
  ? "This face family brings its own head, eyes, brows and lashes, and wears the chosen hairstyle, hat, eyewear and earrings fitted to it. Facial plane shading, eyebrows, facial hair, makeup, complexion and face marks are kept in the save but not drawn. Choose Face family: None to return to the native face."
  : studioHeadNote;
export function studioCreditFor(look) {
  const head = wearsStudioHead(look), hair = studioHairStyles.includes(look?.humanStyle?.hair) && (!head || choosesHair(look));
  if (!head && !hair) return null;
  const entry = studioHeadCredits["Studio Rain"];
  return { ...entry, name: head ? "Studio Rain" : look.humanStyle.hair, changes: head ? entry.changes : "Hair fitted to an editable adult's head; colour map resized and re-tinted." };
}
export const studioHeadNote = "This face family brings its own head, eyes, brows, lashes and hair. Hairstyle, fringe, eyebrows, facial hair, makeup, eyewear, earrings, hat, complexion and face marks are kept in the save but not drawn. Skin, hair and eye colour, the head controls and expressions still apply. Choose None to return to the native face.";
export const studioHeadPresets = {
  "Studio Rain": {
    human: { age: 0.08, frame: -0.35, weight: -0.3, muscle: 0.1, neck: -0.2, jaw: 0, nose: 0, noseBridge: 0, cheeks: 0, lips: 0, chin: 0, jawProjection: 0, chinHeight: 0, forehead: 0, temples: 0, noseLength: 0, noseTipWidth: 0 },
    humanStyle: { faceFamily: "Studio Rain", hairColor: "#5a3d2b" },
    eyeColor: "blue",
    skin: "#e2b08e",
  },
};
export const wearsStudioHead = (form) => form?.humanStyle?.faceFamily === "Studio Rain" && Boolean(form.human);

const expressionNames = ["Blink", "Smile", "BrowLift"];
const gazeTargets = [["LookLeft", 1, 0.32], ["LookRight", 1, -0.32], ["LookUp", 0, -0.23], ["LookDown", 0, 0.23]];
const decoded = new Map();
function read(path, Type) {
  if (!decoded.has(path)) {
    const text = path.split("/").reduce((at, key) => at[key], data);
    const bytes = unzlibSync(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
    decoded.set(path, new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT));
  }
  return decoded.get(path);
}

function cornersOf(s, bones) {
  const totals = new Float32Array(s.names.length), out = [];
  for (let c = 0; c < s.bodyTriangles * 3; c += 3) {
    totals.fill(0);
    for (let i = 0; i < 3; i++) {
      const v = s.indices[c + i];
      for (let j = v * 4; j < v * 4 + 4; j++) totals[s.boneIndices[j]] += s.weights[j];
    }
    let best = 0;
    for (let i = 1; i < totals.length; i++) if (totals[i] > totals[best]) best = i;
    if (bones.includes(best)) out.push(c);
  }
  return out;
}

function closestOnTriangle(p, a, b, c, out) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; } else {
    const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; } else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { v = d1 / (d1 - d3); u = 1 - v; w = 0; } else {
        const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; } else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { w = d2 / (d2 - d6); u = 1 - w; v = 0; } else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { w = (d4 - d3) / (d4 - d3 + d5 - d6); v = 1 - w; u = 0; } else {
              const k = 1 / (va + vb + vc);
              v = vb * k; w = vc * k; u = 1 - v - w;
            }
          }
        }
      }
    }
  }
  out[0] = u; out[1] = v; out[2] = w;
  const x = u * a[0] + v * b[0] + w * c[0] - p[0], y = u * a[1] + v * b[1] + w * c[1] - p[1], z = u * a[2] + v * b[2] + w * c[2] - p[2];
  return x * x + y * y + z * z;
}

let bound = null;
function binding() {
  if (bound) return bound;
  const s = refineFaceForm(smoothHumanSurface(evaluateHuman({})));
  const corners = cornersOf(s, [s.names.indexOf("head"), s.names.indexOf("neck_01")]);
  const cell = 0.012, grid = new Map(), P = s.positions;
  const key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  for (const c of corners) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < 3; i++) for (let d = 0; d < 3; d++) {
      const value = P[s.indices[c + i] * 3 + d];
      lo[d] = Math.min(lo[d], value); hi[d] = Math.max(hi[d], value);
    }
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
      for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
        for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
          const k = key(x, y, z);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(c);
        }
  }
  const meets = read("meets", Float32Array), count = data.count;
  const vertices = new Uint32Array(count * 3), shares = new Float32Array(count * 3), rest = new Float32Array(count * 3);
  const a = [0, 0, 0], b = [0, 0, 0], c3 = [0, 0, 0], p = [0, 0, 0], w = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < 3; d++) p[d] = meets[i * 3 + d];
    let best = Infinity, found = -1;
    const home = p.map((v) => Math.floor(v / cell));
    for (let ring = 1; ring <= 6 && (found < 0 || best > ((ring - 1) * cell) ** 2); ring++)
      for (let x = home[0] - ring; x <= home[0] + ring; x++)
        for (let y = home[1] - ring; y <= home[1] + ring; y++)
          for (let z = home[2] - ring; z <= home[2] + ring; z++) {
            if (Math.max(Math.abs(x - home[0]), Math.abs(y - home[1]), Math.abs(z - home[2])) !== ring && ring > 1) continue;
            const list = grid.get(key(x, y, z));
            if (!list) continue;
            for (const c of list) {
              for (let d = 0; d < 3; d++) { a[d] = P[s.indices[c] * 3 + d]; b[d] = P[s.indices[c + 1] * 3 + d]; c3[d] = P[s.indices[c + 2] * 3 + d]; }
              const distance = closestOnTriangle(p, a, b, c3, w);
              if (distance < best) {
                best = distance; found = c;
                for (let d = 0; d < 3; d++) { vertices[i * 3 + d] = s.indices[c + d]; shares[i * 3 + d] = w[d]; }
              }
            }
          }
    if (found < 0) throw new Error("A studio head control point found no native skin.");
    for (let d = 0; d < 3; d++)
      rest[i * 3 + d] = shares[i * 3] * P[vertices[i * 3] * 3 + d] + shares[i * 3 + 1] * P[vertices[i * 3 + 1] * 3 + d] + shares[i * 3 + 2] * P[vertices[i * 3 + 2] * 3 + d];
  }
  const triangles = read("triangles", Uint16Array), beside = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < triangles.length; t += 3) for (let j = 0; j < 3; j++) {
    beside[triangles[t + j]].add(triangles[t + (j + 1) % 3]);
    beside[triangles[t + (j + 1) % 3]].add(triangles[t + j]);
  }
  bound = { vertices, shares, rest, beside: beside.map((set) => Uint16Array.from(set)), vertexCount: P.length / 3 };
  return bound;
}

function carry(from, to, weight) {
  const a = [0, 0, 0], b = [0, 0, 0];
  let total = 0;
  const count = weight.length;
  for (let i = 0; i < count; i++) {
    total += weight[i];
    for (let d = 0; d < 3; d++) { a[d] += weight[i] * from[i * 3 + d]; b[d] += weight[i] * to[i * 3 + d]; }
  }
  for (let d = 0; d < 3; d++) { a[d] /= total; b[d] /= total; }
  const m = new Float64Array(9);
  let spread = 0;
  for (let i = 0; i < count; i++) {
    const w = weight[i];
    if (!w) continue;
    for (let r = 0; r < 3; r++) {
      const x = from[i * 3 + r] - a[r];
      spread += w * x * x;
      for (let c = 0; c < 3; c++) m[r * 3 + c] += w * x * (to[i * 3 + c] - b[c]);
    }
  }
  const [sxx, sxy, sxz, syx, syy, syz, szx, szy, szz] = m;
  const n = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const lift = Math.abs(sxx) + Math.abs(syy) + Math.abs(szz) + Math.abs(sxy) + Math.abs(syx) + Math.abs(sxz) + Math.abs(szx) + Math.abs(syz) + Math.abs(szy) + 1e-12;
  let q = [1, 0, 0, 0];
  for (let pass = 0; pass < 80; pass++) {
    const next = [0, 1, 2, 3].map((r) => lift * q[r] + n[r][0] * q[0] + n[r][1] * q[1] + n[r][2] * q[2] + n[r][3] * q[3]);
    const size = Math.hypot(...next);
    q = next.map((v) => v / size);
  }
  const rotation = new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion(q[1], q[2], q[3], q[0])), e = rotation.elements;
  const r = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
  let along = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) along += r[j * 3 + i] * m[i * 3 + j];
  const scale = along / spread;
  return {
    scale, rotation: r,
    turn: (x, y, z, out, at = 0) => {
      out[at] = scale * (r[0] * x + r[1] * y + r[2] * z);
      out[at + 1] = scale * (r[3] * x + r[4] * y + r[5] * z);
      out[at + 2] = scale * (r[6] * x + r[7] * y + r[8] * z);
    },
    shift: [0, 1, 2].map((d) => b[d] - scale * (r[d * 3] * a[0] + r[d * 3 + 1] * a[1] + r[d * 3 + 2] * a[2])),
  };
}

function controlPoints(s) {
  const { vertices, shares, rest, beside, vertexCount } = binding();
  if (s.positions.length / 3 !== vertexCount) throw new Error("The studio head was tied to a different native surface.");
  const count = data.count, control = read("control", Float32Array), settle = read("settle", Uint8Array);
  const native = new Float32Array(count * 3), weight = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    weight[i] = 1 - settle[i] / 255;
    for (let d = 0; d < 3; d++)
      native[i * 3 + d] = shares[i * 3] * s.positions[vertices[i * 3] * 3 + d] + shares[i * 3 + 1] * s.positions[vertices[i * 3 + 1] * 3 + d]
        + shares[i * 3 + 2] * s.positions[vertices[i * 3 + 2] * 3 + d];
  }
  const fit = carry(rest, native, weight);
  const carried = new Float32Array(count * 3), change = new Float32Array(count * 3), v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    fit.turn(control[i * 3], control[i * 3 + 1], control[i * 3 + 2], carried, i * 3);
    fit.turn(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2], v);
    for (let d = 0; d < 3; d++) {
      carried[i * 3 + d] += fit.shift[d];
      change[i * 3 + d] = native[i * 3 + d] - v[d] - fit.shift[d];
    }
  }
  const moved = new Float32Array(count * 3), lips = read("lips", Uint8Array);
  for (let i = 0; i < count; i++) {
    const near = beside[i], keep = Math.max(0.5, settle[i] / 255), share = 1 - 0.5 * lips[i] / 255;
    for (let d = 0; d < 3; d++) {
      let mean = 0;
      for (const j of near) mean += change[j * 3 + d];
      const value = near.length ? keep * change[i * 3 + d] + (1 - keep) * mean / near.length : change[i * 3 + d];
      moved[i * 3 + d] = carried[i * 3 + d] + share * value;
    }
  }
  return { fit, carried, moved, native, settle, vertices, shares };
}

function controlNormals(points, triangles) {
  const out = new Float32Array(points.length);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ux = points[b] - points[a], uy = points[b + 1] - points[a + 1], uz = points[b + 2] - points[a + 2];
    const vx = points[c] - points[a], vy = points[c + 1] - points[a + 1], vz = points[c + 2] - points[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const at of [a, b, c]) { out[at] += nx; out[at + 1] += ny; out[at + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) {
    const size = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1;
    out[i] /= size; out[i + 1] /= size; out[i + 2] /= size;
  }
  return out;
}

function nativeNeckLoop(s, corners) {
  const edges = new Set(), count = s.positions.length / 3;
  for (let c = 0; c < corners.length; c += 3)
    for (let j = 0; j < 3; j++) edges.add(s.indices[corners[c + j]] * count + s.indices[corners[c + (j + 1) % 3]]);
  const next = new Map();
  for (const edge of edges) {
    const u = Math.floor(edge / count), v = edge % count;
    if (!edges.has(v * count + u)) next.set(u, v);
  }
  let best = null, lowest = Infinity;
  while (next.size) {
    const start = next.keys().next().value, loop = [start];
    let at = next.get(start), height = s.positions[start * 3 + 1];
    next.delete(start);
    while (at !== start && next.has(at)) {
      loop.push(at); height += s.positions[at * 3 + 1];
      const following = next.get(at);
      next.delete(at);
      at = following;
    }
    if (loop.length > 12 && height / loop.length < lowest) { lowest = height / loop.length; best = loop; }
  }
  if (!best) throw new Error("The native head has no open edge at the neck.");
  return best;
}

function turning(loop, point) {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = point(loop[i]), b = point(loop[(i + 1) % loop.length]);
    area += a[2] * b[0] - a[0] * b[2];
  }
  return area;
}

const pixelCache = new Map();
function irisColour(name) {
  const size = 32, pixels = irisPixels(name, 0, size), at = (Math.floor(size / 2) * size + Math.round(size * (0.5 + 0.26))) * 4;
  return [pixels[at], pixels[at + 1], pixels[at + 2]];
}

function tinted(name, gain, iris, dye) {
  const key = name + "/" + gain.map((v) => v.toFixed(4)).join(",") + (iris ? "/" + iris.join(",") : "") + (dye ? "/dye" + dye.map((v) => v.toFixed(4)).join(",") : "");
  if (pixelCache.has(key)) {
    const kept = pixelCache.get(key);
    pixelCache.delete(key); pixelCache.set(key, kept);
    return kept;
  }
  const side = data.paint[name].side, rgb = read("paint/" + name + "/pixels", Uint8Array), rgba = new Uint8ClampedArray(side * side * 4);
  const tables = gain.map((g) => Uint8Array.from({ length: 256 }, (_, i) => {
    const c = i / 255, lin = (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * g;
    return Math.round(255 * Math.min(1, lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055));
  }));
  const paintedIris = data.paint[name].iris;
  for (let i = 0; i < side * side; i++) {
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = tables[k][rgb[i * 3 + k]];
    rgba[i * 4 + 3] = 255;
    if (dye) {
      const tone = data.paint[name].tone, lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const light = ((0.2126 * lin(rgb[i * 3] / 255) + 0.7152 * lin(rgb[i * 3 + 1] / 255) + 0.0722 * lin(rgb[i * 3 + 2] / 255)) / (0.2126 * tone[0] + 0.7152 * tone[1] + 0.0722 * tone[2])) ** 0.85;
      for (let k = 0; k < 3; k++) {
        const value = Math.min(1, dye[k] * light);
        rgba[i * 4 + k] = Math.round(255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055));
      }
      continue;
    }
    if (!iris || !paintedIris) continue;
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], most = Math.max(r, g, b), least = Math.min(r, g, b);
    const share = T.MathUtils.smoothstep(most ? (most - least) / most : 0, 0.12, 0.3);
    if (!share) continue;
    const light = Math.min(1.9, (0.299 * r + 0.587 * g + 0.114 * b) / (0.299 * paintedIris[0] + 0.587 * paintedIris[1] + 0.114 * paintedIris[2]));
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] += share * (Math.min(255, iris[k] * light) - rgba[i * 4 + k]);
  }
  let texture;
  if (typeof document === "undefined") {
    texture = new T.DataTexture(new Uint8Array(rgba.buffer), side, side);
    texture.flipY = true;
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    canvas.getContext("2d").putImageData(new ImageData(rgba, side, side), 0, 0);
    texture = new T.CanvasTexture(canvas);
  }
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  if (pixelCache.size >= 9) {
    const oldest = pixelCache.keys().next().value;
    pixelCache.get(oldest).dispose();
    pixelCache.delete(oldest);
  }
  pixelCache.set(key, texture);
  return texture;
}
const dyedHair = (colour) => tinted("hair", [1, 1, 1], null, [colour.r * 0.78, colour.g * 0.78, colour.b * 0.78]);
const gainTo = (colour, tone, most = 8) => [colour.r, colour.g, colour.b].map((v, k) => Math.min(most, Math.max(0.02, v / tone[k])));

function headOnly(count, bone) {
  const boneIndices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { boneIndices[i * 4] = bone; weights[i * 4] = 1; }
  return { boneIndices, weights };
}

export function studioHead({ form, surface: s, corners, normals, origin, material, plain, colour, shade, roughness, worn = [] }) {
  const points = controlPoints(s), { fit, moved, settle } = points, count = data.count, headBone = s.names.indexOf("head");
  const source = read("skin/source", Uint16Array), uvs = read("skin/uv", Float32Array), index = read("skin/index", Uint16Array);
  const smooth = read("skin/smooth", Uint16Array), packedNeck = read("skin/neck", Uint16Array);
  const scale = fit.scale, v = [0, 0, 0];

  const nativeNormal = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (!settle[i]) continue;
    for (let d = 0; d < 3; d++)
      nativeNormal[i * 3 + d] = points.shares[i * 3] * normals[points.vertices[i * 3] * 3 + d] + points.shares[i * 3 + 1] * normals[points.vertices[i * 3 + 1] * 3 + d]
        + points.shares[i * 3 + 2] * normals[points.vertices[i * 3 + 2] * 3 + d];
  }
  const joinedNormals = (at) => {
    const own = controlNormals(at, smooth);
    for (let i = 0; i < count; i++) {
      const t = settle[i] / 255;
      if (!t) continue;
      let size = 0;
      for (let d = 0; d < 3; d++) { own[i * 3 + d] += (nativeNormal[i * 3 + d] - own[i * 3 + d]) * t; size += own[i * 3 + d] ** 2; }
      size = Math.sqrt(size) || 1;
      for (let d = 0; d < 3; d++) own[i * 3 + d] /= size;
    }
    return own;
  };
  const restNormals = joinedNormals(moved);
  const shifts = expressionNames.map((name) => {
    const packed = read("expressions/" + name, Float32Array), out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) fit.turn(packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2], out, i * 3);
    return out;
  });
  const leans = shifts.map((shift) => {
    const posed = new Float32Array(count * 3);
    for (let i = 0; i < posed.length; i++) posed[i] = moved[i] + shift[i];
    const lean = joinedNormals(posed);
    for (let i = 0; i < lean.length; i++) lean[i] -= restNormals[i];
    return lean;
  });

  const skinCount = source.length, loop = nativeNeckLoop(s, corners), total = skinCount + loop.length;
  const position = new Float32Array(total * 3), normal = new Float32Array(total * 3), uv = new Float32Array(total * 2), tint = new Float32Array(total * 3).fill(1);
  const anchors = new Uint8Array(total), boneIndices = new Uint16Array(total * 4), weights = new Float32Array(total * 4);
  const pool = new Map();
  for (let i = 0; i < skinCount; i++) {
    const c = source[i], t = settle[c] / 255;
    for (let d = 0; d < 3; d++) { position[i * 3 + d] = moved[c * 3 + d] - origin[d]; normal[i * 3 + d] = restNormals[c * 3 + d]; }
    uv[i * 2] = uvs[i * 2]; uv[i * 2 + 1] = uvs[i * 2 + 1];
    pool.clear();
    pool.set(headBone, 1 - t);
    if (t) for (let k = 0; k < 3; k++) {
      const vertex = points.vertices[c * 3 + k], share = points.shares[c * 3 + k] * t;
      for (let j = vertex * 4; j < vertex * 4 + 4; j++) if (s.weights[j]) pool.set(s.boneIndices[j], (pool.get(s.boneIndices[j]) ?? 0) + share * s.weights[j]);
      if (shade) for (let d = 0; d < 3; d++) tint[i * 3 + d] += points.shares[c * 3 + k] * t * (shade[vertex * 3 + d] - 1);
    }
    const strongest = [...pool].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = strongest.reduce((n, entry) => n + entry[1], 0);
    strongest.forEach(([bone, value], j) => { boneIndices[i * 4 + j] = bone; weights[i * 4 + j] = value / sum; });
  }
  const neck = [], firstOf = new Map();
  source.forEach((c, i) => { if (!firstOf.has(c)) firstOf.set(c, i); });
  for (const c of packedNeck) neck.push(firstOf.get(c));
  for (const [k, vertex] of loop.entries()) {
    const i = skinCount + k;
    for (let d = 0; d < 3; d++) {
      position[i * 3 + d] = s.positions[vertex * 3 + d] - origin[d];
      normal[i * 3 + d] = normals[vertex * 3 + d];
      if (shade) tint[i * 3 + d] = shade[vertex * 3 + d];
    }
    for (let j = 0; j < 4; j++) { boneIndices[i * 4 + j] = s.boneIndices[vertex * 4 + j]; weights[i * 4 + j] = s.weights[vertex * 4 + j]; }
    anchors[i] = 1;
  }
  const at = (i) => [position[i * 3], position[i * 3 + 1], position[i * 3 + 2]];
  const lower = loop.map((_, k) => skinCount + k);
  if (Math.sign(turning(neck, at)) !== Math.sign(turning(lower, at))) throw new Error("The studio head and the native neck run opposite ways round.");
  const apart = (a, b) => Math.hypot(position[a * 3] - position[b * 3], position[a * 3 + 1] - position[b * 3 + 1], position[a * 3 + 2] - position[b * 3 + 2]);
  let start = 0;
  for (let k = 1; k < lower.length; k++) if (apart(neck[0], lower[k]) < apart(neck[0], lower[start])) start = k;
  const sewn = [];
  for (let i = 0, j = 0; i < neck.length || j < lower.length;) {
    const a = neck[i % neck.length], b = lower[(start + j) % lower.length];
    const nextA = neck[(i + 1) % neck.length], nextB = lower[(start + j + 1) % lower.length];
    const ahead = (i + 1) / neck.length - (j + 1) / lower.length;
    const stepUpper = j >= lower.length || (i < neck.length && (ahead < -0.04 || (ahead < 0.04 && apart(nextA, b) <= apart(a, nextB))));
    if (stepUpper) { sewn.push(nextA, a, b); i++; } else {
      sewn.push(b, nextB, a);
      j++;
    }
  }
  for (const [k] of loop.entries()) {
    const i = skinCount + k;
    let nearest = neck[0];
    for (const candidate of neck) if (apart(candidate, i) < apart(nearest, i)) nearest = candidate;
    uv[i * 2] = uv[nearest * 2]; uv[i * 2 + 1] = uv[nearest * 2 + 1];
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new T.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  if (!plain) geometry.setAttribute("color", new T.BufferAttribute(tint, 3));
  geometry.setAttribute("lodAnchor", new T.BufferAttribute(anchors, 1));
  const all = new Uint32Array(index.length + sewn.length);
  all.set(index); all.set(sewn, index.length);
  geometry.setIndex(new T.BufferAttribute(all, 1));
  geometry.morphTargetsRelative = true;
  const spread = (values, name) => {
    const out = new Float32Array(total * 3);
    for (let i = 0; i < skinCount; i++) for (let d = 0; d < 3; d++) out[i * 3 + d] = values[source[i] * 3 + d];
    const attribute = new T.BufferAttribute(out, 3);
    attribute.name = name;
    return attribute;
  };
  geometry.morphAttributes.position = shifts.map((shift, e) => spread(shift, expressionNames[e]));
  geometry.morphAttributes.normal = leans.map((lean, e) => spread(lean, expressionNames[e]));
  const skinColour = new T.Color(colour), hairColour = new T.Color(form.humanStyle?.hairColor ?? form.appearance?.hairColor ?? "#45352e");
  const skin = material(colour).clone();
  skin.roughness = roughness ?? skin.roughness;
  if (!plain) {
    skin.color.set("#ffffff");
    skin.map = tinted("skin", gainTo(skinColour, data.paint.skin.tone, 6));
    skin.vertexColors = true;
    skin.metalness = 0;
    skin.userData = { ...skin.userData, portrait: true, studioHead: "Rain", skinColor: skinColour };
  }
  const head = new T.Mesh(geometry, skin);
  head.name = "studio-head";
  head.humanWeights = { boneIndices, weights, names: s.names };
  head.userData.faceSurface = true;
  head.userData.fittedEyes = true;
  head.userData.studioHead = "Rain";
  head.castShadow = true;
  head.updateMorphTargets();
  const meshes = [head];

  const change = new Float32Array(count * 3);
  for (let i = 0; i < change.length; i++) change[i] = moved[i] - points.carried[i];
  function placed(name) {
    const packed = read("pieces/" + name + "/points", Float32Array), ties = read("pieces/" + name + "/ties", Uint16Array), shares = read("pieces/" + name + "/shares", Float32Array);
    const out = new Float32Array(packed.length);
    for (let i = 0; i < packed.length / 3; i++) {
      fit.turn(packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2], out, i * 3);
      for (let d = 0; d < 3; d++) {
        out[i * 3 + d] += fit.shift[d] - origin[d];
        for (let k = 0; k < 3; k++) out[i * 3 + d] += shares[i * 3 + k] * change[ties[i * 3 + k] * 3 + d];
      }
    }
    return out;
  }
  function pieceGeometry(names, { coloured = false, moving = false } = {}) {
    const position = [], uv = [], colours = [], indices = [], moves = expressionNames.map(() => []);
    for (const name of names) {
      const first = position.length / 3, piece = data.pieces[name];
      for (const value of placed(name)) position.push(value);
      for (const value of read("pieces/" + name + "/uv", Float32Array)) uv.push(value);
      for (const value of read("pieces/" + name + "/index", Uint16Array)) indices.push(first + value);
      if (coloured) for (const value of piece.colour ? read("pieces/" + name + "/colour", Float32Array) : new Float32Array(piece.vertices * 3).fill(1)) colours.push(value);
      if (moving) expressionNames.forEach((expression, e) => {
        const packed = read("pieces/" + name + "/expressions/" + expression, Float32Array);
        for (let i = 0; i < packed.length; i += 3) { fit.turn(packed[i], packed[i + 1], packed[i + 2], v); moves[e].push(v[0], v[1], v[2]); }
      });
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(position, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    if (coloured && !plain) g.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    if (moving) {
      g.morphTargetsRelative = true;
      g.morphAttributes.position = moves.map((values, e) => {
        const attribute = new T.Float32BufferAttribute(values, 3);
        attribute.name = expressionNames[e];
        return attribute;
      });
    }
    return g;
  }
  const finish = (mesh, name) => {
    mesh.name = name;
    mesh.humanWeights = { ...headOnly(mesh.geometry.attributes.position.count, headBone), names: s.names };
    mesh.userData.studioHead = "Rain";
    mesh.castShadow = true;
    if (mesh.geometry.morphAttributes.position?.length) mesh.updateMorphTargets();
    meshes.push(mesh);
    return mesh;
  };

  {
    const g = pieceGeometry(["eyes"]), p = g.attributes.position, side = read("pieces/eyes/side", Int8Array), box = data.paint.eyes.box;
    const centres = {}, shade = new Float32Array(p.count * 3), coords = g.attributes.uv;
    const packed = read("pieces/eyes/points", Float32Array), axis = new T.Vector3(...data.eyeAxis).normalize();
    for (const [label, sign] of [["L", 1], ["R", -1]]) {
      const lids = read("lids/" + label, Uint16Array), was = [0, 0, 0], now = [0, 0, 0];
      for (const c of lids) for (let d = 0; d < 3; d++) { was[d] += points.carried[c * 3 + d] / lids.length; now[d] += moved[c * 3 + d] / lids.length; }
      let before = 0, after = 0;
      for (const c of lids) {
        before += Math.hypot(points.carried[c * 3] - was[0], points.carried[c * 3 + 1] - was[1], points.carried[c * 3 + 2] - was[2]);
        after += Math.hypot(moved[c * 3] - now[0], moved[c * 3 + 1] - now[1], moved[c * 3 + 2] - now[2]);
      }
      const grow = T.MathUtils.clamp(after / before, 0.8, 1.25), centre = data.eyeCentres[label];
      fit.turn(centre[0], centre[1], centre[2], v);
      const from = v.map((value, d) => value + fit.shift[d] - origin[d]), to = from.map((value, d) => value + now[d] - was[d]);
      centres[sign] = new T.Vector3(...to);
      for (let i = 0; i < p.count; i++) {
        if (side[i] !== sign) continue;
        fit.turn(packed[i * 3], packed[i * 3 + 1], packed[i * 3 + 2], v);
        const rest = v.map((value, d) => value + fit.shift[d] - origin[d]);
        p.setXYZ(i, to[0] + grow * (rest[0] - from[0]), to[1] + grow * (rest[1] - from[1]), to[2] + grow * (rest[2] - from[2]));
        const out = new T.Vector3(rest[0] - from[0], rest[1] - from[1], rest[2] - from[2]).normalize();
        const facing = out.dot(axis), value = 0.5 + 0.5 * T.MathUtils.smoothstep(facing, 0.35, 0.93);
        shade[i * 3] = value; shade[i * 3 + 1] = value * (0.94 + 0.06 * value); shade[i * 3 + 2] = value * (0.9 + 0.1 * value);
      }
    }
    for (let i = 0; i < coords.count; i++)
      coords.setXY(i, T.MathUtils.clamp((coords.getX(i) - box[0]) / (box[2] - box[0]), 0, 1), 1 - T.MathUtils.clamp((1 - coords.getY(i) - box[1]) / (box[3] - box[1]), 0, 1));
    g.computeVertexNormals();
    if (!plain) g.setAttribute("color", new T.BufferAttribute(shade, 3));
    g.morphTargetsRelative = true;
    const from = new T.Vector3(), rest = g.attributes.normal;
    const turned = gazeTargets.map(([name, axisIndex, angle]) => {
      const shift = new Float32Array(p.count * 3), lean = new Float32Array(p.count * 3), about = new T.Vector3().setComponent(axisIndex, 1), w = new T.Vector3();
      for (let i = 0; i < p.count; i++) {
        const centre = centres[side[i]];
        from.fromBufferAttribute(p, i);
        w.copy(from).sub(centre).applyAxisAngle(about, angle).add(centre).sub(from).toArray(shift, i * 3);
        from.fromBufferAttribute(rest, i);
        w.copy(from).applyAxisAngle(about, angle).sub(from).toArray(lean, i * 3);
      }
      const a = new T.BufferAttribute(shift, 3), b = new T.BufferAttribute(lean, 3);
      a.name = b.name = name;
      return [a, b];
    });
    const drawn = new Float32Array(p.count * 3), still = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const centre = centres[side[i]];
      from.fromBufferAttribute(p, i).sub(centre).multiplyScalar(-0.09).toArray(drawn, i * 3);
    }
    const blink = [new T.BufferAttribute(drawn, 3), new T.BufferAttribute(still, 3)];
    blink[0].name = blink[1].name = "Blink";
    g.morphAttributes.position = [...turned.map((pair) => pair[0]), blink[0]];
    g.morphAttributes.normal = [...turned.map((pair) => pair[1]), blink[1]];
    const m = material("#ffffff").clone();
    if (!plain) { m.map = tinted("eyes", [1, 1, 1], irisColour(form.eyeColor ?? defaultEyeColor(form))); m.roughness = 0.22; m.metalness = 0; m.vertexColors = true; }
    const eyes = finish(new T.Mesh(g, m), "studio-eyes");
    eyes.userData.eyePiece = "Iris";
    eyes.castShadow = false;
  }

  {
    const hairGain = gainTo(hairColour, data.paint.hair.tone).map((g) => Math.sqrt(g));
    const g = pieceGeometry(["brows", "lashes"], { coloured: true, moving: true });
    const browCount = data.pieces.brows.vertices, c = g.attributes.color;
    if (c) for (let i = 0; i < browCount; i++) c.setXYZ(i, Math.min(1, c.getX(i) * hairGain[0]), Math.min(1, c.getY(i) * hairGain[1]), Math.min(1, c.getZ(i) * hairGain[2]));
    const m = material(plain ? "#" + hairColour.getHexString() : "#ffffff").clone();
    if (!plain) { m.vertexColors = true; m.roughness = 0.65; m.metalness = 0; }
    m.side = T.DoubleSide;
    m.userData = { ...m.userData, fibreLOD: true };
    const fibres = finish(new T.Mesh(g, m), "brows-and-lashes");
    fibres.geometry.userData.browVertices = browCount;
    fibres.castShadow = false;
  }

  const chosen = choosesHair(form), ownHair = !chosen || studioHairStyles.includes(form.humanStyle?.hair);
  if (chosen) {
    const fitted = ontoStudioHead(worn.filter((mesh) => !mesh.userData.studioHair), points);
    for (const mesh of fitted) {
      mesh.geometry.translate(-origin[0], -origin[1], -origin[2]);
      if (mesh.humanWeights) mesh.humanWeights = { ...mesh.humanWeights, names: s.names };
      mesh.userData.studioHead = "Rain";
      meshes.push(mesh);
    }
  }
  if (ownHair) {
    const g = pieceGeometry(["hair_main", "hair_ponytail", "hair_strand"]);
    const m = material("#" + hairColour.getHexString(), "hair").clone();
    if (!plain) { m.color.set("#ffffff"); m.map = dyedHair(hairColour); m.roughness = 0.52; m.metalness = 0; }
    m.userData = { ...m.userData, studioHair: true };
    finish(new T.Mesh(g, m), "studio-hair").userData.sculptedHair = true;
    const band = pieceGeometry(["hairband"], { coloured: true });
    const bandMaterial = material(plain ? "#" + hairColour.getHexString() : "#ffffff").clone();
    if (!plain) { bandMaterial.vertexColors = true; bandMaterial.roughness = 0.7; bandMaterial.metalness = 0; }
    finish(new T.Mesh(band, bandMaterial), "studio-hairband");
  }
  return meshes;
}

function ontoStudioHead(meshes, points) {
  if (!meshes.length) return [];
  const count = data.count, { native, moved, settle } = points, cell = 0.018, reach = 2, spread = 0.013;
  const grid = new Map(), key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  const delta = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const keep = 1 - settle[i] / 255;
    for (let d = 0; d < 3; d++) delta[i * 3 + d] = keep * (moved[i * 3 + d] - native[i * 3 + d]);
    const k = key(Math.floor(native[i * 3] / cell), Math.floor(native[i * 3 + 1] / cell), Math.floor(native[i * 3 + 2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return meshes.map((source) => {
    const mesh = source.clone();
    mesh.geometry = source.geometry.clone();
    const p = mesh.geometry.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v), y = p.getY(v), z = p.getZ(v), cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      let total = 0, dx = 0, dy = 0, dz = 0;
      for (let a = cx - reach; a <= cx + reach; a++) for (let b = cy - reach; b <= cy + reach; b++) for (let c = cz - reach; c <= cz + reach; c++) {
        const list = grid.get(key(a, b, c));
        if (!list) continue;
        for (const i of list) {
          const w = Math.exp(-((native[i * 3] - x) ** 2 + (native[i * 3 + 1] - y) ** 2 + (native[i * 3 + 2] - z) ** 2) / (2 * spread * spread));
          total += w; dx += w * delta[i * 3]; dy += w * delta[i * 3 + 1]; dz += w * delta[i * 3 + 2];
        }
      }
      if (total < 1e-9) {
        let best = Infinity, at = 0;
        for (let i = 0; i < count; i++) {
          const far = (native[i * 3] - x) ** 2 + (native[i * 3 + 1] - y) ** 2 + (native[i * 3 + 2] - z) ** 2;
          if (far < best) { best = far; at = i; }
        }
        total = 1; dx = delta[at * 3]; dy = delta[at * 3 + 1]; dz = delta[at * 3 + 2];
      }
      p.setXYZ(v, x + dx / total, y + dy / total, z + dz / total);
    }
    p.needsUpdate = true;
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    return mesh;
  });
}

export function studioHairFor(cage, style, material, plain) {
  if (!studioHairStyles.includes(style.hair)) return [];
  const s = refineFaceForm(smoothHumanSurface(cage)), { native } = controlPoints(s), { beside } = binding();
  const count = data.count, control = read("control", Float32Array);
  let delta = new Float32Array(count * 3);
  for (let i = 0; i < delta.length; i++) delta[i] = native[i] - control[i];
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) for (let d = 0; d < 3; d++) {
      let sum = delta[i * 3 + d];
      for (const j of beside[i]) sum += delta[j * 3 + d];
      next[i * 3 + d] = sum / (beside[i].length + 1);
    }
    delta = next;
  }
  const build = (names, coloured) => {
    const position = [], uv = [], colours = [], indices = [];
    for (const name of names) {
      const first = position.length / 3, piece = data.pieces[name];
      const packed = read("pieces/" + name + "/points", Float32Array), ties = read("pieces/" + name + "/ties", Uint16Array), shares = read("pieces/" + name + "/shares", Float32Array);
      for (let i = 0; i < packed.length / 3; i++) for (let d = 0; d < 3; d++) {
        let value = packed[i * 3 + d];
        for (let k = 0; k < 3; k++) value += shares[i * 3 + k] * delta[ties[i * 3 + k] * 3 + d];
        position.push(value);
      }
      for (const value of read("pieces/" + name + "/uv", Float32Array)) uv.push(value);
      for (const value of read("pieces/" + name + "/index", Uint16Array)) indices.push(first + value);
      if (coloured) for (const value of piece.colour ? read("pieces/" + name + "/colour", Float32Array) : new Float32Array(piece.vertices * 3).fill(1)) colours.push(value);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(position, 3));
    g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    if (coloured && !plain) g.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  };
  const hairColour = new T.Color(style.hairColor ?? "#45352e");
  const m = material("#" + hairColour.getHexString(), "hair").clone();
  if (!plain) { m.color.set("#ffffff"); m.map = dyedHair(hairColour); m.roughness = 0.52; m.metalness = 0; }
  m.userData = { ...m.userData, studioHair: true };
  const hatted = Boolean(style.hat) && style.hat !== "None";
  const hair = new T.Mesh(build(hatted ? ["hair_main"] : ["hair_main", "hair_ponytail", "hair_strand"], false), m);
  hair.userData.sculptedHair = true;
  const bandMaterial = material(plain ? "#" + hairColour.getHexString() : "#ffffff").clone();
  if (!plain) { bandMaterial.vertexColors = true; bandMaterial.roughness = 0.7; bandMaterial.metalness = 0; }
  const band = new T.Mesh(build(["hairband"], true), bandMaterial);
  for (const mesh of hatted ? [hair] : [hair, band]) { mesh.name = style.hair; mesh.userData.styleRegion = "head"; mesh.userData.studioHair = true; mesh.castShadow = true; }
  return hatted ? [hair] : [hair, band];
}
