import { readPack, type EntrySpec, type Pack, type PackSpec } from "./pack.js";

export interface GroomCredit {
  readonly author: string;
  readonly licence: "CC0 1.0";
  readonly source: string;
  readonly pack: string;
}

export interface GroomEntry {
  readonly credit: GroomCredit;
  readonly facial: boolean;
  readonly smoothCards: boolean;
}

const system: GroomCredit = {
  author: "MakeHuman team",
  licence: "CC0 1.0",
  source: "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
  pack: "makehuman_system_assets_cc0",
};
const toigo = (node: number): GroomCredit => ({
  author: "MargaretToigo",
  licence: "CC0 1.0",
  source: `http://www.makehumancommunity.org/node/${node}`,
  pack: "hair01_cc0",
});
const hair = (credit: GroomCredit, smoothCards = false): GroomEntry => ({
  credit,
  facial: false,
  smoothCards,
});

export const grooms = {
  short_layered: hair(system),
  short_receding: hair(system),
  cloud_waves: hair(
    {
      author: "Cortu Johnstone",
      licence: "CC0 1.0",
      source: "http://www.makehumancommunity.org/node/2808",
      pack: "hair01_cc0",
    },
    true,
  ),
  bob_blunt: hair(toigo(1669)),
  bob_blunt_fringe: hair(toigo(1681)),
  bob_curled: hair(toigo(1677)),
  bob_inverted: hair(toigo(1673)),
  bun_tied: hair(system),
  long_centre: hair(system),
  pixie_swept: hair(system),
  ponytail_low: hair(system),
  moustache_viking: {
    credit: {
      author: "RehmanPolanski",
      licence: "CC0 1.0",
      source: "http://www.makehumancommunity.org/node/2615",
      pack: "bodyparts05_cc0",
    },
    facial: true,
    smoothCards: false,
  },
} as const satisfies Readonly<Record<string, GroomEntry>>;
export type GroomName = keyof typeof grooms;
export const groomNames: ReadonlyArray<GroomName> = [
  "short_layered",
  "short_receding",
  "cloud_waves",
  "bob_blunt",
  "bob_blunt_fringe",
  "bob_curled",
  "bob_inverted",
  "bun_tied",
  "long_centre",
  "pixie_swept",
  "ponytail_low",
  "moustache_viking",
];
export const isGroomName = (name: string): name is GroomName => Object.hasOwn(grooms, name);

export const authoredHair: Readonly<Record<string, GroomName>> = {
  "Loose waves": "cloud_waves",
  "Layered short": "short_layered",
  "Receding short": "short_receding",
  "Sleek bob": "bob_blunt",
  "Fringed bob": "bob_blunt_fringe",
  "Angled bob": "bob_inverted",
  "Curled-under bob": "bob_curled",
  "Tied bun": "bun_tied",
};

export const groomedHair: Readonly<Record<string, GroomName>> = {
  "Low ponytail": "ponytail_low",
  "Long centre part": "long_centre",
  "Side-swept pixie": "pixie_swept",
  ...authoredHair,
};

const groomKinds = {
  faceRefs: "u16",
  faceWeights: "u16",
  faceUV: "u16",
  faceIndices: "u32",
  refs: "u16",
  weights: "f32",
  offsets: "f32",
  uv: "u16",
  corners: "u16",
  uvCorners: "u16",
  hide: "u16",
  rootIds: "u16",
  rootField: "u8",
} as const satisfies Readonly<Record<string, EntrySpec["kind"]>>;
export type GroomArray = keyof typeof groomKinds;
const scalpArrays: ReadonlyArray<string> = ["rootIds", "rootField"];

export const humanGroomSpec: PackSpec = Object.fromEntries(
  groomNames.flatMap((groom) =>
    Object.entries(groomKinds)
      .filter(([key]) => !grooms[groom].facial || !scalpArrays.includes(key))
      .map(([key, kind]) => [`${groom}/${key}`, { kind }]),
  ),
);

export interface Groom extends GroomEntry {
  readonly name: GroomName;
  readonly faceRefs: Uint16Array;
  readonly faceWeights: Uint16Array;
  readonly faceUV: Uint16Array;
  readonly faceIndices: Uint32Array;
  readonly refs: Uint16Array;
  readonly weights: Float32Array;
  readonly offsets: Float32Array;
  readonly uv: Uint16Array;
  readonly corners: Uint16Array;
  readonly uvCorners: Uint16Array;
  readonly hide: Uint16Array;
  readonly scalp: {
    readonly ids: Uint16Array;
    readonly field: Int8Array;
  } | null;
}

export type HumanGrooms = (name: GroomName) => Groom;

function groomOf(pack: Pack, name: GroomName): Groom {
  const at = (key: GroomArray) => `${name}/${key}`;
  const field = grooms[name].facial ? null : pack.u8(at("rootField"));
  return {
    name,
    ...grooms[name],
    faceRefs: pack.u16(at("faceRefs")),
    faceWeights: pack.u16(at("faceWeights")),
    faceUV: pack.u16(at("faceUV")),
    faceIndices: pack.u32(at("faceIndices")),
    refs: pack.u16(at("refs")),
    weights: pack.f32(at("weights")),
    offsets: pack.f32(at("offsets")),
    uv: pack.u16(at("uv")),
    corners: pack.u16(at("corners")),
    uvCorners: pack.u16(at("uvCorners")),
    hide: pack.u16(at("hide")),
    scalp: field
      ? {
          ids: pack.u16(at("rootIds")),
          field: new Int8Array(field.buffer, field.byteOffset, field.byteLength),
        }
      : null,
  };
}

export async function readHumanGrooms(bytes: Uint8Array): Promise<HumanGrooms> {
  const pack = await readPack(bytes, humanGroomSpec, "human-groom.bin");
  const made = new Map<GroomName, Groom>();
  return (name) => {
    let found = made.get(name);
    if (!found) made.set(name, (found = groomOf(pack, name)));
    return found;
  };
}
