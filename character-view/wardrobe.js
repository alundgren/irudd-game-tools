import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { sweepGeometry } from "./surface.js";

export const outfitRoles = [
  "torso",
  "pelvis",
  "upper arm",
  "forearm",
  "hand",
  "thigh",
  "shin",
  "foot",
  "head",
  "skirt",
  "accessory",
  "tail",
];
const dyes = {
  Tide: ["#536c60", "#c0824b", "#bdc8b6"],
  Ochre: ["#a88b58", "#49635c", "#d3c8a8"],
  Clay: ["#955b4c", "#d5a861", "#d0bba6"],
  Polar: ["#718f99", "#c88e54", "#c6d6d1"],
};
export function fitWardrobe(part, form) {
  if (form.outfit === "Work clothes" || !part.outfitRole) return null;
  const role = part.outfitRole,
    suit = form.outfit === "Pressure suit";
  const [cloth, trim, panel] = dyes[form.appearance.palette];
  const dyesForForm = {
    cloth: form.appearance.tones?.cloth ?? cloth,
    trim: form.appearance.tones?.trim ?? trim,
    panel: form.appearance.tones?.panel ?? panel,
  };
  const preserve =
    role === "head" || role === "tail" || (!suit && role === "hand");
  const bare = !suit && ["forearm", "shin"].includes(role);
  const hide = role === "skirt" || role === "accessory";
  const color = bare
    ? form.appearance.skin
    : role === "foot" || role === "hand"
      ? "#384341"
      : suit
        ? dyesForForm.cloth
        : ["thigh", "upper arm", "torso"].includes(role)
          ? "#364b48"
          : "#535c58";
  const amount = preserve
    ? 1
    : suit
      ? ({
          torso: 1.16,
          "upper arm": 1.22,
          forearm: 1.23,
          hand: 1.18,
          thigh: 1.16,
          shin: 1.23,
          foot: 1.14,
        }[role] ?? 1.1)
      : ({
          torso: 0.9,
          "upper arm": 0.85,
          forearm: 0.85,
          shin: 0.84,
          thigh: 0.89,
          foot: 0.88,
        }[role] ?? 1);
  const knots = part.knots?.map((row) => [
    ...row.slice(0, 3),
    row[3] * amount,
    row[4] * amount,
  ]);
  return {
    role,
    suit,
    preserve,
    bare,
    hide,
    color,
    knots,
    amount,
    ...dyesForForm,
  };
}

// Hard goods are positioned against the fitted region's local bounds, so
// turning a shoulder or moving a creature's thorax carries its kit too.
export function addEquipment(mesh, fit, material) {
  if (!fit.suit || fit.hide || fit.role === "tail") return;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox,
    extent = box.getSize(new T.Vector3()),
    c = box.getCenter(new T.Vector3());
  const [w, h, d] = extent.toArray();
  const at = (x, y, z) => [c.x + w * x, box.min.y + h * y, c.z + d * z];
  const rubber = "#34413e";
  function piece(geo, color, pos, surface = "canvas") {
    const obj = new T.Mesh(geo, material(color, surface));
    obj.position.fromArray(pos);
    obj.castShadow = true;
    mesh.add(obj);
    return obj;
  }
  function rounded(x, y, z, sx, sy, sz, color, type) {
    const dim = [w * sx, h * sy, d * sz],
      radius = Math.min(...dim) * 0.43;
    return piece(
      new RoundedBoxGeometry(...dim, 2, radius),
      color,
      at(x, y, z),
      type,
    );
  }
  function loop(y, height, ww, dd, color) {
    const a = at(0, y, 0),
      b = at(0, y + height, 0);
    const object = piece(
      sweepGeometry(
        [
          [0, 0, 0, w * ww, d * dd],
          [0, b[1] - a[1], 0, w * ww, d * dd],
        ],
        true,
      ),
      color,
      a,
      "leather",
    );
    return object;
  }
  if (fit.role === "torso") {
    rounded(0, 0.51, -0.45, 0.85, 0.66, 0.38, rubber, "leather");
    rounded(0, 0.54, -0.64, 0.68, 0.5, 0.12, fit.panel, "metal");
    for (const s of [-1, 1]) {
      rounded(s * 0.34, 0.52, -0.58, 0.16, 0.62, 0.22, fit.trim, "metal");
      rounded(s * 0.24, 0.73, 0.38, 0.12, 0.32, 0.09, rubber, "leather");
    }
    loop(0.81, 0.035, 0.35, 0.42, rubber);
  } else if (fit.role === "head") {
    loop(0.14, 0.05, 0.46, 0.47, rubber);
    for (const s of [-1, 1])
      rounded(s * 0.46, 0.51, -0.015, 0.13, 0.31, 0.38, fit.panel, "metal");
    rounded(0, 0.54, -0.4, 0.67, 0.41, 0.14, fit.panel, "metal");
  }
}
