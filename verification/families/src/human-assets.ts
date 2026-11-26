import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadHumanPacks, type HumanBody } from "@irudd/character/human";
import { repository } from "./paths.js";

export const humanAssetsDir = join(repository, "packages", "character", "assets", "human");

let loaded: Promise<HumanBody> | undefined;
export function loadHumanBody(): Promise<HumanBody> {
  loaded ??= loadHumanPacks(
    async (file) => new Uint8Array(await readFile(join(humanAssetsDir, file))),
  );
  return loaded;
}
