// The prepared forms the desktop ships as starters, and the artwork they paint with.
//
// Only forms that verify against the frozen G0 exports at clay, Full, Game
// and Portrait are listed (verification/families). Every
// asset a listed form declares must resolve to bytes with a recorded origin:
// a bundled sheet from @irudd/character, or a project blob listed below.
// The build fails on anything else, so no unlicensed or private art ships.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundledAsset } from "@irudd/character";
import { digestBrand } from "@irudd/document";

/** The verified forms, by fixture name. */
export const verifiedForms = [
  "accepted-beetle",
  "arched-glider",
  "braided-biologist",
  "coastal-biologist",
  "composed-portrait",
  "creature-42",
  "creature-dispatch",
  "creature-pelt",
  "estuary-glider",
  "feline-worker",
  "fen-crown",
  "festival-conductor",
  "festival-wardrobe",
  "field-athlete",
  "field-athlete-portrait",
  "field-wardrobe",
  "figure-42",
  "figure-runner",
  "fitted-portrait",
  "four-arm-cape",
  "four-hand-courier",
  "glassgrass-eel",
  "harbour-trader",
  "hooded-docker",
  "human-42",
  "jointed-conductor",
  "landmark-ranger",
  "landmark-surveyor",
  "lantern-grazer",
  "marsh-draw-1",
  "marsh-draw-2",
  "marsh-draw-3",
  "marsh-draw-5",
  "marsh-eight-legs",
  "marsh-tripod",
  "merchant-counter",
  "merchant-gesture",
  "moraine-highcrest",
  "moraine-mantle-repair",
  "moraine-porter",
  "native-portrait-projection",
  "oblique-dockworker",
  "plan-8950",
  "plan-8990",
  "portrait-dockworker",
  "portrait-gaze",
  "pressure-poncho",
  "quayside-fitted",
  "quayside-merchant",
  "reef-cartographer",
  "relay-wardrobe",
  "rescue-vest",
  "river-fruit-first",
  "rosette-glider",
  "six-legged-crawler",
  "tidal-print",
  "tide-surveyor",
  "traced-ranger",
  "tucked-aviator",
  "winged-scout",
] as const;

interface ProjectArtwork {
  readonly digest: string;
  readonly mediaType: "image/webp";
  readonly origin: { readonly kind: "project"; readonly license: "MIT"; readonly source: string };
}

/**
 * Project artwork embedded in tracked example forms, prepared into
 * verification/families/fixtures/blobs. Original art for this project.
 */
const projectArtwork: ReadonlyArray<ProjectArtwork> = [
  {
    digest: "sha256:5610ea6c2945f2dfb88e1451cfea0f60fc383d982b56eb9bfad4349dc7ea549b",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/native-portrait-projection.form.json (generated portrait) at b548a0b",
    },
  },
  {
    digest: "sha256:8c201001ef0f1d69d58a8a09d55896ebc5bd5086fbbdd843b76836bf7415bfef",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/moraine-highcrest.form.json at d8d11a5",
    },
  },
  {
    digest: "sha256:132c0da3f7a29bab1d25faa68fa623ef5ac29f3b929d39c5bd254be98059bc58",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/moraine-mantle-repair.form.json at d8d11a5",
    },
  },
  {
    digest: "sha256:414a20ac45845d293910aad5c2b54839d92a78571e3954e8f5075f76b54f7bb3",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/composed-portrait.form.json at 5c6ba08",
    },
  },
  {
    digest: "sha256:fde9c49253ef0a44ec71ac28da419c109cea59cd087038d83e466e06647f4010",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/composed-portrait.form.json at 5c6ba08",
    },
  },
  {
    digest: "sha256:155c87ee4252420b8012cbc5d7c229b3c25a43386cae1c393e3ca62bf5b4ca71",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/fitted-portrait.form.json at 16ce625",
    },
  },
  {
    digest: "sha256:346df2f12cdcda8ea62e3d7cef146649c911f13a128cbf1ce1bf89cd63c63053",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/portrait-dockworker.form.json (side portrait plate) at cdff460",
    },
  },
  {
    digest: "sha256:8c46be6a88b448dbcf258e39daf4c330ce10bc7edc5dd23f4963a6439e268f76",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/portrait-dockworker.form.json (front portrait plate) at cdff460",
    },
  },
  {
    digest: "sha256:74396aaad10049f2ac5763554162076504d9440710c9650e61047db539dcb181",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/festival-conductor.form.json (garment sheet) at 5a69e1e",
    },
  },
  {
    digest: "sha256:656f385b1811fcd2fa8f79d68a9f4b88e1461bfb52eb38ca2a75b1786dfc8f53",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/field-athlete-portrait.form.json (front portrait plate) at d8d11a5",
    },
  },
  {
    digest: "sha256:7362f0830dceb91b3ab8b3d116fef4cd1f01683d53e2c6965318f45542eb2590",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/field-athlete-portrait.form.json (side portrait plate) at d8d11a5",
    },
  },
  {
    digest: "sha256:1f14b91745b427f807191eae2e86d0e579ebada4d700cd364029f689516e30f3",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/coastal-biologist.form.json (head and neck paint) at 60acd04",
    },
  },
  {
    digest: "sha256:48d8557541e91c3f1b542dd99649489fde674df15d460a3822c9a4f3834e4e81",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/rescue-vest.form.json (embedded garment sheet) at 99a25ac",
    },
  },
  {
    digest: "sha256:4e9d2e07535272fe9645dd3f66041dac69271495cea0b973701feabaed51441b",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/tidal-print.form.json (repainted vest) at 5c6ba08",
    },
  },
  {
    digest: "sha256:543dc50b834dd7f7193bd18878c35c52b6c64a07e88308e83f12e498e2906a98",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/feline-worker.form.json (embedded body sheet) at d6d89ef",
    },
  },
  {
    digest: "sha256:11b3ce2f5cb214708c50d25396e0d5865c35d9d301321dbb5876e4102a097827",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/lantern-grazer.form.json (generated turnaround) at d6d89ef",
    },
  },
  {
    digest: "sha256:1f157d81136c1ebf17b9ef82789f1aa8ce50a9dda1f974ac5e3d136cbaa5ea57",
    mediaType: "image/webp",
    origin: {
      kind: "project",
      license: "MIT",
      source: "examples/reef-cartographer.form.json (generated turnaround) at 4582a0b",
    },
  },
];

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function declared(document: unknown): { digest: string; mediaType: string; byteLength: number }[] {
  const assets: unknown =
    typeof document === "object" && document !== null ? Reflect.get(document, "assets") : [];
  if (!Array.isArray(assets)) return [];
  return assets.flatMap((a: unknown) => {
    if (typeof a !== "object" || a === null) return [];
    const digest: unknown = Reflect.get(a, "digest");
    const mediaType: unknown = Reflect.get(a, "mediaType");
    const byteLength: unknown = Reflect.get(a, "byteLength");
    return typeof digest === "string" &&
      typeof mediaType === "string" &&
      typeof byteLength === "number"
      ? [{ digest, mediaType, byteLength }]
      : [];
  });
}

/**
 * Copy the forms and the artwork they declare into `out`, and write
 * `artwork.json` (irudd.form-artwork v1) for the host's `loadForms`.
 */
export function stageForms(
  repository: string,
  out: string,
): {
  readonly forms: ReadonlyArray<string>;
  readonly artwork: number;
} {
  const fixtures = join(repository, "verification", "families", "fixtures");
  const bundledDir = join(repository, "packages", "character", "assets");
  mkdirSync(join(out, "artwork"), { recursive: true });
  const files = new Map<string, unknown>();
  for (const form of verifiedForms) {
    const source = join(fixtures, `${form}.json`);
    const document: unknown = JSON.parse(readFileSync(source, "utf8"));
    copyFileSync(source, join(out, `${form}.json`));
    for (const entry of declared(document)) {
      if (files.has(entry.digest)) continue;
      if (!/^sha256:[0-9a-f]{64}$/.test(entry.digest))
        throw new Error(`${form} declares an asset without a SHA-256 digest.`);
      const bundled = bundledAsset(digestBrand(`sha256:${entry.digest.slice(7)}`));
      const listed = projectArtwork.find((p) => p.digest === entry.digest);
      let bytes: Uint8Array;
      let file: string;
      let origin: unknown;
      if (bundled) {
        bytes = new Uint8Array(readFileSync(join(bundledDir, bundled.file)));
        file = `artwork/${bundled.file}`;
        origin = bundled.origin;
      } else if (listed) {
        bytes = new Uint8Array(
          readFileSync(join(fixtures, "blobs", entry.digest.replace(":", "-"))),
        );
        file = `artwork/${entry.digest.slice(7)}.webp`;
        origin = listed.origin;
      } else
        throw new Error(
          `${form} declares ${entry.digest}, which is neither a bundled sheet nor listed project artwork. Record its origin in scripts/forms.ts before shipping it.`,
        );
      if (sha256(bytes) !== entry.digest || bytes.byteLength !== entry.byteLength)
        throw new Error(`${form}: the bytes for ${entry.digest} do not match the declaration.`);
      writeFileSync(join(out, ...file.split("/")), bytes);
      files.set(entry.digest, {
        digest: entry.digest,
        mediaType: entry.mediaType,
        byteLength: entry.byteLength,
        file,
        origin,
      });
    }
  }
  writeFileSync(
    join(out, "artwork.json"),
    JSON.stringify(
      { format: "irudd.form-artwork", version: 1, files: [...files.values()] },
      null,
      2,
    ) + "\n",
  );
  return { forms: verifiedForms, artwork: files.size };
}
