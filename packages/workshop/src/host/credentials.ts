import { Schema } from "effect";
import { createHash } from "node:crypto";
import fs from "node:fs";
import {
  AgentCredential,
  agentCredentialPath,
  deriveKey,
  newSecret,
  readJsonFile,
  writePrivateFile,
  type HostFiles,
} from "../wire/local.js";
import { AgentId } from "../wire/ids.js";
import type { Pairing, PairResult } from "../wire/protocol.js";

const PairingRow = Schema.Struct({
  agent: AgentId,
  name: Schema.optionalKey(Schema.String),
  createdAt: Schema.Number,
  key: Schema.String,
});

const PairingsFile = Schema.Struct({
  format: Schema.Literal("irudd.workshop-pairings"),
  version: Schema.Literal(1),
  projectId: Schema.String,
  agents: Schema.Array(PairingRow),
  revoked: Schema.optionalKey(Schema.Array(AgentId)),
});
type PairingsFile = typeof PairingsFile.Type;

export function pairingIdOf(key: string): string {
  return `pair-${createHash("sha256").update(`irudd.pairing\0${key}`).digest("hex").slice(0, 16)}`;
}

export class Credentials {
  readonly humanKey: Buffer;
  private readonly files: HostFiles;
  private readonly project: { readonly directory: string; readonly projectId: string };

  constructor(
    files: HostFiles,
    project: { readonly directory: string; readonly projectId: string },
  ) {
    this.files = files;
    this.project = project;
    fs.mkdirSync(files.dir, { recursive: true, mode: 0o700 });
    const secret = newSecret();
    writePrivateFile(files.humanKey, secret + "\n");
    this.humanKey = deriveKey(secret);
  }

  private read(): PairingsFile {
    const read = readJsonFile(this.files.pairings, PairingsFile);
    const empty: PairingsFile = {
      format: "irudd.workshop-pairings",
      version: 1,
      projectId: this.project.projectId,
      agents: [],
    };
    if (!read || !read.ok || read.value.projectId !== this.project.projectId) return empty;
    return read.value;
  }

  private write(file: PairingsFile): void {
    writePrivateFile(this.files.pairings, JSON.stringify(file, null, 2) + "\n");
  }

  agentKey(agent: string): Buffer | undefined {
    const row = this.read().agents.find((a) => a.agent === agent);
    return row ? Buffer.from(row.key, "base64url") : undefined;
  }

  pairingId(agent: string): string | undefined {
    const row = this.read().agents.find((a) => a.agent === agent);
    return row ? pairingIdOf(row.key) : undefined;
  }

  agentName(agent: string): string | undefined {
    return this.read().agents.find((a) => a.agent === agent)?.name;
  }

  list(): ReadonlyArray<Pairing> {
    return this.read().agents.map((a) => ({
      agent: a.agent,
      pairingId: pairingIdOf(a.key),
      name: a.name ?? null,
      createdAt: a.createdAt,
    }));
  }

  pair(agent: string, name: string | undefined, auto = false): PairResult | "revoked" {
    const current = this.read();
    if (auto) {
      if (current.revoked?.includes(agent)) return "revoked";
      const row = current.agents.find((a) => a.agent === agent);
      const credentialFile = agentCredentialPath(this.files, agent);
      const existing = row ? readJsonFile(credentialFile, AgentCredential) : undefined;
      if (
        row &&
        existing?.ok &&
        existing.value.projectId === this.project.projectId &&
        deriveKey(existing.value.secret).toString("base64url") === row.key
      )
        return {
          agent,
          pairingId: pairingIdOf(row.key),
          name: row.name ?? null,
          createdAt: row.createdAt,
          credentialFile,
        };
    }
    const secret = newSecret();
    const createdAt = Date.now();
    const credential: AgentCredential = {
      format: "irudd.agent-credential",
      version: 1,
      project: this.project.directory,
      projectId: this.project.projectId,
      agent,
      ...(name === undefined ? {} : { name }),
      secret,
    };
    const credentialFile = agentCredentialPath(this.files, agent);
    const key = deriveKey(secret).toString("base64url");
    writePrivateFile(credentialFile, JSON.stringify(credential, null, 2) + "\n");
    const { revoked, ...rest } = current;
    const stillRevoked = (revoked ?? []).filter((a) => a !== agent);
    this.write({
      ...rest,
      ...(stillRevoked.length > 0 ? { revoked: stillRevoked } : {}),
      agents: [
        ...current.agents.filter((a) => a.agent !== agent),
        {
          agent,
          ...(name === undefined ? {} : { name }),
          createdAt,
          key,
        },
      ],
    });
    return { agent, pairingId: pairingIdOf(key), name: name ?? null, createdAt, credentialFile };
  }

  revoke(agent: string): boolean {
    const current = this.read();
    const remaining = current.agents.filter((a) => a.agent !== agent);
    const revoked = [...(current.revoked ?? []).filter((a) => a !== agent), agent];
    this.write({ ...current, agents: remaining, revoked });
    fs.rmSync(agentCredentialPath(this.files, agent), { force: true });
    return remaining.length !== current.agents.length;
  }

  dispose(): void {
    fs.rmSync(this.files.humanKey, { force: true });
  }
}
