import { connect, runningHosts, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import type { MethodName, MethodParams, MethodResults, SteeringHost } from "@irudd/workshop/wire";

export interface LocalAgent {
  readonly id: string;
  readonly name: string;
  readonly host: SteeringHost;
}

export type AgentSource =
  | { readonly kind: "credential"; readonly file: string }
  | {
      readonly kind: "auto";
      readonly project: string | undefined;
      readonly agent: () => LocalAgent;
    };

export function localAgent(clientName: string | undefined, override?: string): LocalAgent {
  const client = clientName ?? "";
  if (override !== undefined)
    return { id: override, name: clientName || override, host: hostOf(client) };
  if (/claude/i.test(client)) return { id: "claude", name: "Claude Code", host: "claude-code" };
  if (/codex/i.test(client)) return { id: "codex", name: "Codex", host: "codex" };
  const id = client
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
  return { id: id || "agent", name: client || "Agent", host: "agent" };
}

function hostOf(client: string): SteeringHost {
  if (/claude/i.test(client)) return "claude-code";
  if (/codex/i.test(client)) return "codex";
  return "agent";
}

const notRunning =
  "Irudd Workshop isn't running. Ask the person to open it (or start a headless host with irudd host <dir>), then try again.";

export class HostConnection {
  private client: WorkshopClient | undefined;
  private opening: Promise<WorkshopClient> | undefined;
  private readonly source: AgentSource;
  private readonly stateDir: string | undefined;

  constructor(source: AgentSource, stateDir: string | undefined) {
    this.source = source;
    this.stateDir = stateDir;
  }

  async open(): Promise<WorkshopClient> {
    if (this.client && !this.client.isClosed()) return this.client;
    this.opening ??= this.connect().finally(() => {
      this.opening = undefined;
    });
    this.client = await this.opening;
    return this.client;
  }

  private location() {
    return this.stateDir === undefined ? {} : { stateDir: this.stateDir };
  }

  private connect(): Promise<WorkshopClient> {
    if (this.source.kind === "credential") return this.asAgent(this.source.file);
    return this.connectAuto(this.source.project, this.source.agent());
  }

  private asAgent(file: string): Promise<WorkshopClient> {
    return connect({
      credential: { role: "agent", file },
      client: { name: "irudd-mcp", version: "1" },
      ...this.location(),
    });
  }

  private async connectAuto(
    project: string | undefined,
    agent: LocalAgent,
  ): Promise<WorkshopClient> {
    const target = project ?? runningHosts(this.location())[0]?.project;
    if (target === undefined)
      throw new WorkshopError({ _tag: "HostUnavailable", message: notRunning });
    let human: WorkshopClient;
    try {
      human = await connect({
        credential: { role: "human", project: target },
        client: { name: "irudd-mcp", version: "1" },
        ...this.location(),
      });
    } catch (error) {
      if (error instanceof WorkshopError && error._tag === "HostUnavailable" && !project)
        throw new WorkshopError({ _tag: "HostUnavailable", message: notRunning });
      throw error;
    }
    let file: string;
    try {
      const paired = await human.call("pair.agent", {
        agent: agent.id,
        name: agent.name,
        auto: true,
      });
      file = paired.credentialFile;
      const recipients = await human.call("recipient.list", {});
      if (!recipients.find((r) => r.agent === agent.id)?.recipient)
        await human.call("recipient.bind", {
          agent: agent.id,
          route: { transport: "inbox", host: agent.host, environment: "local" },
        });
    } finally {
      human.close();
    }
    return this.asAgent(file);
  }

  async call<M extends MethodName>(method: M, params: MethodParams[M]): Promise<MethodResults[M]> {
    const client = await this.open();
    return client.call(method, params);
  }

  async whoami(): Promise<WorkshopClient["welcome"]> {
    return (await this.open()).welcome;
  }

  close(): void {
    this.client?.close();
  }
}

export { WorkshopError };
