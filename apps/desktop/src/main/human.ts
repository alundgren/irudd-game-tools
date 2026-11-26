// The editable adult human for the desktop host: its body packs, read once
// from the build's assets and verified by SHA-256, its generator in the host
// registry and its starter beside the workshop's own.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRegistry, familyFeatures, frameCreature, type Registry } from "@irudd/document";
import {
  humanAdultStarter,
  humanPackFiles,
  humanPaintFile,
  loadHumanPacks,
  type HumanBody,
} from "@irudd/character/human";
import { workshopStarters, type StarterDefinition } from "@irudd/workshop/host";

export interface HumanHosting {
  readonly body: HumanBody;
  /** Every ported feature, the frame creature and the adult generator. */
  readonly registry: Registry;
  /** The workshop's starters and the adult. */
  readonly starters: ReadonlyArray<StarterDefinition>;
}

/** The pack files, relative to the assets directory, as the build copies them. */
export const humanPackPaths: ReadonlyArray<string> = [...humanPackFiles, humanPaintFile].map((p) =>
  path.join("human", p.file),
);

/** Load the adult from `assetsDir/human`. Fails when a pack is missing or altered. */
export async function humanHosting(assetsDir: string): Promise<HumanHosting> {
  const body = await loadHumanPacks(
    async (file) => new Uint8Array(await readFile(path.join(assetsDir, "human", file))),
  );
  const { generator, starter } = humanAdultStarter(body);
  return {
    body,
    registry: createRegistry({ features: familyFeatures, generators: [frameCreature, generator] }),
    starters: [...workshopStarters, starter],
  };
}
