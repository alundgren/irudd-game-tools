// The host's credentials: a person's key, new on every start, and paired
// agents, which persist across restarts until a person revokes them.
//
// Pairings are read from disk on every handshake, so a revocation by any host
// process applies to the next connection. Agent IDs bind the actor the host
// stamps: an agent never chooses its own identity.

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
  /** base64url of the derived HMAC key; the secret itself lives only in the credential file. */
  key: Schema.String,
});

const PairingsFile = Schema.Struct({
  format: Schema.Literal("irudd.workshop-pairings"),
  version: Schema.Literal(1),
  projectId: Schema.String,
  agents: Schema.Array(PairingRow),
});
type PairingsFile = typeof PairingsFile.Type;

/** A pairing's ID: a hash of its derived key, so re-pairing (a new secret) gives a new ID. */
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
    // Pairings for a project that was replaced at the same path do not carry over.
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

  /** The agent's current pairing ID, or undefined when it is not paired. */
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

  /** Pair (or re-pair, rotating its secret) an agent and write its credential file. */
  pair(agent: string, name: string | undefined): PairResult {
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
    const current = this.read();
    this.write({
      ...current,
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
    if (remaining.length !== current.agents.length) this.write({ ...current, agents: remaining });
    fs.rmSync(agentCredentialPath(this.files, agent), { force: true });
    return remaining.length !== current.agents.length;
  }

  /** Forget the person's key when the host stops. */
  dispose(): void {
    fs.rmSync(this.files.humanKey, { force: true });
  }
}
