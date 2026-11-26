import { randomBytes } from "node:crypto";
import type { WorkshopClient } from "@irudd/workshop/client";
import type { HostConnection } from "./connection.js";

export const channelCapability = "claude/channel";

export function newChannelInstance(): string {
  return `chn-${randomBytes(12).toString("hex")}`;
}

export interface ChannelOptions {
  readonly host: HostConnection;
  readonly instance: string;
  readonly server: string | undefined;
  readonly client: () => { readonly name: string; readonly version: string } | undefined;
  readonly notify: (content: string, meta: Record<string, string>) => Promise<void>;
  readonly log: (line: string) => void;
}

export class ChannelBridge {
  private readonly options: ChannelOptions;
  private stopped = false;
  constructor(options: ChannelOptions) {
    this.options = options;
  }

  async run(): Promise<void> {
    let delay = 500;
    while (!this.stopped) {
      let client: WorkshopClient | undefined;
      try {
        client = await this.options.host.open();
        const info = this.options.client();
        client.onEvent((event) => {
          if (event.event !== "inbox") return;
          void this.push(event.messageId, event.prompt, event.meta);
        });
        await client.call("inbox.watch", {
          push: "claude-channel",
          instance: this.options.instance,
          ...(this.options.server === undefined ? {} : { server: this.options.server }),
          ...(info === undefined
            ? {}
            : { client: { name: info.name.slice(0, 200), version: info.version.slice(0, 200) } }),
        });
        this.options.log(`channel instance ${this.options.instance} is watching the inbox`);
        delay = 500;
        await client.closed;
      } catch (error) {
        this.options.log(
          `channel: ${error instanceof Error ? error.message : String(error)}; retrying`,
        );
      }
      if (this.stopped) return;
      await new Promise((resolve) => setTimeout(resolve, delay).unref());
      delay = Math.min(delay * 2, 10_000);
    }
  }

  private async push(messageId: string, prompt: string, meta: Record<string, string>) {
    try {
      await this.options.notify(prompt, meta);
      await this.options.host.call("inbox.pushed", { messageId });
    } catch (error) {
      this.options.log(
        `channel: push of ${messageId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
