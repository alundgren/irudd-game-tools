// Steering through one host, in process over a real OS-local endpoint: the
// durable outbox, recipient binding, the paired agent's inbox, acknowledgement
// bound to the pairing, applied receipts, retries, restarts, revocation and
// the Claude channel route.
//
// The T3 route here uses a FAKE transport that records what it is handed. It
// proves the host's state machine, not delivery into a real conversation; the
// named gate `pnpm --filter @irudd/hosts gate:t3` and the canary do that.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { connect, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import { startHost, type HostOptions, type RunningHost } from "@irudd/workshop/host";
import type { InboxEvent, RecipientRoute } from "@irudd/workshop/wire";
import { requestId, tempDir } from "./support/fixtures.js";

const person = { kind: "human", id: "tester", name: "Tester" } as const;
interface Rig {
  readonly project: string;
  readonly stateDir: string;
  host: RunningHost;
  human: WorkshopClient;
  restart(): Promise<void>;
}

async function withRig(name: string, body: (rig: Rig) => Promise<void>): Promise<void> {
  const root = tempDir(`steer-${name}`);
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const options: HostOptions = {
    path: project,
    stateDir,
    create: { label: "Steering test" },
    human: person,
    durability: "normal",
    agentCommand: "irudd",
    steeringTiming: { retryBaseMs: 20, channelConfirmMs: 500, deliverTimeoutMs: 2000 },
  };
  const host = await startHost(options);
  const human = await connect({ credential: { role: "human", project }, stateDir });
  const rig: Rig = {
    project,
    stateDir,
    host,
    human,
    async restart() {
      rig.human.close();
      await rig.host.close();
      rig.host = await startHost(options);
      rig.human = await connect({ credential: { role: "human", project }, stateDir });
    },
  };
  try {
    await body(rig);
  } finally {
    rig.human.close();
    await rig.host.close();
  }
}

async function failsWith(promise: Promise<unknown>, tag: string): Promise<WorkshopError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WorkshopError, String(error));
    assert.equal(error._tag, tag, error.message);
    return error;
  }
  assert.fail(`expected ${tag}`);
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      assert.fail(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const status = (rig: Rig, messageId: string) => rig.human.call("steer.get", { messageId });

async function agentClient(rig: Rig, file: string): Promise<WorkshopClient> {
  return connect({ credential: { role: "agent", file }, stateDir: rig.stateDir });
}

test("inbox-only routes say push is unavailable; the agent reads them in its own session", async () => {
  await withRig("inbox", async (rig) => {
    const { human } = rig;
    const pair = await human.call("pair.agent", { agent: "codex" });
    await human.call("recipient.bind", {
      agent: "codex",
      route: {
        transport: "inbox",
        host: "codex",
        environment: "local",
        conversation: "019a0000-0000-7000-8000-000000000001",
      },
    });
    await failsWith(
      human.call("steer.send", { agent: "codex", requestId: requestId("off"), text: "offline" }),
      "RouteUnproven",
    );
    const codex = await agentClient(rig, pair.credentialFile);
    const view = await human.call("recipient.check", { agent: "codex" });
    assert.equal(view.availability.state, "inbox-only");
    assert.equal(view.availability.push, false);
    const sent = await human.call("steer.send", {
      agent: "codex",
      requestId: requestId("ib"),
      text: "read me",
    });
    assert.equal(sent.status, "inbox-only");
    const events: InboxEvent[] = [];
    try {
      await codex.call("inbox.watch", { push: "events" });
      codex.onEvent((e) => {
        if (e.event === "inbox") events.push(e);
      });
      const later = await human.call("steer.send", {
        agent: "codex",
        requestId: requestId("ib"),
        text: "second",
      });
      await until(
        () => Promise.resolve(events.length),
        (n) => n === 1,
        "inbox event",
      );
      assert.equal(events[0]?.messageId, later.messageId);
      const inbox = await codex.call("inbox.read", {});
      assert.equal(inbox.messages.length, 2);
      assert.equal(
        (await codex.call("inbox.ack", { messageId: sent.messageId })).status,
        "acknowledged",
      );
      assert.equal((await codex.call("inbox.read", {})).messages.length, 1);
      assert.equal((await codex.call("inbox.read", { all: true })).messages.length, 2);
    } finally {
      codex.close();
    }
  });
});

test("a Claude channel route binds one exact MCP server instance and confirms each push", async () => {
  await withRig("channel", async (rig) => {
    const { human } = rig;
    const pair = await human.call("pair.agent", { agent: "claude" });
    const instance = "chn-0123456789abcdef01234567";
    const route: RecipientRoute = {
      transport: "claude-channel",
      host: "claude-code",
      environment: "local",
      server: "irudd",
      instance,
    };
    await failsWith(human.call("recipient.bind", { agent: "claude", route }), "RouteUnproven");

    const mcp = await agentClient(rig, pair.credentialFile);
    try {
      await mcp.call("inbox.watch", {
        push: "claude-channel",
        instance,
        server: "irudd",
        client: { name: "claude-code", version: "2.1.332" },
      });
      const view = await human.call("recipient.list", {});
      assert.deepEqual(
        view.find((r) => r.agent === "claude")?.channels.map((c) => c.instance),
        [instance],
      );
      await failsWith(
        human.call("recipient.bind", {
          agent: "claude",
          route: { ...route, instance: "chn-ffffffffffffffffffffffff" },
        }),
        "RouteUnproven",
      );
      await human.call("recipient.bind", { agent: "claude", route });
      assert.equal(
        (await human.call("recipient.check", { agent: "claude" })).availability.state,
        "ready",
      );

      mcp.onEvent((event) => {
        if (event.event === "inbox") void mcp.call("inbox.pushed", { messageId: event.messageId });
      });
      const sent = await human.call("steer.send", {
        agent: "claude",
        requestId: requestId("ch"),
        text: "via channel",
      });
      const pushed = await until(
        () => status(rig, sent.messageId),
        (m) => m.status === "host-accepted",
        "channel push",
      );
      assert.equal(pushed.delivery.receipt?.delivery, "channel-notified");
    } finally {
      mcp.close();
    }
    // The instance went away: the route is offline and messages wait.
    await until(
      () => human.call("recipient.check", { agent: "claude" }),
      (v) => v.availability.state === "offline",
      "offline after disconnect",
    );
    await failsWith(
      human.call("steer.send", { agent: "claude", requestId: requestId("ch"), text: "later" }),
      "RouteUnproven",
    );
  });
});
