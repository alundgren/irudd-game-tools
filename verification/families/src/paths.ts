import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const examplesDir = join(repository, "examples");
export const fixturesDir = join(repository, "verification", "families", "fixtures");
export const g0Dir = process.env["G0_DIR"] ?? join(repository, ".reference-cache", "g0");
export const outDir = join(repository, ".reference-cache", "g4a");
export const referenceBlobsDir = join(outDir, "blobs");
export const g0PaintDir =
  process.env["G0_PAINT_DIR"] ?? join(repository, ".reference-cache", "g0-paint");
