import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ReviewArtifact } from "../wire/review.js";

export const reviewIndexFormat = "irudd.review-index";

export interface IssuedArtifact extends ReviewArtifact {
  readonly documentId: string;
  readonly revision: number;
  readonly kind: "glb" | "png" | "json";
  readonly issuedAt: number;
}

interface Index {
  readonly format: typeof reviewIndexFormat;
  readonly version: 1;
  readonly projectId: string;
  artifacts: Record<string, IssuedArtifact>;
  exports: Record<string, string>;
}

const extension: Record<IssuedArtifact["kind"], string> = {
  glb: ".glb",
  png: ".png",
  json: ".json",
};

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

function writeAtomic(file: string, bytes: Uint8Array | string): void {
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
}

export class ArtifactStore {
  readonly dir: string;
  private readonly projectId: string;
  private readonly keep: number;
  private index: Index;

  constructor(options: {
    readonly dir: string;
    readonly projectId: string;
    readonly keep?: number;
  }) {
    this.dir = options.dir;
    this.projectId = options.projectId;
    this.keep = options.keep ?? 400;
    fs.mkdirSync(this.dir, { recursive: true });
    this.index = this.load();
  }

  private load(): Index {
    const fresh: Index = {
      format: reviewIndexFormat,
      version: 1,
      projectId: this.projectId,
      artifacts: {},
      exports: {},
    };
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.indexFile, "utf8"));
      if (
        typeof value === "object" &&
        value !== null &&
        Reflect.get(value, "format") === reviewIndexFormat &&
        Reflect.get(value, "projectId") === this.projectId
      ) {
        const artifacts: unknown = Reflect.get(value, "artifacts");
        const exports: unknown = Reflect.get(value, "exports");
        if (typeof artifacts === "object" && artifacts !== null)
          for (const [sha, entry] of Object.entries(artifacts))
            if (isIssued(entry) && /^[0-9a-f]{64}$/.test(sha)) fresh.artifacts[sha] = entry;
        if (typeof exports === "object" && exports !== null)
          for (const [key, sha] of Object.entries(exports))
            if (typeof sha === "string") fresh.exports[key] = sha;
        return fresh;
      }
      for (const name of fs.readdirSync(this.dir))
        fs.rmSync(path.join(this.dir, name), { force: true });
    } catch {}
    return fresh;
  }

  private get indexFile(): string {
    return path.join(this.dir, "index.json");
  }

  private file(entry: Pick<IssuedArtifact, "sha256" | "kind">): string {
    return path.join(this.dir, entry.sha256 + extension[entry.kind]);
  }

  private save(): void {
    writeAtomic(this.indexFile, JSON.stringify(this.index) + "\n");
  }

  put(
    bytes: Uint8Array,
    meta: Pick<IssuedArtifact, "mediaType" | "documentId" | "revision" | "kind">,
  ): ReviewArtifact {
    const sha256 = sha256Hex(bytes);
    const entry: IssuedArtifact = {
      ...meta,
      sha256,
      byteLength: bytes.byteLength,
      issuedAt: Date.now(),
    };
    const file = this.file(entry);
    if (!fs.existsSync(file) || fs.statSync(file).size !== bytes.byteLength)
      writeAtomic(file, bytes);
    delete this.index.artifacts[sha256];
    this.index.artifacts[sha256] = entry;
    this.prune();
    this.save();
    return { sha256, mediaType: meta.mediaType, byteLength: bytes.byteLength };
  }

  private prune(): void {
    const entries = Object.values(this.index.artifacts).sort((a, b) => a.issuedAt - b.issuedAt);
    for (const old of entries.slice(0, Math.max(0, entries.length - this.keep))) {
      delete this.index.artifacts[old.sha256];
      fs.rmSync(this.file(old), { force: true });
    }
  }

  issued(sha256: string): IssuedArtifact | undefined {
    return Object.hasOwn(this.index.artifacts, sha256) ? this.index.artifacts[sha256] : undefined;
  }

  read(
    sha256: string,
    offset: number,
    length: number,
  ): { readonly entry: IssuedArtifact; readonly bytes: Uint8Array } | undefined {
    const entry = this.issued(sha256);
    if (!entry) return undefined;
    let all: Uint8Array;
    try {
      all = new Uint8Array(fs.readFileSync(this.file(entry)));
    } catch {
      return undefined;
    }
    if (sha256Hex(all) !== sha256) return undefined;
    return {
      entry,
      bytes: all.subarray(
        Math.min(offset, all.byteLength),
        Math.min(offset + length, all.byteLength),
      ),
    };
  }

  lastExport(key: string): string | undefined {
    return Object.hasOwn(this.index.exports, key) ? this.index.exports[key] : undefined;
  }

  recordExport(key: string, sha256: string): void {
    this.index.exports[key] = sha256;
    this.save();
  }
}

function isIssued(value: unknown): value is IssuedArtifact {
  if (typeof value !== "object" || value === null) return false;
  const kind: unknown = Reflect.get(value, "kind");
  return (
    typeof Reflect.get(value, "sha256") === "string" &&
    typeof Reflect.get(value, "mediaType") === "string" &&
    typeof Reflect.get(value, "byteLength") === "number" &&
    typeof Reflect.get(value, "documentId") === "string" &&
    typeof Reflect.get(value, "revision") === "number" &&
    typeof Reflect.get(value, "issuedAt") === "number" &&
    (kind === "glb" || kind === "png" || kind === "json")
  );
}
