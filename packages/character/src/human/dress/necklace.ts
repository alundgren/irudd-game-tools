import * as T from "three";
import { Piece, analyse, raycaster, type DressMesh, type Skin, type Vec } from "./kit.js";
import type { HumanSurface } from "../surface.js";
import { necklaceStyles } from "./styles.js";

const tau = 2 * Math.PI;

function bead(
  piece: Piece,
  at: T.Vector3,
  rx: number,
  ry: number,
  rz: number,
  skin: Skin,
  facets = 10,
): void {
  const rings = [-1.42, -0.88, 0, 0.88, 1.42].map((lat) =>
    Array.from({ length: facets }, (_, j): Vec => {
      const lon = (tau * j) / facets;
      return [
        at.x + rx * Math.cos(lat) * Math.cos(lon),
        at.y + ry * Math.sin(lat),
        at.z + rz * Math.cos(lat) * Math.sin(lon),
      ];
    }),
  );
  piece.loft(rings, skin, { capStart: true, capEnd: true });
}

function fan(piece: Piece, at: T.Vector3, k: number, skin: Skin): void {
  const shell = (outset: number) =>
    Array.from({ length: 5 }, (_, i) =>
      Array.from({ length: 27 }, (_, j): Vec => {
        const a = (j / 26 - 0.5) * 2.38,
          r = (0.004 + (0.038 * i) / 4) * k;
        const flute = 0.5 + 0.5 * Math.cos(j * Math.PI);
        const reach = r * (1 + 0.07 * (i / 4) ** 2 * flute);
        return [
          at.x + Math.sin(a) * reach,
          at.y - 0.038 * k + Math.cos(a) * reach,
          at.z + k * (0.0024 * flute * (i / 4) + 0.006 * Math.sin((Math.PI * i) / 6) + outset),
        ];
      }),
    );
  piece.slab(shell(0.003), shell(0), skin);
}

export interface NecklaceStyleFields {
  readonly necklace?: string | undefined;
  readonly clothAccent?: string | undefined;
  readonly metalColor?: string | undefined;
}

export function fittedNecklace(
  surface: HumanSurface,
  style: NecklaceStyleFields,
  clothes: ReadonlyArray<T.Mesh>,
  material: (colour: string, type: string) => T.Material,
  plain = false,
): DressMesh[] {
  const cut = style.necklace;
  if (!cut || cut === "None" || !necklaceStyles.some((s) => s === cut)) return [];
  const body = analyse(surface),
    k = body.scale;
  const [cx, cy, cz] = body.joint("neck_01");
  const casts = [raycaster(body.P, body.tri)];
  for (const mesh of clothes) {
    if (mesh.userData["styleRegion"] === "head") continue;
    const g = mesh.geometry,
      p = g.getAttribute("position");
    if (!p) continue;
    g.computeBoundingBox();
    const box = g.boundingBox;
    if (!box || box.max.y < cy - 0.18 * k || box.min.y > cy + 0.08 * k) continue;
    casts.push(raycaster(p.array, g.index?.array ?? Array.from({ length: p.count }, (_, i) => i)));
  }
  const ornate = cut === "Fan collar",
    pearls = cut === "Pearl strand";
  const count = 64;
  const chain = new Piece(),
    stones = new Piece();
  function pointAt(a: number, frontDrop: number): T.Vector3 {
    const dx = Math.sin(a),
      dz = Math.cos(a);
    const y = cy + k * (0.018 - 0.018 * Math.max(0, -dz) - frontDrop * Math.max(0, dz) ** 1.35);
    const outer = 0.29 * k,
      rise = (0.22 + 0.49 * dx * dx) * outer;
    const from: Vec = [cx + dx * outer, y + rise, cz + dz * outer];
    const dir = new T.Vector3(-dx, -rise / outer, -dz).normalize();
    let distance = Math.min(...casts.map((cast) => cast(from, dir.toArray())));
    if (!Number.isFinite(distance)) distance = outer * 0.7;
    return new T.Vector3(...from).addScaledVector(dir, distance - 0.0035 * k);
  }
  const path = Array.from({ length: count }, (_, i) =>
    pointAt((tau * i) / count, ornate ? 0.142 : pearls ? 0.11 : 0.157),
  );
  const skins = path.map((p) => body.skinAt([p.x, p.y, p.z]));
  const point = (i: number) => path[i] ?? new T.Vector3();
  const rings = path.map((p, i) => {
    const tangent = point((i + 1) % count)
      .clone()
      .sub(point((i + count - 1) % count))
      .normalize();
    const outward = new T.Vector3(Math.sin((tau * i) / count), 0.2, Math.cos((tau * i) / count));
    const side = new T.Vector3().crossVectors(tangent, outward).normalize();
    outward.crossVectors(side, tangent).normalize();
    const width = (ornate ? 0.0024 : 0.0015) * k;
    return Array.from({ length: 6 }, (_, j): Vec => {
      const q = p
        .clone()
        .addScaledVector(outward, width * Math.cos((tau * j) / 6))
        .addScaledVector(side, width * Math.sin((tau * j) / 6));
      return [q.x, q.y, q.z];
    });
  });
  const none: Skin = [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
  ];
  chain.loft([...rings, rings[0] ?? []], (_p, i) => skins[i % count] ?? none, { flip: true });
  if (pearls || ornate) {
    for (let i = 0; i < count; i += 2) {
      const p = point(i),
        face = Math.max(0, Math.cos((tau * i) / count));
      const r = (pearls ? 0.0038 + 0.0025 * face : 0.0027 + 0.0018 * face) * k;
      bead(stones, p, r, r * 1.04, r, skins[i] ?? none, 8);
    }
  }
  if (!pearls) {
    const at = point(0).clone(),
      skin = skins[0] ?? none;
    if (ornate) {
      fan(chain, at, k, skin);
      bead(
        stones,
        at.clone().add(new T.Vector3(0, -0.032 * k, 0.006 * k)),
        0.006 * k,
        0.007 * k,
        0.005 * k,
        skin,
      );
    } else {
      bead(chain, at, 0.004 * k, 0.005 * k, 0.003 * k, skin);
      const centre = at.clone().add(new T.Vector3(0, -0.016 * k, 0.002 * k));
      bead(chain, centre, 0.0105 * k, 0.014 * k, 0.004 * k, skin);
      bead(
        stones,
        centre.clone().add(new T.Vector3(0, 0, 0.0035 * k)),
        0.0088 * k,
        0.0117 * k,
        0.0038 * k,
        skin,
        8,
      );
    }
  }
  function mesh(piece: Piece, colour: string, metal: boolean, name: string): DressMesh {
    const m = material(colour, metal ? "metal" : "cloth").clone();
    if (!plain && m instanceof T.MeshStandardMaterial) {
      m.metalness = metal ? 0.72 : 0.11;
      m.roughness = metal ? 0.31 : 0.24;
    }
    m.userData["fibreLOD"] = true;
    return piece.mesh(m, "spine_03", name);
  }
  const enamel = style.clothAccent || "#26766f";
  return [
    mesh(chain, style.metalColor || "#b1935e", true, cut + " setting"),
    mesh(stones, pearls || ornate ? "#ecdec8" : enamel, false, cut + " beads"),
  ];
}
