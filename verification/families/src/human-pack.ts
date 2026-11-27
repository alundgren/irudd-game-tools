import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import {
  capturedAxes,
  castBodySkin,
  castFromSlug,
  castSlug,
  castFigureNames,
  castFigures,
  castPieceCodes,
  castPieces,
  castPoseNames,
  castReceivers,
  castSurfaceSide,
  castSurfaceSubjects,
  castVariantKey,
  isCastFigureName,
  humanBodySpec,
  humanCastSpec,
  humanCapturedSpec,
  castSkinNames,
  humanFaceSpec,
  humanGroomSpec,
  humanPaintSpec,
  buzzSize,
  sweptScalpSize,
  paintImageNames,
  paintMediaType,
  sculptAxes,
  writePack,
  type PackKind,
} from "@irudd/character/human";
import { isRecord } from "./glb.js";
import { repository } from "./paths.js";

const source = join(repository, "character-view");
const out = join(repository, "packages", "character", "assets", "human");

type Raw = Readonly<Record<string, unknown>>;
const record = (v: unknown, what: string): Raw => {
  if (!isRecord(v)) throw new Error(`${what} is not an object.`);
  return v;
};
const json = (file: string): Raw =>
  record(JSON.parse(readFileSync(join(source, file), "utf8")), file);

const kinds: Record<PackKind, (b: Buffer) => ArrayBufferView> = {
  u8: (b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  u16: (b) => new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  u32: (b) => new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  i16: (b) => new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  i32: (b) => new Int32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  f32: (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  f64: (b) => new Float64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
};
const packed = (text: unknown, what: string): Buffer => {
  if (typeof text !== "string") throw new Error(`${what} is not a packed string.`);
  return inflateSync(Buffer.from(text, "base64"));
};
const isNumber = (x: unknown): x is number => typeof x === "number";
const numbers = (v: unknown, what: string): number[] => {
  if (!Array.isArray(v)) throw new Error(`${what} is not numbers.`);
  const out: number[] = v.filter(isNumber);
  if (out.length !== v.length) throw new Error(`${what} is not numbers.`);
  return out;
};
const ints = (v: unknown, what: string): number[] => {
  const out = numbers(v, what);
  if (!out.every((x) => Number.isInteger(x))) throw new Error(`${what} is not integers.`);
  return out;
};
const sculptNames: ReadonlyArray<string> = sculptAxes;
const capturedNames: ReadonlyArray<string> = capturedAxes;

const data = json("human-data.json");
const meta = record(data["meta"], "meta");
const packets: Raw[] = [
  record(data["packet"], "human-data packet"),
  record(json("human-identity-data.json")["packet"], "identity packet"),
  record(json("human-portrait-bases.json")["packet"], "portrait packet"),
  record(json("human-cast-shapes-data.json")["packet"], "cast packet"),
];
const sculpt = record(json("human-face-sculpt-data.json")["controls"], "face sculpt controls");
const patches = meta["patches"];
if (!Array.isArray(patches) || patches.length !== 1)
  throw new Error("Expected one smoothing patch.");
const patch = record(patches[0], "patch");
const matrix = patch["matrix"];
if (!Array.isArray(matrix)) throw new Error("patch matrix");
const eyes = meta["eyeGroups"];
if (!Array.isArray(eyes) || eyes.length !== 2) throw new Error("Expected two eye groups.");

const body: { name: string; kind: PackKind; data: ArrayBufferView }[] = [];
for (const [name, spec] of Object.entries(humanBodySpec)) {
  let view: ArrayBufferView;
  if (name.startsWith("sculpt:")) view = Int32Array.from(ints(sculpt[name.slice(7)], name));
  else if (name === "patch.inner") view = Uint16Array.from(ints(patch["inner"], name));
  else if (name === "patch.ring") view = Uint16Array.from(ints(patch["ring"], name));
  else if (name === "patch.matrix")
    view = Float64Array.from(matrix.flatMap((row, i) => numbers(row, `${name}[${i}]`)));
  else if (name === "eyes.left") view = Uint16Array.from(ints(eyes[0], name));
  else if (name === "eyes.right") view = Uint16Array.from(ints(eyes[1], name));
  else {
    const holder = packets.find((p) => Object.hasOwn(p, name));
    if (!holder) throw new Error(`No packed ${name}.`);
    view = kinds[spec.kind](packed(holder[name], name));
  }
  body.push({ name, kind: spec.kind, data: view });
}
const used = new Set(Object.keys(humanBodySpec));
for (const p of packets)
  for (const key of Object.keys(p))
    if (!used.has(key)) throw new Error(`Packed ${key} has no pack entry.`);
for (const axis of Object.keys(sculpt))
  if (!sculptNames.includes(axis)) throw new Error(`Sculpt ${axis}.`);

const captures = json("human-captured-portraits-data.json");
const captured: { name: string; kind: PackKind; data: ArrayBufferView }[] = [];
for (const name of Object.keys(humanCapturedSpec)) {
  const [axis, part] = name.split(".");
  if (!axis || !part || !capturedNames.includes(axis)) throw new Error(name);
  const scan = record(captures[axis], axis);
  const kind = humanCapturedSpec[name]?.kind ?? "u8";
  captured.push({ name, kind, data: kinds[kind](packed(scan[part], name)) });
}

const faceData = json("human-face-data.json"),
  browPaint = json("human-brow-paint.json");
const face: { name: string; kind: PackKind; data: ArrayBufferView }[] = [];
const complexion = json("human-complexion-data.json");
const chartLids = complexion["lids"];
if (!Array.isArray(chartLids) || chartLids.length !== 4)
  throw new Error("Expected four lid lines.");
const chartEntry = (name: string): ArrayBufferView | null => {
  if (name === "chart.rect") return Uint16Array.from(ints(complexion["rect"], name));
  if (name === "chart.mouthPatch")
    return Float64Array.from(numbers(record(complexion["mouth"], "mouth")["patch"], name));
  if (name === "chart.lidLower")
    return Uint8Array.from(
      chartLids.map((l, k) => (record(l, `lid ${k}`)["lower"] === true ? 1 : 0)),
    );
  const lid = /^chart\.lid(\d)$/.exec(name);
  if (lid) return kinds.u16(packed(record(chartLids[Number(lid[1])], name)["points"], name));
  const brow = /^chart\.strokes\.(.+)$/.exec(name);
  if (brow) {
    const card = brow[1] ?? "";
    const paint = record(browPaint[card], card)["strokes"];
    const text = paint ?? record(complexion["brows"], "brows")[card];
    return kinds.u16(packed(text, name));
  }
  return null;
};
for (const [name, spec] of Object.entries(humanFaceSpec)) {
  const charted = chartEntry(name);
  if (charted) {
    face.push({ name, kind: spec.kind, data: charted });
    continue;
  }
  const [card = "", key = ""] = name.split(".");
  const holder = Object.hasOwn(faceData, card)
    ? record(faceData[card], card)
    : record(record(browPaint[card], card)["fibres"], `${card} fibres`);
  const view =
    key === "points"
      ? Uint8Array.from(ints([holder[key]], name))
      : kinds[spec.kind](packed(holder[key], name));
  face.push({ name, kind: spec.kind, data: view });
}
for (const [card, value] of Object.entries(faceData))
  for (const key of Object.keys(record(value, card)))
    if (card !== "eyes" && !Object.hasOwn(humanFaceSpec, `${card}.${key}`))
      throw new Error(`Face ${card}.${key} has no pack entry.`);

const dataUrl = (v: unknown, name: string): Uint8Array => {
  const match = typeof v === "string" ? /^data:([^;]+);base64,(.*)$/s.exec(v) : null;
  if (!match) throw new Error(`${name} is not a data URL.`);
  if (match[1] !== paintMediaType(name)) throw new Error(`${name} is ${match[1]}.`);
  return new Uint8Array(Buffer.from(match[2] ?? "", "base64"));
};
const list = (v: unknown, what: string): ReadonlyArray<unknown> => {
  if (!Array.isArray(v)) throw new Error(`${what} is not a list.`);
  return v;
};
const complexionMaps = list(complexion["maps"], "complexion maps"),
  complexionFields = list(complexion["fields"], "complexion fields"),
  visibility = json("human-face-visibility.json"),
  dermal = json("human-dermal-data.json"),
  relief = json("human-body-relief.json"),
  finish = json("human-portrait-finish-data.json"),
  castSkin = json("human-cast-skin-data.json"),
  skinTone = json("human-skin-tone-data.json"),
  skinPigment = json("human-skin-pigment-data.json"),
  irisData = json("human-iris-data.json"),
  buzz = json("human-buzz-data.json"),
  swept = json("human-swept-scalp-data.json");
const fieldNames = ["tone", "zones", "eyes"];
const castData = json("human-cast-data.json"),
  wardrobe = json("human-cast-wardrobe-data.json"),
  castSurface = json("human-cast-surface-data.json");
const castFigure = (name: string) => record(castData[name], name);
const castPicture = (name: string): ArrayBufferView | undefined => {
  const figure = /^castFigure\.(.+)\.(pixels|mask|cards|pixelDelta)$/.exec(name);
  if (figure) {
    const f = castFigure(castFromSlug(figure[1] ?? "") ?? "");
    const owner =
      figure[2] === "cards"
        ? record(f["cardPaint"], name)
        : figure[2] === "pixelDelta"
          ? record(f["blend"], name)
          : record(f["paint"], name);
    return kinds.u8(packed(owner[figure[2] === "cards" ? "pixels" : (figure[2] ?? "")], name));
  }
  const art = /^castArt\.(.+)\.(pixels|mask)$/.exec(name);
  if (art)
    return kinds.u8(
      packed(record(record(wardrobe["art"], "art")[art[1] ?? ""], name)[art[2] ?? ""], name),
    );
  const surface = /^castSurface\.(.+)\.(body|head)$/.exec(name);
  if (surface)
    return kinds.u8(
      packed(
        record(record(castSurface["subjects"], "subjects")[surface[1] ?? ""], name)[
          surface[2] ?? ""
        ],
        name,
      ),
    );
  return undefined;
};
const groomData = json("human-grooms-data.json");
const imageSource = (name: string): unknown => {
  const [group = "", a = "", b = ""] = name.split(".");
  const at = (v: unknown, k: number) => list(v, name)[k];
  switch (group) {
    case "clippedBeard":
      return json("human-clipped-beard-data.json")["url"];
    case "detail":
      return complexionMaps[Number(a)];
    case "field":
      return a === "visibility" ? visibility["map"] : complexionFields[fieldNames.indexOf(a)];
    case "dermal":
      return at(dermal["maps"], Number(a));
    case "brow":
      return record(browPaint[a], a)["url"];
    case "body":
      return relief[a];
    case "finish":
      return a === "donor" ? at(finish["maps"], Number(b)) : finish[a];
    case "cast":
      return record(castSkin[a], a)[b];
    case "captured":
      return record(captures[a], a)[b];
    case "groom":
      return record(groomData[a], a)[b];
  }
  throw new Error(`No source for ${name}.`);
};
const finishEncoding = record(finish["encoding"], "finish encoding"),
  toneEncoding = record(skinTone["encoding"], "tone encoding");
if (finishEncoding["name"] !== "portrait-finish-v1" || toneEncoding["name"] !== "signed-local-tone")
  throw new Error("Unexpected paint encodings.");
const tableSource = (name: string): ArrayBufferView => {
  const brow = /^brow\.(.+)\.at$/.exec(name);
  if (brow) {
    const at = record(browPaint[brow[1] ?? ""], name);
    return Uint16Array.from([Number(at["x"]), Number(at["y"])]);
  }
  const patch = /^skinPigment\.(\d)$/.exec(name);
  if (patch) return kinds.u8(packed(list(skinPigment["patches"], name)[Number(patch[1])], name));
  const stroma = /^iris\.(\d)$/.exec(name);
  if (stroma) return kinds.u8(packed(list(irisData["maps"], name)[Number(stroma[1])], name));
  const iris = /^captured\.(.+)\.iris$/.exec(name);
  if (iris)
    return kinds.u8(
      packed(record(record(captures[iris[1] ?? ""], name)["iris"], name)["value"], name),
    );
  const cast = castPicture(name);
  if (cast) return cast;
  const scalp = /^buzz\.(vertices|uv|indices|density|pixels)$/.exec(name);
  if (scalp) {
    const raw = packed(buzz[scalp[1] ?? ""], name);
    return scalp[1] === "vertices"
      ? kinds.u32(raw)
      : scalp[1] === "uv" || scalp[1] === "indices"
        ? kinds.u16(raw)
        : kinds.u8(raw);
  }
  if (name === "swept.tone") return kinds.u8(packed(swept["tone"], name));
  switch (name) {
    case "finish.donors":
      return Uint8Array.from(
        list(finish["donors"], name).flatMap((d) => {
          const donor = record(d, name);
          return [
            Number(donor["age"]),
            donor["deep"] === true ? 1 : 0,
            donor["male"] === true ? 1 : 0,
          ];
        }),
      );
    case "finish.encoding":
      return Float64Array.from(
        ["darker", "lighter", "micro", "meso", "gloss"].map((k) => Number(finishEncoding[k])),
      );
    case "layout.mouthIsland":
      return Uint16Array.from(ints(record(complexion["mouth"], "mouth")["island"], name));
    case "tone":
      return kinds.u8(packed(skinTone["tone"], name));
    case "tone.range":
      return Float64Array.from([
        Number(toneEncoding["toneRange"]),
        Number(toneEncoding["warmRange"]),
      ]);
    case "captured.brows":
      return Uint8Array.from(capturedAxes, (axis) =>
        record(captures[axis], axis)["brows"] === true ? 1 : 0,
      );
  }
  throw new Error(`No source for ${name}.`);
};
if (Number(irisData["width"]) !== 192 || Number(irisData["height"]) !== 72)
  throw new Error("Unexpected iris stroma size.");
if (
  capturedAxes.some(
    (axis) => Number(record(record(captures[axis], axis)["iris"], axis)["size"]) !== 96,
  )
)
  throw new Error("Unexpected captured iris size.");
if (Number(skinPigment["size"]) !== 74 || Number(skinTone["count"]) !== 53514)
  throw new Error("Unexpected paint table sizes.");
if (numbers(buzz["size"], "buzz size").join() !== buzzSize.join())
  throw new Error("Unexpected buzz cut picture size.");
if (Number(swept["size"]) !== sweptScalpSize)
  throw new Error("Unexpected swept scalp painting size.");
if (Object.keys(castSkin).join() !== castSkinNames.join())
  throw new Error("Unexpected cast skins.");
if (Object.keys(captures).join() !== capturedAxes.join())
  throw new Error("Unexpected captured axes.");
const paint: { name: string; kind: PackKind; data: ArrayBufferView }[] = [];
const images = new Set(paintImageNames);
for (const [name, spec] of Object.entries(humanPaintSpec)) {
  const data = images.has(name) ? dataUrl(imageSource(name), name) : tableSource(name);
  const elements =
    data.byteLength /
    ({ u8: 1, u16: 2, u32: 4, i16: 2, i32: 4, f32: 4, f64: 8 } as const)[spec.kind];
  if (spec.elements !== undefined && spec.elements !== elements)
    throw new Error(`${name} has ${elements} elements, not ${spec.elements}.`);
  paint.push({ name, kind: spec.kind, data });
}

const groom: { name: string; kind: PackKind; data: ArrayBufferView }[] = [];
for (const [name, spec] of Object.entries(humanGroomSpec)) {
  const [key = "", array = ""] = name.split("/");
  groom.push({
    name,
    kind: spec.kind,
    data: kinds[spec.kind](packed(record(groomData[key], key)[array], name)),
  });
}
for (const [key, value] of Object.entries(groomData))
  for (const [array, text] of Object.entries(record(value, key)))
    if (
      typeof text === "string" &&
      !text.startsWith("data:") &&
      !Object.hasOwn(humanGroomSpec, `${key}/${array}`)
    )
      throw new Error(`Groom ${key}/${array} has no pack entry.`);

const near = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
if (Object.keys(castData).join() !== castFigureNames.join())
  throw new Error("Unexpected cast figures.");
for (const name of castFigureNames) {
  const f = castFigure(name),
    entry = castFigures[name],
    field = record(f["field"], name),
    paint = record(f["paint"], name);
  const cards = f["cards"] === undefined ? null : record(f["cards"], name);
  const blend = f["blend"] === undefined ? null : record(f["blend"], name);
  if (
    f["faceTriangles"] !== entry.faceTriangles ||
    field["reach"] !== entry.reach ||
    field["wide"] !== false ||
    paint["side"] !== 1024 ||
    !near(numbers(paint["tone"], name), entry.tone) ||
    (cards ? cards["vertices"] : null) !== entry.cards ||
    (cards && record(f["cardPaint"], name)["side"] !== 512) ||
    (blend ? blend["donor"] : null) !== entry.donor ||
    (f["skirt"] !== undefined) !== entry.skirt ||
    Object.keys(record(f["poses"], name)).join() !== castPoseNames.join()
  )
    throw new Error(`Cast figure ${name} differs from its catalogue entry.`);
}
const pieceTable = record(wardrobe["pieces"], "pieces");
if (
  Object.keys(pieceTable).join() !== castPieceCodes.join() ||
  castPieceCodes.some((code) => {
    const piece = record(pieceTable[code], code),
      want = castPieces[code];
    return (
      piece["subject"] !== want.subject ||
      piece["figure"] !== want.figure ||
      piece["top"] !== want.top ||
      piece["bottom"] !== want.bottom
    );
  })
)
  throw new Error("Unexpected cast wardrobe pieces.");
const receivers = record(wardrobe["receivers"], "receivers");
for (const [name, receiver] of Object.entries(receivers)) {
  const r = record(receiver, name),
    want = isCastFigureName(name) ? castReceivers[name] : undefined;
  const variants = record(r["variants"], name);
  if (
    !want ||
    r["own"] !== want.own ||
    Object.keys(variants).join() !== want.variants.map(castVariantKey).join() ||
    want.variants.some((v) => {
      const packed = record(variants[castVariantKey(v)], name),
        cards = record(packed["cards"], name);
      return (
        packed["faceTriangles"] !== v.faceTriangles ||
        record(packed["field"], name)["reach"] !== v.reach ||
        record(packed["field"], name)["wide"] !== false ||
        cards["vertices"] !== v.cards ||
        Object.keys(record(packed["poses"], name)).join() !== castPoseNames.join()
      );
    })
  )
    throw new Error(`Unexpected cast receiver ${name}.`);
}
if (Object.keys(receivers).length !== Object.keys(castReceivers).length)
  throw new Error("Unexpected cast receivers.");
const skins = record(wardrobe["skin"], "skin");
for (const [name, skin] of Object.entries(castBodySkin)) {
  const body = record(skins[name], name)["body"];
  if (skin === null ? body !== null : !near(numbers(body, name), skin))
    throw new Error(`Unexpected wardrobe skin for ${name}.`);
}
if (Object.keys(skins).join() !== Object.keys(castBodySkin).join())
  throw new Error("Unexpected wardrobe skins.");
const artTable = record(wardrobe["art"], "art");
if (
  Object.keys(artTable).join() !== "m007" ||
  record(artTable["m007"], "m007")["width"] !== 512 ||
  record(artTable["m007"], "m007")["height"] !== 1024
)
  throw new Error("Unexpected wardrobe art.");
const surfaceSubjects = record(castSurface["subjects"], "subjects");
if (
  castSurface["size"] !== castSurfaceSide ||
  Object.keys(surfaceSubjects).join() !== Object.keys(castSurfaceSubjects).join() ||
  Object.entries(castSurfaceSubjects).some(
    ([subject, regions]) =>
      Object.keys(record(surfaceSubjects[subject], subject)).join() !== regions.join(),
  )
)
  throw new Error("Unexpected cast surface maps.");

function castArray(owner: Raw, key: string, what: string): unknown {
  const [group = "", rest = ""] = key.split(/\.(.*)/s);
  if (["source", "uv", "index", "smooth"].includes(key)) return record(owner["surface"], what)[key];
  switch (group) {
    case "field":
      return record(owner["field"], what)[rest];
    case "pose":
      return record(owner["poses"], what)[rest];
    case "cards": {
      const cards = record(owner["cards"], what);
      return rest.startsWith("expr.")
        ? record(cards["expressions"], what)[rest.slice(5)]
        : cards[rest];
    }
    case "blend": {
      const blend = record(owner["blend"], what);
      return rest.startsWith("pose.") ? record(blend["poses"], what)[rest.slice(5)] : blend[rest];
    }
  }
  return owner[key];
}
const castEntries: { name: string; kind: PackKind; data: ArrayBufferView }[] = [];
const castSeen = new Set<string>();
for (const [name, spec] of Object.entries(humanCastSpec)) {
  const parts = name.split("/");
  const owner =
    parts[0] === "figure"
      ? castFigure(castFromSlug(parts[1] ?? "") ?? "")
      : record(
          record(record(receivers[castFromSlug(parts[1] ?? "") ?? ""], name)["variants"], name)[
            `${parts[2]}/${parts[3]}`
          ],
          name,
        );
  const key = parts.at(-1) ?? "";
  castEntries.push({
    name,
    kind: spec.kind,
    data: kinds[spec.kind](packed(castArray(owner, key, name), name)),
  });
  castSeen.add(name);
}
const strings = (v: unknown, at: string, out: string[]) => {
  if (typeof v === "string") out.push(at);
  else if (isRecord(v))
    for (const [k, x] of Object.entries(v)) strings(x, at ? `${at}.${k}` : k, out);
};
for (const name of castFigureNames) {
  const found: string[] = [];
  strings(castFigure(name), "", found);
  const pictures = [
    "paint.pixels",
    "paint.mask",
    "cardPaint.pixels",
    "blend.pixelDelta",
    "blend.donor",
  ];
  if (
    found.filter((k) => !pictures.includes(k)).length !==
    Object.keys(humanCastSpec).filter((k) => k.startsWith(`figure/${castSlug(name)}/`)).length
  )
    throw new Error(`Cast figure ${name} has arrays without pack entries.`);
}

const deflate = (raw: Uint8Array) => new Uint8Array(deflateSync(raw, { level: 9 }));
mkdirSync(out, { recursive: true });
for (const [file, entries] of [
  ["human-body.bin", body],
  ["human-captured.bin", captured],
  ["human-face.bin", face],
  ["human-groom.bin", groom],
  ["human-cast.bin", castEntries],
  ["human-paint.bin", paint],
] as const) {
  const bytes = writePack(entries, deflate);
  writeFileSync(join(out, file), bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  console.log(`${file}: ${entries.length} entries, ${bytes.byteLength} bytes, sha256 ${digest}`);
}
