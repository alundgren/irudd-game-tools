import * as T from "three";
import type { SmoothSurface } from "./smooth.js";
import type { HumanBody } from "./body.js";
import { studioEyes } from "./studio-eyes.js";
import { studioTexture } from "./studio-paint.js";
import type { StudioFit } from "./studio-fit.js";
import { studioExpressions, studioPieces } from "./studio-data.js";

function nativeRim(s: SmoothSurface, corners: readonly number[]) {
  const edges = new Set<number>(),
    count = s.positions.length / 3;
  for (let i = 0; i < corners.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = s.indices[corners[i + j] ?? 0] ?? 0,
        b = s.indices[corners[i + ((j + 1) % 3)] ?? 0] ?? 0;
      edges.add(a * count + b);
    }
  const next = new Map<number, number>();
  for (const key of edges) {
    const a = Math.floor(key / count),
      b = key % count;
    if (!edges.has(b * count + a)) next.set(a, b);
  }
  let lowest = Infinity,
    best: number[] = [];
  while (next.size) {
    const start = next.keys().next().value;
    if (start === undefined) break;
    const ring: number[] = [];
    let v: number | undefined = start;
    while (v !== undefined && next.has(v)) {
      ring.push(v);
      const n: number | undefined = next.get(v);
      next.delete(v);
      v = n;
    }
    if (v !== start || ring.length < 12) continue;
    const mean = ring.reduce((sum, n) => sum + (s.positions[n * 3 + 1] ?? 0), 0) / ring.length;
    if (mean < lowest) {
      lowest = mean;
      best = ring;
    }
  }
  return best;
}
export function studioCollar(
  body: HumanBody,
  s: SmoothSurface,
  corners: readonly number[],
  origin: readonly [number, number, number],
  head: T.Mesh,
  headBone: number,
  normals: ArrayLike<number>,
) {
  const native = nativeRim(s, corners),
    rim = body.studio.u16("neck");
  if (!native.length) return;
  const coords = head.geometry.getAttribute("position"),
    color = head.geometry.getAttribute("color"),
    tone = new T.Color(1, 1, 1);
  const points: T.Vector3[] = [],
    colours: number[] = [],
    indices: number[] = [],
    weights: number[] = [],
    bones: number[] = [];
  for (const v of rim) {
    points.push(new T.Vector3().fromBufferAttribute(coords, v));
    colours.push(color.getX(v), color.getY(v), color.getZ(v));
    weights.push(1, 0, 0, 0);
    bones.push(headBone, 0, 0, 0);
  }
  for (const v of native) {
    points.push(new T.Vector3().fromArray(s.positions, v * 3).sub(new T.Vector3(...origin)));
    colours.push(tone.r, tone.g, tone.b);
    for (let j = 0; j < 4; j++) {
      weights.push(s.weights[4 * v + j] ?? 0);
      bones.push(s.boneIndices[4 * v + j] ?? 0);
    }
  }
  const upper = Array.from(rim, (_, i) => i),
    lower = native.map((_, i) => rim.length + i);
  const distance = (a: number, b: number) =>
    (points[a] ?? zero).distanceToSquared(points[b] ?? zero);
  const winding = (ring: number[]) =>
    ring.reduce((sum, a, i) => {
      const p = points[a] ?? zero,
        q = points[ring[(i + 1) % ring.length] ?? 0] ?? zero;
      return sum + p.z * q.x - p.x * q.z;
    }, 0);
  if (Math.sign(winding(upper)) !== Math.sign(winding(lower))) lower.reverse();
  let start = 0;
  for (let i = 1; i < lower.length; i++)
    if (distance(0, lower[i] ?? 0) < distance(0, lower[start] ?? 0)) start = i;
  const tex = head.geometry.getAttribute("uv"),
    normal = head.geometry.getAttribute("normal"),
    uv: number[] = [],
    directions: number[] = [];
  for (const i of rim) {
    uv.push(tex.getX(i), tex.getY(i));
    directions.push(normal.getX(i), normal.getY(i), normal.getZ(i));
  }
  for (const [k, v] of native.entries()) {
    let nearest = 0;
    for (const i of upper)
      if (distance(i, rim.length + k) < distance(nearest, rim.length + k)) nearest = i;
    const j = rim[nearest] ?? 0;
    uv.push(tex.getX(j), tex.getY(j));
    directions.push(normals[3 * v] ?? 0, normals[3 * v + 1] ?? 0, normals[3 * v + 2] ?? 0);
  }
  for (let i = 0, j = 0; i < upper.length || j < lower.length;) {
    const a = upper[i % upper.length] ?? 0,
      b = lower[(j + start) % lower.length] ?? 0;
    const c = upper[(i + 1) % upper.length] ?? 0,
      d = lower[(j + 1 + start) % lower.length] ?? 0;
    const ahead = (i + 1) / upper.length - (j + 1) / lower.length;
    if (
      j >= lower.length ||
      (i < upper.length && (ahead < -0.04 || (ahead < 0.04 && distance(c, b) <= distance(a, d))))
    ) {
      indices.push(c, a, b);
      i++;
    } else {
      indices.push(b, d, a);
      j++;
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      points.flatMap((p) => p.toArray()),
      3,
    ),
  );
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
  g.setIndex(indices);
  g.setAttribute("normal", new T.Float32BufferAttribute(directions, 3));
  const mesh = new T.Mesh(g, head.material);
  mesh.name = "Studio Rain neck";
  return { mesh, bones, weights };
}
const zero = new T.Vector3();

export function studioMeshes(
  body: HumanBody,
  fit: StudioFit,
  origin: readonly [number, number, number],
  skin: string,
  hair: string,
  familyHair: boolean,
  plain: boolean,
  iris: T.Color | null,
  onlyHair = false,
) {
  const pack = body.studio,
    skinColour = new T.Color(skin),
    hairColour = new T.Color(hair),
    vec = new T.Vector3();
  const standalone = onlyHair ? fit.standaloneDelta() : undefined;
  return studioPieces
    .filter((name) => (onlyHair ? name.startsWith("hair") : familyHair || !name.startsWith("hair")))
    .map((name) => {
      const geo = new T.BufferGeometry();
      geo.setAttribute(
        "position",
        new T.BufferAttribute(fit.position(name, origin, standalone), 3),
      );
      geo.setAttribute("uv", new T.BufferAttribute(pack.f32(name + ".uv").slice(), 2));
      geo.setIndex(new T.BufferAttribute(pack.u16(name + ".index"), 1));
      geo.computeVertexNormals();
      const mapped =
        name === "skin"
          ? "skin"
          : name === "eyes"
            ? "eyes"
            : name.startsWith("hair_")
              ? "hair"
              : undefined;
      const source = pack.u8(name + ".color"),
        values = new Float32Array(source.length).fill(1);
      if (!mapped) {
        const tint = new T.Color(),
          gain = new T.Color().fromArray(
            hairColour
              .toArray()
              .map((x, i) =>
                Math.sqrt(
                  T.MathUtils.clamp(x / ([0.01850022, 0.01032982, 0.00604883][i] ?? 1), 0.02, 8),
                ),
              ),
          );
        for (let i = 0; i < values.length; i += 3) {
          tint.setRGB(
            (source[i] ?? 0) / 255,
            (source[i + 1] ?? 0) / 255,
            (source[i + 2] ?? 0) / 255,
            T.SRGBColorSpace,
          );
          if (name === "brows") tint.multiply(gain);
          values.set([Math.min(1, tint.r), Math.min(1, tint.g), Math.min(1, tint.b)], i);
        }
      }
      geo.setAttribute("color", new T.BufferAttribute(values, 3));
      if (name === "eyes") studioEyes(body, fit, geo, origin);
      if (pack.has(name + ".Blink")) {
        geo.morphTargetsRelative = true;
        geo.morphAttributes["position"] = studioExpressions.map((e) => {
          const shift = pack.f32(name + "." + e).slice();
          for (let i = 0; i < shift.length; i += 3)
            vec.fromArray(shift, i).applyMatrix3(fit.rotation).toArray(shift, i);
          const attr = new T.BufferAttribute(shift, 3);
          attr.name = e;
          return attr;
        });
      }
      const map =
        !plain && mapped
          ? studioTexture(
              body,
              mapped,
              mapped === "skin"
                ? skinColour
                : mapped === "hair"
                  ? hairColour
                  : (iris ?? new T.Color(0.15, 0.35, 0.45)),
            )
          : null;
      const mesh = new T.Mesh(
        geo,
        new T.MeshStandardMaterial({
          map,
          color: plain ? 0xcac5be : 0xffffff,
          vertexColors: !plain,
          roughness: name === "eyes" ? 0.22 : mapped === "hair" ? 0.52 : 0.65,
          side: T.DoubleSide,
        }),
      );
      mesh.name = "Studio Rain " + name;
      mesh.userData["faceSurface"] = name === "skin";
      if (name === "eyes") mesh.userData["eyePiece"] = "Iris";
      if (name.startsWith("hair")) mesh.userData["studioHair"] = true;
      mesh.castShadow = name !== "eyes";
      return mesh;
    });
}
