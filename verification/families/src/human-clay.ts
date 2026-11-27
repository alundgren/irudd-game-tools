import { createHash } from "node:crypto";
import {
  createRegistry,
  decodeWith,
  DocumentId,
  emptyState,
  familyFeatures,
  memoryEnvironment,
  reduce,
  type CharacterDocument,
  type CommandEnvelopeInput,
  type DocumentState,
} from "@irudd/document";
import { exportCharacter } from "@irudd/character";
import {
  humanAdultGenerator,
  humanAdultId,
  humanAdultVersion,
  seededHumanAdult,
  type HumanAdultParams,
  type HumanBody,
} from "@irudd/character/human";
import { accessorValues, isRecord, records, type Glb } from "./glb.js";

export function adultStore(body: HumanBody) {
  const env = memoryEnvironment(
    createRegistry({ features: familyFeatures, generators: [humanAdultGenerator(body)] }),
  );
  const id = decodeWith(DocumentId, "doc-adult-clay");
  if (!id.ok) throw new Error("Invalid fixture document ID.");
  const documentId = id.value;
  let counter = 0;
  const commit = (
    state: DocumentState,
    command: CommandEnvelopeInput["command"],
  ): DocumentState => {
    counter += 1;
    const next = reduce(
      state,
      {
        format: "irudd.command",
        version: 1,
        requestId: `req-clay-${counter}`,
        documentId,
        actor: { kind: "human", id: "tester" },
        expectedRevision: state.head,
        command,
      },
      env,
    );
    if (next.outcome.kind !== "committed") throw new Error(JSON.stringify(next.outcome));
    return next.state;
  };
  const generate = (params: HumanAdultParams, label: string) =>
    commit(emptyState(documentId), {
      type: "document.generate",
      label,
      generator: humanAdultId,
      version: humanAdultVersion,
      params,
    });
  return {
    commit,
    generate,
    generated: (seed: number) => generate(seededHumanAdult(body, seed), `Adult ${seed}`),
  };
}

export const documentOf = (state: DocumentState): CharacterDocument => {
  if (!state.document) throw new Error("No document.");
  return state.document;
};

export async function clayBytes(doc: CharacterDocument, body: HumanBody): Promise<Uint8Array> {
  const result = await exportCharacter(doc, {
    preset: "clay",
    revision: 1,
    build: "test",
    human: body,
  });
  return result.bytes;
}

export function meshValues(glb: Glb): Map<string, Float64Array> {
  const out = new Map<string, Float64Array>();
  const meshes = records(glb.json["meshes"]);
  for (const node of records(glb.json["nodes"])) {
    if (node["mesh"] === undefined) continue;
    const name = String(node["name"]);
    records(meshes[Number(node["mesh"])]?.["primitives"]).forEach((primitive, k) => {
      const attributes = isRecord(primitive["attributes"]) ? primitive["attributes"] : {};
      for (const [key, index] of Object.entries(attributes))
        out.set(`${name}/${k}/${key}`, accessorValues(glb, Number(index)));
      out.set(`${name}/${k}/indices`, accessorValues(glb, Number(primitive["indices"])));
      records(primitive["targets"]).forEach((target, t) => {
        for (const [key, index] of Object.entries(target))
          out.set(`${name}/${k}/target${t}/${key}`, accessorValues(glb, Number(index)));
      });
    });
  }
  return out;
}

export function accessorDigest(glb: Glb): string {
  const hash = createHash("sha256");
  const count = records(glb.json["accessors"]).length;
  for (let i = 0; i < count; i++)
    hash.update(Float64Array.from(accessorValues(glb, i), (v) => Math.round(v * 1e9)));
  return hash.digest("hex");
}
