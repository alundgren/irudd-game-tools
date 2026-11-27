import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const examplesDir = join(repository, "examples");
export const fixturesDir = join(repository, "verification", "families", "fixtures");
