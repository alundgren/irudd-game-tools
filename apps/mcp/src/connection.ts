import { connect, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import type { MethodName, MethodParams, MethodResults } from "@irudd/workshop/wire";

export class HostConnection {
  private client: WorkshopClient | undefined;
  private opening: Promise<WorkshopClient> | undefined;
  private readonly credential: string;
  private readonly stateDir: string | undefined;

  constructor(credential: string, stateDir: string | undefined) {
    this.credential = credential;
    this.stateDir = stateDir;
  }

  async open(): Promise<WorkshopClient> {
    if (this.client && !this.client.isClosed()) return this.client;
    this.opening ??= connect({
      credential: { role: "agent", file: this.credential },
      client: { name: "irudd-mcp", version: "1" },
      ...(this.stateDir === undefined ? {} : { stateDir: this.stateDir }),
    }).finally(() => {
      this.opening = undefined;
    });
    this.client = await this.opening;
    return this.client;
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
