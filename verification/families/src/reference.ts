import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageBytes, isRecord, parseGlb, records } from "./glb.js";
import { decodePng } from "./png.js";
import { g0Dir, repository } from "./paths.js";

const baselineDir = join(repository, "verification/baseline");
const pixelsFile = join(baselineDir, "export-texture-digests.json");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function textureDigest(bytes: Uint8Array): string {
  const glb = parseGlb(bytes);
  const digest = createHash("sha256");
  for (const [index] of records(glb.json["images"]).entries()) {
    const image = decodePng(imageBytes(glb, index));
    digest.update(`${index}:${image.width}x${image.height}:`);
    digest.update(image.rgba);
  }
  return digest.digest("hex");
}

export function authenticateReference(
  dir: string,
  name: string,
  comparedSha: string,
  record: unknown,
): boolean {
  if (!isRecord(record)) return false;
  if (record["sha256"] === comparedSha) return true;

  const path = join(dir, name);
  const summary: unknown = JSON.parse(
    execFileSync(process.execPath, [join(baselineDir, "glb.mjs"), path], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const pixels: unknown = JSON.parse(readFileSync(pixelsFile, "utf8"));
  const bytes = readFileSync(path);
  return (
    isRecord(summary) &&
    summary["integrity"] === "ok" &&
    summary["contentDigest"] === record["contentDigest"] &&
    isRecord(pixels) &&
    sha256(bytes) === comparedSha &&
    textureDigest(bytes) === pixels[name]
  );
}

if (import.meta.main) {
  const baseline: unknown = JSON.parse(readFileSync(join(baselineDir, "baseline.json"), "utf8"));
  const frozen = isRecord(baseline) && baseline["frozen"];
  const exports = isRecord(frozen) && frozen["exports"];
  const files = isRecord(exports) && exports["files"];
  if (!isRecord(files) || !Object.keys(files).length) throw new Error("Missing frozen inventory.");
  const result: Record<string, string> = {};
  for (const name of Object.keys(files).sort()) {
    const bytes = readFileSync(join(g0Dir, "export-a", name));
    const record = files[name];
    if (!isRecord(record) || sha256(bytes) !== record["sha256"])
      throw new Error(`Original G0 file required to freeze ${name}`);
    result[name] = textureDigest(bytes);
  }
  writeFileSync(pixelsFile, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `Froze decoded texture digests for ${Object.keys(result).length} authenticated files.`,
  );
}
