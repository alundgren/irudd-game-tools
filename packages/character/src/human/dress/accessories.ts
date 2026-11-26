import * as T from "three";
import { boneNames } from "../catalogue.js";
import type { HumanSurface } from "../surface.js";

export interface AccessoryStyle {
  readonly hat?: string;
  readonly hatColor?: string;
  readonly earrings?: string;
  readonly waistBag?: string;
  readonly facialHair?: string;
  readonly handProp?: string;
  readonly metalColor?: string;
  readonly hairColor?: string;
  readonly leatherColor?: string;
  readonly clothSecond?: string;
}
export function fittedAccessories(
  s: HumanSurface,
  style: AccessoryStyle | undefined,
  material: (tone: string, type: string) => T.Material,
) {
  const pieces: { mesh: T.Mesh; region: string }[] = [];
  if (
    !style ||
    ![style.hat, style.earrings, style.waistBag, style.handProp, style.facialHair].some(
      (v) => v && v !== "None",
    )
  )
    return pieces;
  const k = s.height / 1.72;
  const joint = (bone: (typeof boneNames)[number]) =>
    new T.Vector3().fromArray(s.joints, 3 * boneNames.indexOf(bone));
  const eye = new T.Box3();
  for (const ids of s.eyeGroups)
    for (const i of ids) eye.expandByPoint(new T.Vector3().fromArray(s.positions, i * 3));
  const centre = eye.getCenter(new T.Vector3());
  const head = joint("head"),
    skull = new T.Box3();
  const skin: T.Vector3[] = [];
  for (let i = 0; i < s.bodyVertices; i++) {
    const p = new T.Vector3().fromArray(s.positions, i * 3);
    if (p.y < centre.y - 0.13 * k) continue;
    skin.push(p);
    if (p.y >= centre.y) skull.expandByPoint(p);
  }
  const cap = skull.getCenter(new T.Vector3()),
    span = skull.getSize(new T.Vector3());
  function add(
    region: string,
    name: string,
    g: T.BufferGeometry,
    p: T.Vector3,
    color: string,
    type: string,
  ) {
    g.translate(p.x, p.y, p.z);
    const mesh = new T.Mesh(g, material(color, type));
    mesh.name = name;
    pieces.push({ mesh, region });
  }
  const metal = style.metalColor ?? "#a78c59",
    leather = style.leatherColor ?? "#674e40";
  if (style.hat && style.hat !== "None") {
    const y = centre.y + 0.042 * k,
      hat = style.hatColor ?? "#526377",
      beret = style.hat === "Beret";
    const crown = new T.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(
      span.x * (beret ? 0.68 : 0.57),
      Math.max(skull.max.y - y + 0.018 * k, 0.05 * k),
      span.z * 0.59,
    );
    if (beret) crown.rotateZ(0.13);
    add("head", style.hat, crown, new T.Vector3(cap.x, y, cap.z), hat, "canvas");
    const brim = new T.CylinderGeometry(beret ? 0.95 : 0.8, 1, 0.15, 32).scale(
      span.x * (beret ? 0.52 : 0.73),
      0.15 * k,
      span.z * (beret ? 0.52 : 0.73),
    );
    add("head", "Hat brim", brim, new T.Vector3(cap.x, y, cap.z), hat, "canvas");
  }
  if (style.earrings && style.earrings !== "None") {
    for (const side of style.earrings === "Hoops" ? [-1, 1] : [1]) {
      const ear = skin
        .filter((v) => v.y < centre.y && v.y > centre.y - 0.05 * k)
        .sort((a, b) => side * (b.x - a.x))[0];
      if (!ear) continue;
      add(
        "head",
        style.earrings,
        new T.TorusGeometry(0.015 * k, 0.0025 * k, 8, 20).rotateY(side * 0.5),
        ear.clone().add(new T.Vector3(0, -0.016 * k, 0)),
        metal,
        "metal",
      );
      if (style.earrings !== "Hoops")
        add(
          "head",
          "Ear pendant",
          new T.OctahedronGeometry(0.009 * k).scale(0.7, 1.4, 0.6),
          ear.clone().add(new T.Vector3(0, -0.037 * k, 0)),
          metal,
          "metal",
        );
    }
  }
  if (style.facialHair && style.facialHair !== "None") {
    const beard = style.facialHair === "Short beard";
    const positions: number[] = [];
    for (const p of skin) {
      const x = Math.abs(p.x - centre.x) / k,
        y = (centre.y - p.y) / k;
      if (p.z < head.z + 0.023 * k || y < 0.044 || x > 0.064) continue;
      const moustache = x < 0.029 && Math.abs(y - (0.054 + x * 0.24)) < 0.005;
      if (!moustache && !(beard && y > 0.083 - x * 0.2 && y < 0.12 - x * 0.28)) continue;
      const r = k * (beard ? 0.0025 : 0.0018),
        z = p.z + 0.001 * k;
      positions.push(p.x - r, p.y, z, p.x, p.y - r * 3, z + r, p.x + r, p.y, z);
    }
    if (positions.length) {
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      add("head", style.facialHair, g, new T.Vector3(), style.hairColor ?? "#46382e", "plain");
    }
  }
  if (style.waistBag && style.waistBag !== "None") {
    const base = joint("spine_01");
    let z = base.z;
    for (let i = 0; i < s.bodyVertices; i++) {
      const p = new T.Vector3().fromArray(s.positions, i * 3);
      if (Math.abs(p.y - base.y) < 0.025 * k && Math.abs(p.x) < 0.14 * k) z = Math.max(z, p.z);
    }
    const folio = style.waistBag === "Dispatch folio",
      pos = new T.Vector3(base.x + 0.07 * k, base.y, z + 0.017 * k);
    add(
      "spine_01",
      style.waistBag,
      new T.BoxGeometry((folio ? 0.15 : 0.2) * k, (folio ? 0.13 : 0.07) * k, 0.04 * k),
      pos,
      leather,
      "leather",
    );
    add(
      "spine_01",
      "Pouch clasp",
      new T.BoxGeometry(0.022 * k, 0.018 * k, 0.008 * k),
      pos.clone().add(new T.Vector3(0, 0, 0.023 * k)),
      metal,
      "metal",
    );
  }
  if (style.handProp && style.handProp !== "None") {
    const palm = joint("hand_r"),
      radius = 0.17 * k;
    const fan = new T.CircleGeometry(radius, 16, Math.PI * 0.13, Math.PI * 0.74);
    add("hand_r", style.handProp, fan, palm, style.clothSecond ?? "#965c60", "canvas");
    for (let i = 0; i <= 8; i++) {
      const angle = Math.PI * (0.13 + (0.74 * i) / 8),
        dir = new T.Vector3(Math.cos(angle), Math.sin(angle), 0);
      add(
        "hand_r",
        "Fan rib",
        new T.CylinderGeometry(0.0014 * k, 0.002 * k, radius, 5).rotateZ(angle - Math.PI / 2),
        palm
          .clone()
          .addScaledVector(dir, radius / 2)
          .add(new T.Vector3(0, 0, 0.002 * k)),
        metal,
        "metal",
      );
    }
  }
  return pieces;
}
