import {
  formGenerator,
  formStarter,
  creatureGenerator,
  creatureStarter,
} from "@irudd/character/creature";
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
  readonly registry: Registry;
  readonly starters: ReadonlyArray<StarterDefinition>;
}

export const humanPackPaths: ReadonlyArray<string> = [...humanPackFiles, humanPaintFile].map((p) =>
  path.join("human", p.file),
);

export async function humanHosting(assetsDir: string): Promise<HumanHosting> {
  const body = await loadHumanPacks(
    async (file) => new Uint8Array(await readFile(path.join(assetsDir, "human", file))),
  );
  const { generator, starter } = humanAdultStarter(body);
  return {
    body,
    registry: createRegistry({
      features: familyFeatures,
      generators: [frameCreature, formGenerator, creatureGenerator, generator],
    }),
    starters: [...workshopStarters, starter, creatureStarter, formStarter],
  };
}
