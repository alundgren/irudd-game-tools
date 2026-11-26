// The seeded adult's clay export against G0, shared by the fast regression
// (test/human-clay.test.ts) and the heavy gate (src/human-gate.ts).
//
// G0 exported seeded adults only dressed, at game and portrait, so the
// undressed `#adult=SEED` clay references come from the frozen G0 build itself,
// through its own Open form and Export GLB controls:
//
//   powershell -NoProfile -File verification/baseline/gpu-lock.ps1 verification/baseline/browser.py \
//     export .reference-cache/g0/build .reference-cache/human-oracle \
//     .reference-cache/g0/seeded/adult-491.form.json ... --presets clay
//
// A fresh export compares whole: every mesh bit for bit (the body skin, the
// head skin with its five expressions, the eyes, the brows and lashes, the
// teeth), the joints in the adult's standing posture, the Idle, Walk, Crouch
// and Reach clips and the credits. The one planned difference is that joints
// name their region by the document's part ID.

import { createHash } from "node:crypto";
import { join } from "node:path";
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
import { compareGlb, type Comparison } from "./compare.js";
import { accessorValues, isRecord, parseGlb, records, type Glb } from "./glb.js";
import { repository } from "./paths.js";

export const humanOracleDir = join(repository, ".reference-cache", "human-oracle");

/**
 * Every seeded adult of the frozen G0 fixtures, with the SHA-256 of its clay
 * reference export. 42 has a cast face and 8973 a scar that parts a brow.
 */
export const adultClayReferences: ReadonlyArray<{
  readonly seed: number;
  readonly sha256: string;
}> = [
  { seed: 491, sha256: "1df054c49851d7b4d2a2901994aba71ef8f61dc85e45cb3d7bf9a38f4556bb80" },
  { seed: 42, sha256: "e1ca14f27a26a569db201232d6608e2df01455d326d9f29bbf18369d7506340b" },
  { seed: 1, sha256: "9154e80d1e024419d29032664e2120eb80c55a363697584dfef14e8463624174" },
  { seed: 8713, sha256: "aec13495296c1d69fc52b2ec91012a7d3be8d7392f37d0513fb28c338ae4dca9" },
  { seed: 8950, sha256: "b5f565616b3a67a51fcd61223495b13e0323a3e6bd182042618e4eb33d34272f" },
  { seed: 8973, sha256: "4dc16f6ccd44db815592848288baf28edce0a29bd8b442e24c1473be6d6a1387" },
  { seed: 8990, sha256: "5b1612ff7202412199858f03d9c5fe7c071731fd77b50a4a974e562203966e09" },
  { seed: 9001, sha256: "51c6814dec7fad72c76bc6c7c11e167192e2515d5baa06809fc6a0a0990b9d57" },
  { seed: 49027675, sha256: "2a8c64645ad82a8994ce70099f15ac8fd88f0b16747338782efa51f76a0670ee" },
  { seed: 716973847, sha256: "20c84fa3493b170478f9999d467ae9ef788bca3c655fa297fda9915454712980" },
  { seed: 3782767734, sha256: "add68a01947e04599fdc1a772f4ef2ee0382ffa23082d6fc3204b24dffe965d1" },
];

/** A store of adult documents, committing through the real reducer. */
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

/** Every attribute, index and morph target of each named mesh's primitives. */
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

/**
 * SHA-256 of every accessor in order, each value on a 1e-9 grid: the meshes,
 * the rig and the clips. The grid absorbs the last bit the posture solver's
 * quaternions may differ by.
 */
export function accessorDigest(glb: Glb): string {
  const hash = createHash("sha256");
  const count = records(glb.json["accessors"]).length;
  for (let i = 0; i < count; i++)
    hash.update(Float64Array.from(accessorValues(glb, i), (v) => Math.round(v * 1e9)));
  return hash.digest("hex");
}

export interface ClayCheck {
  readonly comparison: Comparison;
  /** Mesh values that are not bit-identical. */
  readonly meshes: ReadonlyArray<string>;
  /** Accessors beyond 1e-15. */
  readonly accessors: ReadonlyArray<string>;
}
/** The whole comparison of a fresh clay export with its reference. */
export function checkClay(
  reference: Uint8Array,
  fresh: Uint8Array,
  doc: CharacterDocument,
): ClayCheck {
  const comparison = compareGlb(reference, fresh, {
    regions: new Map(doc.parts.map((p) => [p.label, p.id])),
  });
  const got = meshValues(parseGlb(fresh));
  const meshes: string[] = [];
  for (const [key, values] of meshValues(parseGlb(reference))) {
    const other = got.get(key);
    if (!other || other.length !== values.length || other.some((v, i) => v !== values[i]))
      meshes.push(key);
  }
  return {
    comparison,
    meshes,
    accessors: comparison.accessors
      .filter((use) => use.maxAbs > 1e-15)
      .map((use) => `${use.use} differs by ${use.maxAbs}`),
  };
}
