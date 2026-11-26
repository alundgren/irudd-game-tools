import { Schema } from "effect";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeWith, diagnostic, fail, type Checked } from "@irudd/document";
import { AgentId, HostIdentity, wireProtocol, wireVersion } from "./protocol.js";

export interface LocationOptions {
  readonly stateDir?: string;
}

export function stateRoot(options: LocationOptions = {}): string {
  if (options.stateDir) return path.resolve(options.stateDir);
  const override = process.env["IRUDD_STATE_DIR"];
  if (override) return path.resolve(override);
  const home = os.homedir();
  if (process.platform === "win32") {
    const local = process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    return path.join(local, "irudd", "workshop");
  }
  if (process.platform === "darwin")
    return path.join(home, "Library", "Application Support", "irudd", "workshop");
  const xdg = process.env["XDG_STATE_HOME"] ?? path.join(home, ".local", "state");
  return path.join(xdg, "irudd", "workshop");
}

export function canonicalProjectPath(directory: string): string {
  let resolved = path.resolve(directory);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {}
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function projectKey(directory: string): string {
  return createHash("sha256").update(canonicalProjectPath(directory)).digest("hex").slice(0, 20);
}

export interface HostFiles {
  readonly key: string;
  readonly dir: string;
  readonly endpoint: string;
  readonly humanKey: string;
  readonly pairings: string;
  readonly agents: string;
}

export function hostFiles(directory: string, options: LocationOptions = {}): HostFiles {
  const key = projectKey(directory);
  const dir = path.join(stateRoot(options), "hosts", key);
  return {
    key,
    dir,
    endpoint: path.join(dir, "endpoint.json"),
    humanKey: path.join(dir, "human.key"),
    pairings: path.join(dir, "pairings.json"),
    agents: path.join(dir, "agents"),
  };
}

export function agentCredentialPath(files: HostFiles, agent: string): string {
  return path.join(files.agents, `${agent}.json`);
}

export function endpointAddress(files: HostFiles, instance: string): string {
  if (process.platform === "win32")
    return `\\\\.\\pipe\\irudd-workshop-${files.key}-${instance.slice(0, 12)}`;
  const inDir = path.join(files.dir, "host.sock");
  return Buffer.byteLength(inDir) < 100 ? inDir : path.join(os.tmpdir(), `irudd-${files.key}.sock`);
}

export const Endpoint = Schema.Struct({
  format: Schema.Literal("irudd.workshop-endpoint"),
  wire: Schema.Literal(wireProtocol),
  version: Schema.Literal(wireVersion),
  address: Schema.String,
  project: Schema.String,
  projectId: Schema.String,
  host: HostIdentity,
});
export type Endpoint = typeof Endpoint.Type;

export const AgentCredential = Schema.Struct({
  format: Schema.Literal("irudd.agent-credential"),
  version: Schema.Literal(1),
  project: Schema.String,
  projectId: Schema.String,
  agent: AgentId,
  name: Schema.optionalKey(Schema.String),
  secret: Schema.String,
});
export type AgentCredential = typeof AgentCredential.Type;

export function readJsonFile<S extends Schema.Decoder<unknown>>(
  file: string,
  schema: S,
): Checked<S["Type"]> | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail([diagnostic("schema", [], `${file} is not JSON.`)]);
  }
  return decodeWith(schema, value);
}

export function writePrivateFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function newNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(`irudd.workshop-key\0${secret}`).digest();
}

export function proof(
  key: Uint8Array,
  label: "host" | "client",
  first: string,
  second: string,
): string {
  return createHmac("sha256", key)
    .update(`${wireProtocol}\0${label}\0${first}\0${second}`)
    .digest("base64url");
}

export function sameProof(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
