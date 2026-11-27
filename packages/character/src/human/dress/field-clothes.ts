import * as T from "three";
import type { FieldClothing as Source } from "../field-clothes-data.js";
import type { HumanBody } from "../body.js";
import type { HumanSurface } from "../surface.js";
import { boneNames } from "../catalogue.js";
import { surfaceBody } from "./fringe.js";
import { outfitPalette, toneFields, type OutfitTones } from "./outfits.js";

type PixelMap = Source["record"]["texture"];
type JointInfluence = { boneIndices: number[]; weights: number[] };
const unit = (v: number) => Math.max(0, Math.min(1, v));
function imageMap(image: PixelMap, colour: boolean, style?: OutfitTones, shoe = false) {
  const pixels = image.pixels.slice();
  if (colour && style && Object.keys(toneFields).some((k) => Object.hasOwn(style, k))) {
    const palette = outfitPalette(style),
      tones = new Map(
        Object.entries(palette).map(([k, v]) => [
          k,
          new T.Color(v)
            .convertLinearToSRGB()
            .toArray()
            .map((x) => x * 255),
        ]),
      );
    const hsl = { h: 0, s: 0, l: 0 },
      col = new T.Color();
    for (let i = 0; i < pixels.length; i += 4) {
      const { h, s, l } = col
        .setRGB((pixels[i] ?? 0) / 255, (pixels[i + 1] ?? 0) / 255, (pixels[i + 2] ?? 0) / 255)
        .getHSL(hsl);
      let name = "",
        level = 1,
        light = 0;
      if (shoe) {
        if (s < 0.3 && l > 0.05) {
          name = "leather";
          level = 0.4;
        }
      } else if (s > 0.14 && h > 0.5 && h < 0.68 && l > 0.1) {
        name = "dark";
        level = 0.37;
      } else if (s > 0.16 && (h > 0.88 || h < 0.07) && l > 0.05) {
        name = "accent";
        level = 0.2;
        light = unit((l - 0.32) / 0.18);
      } else if (s <= 0.14 && l >= 0.36) {
        name = "dark";
        level = 0.5;
      } else if (s <= 0.14 && l > 0.1) {
        name = "main";
        level = 0.25;
      }
      const dye = tones.get(name);
      if (!dye) continue;
      const shade = T.MathUtils.clamp((l / level) ** 0.72, 0.36, 1.5),
        pale = tones.get("light");
      for (let c = 0; c < 3; c++) {
        const base = Math.min(255, (dye[c] ?? 0) * (light ? Math.min(shade, 1) : shade));
        pixels[i + c] = Math.round(T.MathUtils.lerp(base, pale?.[c] ?? base, light));
      }
    }
  }
  const tex = new T.DataTexture(pixels, image.width, image.height, T.RGBAFormat);
  tex.flipY = true;
  tex.generateMipmaps = true;
  tex.magFilter = T.LinearFilter;
  tex.minFilter = T.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  if (colour) tex.colorSpace = T.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
function frame(points: Float32Array, ids: readonly number[]) {
  const [i = 0, j = 0, k = 0] = ids,
    base = new T.Vector3().fromArray(points, i * 3);
  const x = new T.Vector3()
      .fromArray(points, j * 3)
      .sub(base)
      .normalize(),
    edge = new T.Vector3().fromArray(points, k * 3).sub(base);
  const z = x.clone().cross(edge).normalize();
  return z.lengthSq() > 0.5 ? ([x, z.clone().cross(x), z] as const) : undefined;
}
function fitChest(
  surface: HumanSurface,
  rest: Float32Array,
  panel: Float32Array,
  positions: Float32Array,
) {
  const cells = new Map<string, number>(),
    bin = (v: number) => Math.floor(v / 0.018),
    k = surface.height / 1.72;
  for (let i = 0; i < surface.bodyVertices; i++) {
    const j = i * 3,
      x = rest[j] ?? 0,
      y = rest[j + 1] ?? 0,
      z = rest[j + 2] ?? 0;
    if (Math.abs(x) > 0.24 || y < 0.1 || y > 0.59 || z < 0.045) continue;
    const cell = bin(x) + "," + bin(y),
      prior = cells.get(cell);
    if (prior === undefined || z > (rest[prior * 3 + 2] ?? 0)) cells.set(cell, i);
  }
  for (let j = 0; j < panel.length; j += 3) {
    const pos = new T.Vector3().fromArray(panel, j),
      { x, y, z } = pos;
    const smooth = T.MathUtils.smoothstep;
    const mix =
      smooth(z, 0.062, 0.12) *
      smooth(0.225 - Math.abs(x), 0, 0.065) *
      smooth(y, 0.12, 0.22) *
      smooth(0.565 - y, 0, 0.09);
    if (mix < 0.01) continue;
    let total = 0,
      support = -Infinity;
    const delta = new T.Vector3();
    for (let dx = -5; dx <= 5; dx++)
      for (let dy = -6; dy <= 6; dy++) {
        const i = cells.get(bin(x) + dx + "," + (bin(y) + dy));
        if (i === undefined) continue;
        const r = new T.Vector3().fromArray(rest, i * 3),
          v = new T.Vector3().fromArray(surface.positions, i * 3),
          ax = r.x - x,
          ay = r.y - y;
        const distance = (ax / 0.044) ** 2 + (ay / 0.052) ** 2;
        if (distance >= 5) continue;
        const w = Math.exp(-0.5 * distance);
        total += w;
        support = Math.max(support, v.z - k * (4.7 * ax * ax + (ay > 0 ? 0.29 * ay : -0.7 * ay)));
        delta.addScaledVector(v.addScaledVector(r, -k), w);
      }
    if (!total) continue;
    pos.multiplyScalar(k).addScaledVector(delta, 1 / total);
    pos.z = Math.max(pos.z, support + 0.007 * k);
    new T.Vector3().fromArray(positions, j).lerp(pos, mix).toArray(positions, j);
  }
  const body = surfaceBody(surface),
    shoulder = body.joint("upperarm_l"),
    neck = body.joint("neck_01");
  for (let j = 0; j < positions.length; j += 3) {
    const x = positions[j] ?? 0,
      y = positions[j + 1] ?? 0;
    if (
      y - shoulder[1] >= -0.039 * body.scale &&
      y <= neck[1] + 0.09 * body.scale &&
      Math.abs(x) <= Math.abs(shoulder[0]) + 0.035 * body.scale
    )
      positions.set(body.clear([x, y, positions[j + 2] ?? 0], 0.009 * body.scale), j);
  }
}
function fit(body: HumanBody, s: HumanSurface, source: Source, ids: Map<number, number>) {
  const rest = body.arrays.f32("base"),
    positions = new Float32Array(source.refs.length),
    bones = new Uint8Array((positions.length / 3) * 4),
    skin = new Float32Array(bones.length);
  const shoe = source.record.name === "shoes02",
    panel = shoe ? undefined : new Float32Array(positions.length);
  for (let j = 0; j < positions.length; j += 3) {
    const refs = Array.from(source.refs.subarray(j, j + 3), (r) => {
      const id = ids.get(r);
      if (id === undefined) throw new Error("Missing field garment body vertex " + r);
      return id;
    });
    const weights = new Map<number, number>(),
      p = new T.Vector3(),
      delta = new T.Vector3().fromArray(source.offsets, j),
      base = delta.clone();
    refs.forEach((id, i) => {
      const w = source.weights[j + i] ?? 0;
      p.addScaledVector(new T.Vector3().fromArray(s.positions, id * 3), w);
      base.addScaledVector(new T.Vector3().fromArray(rest, id * 3), w);
      for (let b = id * 4; b < id * 4 + 4; b++) {
        const bone = s.boneIndices[b] ?? 0,
          sw = s.weights[b] ?? 0;
        if (sw) weights.set(bone, (weights.get(bone) ?? 0) + Math.max(0, w) * sw);
      }
    });
    if (panel) base.toArray(panel, j);
    const a = frame(rest, refs),
      b = frame(s.positions, refs);
    if (a && b && delta.lengthSq() > 1e-9) {
      const turns = [delta.dot(a[0]), delta.dot(a[1]), delta.dot(a[2])];
      delta.set(0, 0, 0);
      b.forEach((axis, i) => delta.addScaledVector(axis, turns[i] ?? 0));
    }
    p.addScaledVector(delta, s.height / 1.72).toArray(positions, j);
    const top = Array.from(weights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
      sum = top.reduce((n, e) => n + e[1], 0);
    top.forEach(([id, w], i) => {
      bones[(j / 3) * 4 + i] = id;
      skin[(j / 3) * 4 + i] = w / sum;
    });
  }
  if (panel) fitChest(s, rest, panel, positions);
  if (shoe) {
    const legs = (["r", "l"] as const).map((side) => {
        const ankle = new T.Vector3().fromArray(s.joints, 3 * boneNames.indexOf(`foot_${side}`)),
          knee = new T.Vector3().fromArray(s.joints, 3 * boneNames.indexOf(`calf_${side}`));
        return { ankle, axis: knee.sub(ankle).normalize() };
      }),
      k = s.height / 1.72;
    for (let i = 1306 * 3; i < positions.length; i += 3) {
      const leg = legs[(positions[i] ?? 0) > 0 ? 1 : 0];
      if (!leg) continue;
      const v = new T.Vector3().fromArray(positions, i).sub(leg.ankle),
        along = v.dot(leg.axis),
        rise = Math.max(0, along - 0.009 * k);
      if (rise)
        v.addScaledVector(leg.axis, -along)
          .multiplyScalar(1 - 0.3 * T.MathUtils.smoothstep(rise, 0, 0.036 * k))
          .addScaledVector(leg.axis, along - 0.82 * rise)
          .add(leg.ankle)
          .toArray(positions, i);
    }
  }
  return { positions, bones, skin };
}
export function fieldClothes(
  body: HumanBody,
  s: HumanSurface,
  style: OutfitTones,
  material: (color: string) => T.Material,
  plain: boolean,
) {
  const meshes: { mesh: T.Mesh; region: string; skin: JointInfluence }[] = [],
    hidden = new Set<number>(),
    ids = new Map(Array.from(s.ids, (r, i) => [r, i] as const));
  for (const src of body.fieldClothing) {
    const { positions, bones, skin } = fit(body, s, src, ids),
      r = src.record;
    const m = material("#ffffff").clone();
    m.side = T.DoubleSide;
    if (!plain && m instanceof T.MeshStandardMaterial) {
      m.map = imageMap(r.texture, true, style, r.name === "shoes02");
      if (r.normal) {
        m.normalMap = imageMap(r.normal, false);
        m.normalScale.setScalar(0.82);
      }
      if (r.occlusion) {
        m.aoMap = imageMap(r.occlusion, false);
        m.aoMapIntensity = 0.72;
      }
      if (style.clothColor && !Object.keys(toneFields).some((k) => Object.hasOwn(style, k)))
        m.color.lerp(new T.Color(style.clothColor), 0.32);
      m.addEventListener("dispose", () => {
        m.map?.dispose();
        m.normalMap?.dispose();
        m.aoMap?.dispose();
      });
    }
    for (const id of src.hide) hidden.add(id);
    const whole = new T.BufferGeometry();
    whole.setAttribute("position", new T.BufferAttribute(positions, 3));
    whole.setIndex(new T.BufferAttribute(src.corners, 1));
    whole.computeVertexNormals();
    const normals = whole.getAttribute("normal"),
      bins = new Map<number, number[]>();
    for (let c = 0; c < src.corners.length; c += 3) {
      const votes = new Map<number, number>();
      for (let i = c; i < c + 3; i++) {
        const v = (src.corners[i] ?? 0) * 4;
        for (let j = v; j < v + 4; j++) {
          const bone = bones[j] ?? 0;
          votes.set(bone, (votes.get(bone) ?? 0) + (skin[j] ?? 0));
        }
      }
      let best = -1,
        owner = 0;
      for (const [key, n] of votes)
        if (n > best) {
          owner = key;
          best = n;
        }
      let bin = bins.get(owner);
      if (!bin) bins.set(owner, (bin = []));
      bin.push(c, c + 1, c + 2);
    }
    for (const [owner, bin] of bins) {
      const g = new T.BufferGeometry(),
        pos: number[] = [],
        norm: number[] = [],
        uv: number[] = [],
        indices: number[] = [],
        influence: JointInfluence = { boneIndices: [], weights: [] },
        seen = new Map<number, number>();
      for (const c of bin) {
        const v = src.corners[c] ?? 0,
          t = src.texCorners[c] ?? 0,
          key = v * 65536 + t;
        let index = seen.get(key);
        if (index === undefined) {
          index = pos.length / 3;
          seen.set(key, index);
          pos.push(...positions.subarray(v * 3, v * 3 + 3));
          norm.push(normals.getX(v), normals.getY(v), normals.getZ(v));
          uv.push((src.uv[t * 2] ?? 0) / 65535, (src.uv[t * 2 + 1] ?? 0) / 65535);
          influence.boneIndices.push(...bones.subarray(v * 4, v * 4 + 4));
          influence.weights.push(...skin.subarray(v * 4, v * 4 + 4));
        }
        indices.push(index);
      }
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
      g.setIndex(indices);
      const mesh = new T.Mesh(g, m);
      mesh.castShadow = true;
      meshes.push({ mesh, region: boneNames[owner] ?? "spine_03", skin: influence });
    }
    whole.dispose();
  }
  return { meshes, hidden };
}
