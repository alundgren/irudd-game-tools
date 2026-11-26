// Starting forms a host offers: registered generators with named presets and
// seeded variations, and prepared family documents ("forms") the host was
// given. Only generators the host's registry really holds are listed, and a
// reference generator says so.

import fs from "node:fs";
import path from "node:path";
import {
  createRegistry,
  isJson,
  isJsonArray,
  isJsonObject,
  type Json,
  defaultFrameCreatureParams,
  familyFeatures,
  frameCreature,
  type FrameCreatureParams,
  type GeneratorDefinition,
  type Registry,
} from "@irudd/document";
import type { Starter, StarterPreset, StartersView } from "../wire/protocol.js";
import { declaredAssets, formArtworkFile, readFormArtwork, type FormArtwork } from "./artwork.js";

export interface StarterDefinition {
  readonly id: string;
  readonly label: string;
  readonly generator: GeneratorDefinition;
  readonly reference: boolean;
  readonly description: string;
  readonly presets: ReadonlyArray<StarterPreset>;
  /** Deterministic parameters for a seed, inside the generator's ranges. */
  readonly seed?: (seed: number) => unknown;
}

/** A prepared `irudd.character` document offered as a starting form. */
export interface FormStarter {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** The whole document. `start` replaces its `id` (and `label`, when given) and sends `document.create`. */
  readonly document: Json;
  /**
   * Verified bytes for assets the document declares. `start` stages each
   * through the project's blob store before it creates the document.
   */
  readonly artwork?: ReadonlyArray<FormArtwork>;
}

/**
 * Prepared forms from a directory: every `*.json` file holding an
 * `irudd.character` document. The starter ID is the file name without `.json`.
 * Files that are not documents are reported, not skipped silently. Artwork the
 * forms declare comes from `artwork.json` beside them, verified by SHA-256.
 */
export function loadForms(directory: string): {
  readonly forms: ReadonlyArray<FormStarter>;
  readonly problems: ReadonlyArray<string>;
} {
  const forms: FormStarter[] = [];
  const problems: string[] = [];
  const artwork = readFormArtwork(directory, problems);
  for (const name of fs
    .readdirSync(directory)
    .filter((n) => n.endsWith(".json") && n !== formArtworkFile)
    .sort()) {
    const id = name.slice(0, -5).toLowerCase();
    const file = path.join(directory, name);
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      problems.push(`${file} is not JSON.`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(id)) {
      problems.push(`${file}: use a lowercase file name for the starter ID.`);
      continue;
    }
    if (!isJson(value) || !isJsonObject(value) || value["format"] !== "irudd.character") {
      problems.push(`${file} is not an irudd.character document.`);
      continue;
    }
    const label = typeof value["label"] === "string" ? value["label"] : id;
    const shipped = declaredAssets(value).flatMap((digest) => {
      const found = artwork.get(digest);
      return found ? [found] : [];
    });
    forms.push({
      id,
      label,
      description: `Prepared form from ${name}.`,
      document: value,
      ...(shipped.length ? { artwork: shipped } : {}),
    });
  }
  return { forms, problems };
}

export type ResolvedStarter =
  | { readonly kind: "generator"; readonly definition: StarterDefinition }
  | { readonly kind: "form"; readonly form: FormStarter };

/** The registry this build ships: every ported family feature and the protocol's reference generator. */
export function workshopRegistry(): Registry {
  return createRegistry({ features: familyFeatures, generators: [frameCreature] });
}

/** A small, fast, deterministic generator for seeds (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number, places = 3): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function frameCreatureSeed(seed: number): FrameCreatureParams {
  const next = seededRandom(seed);
  const between = (minimum: number, maximum: number) =>
    round(minimum + (maximum - minimum) * next());
  const shapes = ["ellipsoid", "box", "capsule"] as const;
  const shape = shapes[Math.floor(next() * shapes.length)] ?? "ellipsoid";
  const channel = () =>
    Math.floor(40 + next() * 160)
      .toString(16)
      .padStart(2, "0");
  return {
    scale: between(0.6, 1.6),
    trunk: { length: between(0.5, 1.6), girth: between(0.12, 0.4), shape },
    neck: { length: between(0, 0.6), pitch: between(-20, 70) },
    head: { size: between(0.12, 0.35) },
    legs: { pairs: Math.floor(next() * 4), length: between(0.2, 0.8) },
    tail: { length: between(0, 1.2) },
    color: `#${channel()}${channel()}${channel()}`,
  };
}

const frameCreaturePresets: ReadonlyArray<StarterPreset> = [
  { id: "default", label: "Marsh walker", params: defaultFrameCreatureParams },
  {
    id: "grazer",
    label: "Long-necked grazer",
    params: {
      ...defaultFrameCreatureParams,
      trunk: { length: 1.2, girth: 0.3, shape: "capsule" },
      neck: { length: 0.9, pitch: 60 },
      legs: { pairs: 2, length: 0.8 },
      color: "#8a6f4d",
    },
  },
  {
    id: "crawler",
    label: "Six-legged crawler",
    params: {
      ...defaultFrameCreatureParams,
      trunk: { length: 1.1, girth: 0.16, shape: "box" },
      neck: { length: 0.05, pitch: 0 },
      legs: { pairs: 3, length: 0.3 },
      tail: { length: 0.2 },
      color: "#4d5f7a",
    },
  },
  {
    id: "serpent",
    label: "Legless serpent",
    params: {
      ...defaultFrameCreatureParams,
      trunk: { length: 1.8, girth: 0.12, shape: "capsule" },
      neck: { length: 0.2, pitch: 10 },
      legs: { pairs: 0, length: 0.2 },
      tail: { length: 1.5 },
      color: "#6b7a3a",
    },
  },
];

/** Starters for the generators `workshopRegistry` holds. */
export const workshopStarters: ReadonlyArray<StarterDefinition> = [
  {
    id: "frame-creature",
    label: "Frame creature",
    generator: frameCreature,
    reference: true,
    description:
      "The protocol's reference generator: a small articulated body (trunk, neck, head, legs, tail) from a few plan values. It exercises editing, proposals and undo against a real deterministic generator. It is not a character family and does not match the workshop's creature builder.",
    presets: frameCreaturePresets,
    seed: frameCreatureSeed,
  },
];

/** What a host can offer from `registry` and its prepared forms. */
export function startersView(
  registry: Registry,
  definitions: ReadonlyArray<StarterDefinition>,
  forms: ReadonlyArray<FormStarter> = [],
): { readonly view: StartersView; readonly byId: ReadonlyMap<string, ResolvedStarter> } {
  const generators = new Map<string, StarterDefinition>();
  for (const definition of definitions) {
    const key = `${definition.generator.id}@${definition.generator.version}`;
    if (registry.generators.get(key) === definition.generator)
      generators.set(definition.id, definition);
  }
  const covered = new Set(
    [...generators.values()].map((d) => `${d.generator.id}@${d.generator.version}`),
  );
  for (const [key, generator] of registry.generators) {
    if (covered.has(key)) continue;
    const id = `${generator.id}-v${generator.version}`.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
    generators.set(id, {
      id,
      label: generator.label,
      generator,
      reference: false,
      description: `${generator.label}. Registered without presets; pass explicit parameters.`,
      presets: [],
    });
  }
  const byId = new Map<string, ResolvedStarter>();
  const starters: Starter[] = [];
  for (const d of generators.values()) {
    byId.set(d.id, { kind: "generator", definition: d });
    starters.push({
      id: d.id,
      kind: "generator",
      label: d.label,
      generator: { id: d.generator.id, version: d.generator.version, label: d.generator.label },
      reference: d.reference,
      description: d.description,
      presets: d.presets,
      seeded: d.seed !== undefined,
      features: [],
    });
  }
  for (const form of forms) {
    if (byId.has(form.id)) throw new Error(`Starter ${form.id} is defined twice.`);
    byId.set(form.id, { kind: "form", form });
    starters.push({
      id: form.id,
      kind: "form",
      label: form.label,
      generator: null,
      reference: false,
      description: form.description,
      presets: [],
      seeded: false,
      features: formFeatures(form.document),
      artwork: declaredAssets(form.document).map((digest) => {
        const shipped = form.artwork?.find((a) => a.digest === digest);
        return { digest, shipped: shipped !== undefined, origin: shipped?.origin ?? null };
      }),
    });
  }
  const families = [...registry.features.values()]
    .filter((feature) => feature.scope !== "none")
    .map((feature) => ({ id: feature.id, version: feature.version }));
  return { view: { starters, families }, byId };
}

/** Every feature ID a document's payloads name, at document or part level. */
function formFeatures(document: Json): ReadonlyArray<string> {
  const found = new Set<string>();
  const collect = (features: Json | undefined) => {
    if (isJsonObject(features)) for (const key of Object.keys(features)) found.add(key);
  };
  if (isJsonObject(document)) {
    collect(document["features"]);
    const parts = document["parts"];
    if (isJsonArray(parts))
      for (const part of parts) if (isJsonObject(part)) collect(part["features"]);
  }
  return [...found].sort();
}
