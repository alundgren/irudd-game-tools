// Repository locations the family gate reads and writes.

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
/** Tracked example forms at the reference commit. Read-only input for preparation. */
export const examplesDir = join(repository, "examples");
/** New-format fixtures prepared from the examples. */
export const fixturesDir = join(repository, "verification", "families", "fixtures");
/** The frozen G0 reference cache. Read-only. */
export const g0Dir = process.env["G0_DIR"] ?? join(repository, ".reference-cache", "g0");
/** Fresh exports and reports from this gate (ignored). */
export const outDir = join(repository, ".reference-cache", "g4a");
/** Content-addressed project bytes the fixtures reference: `sha256-<hex>`, verified on use. */
export const blobsDir = join(fixturesDir, "blobs");
/**
 * Project bytes from local reference material that is not tracked, such as
 * the sheet G0 accepted in its repaint oracle. Same naming as `blobsDir`.
 */
export const referenceBlobsDir = join(outDir, "blobs");
/** G0's recorded selected-body repaint of harbour-trader (verification/baseline/paint.py). Read-only. */
export const g0PaintDir =
  process.env["G0_PAINT_DIR"] ?? join(repository, ".reference-cache", "g0-paint");
