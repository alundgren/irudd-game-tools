import {
  createRegistry,
  defaultFrameCreatureParams,
  emptyState,
  frameCreature,
  memoryEnvironment,
  reduce,
  sha256Digest,
  utf8Encode,
  type CommandEnvelopeInput,
  type DocumentState,
  type Environment,
  type Outcome,
  type StoredAsset,
} from "@irudd/document";
import { Schema } from "effect";
import { CatalogId, Digest, DocumentId } from "@irudd/document";

export const registry = createRegistry({ generators: [frameCreature] });

export const human = { kind: "human", id: "user" } as const;
export const agent = { kind: "agent", id: "assistant" } as const;

export const docId = Schema.decodeUnknownSync(DocumentId)("doc-fixture1");
export const digest = Schema.decodeUnknownSync(Digest);
export const catalogId = Schema.decodeUnknownSync(CatalogId);

export function blob(name: string): {
  readonly digest: ReturnType<typeof digest>;
  readonly bytes: Uint8Array;
} {
  const bytes = utf8Encode(`RIFF-test-artwork-${name}`);
  return { digest: digest(sha256Digest(bytes)), bytes };
}

export function environment(
  assets: ReadonlyArray<{
    readonly digest: ReturnType<typeof digest>;
    readonly bytes: Uint8Array;
    readonly mediaType?: string;
  }> = [],
  catalog: ReadonlyArray<readonly [string, string]> = [],
): Environment {
  return memoryEnvironment(
    registry,
    assets.map((a): readonly [ReturnType<typeof digest>, StoredAsset] => [
      a.digest,
      { byteLength: a.bytes.length, mediaType: a.mediaType ?? "image/webp" },
    ]),
    catalog.map(([id, d]) => [catalogId(id), digest(d)] as const),
  );
}

let counter = 0;
export function requestId(): string {
  counter += 1;
  return `req-${counter.toString().padStart(8, "0")}`;
}

export function envelope(
  actor: CommandEnvelopeInput["actor"],
  expectedRevision: number,
  command: CommandEnvelopeInput["command"],
  id: string = requestId(),
  documentId: string = docId,
): CommandEnvelopeInput {
  return {
    format: "irudd.command",
    version: 1,
    requestId: id,
    documentId,
    actor,
    expectedRevision,
    command,
  };
}

export function committed(outcome: Outcome): Extract<Outcome, { kind: "committed" }> {
  if (outcome.kind !== "committed")
    throw new Error(
      "Expected a commit, got " +
        outcome.kind +
        (outcome.kind === "rejected" ? ": " + JSON.stringify(outcome.diagnostics) : ""),
    );
  return outcome;
}

export function rejected(outcome: Outcome): Extract<Outcome, { kind: "rejected" }> {
  if (outcome.kind !== "rejected") throw new Error("Expected a rejection, got " + outcome.kind);
  return outcome;
}

export function run(
  state: DocumentState,
  env: Environment,
  ...envelopes: CommandEnvelopeInput[]
): DocumentState {
  let s = state;
  for (const e of envelopes) {
    const step = reduce(s, e, env);
    committed(step.outcome);
    s = step.state;
  }
  return s;
}

export function generatedCreature(
  env: Environment = environment(),
  params: object = defaultFrameCreatureParams,
): DocumentState {
  return run(
    emptyState(docId),
    env,
    envelope(human, 0, {
      type: "document.generate",
      label: "Marsh walker",
      generator: "irudd.frame-creature",
      version: 1,
      params,
    }),
  );
}

export function partBySlot(state: DocumentState, slot: string) {
  const p = state.document?.parts.find((x) => x.slot === slot);
  if (!p) throw new Error("No part for slot " + slot);
  return p;
}

export function manualDocument(
  atlasBlob: { readonly digest: string; readonly bytes: Uint8Array },
  occluderBlob: { readonly digest: string; readonly bytes: Uint8Array },
  catalogDigest: string,
): Record<string, unknown> {
  const atlas = atlasBlob.digest;
  const occluder = occluderBlob.digest;
  return {
    format: "irudd.character",
    version: 1,
    id: docId,
    label: "Lantern grazer",
    requires: [
      { feature: "core.parts", version: 1 },
      { feature: "core.poses", version: 1 },
      { feature: "core.paint", version: 1 },
      { feature: "core.catalog", version: 1 },
    ],
    catalog: [{ id: "irudd.parts", digest: catalogDigest }],
    assets: [
      {
        digest: atlas,
        mediaType: "image/webp",
        byteLength: atlasBlob.bytes.length,
        role: "paint-atlas",
      },
      {
        digest: occluder,
        mediaType: "image/webp",
        byteLength: occluderBlob.bytes.length,
        role: "occluder-atlas",
      },
    ],
    parts: [
      {
        id: "p-body",
        label: "Body",
        parent: null,
        shape: "ellipsoid",
        position: [0, 0.8, 0],
        rotation: [0, 0, 0, 1],
        size: [0.4, 0.4, 0.9],
        color: "#5f7a58",
        sculpt: [],
        paint: { atlas, occluder },
        features: {},
      },
      {
        id: "p-lamp",
        label: "Lamp",
        parent: "p-body",
        shape: "cylinder",
        position: [0, 0.3, 0.3],
        rotation: [0, 0, 0, 1],
        size: [0.05, 0.2, 0.05],
        color: "#d7a24c",
        sculpt: [],
        component: { catalog: "irudd.parts", item: "lantern" },
        features: {},
      },
    ],
    poses: [
      {
        id: "pose-raise",
        label: "Raise lamp",
        joints: [{ part: "p-lamp", rotation: [0.2588190451, 0, 0, 0.9659258263] }],
      },
    ],
    features: {},
    extensions: { "org.example.notes": { mood: "curious" } },
  };
}
