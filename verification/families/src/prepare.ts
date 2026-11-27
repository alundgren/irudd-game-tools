import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { bundledAssetNamed, bundledEntry } from "@irudd/character";
import { join } from "node:path";
import * as T from "three";
import {
  canonicalJson,
  createRegistry,
  decodeWith,
  documentJson,
  generateParts,
  PartId,
  familyFeatures,
  isJsonObject,
  motionRoles,
  outfitRoles,
  readDocument,
  type CharacterDocument,
  type Json,
  type JsonObject,
  mantleCuts,
  type MotionRoleName,
  occluderOrder,
} from "@irudd/document";
import { referenceBlobsDir, examplesDir, fixturesDir, g0Dir } from "./paths.js";
import {
  evaluateHuman,
  HumanAdultParams,
  humanAdultGenerator,
  humanAdultId,
  humanAdultVersion,
  humanMeasurements,
  humanSlot,
  isHumanAxis,
  regionName,
  surfaceRegions,
  type HumanBody,
} from "@irudd/character/human";
import { loadHumanBody } from "./human-assets.js";
import { creatureLimbChains, creatureOrgan } from "./creature-names.js";

let humanBody: HumanBody | undefined;
const loadedBody = (): HumanBody => {
  if (!humanBody)
    throw new Error("Preparing an adult needs the body pack: await preparePacks() first.");
  return humanBody;
};
export async function preparePacks(): Promise<void> {
  humanBody ??= await loadHumanBody();
}

export const familyRegistry = createRegistry({
  features: familyFeatures,
  generators: [humanAdultGenerator(loadedBody)],
});

type Legacy = Record<string, unknown>;

function isRecord(value: unknown): value is Legacy {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} is not a string.`);
  return value;
}

function nums(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "number"))
    throw new Error(`${what} is not a list of numbers.`);
  return value.filter((v) => typeof v === "number");
}

function asJson(value: unknown, what: string): Json {
  const text = JSON.stringify(value);
  const parsed: unknown = JSON.parse(text);
  const check = (v: unknown): v is Json =>
    v === null ||
    ["string", "number", "boolean"].includes(typeof v) ||
    (Array.isArray(v) && v.every(check)) ||
    (isRecord(v) && Object.values(v).every(check));
  if (!check(parsed)) throw new Error(`${what} is not JSON.`);
  return parsed;
}

function asObject(value: Legacy, what: string): JsonObject {
  const json = asJson(value, what);
  if (!isJsonObject(json)) throw new Error(`${what} is not an object.`);
  return json;
}

function inferRole(p: Legacy): string {
  const id = str(p["id"], "part id").toLowerCase();
  const shape = str(p["shape"], "part shape");
  const motion = p["motionRole"];
  const knots = p["knots"];
  if (motion === "axial spine" && !(Array.isArray(knots) && knots.length)) return "rigid";
  if (typeof motion === "string") return motion;
  if (/wing/.test(id) && (!/(rib|spar|plate|fin)/.test(id) || /leading.spar/.test(id)))
    return "wing";
  if (typeof p["outfitRole"] === "string") return p["outfitRole"];
  if (/skirt fold|velvet dress/.test(id)) return "skirt";
  if (shape === "head" || p["anatomy"] === "face" || /(?:^|[- ])head(?:$|[- ])/.test(id))
    return "head";
  if (shape === "torso" || id === "spine" || id === "torso") return "torso";
  if (
    shape.endsWith(" leg") ||
    /^(left|right)[- ](foreleg|hindleg|leg)$/.test(id) ||
    /walking leg|load bearing leg/.test(id)
  )
    return "thigh";
  if (shape.endsWith(" arm") || /bent arm|power arm/.test(id)) return "upper arm";
  if (/tail/.test(id)) return "tail";
  if (/foot|feet/.test(id)) return "foot";
  return "rigid";
}

function movementRoles(parts: ReadonlyArray<Legacy>): Map<string, string> {
  const id = (p: Legacy) => str(p["id"], "part id");
  const roles = new Map(parts.map((p) => [id(p), inferRole(p)]));
  for (const part of parts) {
    const parent = part["parent"];
    if (
      part["motionRole"] === undefined &&
      roles.get(id(part)) === "rigid" &&
      typeof parent === "string" &&
      roles.get(parent) === "hand" &&
      /finger|thumb|claw|talon|digit/i.test(id(part))
    )
      roles.set(id(part), "hand");
  }
  for (const base of parts) {
    const role = roles.get(id(base));
    if (base["motionRole"] !== undefined || (role !== "upper arm" && role !== "rigid")) continue;
    const wingParts = parts.filter((p) => p["parent"] === id(base) && /wing/i.test(id(p)));
    if (wingParts.length < 2 || !wingParts.some((p) => /spar|rib/i.test(id(p)))) continue;
    roles.set(id(base), "wing");
    for (const child of wingParts)
      if (child["motionRole"] === undefined) roles.set(id(child), "rigid");
  }
  return roles;
}

const isMotionRole = (role: string): role is MotionRoleName => motionRoles.some((r) => r === role);
const isOutfitRole = (role: string) => outfitRoles.some((r) => r === role);

const handledPartFields = new Set([
  "id",
  "shape",
  "parent",
  "position",
  "size",
  "rotation",
  "color",
  "knots",
  "frameSize",
  "mount",
  "surface",
  "motionRole",
  "outfitRole",
  "visibleIn",
  "blendSkin",
  "markings",
  "cage",
  "paint",
  "hull",
  "grip",
  "surfaceJoin",
  "anatomy",
  "wearFit",
  "cut",
  "groom",
  "bare",
  "look",
  "sculpt",
  "cranialProfile",
  "frontFits",
  "profileFit",
  "headLayer",
  "rigidFaceAnchor",
  "faceClearance",
  "eyesRig",
  "fibres",
  "hairCap",
  "sourceHairOnly",
  "plateGrowth",
  "plateGrowthRest",
  "plateSite",
  "hornSwatch",
  "holdArmPose",
  "undercoat",
  "coatZone",
  "eyeSurface",
  "wing",
  "seamGroup",
  "pulls",
  "footSection",
]);
const handledFormFields = new Set([
  "outfit",
  "appearance",
  "parts",
  "skinTint",
  "skinSurface",
  "skinSoftness",
  "poses",
  "origin",
  "build",
  "artwork",
  "occluders",
  "layerStyles",
  "outfitSets",
]);
const adultFormFields = new Set([
  "human",
  "humanStyle",
  "posture",
  "eyeColor",
  "complexion",
  "faceMarks",
]);
const adultPartFields = new Set(["humanBone", "humanBounds", "scapulaMount", "nativePortrait"]);
const paintFields = new Set([
  "atlas",
  "region",
  "height",
  "offset",
  "rest",
  "profile",
  "frame",
  "portrait",
]);
const hullFields = new Set([
  "atlas",
  "height",
  "rows",
  "pivot",
  "frames",
  "resolution",
  "membrane",
  "mirrored",
]);
const coreShapes = new Set(["ellipsoid", "box", "cylinder", "cone"]);
const figureShapes = new Map([
  ["sweep", "capsule"],
  ["scute", "box"],
  ["cage", "box"],
  ["volume", "box"],
  ["hand", "box"],
  ["mantle", "box"],
  ["wing", "box"],
]);

const paintedRoles = new Set(["head", "hand", "foot", "thigh", "shin", "upper arm", "forearm"]);

export function partId(legacy: string, used: Set<string>): string {
  const slug =
    legacy
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "part";
  let id = "p-" + slug;
  for (let n = 2; used.has(id); n++) id = `p-${slug}-${n}`;
  used.add(id);
  return id;
}

export function quaternionFromDegrees(rotation: ReadonlyArray<number>): number[] {
  const [x = 0, y = 0, z = 0] = rotation.map(T.MathUtils.degToRad);
  const q = new T.Quaternion().setFromEuler(new T.Euler(x, y, z));
  return q.w < 0 ? [-q.x, -q.y, -q.z, -q.w] : [q.x, q.y, q.z, q.w];
}

export interface Prepared {
  readonly document: CharacterDocument;
  readonly blobs: ReadonlyMap<string, Uint8Array>;
}

function resolveAtlas(
  id: string,
  artwork: Legacy,
  out: { assets: Map<string, JsonObject>; blobs: Map<string, Uint8Array> },
): string | undefined {
  const bundled = bundledAssetNamed(id);
  if (bundled?.use === "turnaround") {
    const entry = bundledEntry(bundled);
    out.assets.set(entry.digest, { ...entry });
    return entry.digest;
  }
  const match = /^art-([0-9a-f]{64})$/.exec(id);
  const url = artwork[id];
  if (!match || typeof url !== "string" || !url.startsWith("data:image/webp;base64,"))
    return undefined;
  const bytes = new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  const hex = createHash("sha256").update(bytes).digest("hex");
  if (hex !== match[1]) return undefined;
  const digest = "sha256:" + hex;
  out.assets.set(digest, {
    digest,
    mediaType: "image/webp",
    byteLength: bytes.length,
    role: "paint-atlas",
  });
  out.blobs.set(digest, bytes);
  return digest;
}

function resolvePlate(
  id: unknown,
  kind: "face" | "side" | "nativeportrait",
  artwork: Legacy,
  out: { assets: Map<string, JsonObject>; blobs: Map<string, Uint8Array> },
): string | undefined {
  if (typeof id !== "string") return undefined;
  const match = new RegExp(`^${kind}-([0-9a-f]{64})$`).exec(id);
  const url = artwork[id];
  if (!match || typeof url !== "string" || !url.startsWith("data:image/webp;base64,"))
    return undefined;
  const bytes = new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  const hex = createHash("sha256").update(bytes).digest("hex");
  if (hex !== match[1]) return undefined;
  const digest = "sha256:" + hex;
  out.assets.set(digest, {
    digest,
    mediaType: "image/webp",
    byteLength: bytes.length,
    role: "portrait-plate",
  });
  out.blobs.set(digest, bytes);
  return digest;
}

function binding(paint: Legacy, what: string): Record<string, Json> {
  const out: Record<string, Json> = {
    height: asJson(paint["height"], what + " height"),
    offset: nums(paint["offset"], what + " offset"),
    rest: asJson(paint["rest"], what + " rest"),
  };
  if (paint["region"] !== undefined) out["region"] = str(paint["region"], what + " region");
  if (paint["profile"] !== undefined) out["profile"] = asJson(paint["profile"], what + " profile");
  if (paint["frame"] !== undefined) out["frame"] = str(paint["frame"], what + " frame");
  if (paint["portrait"] !== undefined)
    out["portrait"] = asJson(paint["portrait"], what + " portrait");
  return out;
}

const jointedRoles = new Set(["upper arm", "forearm"]);

function sectionRoleMismatches(
  parts: ReadonlyArray<Legacy>,
  roles: ReadonlyMap<string, string>,
): string[] {
  const byId = new Map(parts.map((p) => [str(p["id"], "part id"), p]));
  const legacyRole = (p: Legacy | undefined) => {
    const v = p?.["motionRole"] ?? p?.["outfitRole"];
    return typeof v === "string" ? v : undefined;
  };
  const storedRole = (p: Legacy | undefined) => {
    if (!p) return undefined;
    const role = roles.get(str(p["id"], "part id"));
    if (role !== undefined && isMotionRole(role)) return role;
    const outfit = p["outfitRole"];
    return typeof outfit === "string" ? outfit : undefined;
  };
  const retains = (
    p: Legacy,
    role: (q: Legacy | undefined) => string | undefined,
    stored: boolean,
  ) => {
    if (p["shape"] !== "sweep" || p["blendSkin"]) return false;
    const parent = typeof p["parent"] === "string" ? byId.get(p["parent"]) : undefined;
    const rigid = stored ? role(p) === "rigid" : p["motionRole"] === "rigid";
    return jointedRoles.has(role(p) ?? "") || (rigid && jointedRoles.has(role(parent) ?? ""));
  };
  return parts
    .filter((p) => retains(p, legacyRole, false) !== retains(p, storedRole, true))
    .map((p) => `parts[${str(p["id"], "part id")}] game sections by inferred role`);
}

export function prepareForm(name: string, raw: unknown): Prepared {
  const envelope = isRecord(raw) && raw["format"] === "irudd.form.v1";
  const form = envelope && isRecord(raw) ? raw["form"] : raw;
  if (!isRecord(form)) throw new Error(`${name} has no form.`);
  const unsupported: string[] = [];
  const adult = isRecord(form["origin"]) && form["origin"]["kind"] === "human surface";
  for (const key of Object.keys(form))
    if (!handledFormFields.has(key) && !(adult && adultFormFields.has(key)))
      unsupported.push(`form.${key}`);
  const legacyOrigin = form["origin"];
  if (isRecord(legacyOrigin)) {
    for (const key of Object.keys(legacyOrigin))
      if (!["generator", "kind", "seed", "figure", "plan"].includes(key))
        unsupported.push(`form.origin.${key}`);
    if ((legacyOrigin["kind"] === "creature plan") !== isRecord(legacyOrigin["plan"]))
      unsupported.push("form.origin.plan without a creature plan origin");
  }
  const legacyParts = Array.isArray(form["parts"]) ? form["parts"].filter(isRecord) : [];
  const roles = movementRoles(legacyParts);
  const taken = new Set<string>();
  const ids = new Map(
    legacyParts.map((p) => [str(p["id"], "part id"), partId(str(p["id"], "part id"), taken)]),
  );
  const plan =
    isRecord(legacyOrigin) && isRecord(legacyOrigin["plan"]) ? legacyOrigin["plan"] : undefined;
  if (plan?.["dress"] !== undefined) unsupported.push("form.origin.plan.dress");
  const chains = plan
    ? creatureLimbChains(
        legacyParts.map((p) => str(p["id"], "part id")),
        (Array.isArray(plan["limbs"]) ? plan["limbs"] : []).filter(isRecord).map((l) => ({
          kind: str(l["kind"], "plan limb kind"),
          side: str(l["side"], "plan limb side"),
          pairs: typeof l["pairs"] === "number" ? l["pairs"] : 0,
        })),
        ids,
        roles,
      )
    : new Map<string, Record<string, Json>>();
  if (plan)
    for (const p of legacyParts) {
      const legacyId = str(p["id"], "part id");
      const authored = typeof p["motionRole"] === "string" ? p["motionRole"] : undefined;
      const inferred = roles.get(legacyId);
      if (authored !== inferred && [authored, inferred].some((r) => r && paintedRoles.has(r)))
        unsupported.push(`parts[${legacyId}] inferred role ${String(inferred)} for a plan painter`);
      if (p["surface"] === undefined) unsupported.push(`parts[${legacyId}] without a surface`);
    }
  const artwork = isRecord(form["artwork"]) ? form["artwork"] : {};
  const store = { assets: new Map<string, JsonObject>(), blobs: new Map<string, Uint8Array>() };
  for (const p of legacyParts) {
    const legacyId = str(p["id"], "part id");
    for (const key of Object.keys(p))
      if (!handledPartFields.has(key) && !(adult && adultPartFields.has(key)))
        unsupported.push(`parts[${legacyId}].${key}`);
    const shape = str(p["shape"], "shape");
    if (p["mount"] !== undefined && (shape !== "scute" || !isRecord(p["mount"])))
      unsupported.push(`parts[${legacyId}].mount`);
    if (
      !figureShapes.has(shape) &&
      !coreShapes.has(shape) &&
      !anatomyShapes.has(shape) &&
      !(adult && shape === "human region")
    )
      unsupported.push(`parts[${legacyId}].shape=${shape}`);
    if ((shape === "human region") !== (p["humanBone"] !== undefined))
      unsupported.push(`parts[${legacyId}].humanBone off a region`);
    const carrier = legacyParts.find((q) => q["id"] === p["parent"]);
    if (
      p["scapulaMount"] !== undefined &&
      ((p["scapulaMount"] !== 1 && p["scapulaMount"] !== -1) ||
        carrier?.["humanBone"] !== "spine_03")
    )
      unsupported.push(`parts[${legacyId}].scapulaMount off the chest`);
    if (
      p["nativePortrait"] !== undefined &&
      (p["humanBone"] !== "head" ||
        !resolvePlate(p["nativePortrait"], "nativeportrait", artwork, store))
    )
      unsupported.push(`parts[${legacyId}].nativePortrait unresolved or off the head`);
    if (p["look"] !== undefined && !anatomyShapes.has(shape))
      unsupported.push(`parts[${legacyId}].look on ${shape}`);
    if (p["cranialProfile"] !== undefined && (shape !== "head" || p["cranialProfile"] !== "adult"))
      unsupported.push(`parts[${legacyId}].cranialProfile on ${shape}`);
    if (p["sculpt"] !== undefined && shape !== "head" && p["anatomy"] !== "face")
      unsupported.push(`parts[${legacyId}].sculpt on ${shape}`);
    const passes = p["frontFits"];
    if (Array.isArray(passes))
      for (const pass of passes)
        if (isRecord(pass)) {
          for (const key of Object.keys(pass))
            if (!["pins", "radius", "amount", "view", "overlay"].includes(key))
              unsupported.push(`parts[${legacyId}].frontFits.${key}`);
          if (
            pass["overlay"] !== undefined &&
            !resolvePlate(pass["overlay"], "face", artwork, store)
          )
            unsupported.push(`parts[${legacyId}].frontFits.overlay unresolved`);
        }
    const profile = p["profileFit"];
    if (isRecord(profile)) {
      for (const key of Object.keys(profile))
        if (!["curve", "amount", "stage", "relief", "paint"].includes(key))
          unsupported.push(`parts[${legacyId}].profileFit.${key}`);
      const side = profile["paint"];
      if (side !== undefined) {
        if (isRecord(side))
          for (const key of Object.keys(side))
            if (!["atlas", "facing", "brow", "ear", "chinY"].includes(key))
              unsupported.push(`parts[${legacyId}].profileFit.paint.${key}`);
        if (!isRecord(side) || !resolvePlate(side["atlas"], "side", artwork, store))
          unsupported.push(`parts[${legacyId}].profileFit.paint unresolved`);
      }
    }
    if (p["faceClearance"] !== undefined && p["rigidFaceAnchor"] === undefined)
      unsupported.push(`parts[${legacyId}].faceClearance without a rigid face anchor`);
    if (p["headLayer"] !== undefined && p["headLayer"] !== "hair")
      unsupported.push(`parts[${legacyId}].headLayer=${JSON.stringify(p["headLayer"])}`);
    const role = roles.get(legacyId) ?? "rigid";
    if (!isMotionRole(role) && (!isOutfitRole(role) || role !== p["outfitRole"]))
      unsupported.push(`parts[${legacyId}] role ${role}`);
    const cut = p["cut"];
    if (shape === "mantle" && isRecord(cut) && !mantleCuts.some((k) => k === cut["kind"]))
      unsupported.push(`parts[${legacyId}].cut.kind=${String(cut["kind"])}`);
    if (p["grip"] !== undefined && shape !== "hand")
      unsupported.push(`parts[${legacyId}].grip on ${shape}`);
    const hull = p["hull"];
    if ((shape === "volume") !== isRecord(hull))
      unsupported.push(`parts[${legacyId}] volume without a hull, or a hull on ${shape}`);
    if (isRecord(hull)) {
      for (const key of Object.keys(hull))
        if (!hullFields.has(key)) unsupported.push(`parts[${legacyId}].hull.${key}`);
      if (p["paint"] !== undefined) unsupported.push(`parts[${legacyId}] paint and hull`);
    }
    const paint = p["paint"];
    if (isRecord(paint))
      for (const key of Object.keys(paint))
        if (!paintFields.has(key) && key !== "depthPins" && key !== "depthField")
          unsupported.push(`parts[${legacyId}].paint.${key}`);
    if (p["plateGrowthRest"] !== undefined && p["plateGrowth"] === undefined)
      unsupported.push(`parts[${legacyId}].plateGrowthRest without a plate field`);
    if (p["holdArmPose"] !== undefined && typeof p["holdArmPose"] !== "boolean")
      unsupported.push(`parts[${legacyId}].holdArmPose`);
    if (p["sourceHairOnly"] !== undefined && (p["sourceHairOnly"] !== true || !p["hairCap"]))
      unsupported.push(`parts[${legacyId}].sourceHairOnly without a hair cap`);
    if ((shape === "wing") !== isRecord(p["wing"]))
      unsupported.push(`parts[${legacyId}] wing without a wing surface, or a wing on ${shape}`);
    const eye = p["eyeSurface"];
    if (eye !== undefined && (shape !== "cage" || !isRecord(p["cage"])))
      unsupported.push(`parts[${legacyId}].eyeSurface on ${shape}`);
    for (const key of ["seamGroup", "footSection"])
      if (p[key] !== undefined && shape !== "sweep")
        unsupported.push(`parts[${legacyId}].${key} on ${shape}`);
  }
  unsupported.push(...sectionRoleMismatches(legacyParts, roles));
  const atlasOf = (paint: unknown, what: string): string | undefined => {
    if (!isRecord(paint)) return undefined;
    const atlas = resolveAtlas(str(paint["atlas"], what + " atlas"), artwork, store);
    if (atlas === undefined) unsupported.push(`${what}.atlas ${String(paint["atlas"])}`);
    return atlas;
  };
  const partAtlases = new Map(
    legacyParts.map((p) => [
      str(p["id"], "part id"),
      p["hull"] === undefined
        ? atlasOf(p["paint"], `parts[${String(p["id"])}].paint`)
        : atlasOf(p["hull"], `parts[${String(p["id"])}].hull`),
    ]),
  );
  const legacyOccluders = Array.isArray(form["occluders"])
    ? form["occluders"].filter(isRecord)
    : [];
  const occluders = legacyOccluders.map((o, i) => {
    for (const key of Object.keys(o))
      if (!paintFields.has(key)) unsupported.push(`form.occluders.${key}`);
    return { atlas: atlasOf(o, `form.occluders[${i}]`), source: o };
  });
  for (const id of Object.keys(artwork))
    if (
      !store.assets.has("sha256:" + id.slice(id.indexOf("-") + 1)) &&
      (!id.startsWith("art-") || resolveAtlas(id, artwork, store) === undefined)
    )
      unsupported.push(`form.artwork unused ${id.split("-")[0] ?? ""}`);
  const regions = adult
    ? adultRegions(form, legacyParts, ids, unsupported, (id) =>
        resolvePlate(id, "nativeportrait", artwork, store),
      )
    : undefined;
  if (unsupported.length) throw new UnsupportedForm(name, unsupported);
  const handMade = legacyParts.flatMap((p, order) =>
    p["shape"] === "human region" ? [] : [{ p, order }],
  );
  const parts = handMade.map(({ p, order }): JsonObject => {
    const legacyId = str(p["id"], "part id");
    const shape = str(p["shape"], "shape");
    const features: Record<string, Json> = {};
    const frame = p["frameSize"];
    features["figure.assembly"] = {
      order,
      ...(frame === undefined ? {} : { frameSize: nums(frame, "frameSize") }),
    };
    if (shape === "sweep") features["figure.sweep"] = { knots: asJson(p["knots"], "knots") };
    if (shape === "scute") {
      const m = p["mount"];
      features["figure.scute"] = isRecord(m)
        ? {
            mount: {
              position: nums(m["position"], "mount position"),
              rotation: quaternionFromDegrees(nums(m["rotation"], "mount rotation")),
              size: nums(m["size"], "mount size"),
            },
          }
        : {};
    }
    if (anatomyShapes.has(shape))
      features["figure.piece"] = {
        piece: shape,
        ...(p["look"] === undefined ? {} : { look: asJson(p["look"], `parts[${legacyId}].look`) }),
        ...(p["cranialProfile"] === undefined
          ? {}
          : { cranialProfile: str(p["cranialProfile"], `parts[${legacyId}].cranialProfile`) }),
      };
    if (p["sculpt"] !== undefined)
      features["figure.sculpt"] = { sculpt: asJson(p["sculpt"], `parts[${legacyId}].sculpt`) };
    const fits = p["frontFits"];
    if (Array.isArray(fits) && fits.length)
      features["figure.front-fit"] = {
        passes: fits.map((pass, i): Json => {
          const what = `parts[${legacyId}].frontFits[${i}]`;
          if (!isRecord(pass)) return asJson(pass, what);
          const { overlay, ...rest } = pass;
          const plate =
            overlay === undefined ? undefined : resolvePlate(overlay, "face", artwork, store);
          return { ...asObject(rest, what), ...(plate ? { plate } : {}) };
        }),
      };
    const profileFit = p["profileFit"];
    if (isRecord(profileFit)) {
      const what = `parts[${legacyId}].profileFit`;
      const { paint, ...rest } = profileFit;
      const plate = isRecord(paint)
        ? resolvePlate(paint["atlas"], "side", artwork, store)
        : undefined;
      features["figure.profile-fit"] = {
        ...asObject(rest, what),
        ...(isRecord(paint) && plate
          ? {
              side: {
                plate,
                facing: str(paint["facing"], what + ".paint.facing"),
                brow: nums(paint["brow"], what + ".paint.brow"),
                ear: nums(paint["ear"], what + ".paint.ear"),
                chinY: asJson(paint["chinY"], what + ".paint.chinY"),
              },
            }
          : {}),
      };
    } else if (profileFit !== undefined)
      features["figure.profile-fit"] = asJson(profileFit, `parts[${legacyId}].profileFit`);
    if (p["headLayer"] !== undefined) features["figure.head-layer"] = { layer: "hair" };
    const eyes = p["eyesRig"];
    if (isRecord(eyes))
      features["figure.eyes"] = asJson(
        { ...eyes, color: str(eyes["color"], `parts[${legacyId}].eyesRig.color`).toLowerCase() },
        `parts[${legacyId}].eyesRig`,
      );
    else if (eyes !== undefined) throw new Error(`parts[${legacyId}].eyesRig is not a rig.`);
    if (p["fibres"] !== undefined)
      features["figure.fibres"] = asJson(p["fibres"], `parts[${legacyId}].fibres`);
    if (p["rigidFaceAnchor"] !== undefined)
      features["figure.face-anchor"] = {
        anchor: nums(p["rigidFaceAnchor"], `parts[${legacyId}].rigidFaceAnchor`),
        ...(p["faceClearance"] === undefined
          ? {}
          : { clearance: asJson(p["faceClearance"], `parts[${legacyId}].faceClearance`) }),
      };
    if (shape === "cage") features["figure.cage"] = asJson(p["cage"], "cage");
    if (p["anatomy"] !== undefined)
      features["figure.anatomy"] = { region: str(p["anatomy"], `parts[${legacyId}].anatomy`) };
    if (p["wearFit"] === true) features["outfit.fit"] = {};
    const groom = p["groom"];
    if (isRecord(groom))
      features["figure.groom"] = asJson(
        { ...groom, color: str(groom["color"], `parts[${legacyId}].groom.color`).toLowerCase() },
        `parts[${legacyId}].groom`,
      );
    else if (groom !== undefined) throw new Error(`parts[${legacyId}].groom is not a groom.`);
    if (shape === "mantle")
      features["figure.mantle"] = { cut: asJson(p["cut"], `parts[${legacyId}].cut`) };
    if (p["surfaceJoin"] !== undefined)
      features["figure.join"] = asJson(p["surfaceJoin"], `parts[${legacyId}].surfaceJoin`);
    if (p["seamGroup"] !== undefined)
      features["figure.seam"] = { group: str(p["seamGroup"], `parts[${legacyId}].seamGroup`) };
    const pulls = p["pulls"];
    if (!Array.isArray(pulls) && pulls !== undefined)
      throw new Error(`parts[${legacyId}].pulls is not a list.`);
    if (Array.isArray(pulls) && pulls.length)
      features["figure.pulls"] = { pulls: asJson(pulls, `parts[${legacyId}].pulls`) };
    if (p["footSection"] !== undefined)
      features["figure.foot"] = {
        section: str(p["footSection"], `parts[${legacyId}].footSection`),
      };
    if (shape === "hand")
      features["figure.hand"] = asJson(p["grip"] ?? {}, `parts[${legacyId}].grip`);
    const hull = p["hull"];
    if (isRecord(hull)) {
      const { atlas: _atlas, ...traced } = hull;
      features["figure.hull"] = asJson(traced, `parts[${legacyId}].hull`);
    }
    const markings = p["markings"];
    if (isRecord(markings))
      features["figure.markings"] = {
        kind: str(markings["kind"], "markings kind"),
        color: str(markings["color"], "markings color").toLowerCase(),
        spacing: asJson(markings["spacing"], "markings spacing"),
        coverage: asJson(markings["coverage"], "markings coverage"),
        angle: asJson(markings["angle"], "markings angle"),
        seed: asJson(markings["seed"], "markings seed"),
      };
    if (p["surface"] !== undefined)
      features["figure.finish"] = { surface: str(p["surface"], "surface") };
    const role = roles.get(legacyId) ?? "rigid";
    if (isMotionRole(role)) features["motion.role"] = { role };
    const wear: Record<string, Json> = {};
    if (p["outfitRole"] !== undefined) wear["role"] = str(p["outfitRole"], "outfitRole");
    if (p["visibleIn"] !== undefined) wear["visibleIn"] = asJson(p["visibleIn"], "visibleIn");
    if (p["bare"] === true) wear["bare"] = true;
    else if (p["bare"] !== undefined) throw new Error(`parts[${legacyId}].bare is not true.`);
    if (Object.keys(wear).length) features["outfit.wear"] = wear;
    if (p["blendSkin"] === true) features["creature.blend"] = { blend: true };
    const paint = p["paint"];
    if (isRecord(paint)) features["figure.paint"] = binding(paint, `parts[${legacyId}].paint`);
    if (isRecord(paint) && (paint["depthPins"] !== undefined || paint["depthField"] !== undefined))
      features["figure.portrait-depth"] = {
        ...(paint["depthPins"] === undefined
          ? {}
          : { pins: asJson(paint["depthPins"], `parts[${legacyId}].paint.depthPins`) }),
        ...(paint["depthField"] === undefined
          ? {}
          : { field: asJson(paint["depthField"], `parts[${legacyId}].paint.depthField`) }),
      };
    const cap = p["hairCap"];
    if (isRecord(cap))
      features["figure.hair-cap"] = {
        scalp: "#" + str(cap["scalp"], `parts[${legacyId}].hairCap.scalp`).toLowerCase(),
        mask: str(cap["mask"], `parts[${legacyId}].hairCap.mask`),
        relief: str(cap["relief"], `parts[${legacyId}].hairCap.relief`),
        ...(p["sourceHairOnly"] === true ? { sourceOnly: true } : {}),
      };
    else if (cap !== undefined) throw new Error(`parts[${legacyId}].hairCap is not a cap.`);
    const growth = p["plateGrowth"];
    if (isRecord(growth))
      features["figure.plate-field"] = asJson(
        {
          ...growth,
          color: str(growth["color"], `parts[${legacyId}].plateGrowth.color`).toLowerCase(),
          ...(p["plateGrowthRest"] === undefined ? {} : { rest: p["plateGrowthRest"] }),
        },
        `parts[${legacyId}].plateGrowth`,
      );
    else if (growth !== undefined)
      throw new Error(`parts[${legacyId}].plateGrowth is not a field.`);
    if (p["plateSite"] !== undefined)
      features["figure.plate-site"] = asJson(p["plateSite"], `parts[${legacyId}].plateSite`);
    if (p["hornSwatch"] !== undefined)
      features["figure.horn-swatch"] = {
        swatch: asJson(p["hornSwatch"], `parts[${legacyId}].hornSwatch`),
      };
    if (p["holdArmPose"] === true) features["motion.hold"] = {};
    const blade = p["scapulaMount"];
    if (blade === 1 || blade === -1) features["figure.scapula-mount"] = { side: blade };
    const undercoat = p["undercoat"];
    if (isRecord(undercoat))
      features["figure.undercoat"] = {
        kind: str(undercoat["kind"], "undercoat kind"),
        color: str(undercoat["color"], "undercoat color").toLowerCase(),
        spacing: asJson(undercoat["spacing"], "undercoat spacing"),
        coverage: asJson(undercoat["coverage"], "undercoat coverage"),
        angle: asJson(undercoat["angle"], "undercoat angle"),
        seed: asJson(undercoat["seed"], "undercoat seed"),
      };
    else if (undercoat !== undefined)
      throw new Error(`parts[${legacyId}].undercoat is not a marking.`);
    if (p["coatZone"] !== undefined)
      features["creature.coat-zone"] = { zone: str(p["coatZone"], `parts[${legacyId}].coatZone`) };
    if (p["eyeSurface"] !== undefined)
      features["creature.eye-surface"] = {
        surface: str(p["eyeSurface"], `parts[${legacyId}].eyeSurface`),
      };
    const wing = p["wing"];
    if (isRecord(wing))
      features["figure.wing"] = asJson(
        {
          ...wing,
          ...Object.fromEntries(
            ["dark", "pale", "limb"].map((k) => [
              k,
              str(wing[k], `parts[${legacyId}].wing.${k}`).toLowerCase(),
            ]),
          ),
        },
        `parts[${legacyId}].wing`,
      );
    const organ = plan && creatureOrgan(legacyId);
    if (organ) features["creature.organ"] = organ;
    const chain = chains.get(legacyId);
    if (chain) features["creature.limb-chain"] = chain;
    const atlas = partAtlases.get(legacyId);
    const parent = p["parent"];
    return {
      id: ids.get(legacyId) ?? "",
      label: legacyId,
      parent: typeof parent === "string" ? (ids.get(parent) ?? parent) : null,
      shape: figureShapes.get(shape) ?? (anatomyShapes.has(shape) ? "box" : shape),
      position: nums(p["position"], "position"),
      rotation: quaternionFromDegrees(nums(p["rotation"] ?? [0, 0, 0], "rotation")),
      size: nums(p["size"], "size"),
      color: (p["color"] === undefined && anatomyShapes.has(shape)
        ? pieceSkin(p, form)
        : str(p["color"], "color")
      ).toLowerCase(),
      sculpt: [],
      ...(atlas === undefined ? {} : { paint: { atlas } }),
      features,
    };
  });
  const features: Record<string, Json> = {};
  const build = form["build"];
  if (isRecord(build))
    features["figure.build"] = {
      ...Object.fromEntries(
        Object.entries(build).map(([k, v]): [string, Json] => [k, asJson(v, "build " + k)]),
      ),
      frame: bodyFrameParts(legacyParts).map((p) => ids.get(str(p["id"], "part id")) ?? ""),
    };
  const origin = form["origin"];
  if (isRecord(origin) && !adult) {
    const { plan, ...provenance } = origin;
    features["character.origin"] = asJson(provenance, "origin");
    if (isRecord(plan)) features["creature.plan"] = asJson(plan, "origin.plan");
  }
  if (occluders.length)
    features["figure.occluders"] = {
      sources: occluders
        .map(({ atlas, source }) => ({
          order: {
            atlas: atlas ?? "",
            region: typeof source["region"] === "string" ? source["region"] : "",
          },
          json: { atlas: atlas ?? "", ...binding(source, "occluder") },
        }))
        .sort((x, y) => occluderOrder(x.order, y.order))
        .map((x) => x.json),
    };
  const garmentLayers = (value: unknown, what: string): Json => {
    if (!isRecord(value)) throw new Error(`${what} is not a set of garment styles.`);
    return Object.fromEntries(
      Object.entries(value).map(([legacy, style]): [string, Json] => {
        const id = ids.get(legacy);
        if (!id) throw new Error(`${what} styles a part ${legacy} the form lacks.`);
        return [id, asJson(style, `${what}[${legacy}]`)];
      }),
    );
  };
  const layerStyles = form["layerStyles"];
  if (isRecord(layerStyles) && Object.keys(layerStyles).length)
    features["outfit.layers"] = { layers: garmentLayers(layerStyles, "layerStyles") };
  const outfitSets = form["outfitSets"];
  if (Array.isArray(outfitSets))
    features["outfit.looks"] = {
      looks: outfitSets.map((set, i): Json => {
        if (!isRecord(set)) throw new Error(`outfitSets[${i}] is not an outfit.`);
        const { layers, ...rest } = set;
        return {
          ...Object.fromEntries(
            Object.entries(rest).map(([k, v]): [string, Json] => [
              k,
              asJson(v, `outfitSets[${i}].${k}`),
            ]),
          ),
          layers: garmentLayers(layers, `outfitSets[${i}].layers`),
        };
      }),
    };
  if (form["outfit"] !== undefined && !adult)
    features["outfit.wardrobe"] = { outfit: str(form["outfit"], "outfit") };
  if (form["appearance"] !== undefined && !adult)
    features["character.appearance"] = asJson(form["appearance"], "appearance");
  const skin: Record<string, Json> = {};
  if (form["skinTint"] !== undefined)
    skin["tint"] = str(form["skinTint"], "skinTint").toLowerCase();
  if (form["skinSurface"] !== undefined) skin["surface"] = str(form["skinSurface"], "skinSurface");
  if (form["skinSoftness"] !== undefined)
    skin["softness"] = asJson(form["skinSoftness"], "skinSoftness");
  if (Object.keys(skin).length) features["creature.skin"] = skin;
  const poses = form["poses"];
  if (Array.isArray(poses) && poses.length)
    features["motion.poses"] = { poses: poses.map((pose) => jointPose(pose, ids)) };
  const tube = ids.get("gear dispatch tube");
  const tubeCarrier = legacyParts.find((p) => p["id"] === "gear dispatch tube")?.["parent"];
  if (
    tube &&
    typeof tubeCarrier === "string" &&
    tubeCarrier.endsWith(" hand") &&
    Array.isArray(poses) &&
    poses.some(
      (p) =>
        isRecord(p) &&
        p["name"] === "Present dispatch" &&
        Array.isArray(p["joints"]) &&
        p["joints"].length > 0,
    )
  )
    features["motion.offer"] = { pose: "Present dispatch", held: tube };
  const used = new Set<string>(["core.parts", ...Object.keys(features)]);
  if (store.assets.size) used.add("core.paint");
  if (regions) used.add("core.generation");
  for (const part of [...(regions?.parts ?? []), ...parts]) {
    const payloads = part["features"];
    if (payloads && typeof payloads === "object" && !Array.isArray(payloads))
      for (const key of Object.keys(payloads)) used.add(key);
  }
  const requires = [...used].sort().map((feature) => ({
    feature,
    version: familyRegistry.features.get(feature)?.version ?? 1,
  }));
  const draft = {
    format: "irudd.character",
    version: 1,
    id: "doc-" + name,
    label: name,
    requires,
    catalog: [],
    assets: [...store.assets.values()],
    parts: [...(regions?.parts ?? []), ...parts],
    poses: [],
    ...(regions ? { generation: regions.generation } : {}),
    features,
    extensions: {},
  };
  const read = readDocument(draft, { registry: familyRegistry });
  if (!read.ok) throw new Error(`${name}: ${JSON.stringify(read.diagnostics.slice(0, 8))}`);
  return { document: read.value, blobs: store.blobs };
}

const anatomyShapes = new Set(["head", "torso", "left arm", "right arm", "left leg", "right leg"]);

const adultAppearance = (skin: unknown) => ({
  palette: "Clay",
  skin,
  face: 0,
  hairColor: "#45352e",
  hair: "Crop",
});

const regionRole = (bone: string): string =>
  ({
    upperarm: "upper arm",
    lowerarm: "forearm",
    hand: "hand",
    thigh: "thigh",
    calf: "shin",
    foot: "foot",
    head: "head",
    spine_03: "torso",
  })[bone.replace(/_[lr]$/, "")] ?? "rigid";

function adultRegions(
  form: Legacy,
  legacyParts: ReadonlyArray<Legacy>,
  ids: ReadonlyMap<string, string>,
  unsupported: string[],
  portraitLayer: (id: unknown) => string | undefined,
): { parts: JsonObject[]; generation: Json } | undefined {
  const origin = isRecord(form["origin"]) ? form["origin"] : {};
  const appearance = isRecord(form["appearance"]) ? form["appearance"] : {};
  const human = isRecord(form["human"]) ? form["human"] : {};
  for (const axis of Object.keys(human))
    if (!isHumanAxis(axis)) unsupported.push(`form.human.${axis}`);
  if (JSON.stringify(appearance) !== JSON.stringify(adultAppearance(appearance["skin"])))
    unsupported.push("form.appearance beyond the adult's skin");
  const outfit = form["outfit"];
  const raw = {
    seed: origin["seed"],
    human,
    ...(form["posture"] === undefined ? {} : { posture: form["posture"] }),
    skin: appearance["skin"],
    style: form["humanStyle"] ?? {},
    ...(outfit === "Anatomy" ? {} : { outfit }),
    ...(form["eyeColor"] === undefined ? {} : { eyeColor: form["eyeColor"] }),
    ...(form["complexion"] === undefined ? {} : { complexion: form["complexion"] }),
    ...(form["faceMarks"] === undefined ? {} : { faceMarks: form["faceMarks"] }),
  };
  const params = decodeWith(HumanAdultParams, raw, ["form"]);
  if (!params.ok) {
    unsupported.push(...params.diagnostics.map((d) => `form adult parameters: ${d.message}`));
    return undefined;
  }
  const evaluated = new Map(
    surfaceRegions(evaluateHuman(loadedBody(), humanMeasurements(params.value))).map((r) => [
      String(r.bone),
      r,
    ]),
  );
  const legacyOf = new Map<string, Legacy>();
  for (const p of legacyParts) {
    if (p["shape"] !== "human region") continue;
    const legacyId = str(p["id"], "part id");
    const region = evaluated.get(str(p["humanBone"], `parts[${legacyId}].humanBone`));
    if (!region) {
      unsupported.push(`parts[${legacyId}].humanBone ${String(p["humanBone"])}`);
      continue;
    }
    if (legacyId !== regionName(region.bone)) unsupported.push(`parts[${legacyId}] renamed region`);
    const parent = region.parent === null ? undefined : regionName(region.parent);
    if (p["parent"] !== parent) unsupported.push(`parts[${legacyId}] re-parented region`);
    if (p["motionRole"] !== regionRole(region.bone))
      unsupported.push(`parts[${legacyId}] region role`);
    legacyOf.set(humanSlot(region.bone), p);
  }
  if (legacyOf.size !== evaluated.size) unsupported.push("form drops a region of the adult");
  if (unsupported.length) return undefined;
  const generated = generateParts(
    familyRegistry,
    { generator: humanAdultId, version: humanAdultVersion, params: params.value },
    (slot) => {
      const p = legacyOf.get(slot);
      const id = p && ids.get(str(p["id"], "part id"));
      if (!id) throw new Error(`The adult generator made a slot ${slot} the form lacks.`);
      const checked = decodeWith(PartId, id, ["parts"]);
      if (!checked.ok) throw new Error(`${id} is not a part ID.`);
      return checked.value;
    },
  );
  if (!generated.ok) {
    unsupported.push(...generated.diagnostics.map((d) => `form adult regions: ${d.message}`));
    return undefined;
  }
  const parts = generated.value.parts.map((part): JsonObject => {
    const p = legacyOf.get(part.slot ?? "");
    if (!p) throw new Error(`The adult generator made a slot ${part.slot ?? ""} the form lacks.`);
    const layer =
      p["nativePortrait"] === undefined ? undefined : portraitLayer(p["nativePortrait"]);
    return {
      ...asObject({ ...part }, `slot ${part.slot ?? ""}`),
      ...(layer ? { features: { "figure.native-portrait": { layer } } } : {}),
      position: nums(p["position"], "position"),
      rotation: quaternionFromDegrees(nums(p["rotation"] ?? [0, 0, 0], "rotation")),
      size: nums(p["size"], "size"),
      color: str(p["color"], "color").toLowerCase(),
    };
  });
  return { parts, generation: asJson(generated.value.generation, "generation") };
}

function pieceSkin(part: Legacy, form: Legacy): string {
  const look = isRecord(part["look"]) ? part["look"] : form["appearance"];
  if (!isRecord(look))
    throw new Error(`parts[${String(part["id"])}] is a built-in piece without an appearance.`);
  return str(look["skin"], "piece skin");
}

function bodyFrameParts(parts: ReadonlyArray<Legacy>): Legacy[] {
  const candidates = parts.filter(
    (p) =>
      !p["wearFit"] &&
      !p["sourceHairOnly"] &&
      !p["headLayer"] &&
      !p["visibleIn"] &&
      p["shape"] !== "mantle" &&
      p["outfitRole"] !== "skirt" &&
      p["outfitRole"] !== "accessory",
  );
  const primary = candidates.filter(
    (p) =>
      anatomyShapes.has(str(p["shape"], "shape")) ||
      p["anatomy"] === "face" ||
      Boolean(p["outfitRole"]) ||
      p["motionRole"] === "torso" ||
      p["motionRole"] === "axial spine",
  );
  const carriers = primary.length ? primary : candidates.filter((p) => !p["parent"]);
  return carriers.length ? carriers : parts.filter((p) => !p["parent"]);
}

function jointPose(pose: unknown, ids: ReadonlyMap<string, string>): Json {
  if (!isRecord(pose) || !Array.isArray(pose["joints"])) throw new Error("A pose has no joints.");
  return {
    name: str(pose["name"], "pose name"),
    joints: pose["joints"].map((j): Json => {
      if (!isRecord(j)) throw new Error("A pose joint is not an object.");
      const legacy = str(j["part"], "pose joint part");
      const part = legacy === "" ? null : ids.get(legacy);
      if (part === undefined) throw new Error(`A pose moves the missing part ${legacy}.`);
      return {
        part,
        station: asJson(j["station"], "station"),
        ...(j["digit"] === undefined ? {} : { digit: str(j["digit"], "digit") }),
        ...(j["turn"] === undefined ? {} : { turn: nums(j["turn"], "turn") }),
        ...(j["shift"] === undefined ? {} : { shift: nums(j["shift"], "shift") }),
      };
    }),
  };
}

export class UnsupportedForm extends Error {
  readonly fields: ReadonlyArray<string>;
  constructor(name: string, fields: ReadonlyArray<string>) {
    super(`${name} uses fields without a ported family: ${[...new Set(fields)].join(", ")}`);
    this.fields = fields;
  }
}

export function fixtureText(document: CharacterDocument): string {
  const canonical: unknown = JSON.parse(canonicalJson(documentJson(document)));
  return JSON.stringify(canonical, null, 2) + "\n";
}

export function legacyForm(name: string): unknown {
  const file = [
    join(g0Dir, "wrapped", name + ".form.json"),
    join(examplesDir, name + ".form.json"),
    join(g0Dir, "seeded", name + ".form.json"),
  ].find((f) => existsSync(f));
  if (!file) throw new Error(`No source form for ${name}.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

if (import.meta.main) {
  await preparePacks();
  for (const name of process.argv.slice(2)) {
    const { document, blobs } = prepareForm(name, legacyForm(name));
    const file = join(fixturesDir, name + ".json");
    writeFileSync(file, fixtureText(document));
    mkdirSync(referenceBlobsDir, { recursive: true });
    for (const [digest, bytes] of blobs)
      writeFileSync(join(referenceBlobsDir, digest.replace(":", "-")), bytes);
    console.log(`Prepared ${file}${blobs.size ? ` and ${blobs.size} project blob(s)` : ""}`);
  }
}
