import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hostFiles } from "@irudd/workshop/endpoint";
import { connect, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import { startHost, type HostOptions, type RunningHost } from "@irudd/workshop/host";
import type {
  DeliveryOutcome,
  DeliveryRequest,
  HostEvent,
  InboxEvent,
  MethodResults,
  RecipientRoute,
  SteeringTransport,
} from "@irudd/workshop/wire";
import { generate, rename, request, requestId, tempDir, docId } from "./support/fixtures.js";

const person = { kind: "human", id: "tester", name: "Tester" } as const;
const thread = "thread:delegated-task:command%3Afake%3A0001";
const t3Route: RecipientRoute = {
  transport: "t3-thread",
  host: "t3",
  environment: "local",
  conversation: thread,
};

class FakeT3 implements SteeringTransport {
  readonly transport = "t3-thread" as const;
  readonly sent: DeliveryRequest[] = [];
  next: () => Promise<DeliveryOutcome> = () =>
    Promise.resolve({
      kind: "accepted",
      receipt: {
        transport: "t3-thread",
        hostMessageId: `fake-${this.sent.length}`,
        delivery: "queued",
        at: Date.now(),
      },
    });
  check() {
    return Promise.resolve({
      state: "ready" as const,
      push: true,
      summary: "fake thread is running",
      conversation: { status: "running", busy: true },
    });
  }
  deliver(request: DeliveryRequest) {
    this.sent.push(request);
    return this.next();
  }
}

interface Rig {
  readonly project: string;
  readonly stateDir: string;
  readonly fake: FakeT3;
  host: RunningHost;
  human: WorkshopClient;
  restart(): Promise<void>;
}

async function withRig(name: string, body: (rig: Rig) => Promise<void>): Promise<void> {
  const root = tempDir(`steer-${name}`);
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const fake = new FakeT3();
  const options: HostOptions = {
    path: project,
    stateDir,
    create: { label: "Steering test" },
    human: person,
    durability: "normal",
    transports: [fake],
    agentCommand: "irudd",
    steeringTiming: { retryBaseMs: 20, channelConfirmMs: 500, deliverTimeoutMs: 2000 },
  };
  const host = await startHost(options);
  const human = await connect({ credential: { role: "human", project }, stateDir });
  const rig: Rig = {
    project,
    stateDir,
    fake,
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

const committed = (result: MethodResults["apply"]): number => {
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result.kind === "committed" ? result.receipt.revision : -1;
};

test("a message reaches only the bound conversation; ack and applied are bound to the pairing", async () => {
  await withRig("flow", async (rig) => {
    const { human, fake } = rig;
    const events: HostEvent[] = [];
    await human.call("subscribe", {});
    human.onEvent((event) => events.push(event));
    committed(await human.call("apply", { request: generate() }));
    const pair = await human.call("pair.agent", { agent: "claude", name: "Claude" });
    const other = await human.call("pair.agent", { agent: "codex" });

    const listed = await human.call("recipient.list", {});
    assert.equal(listed.find((r) => r.agent === "claude")?.availability.state, "unbound");
    await failsWith(
      human.call("steer.send", { agent: "claude", requestId: requestId("s"), text: "hi" }),
      "RecipientUnbound",
    );
    assert.equal(fake.sent.length, 0);

    const bound = await human.call("recipient.bind", { agent: "claude", route: t3Route });
    assert.equal(bound.pairingId, pair.pairingId);
    const checked = await human.call("recipient.check", { agent: "claude" });
    assert.equal(checked.availability.state, "ready");
    assert.equal(checked.availability.conversation?.busy, true);

    const part = (await human.call("current", { documentId: docId })).document?.parts[1]?.id ?? "";
    assert.ok(part);
    const head = committed(await human.call("apply", { request: rename(1, part, "Skull") }));
    const sendId = requestId("send");
    const sent = await human.call("steer.send", {
      agent: "claude",
      requestId: sendId,
      text: "Build on my head rename.",
      documentId: docId,
    });
    assert.match(sent.messageId, /^stm-[0-9a-z]{26}$/);
    assert.deepEqual(sent.cursor, { documentId: docId, since: 0, head });
    const accepted = await until(
      () => status(rig, sent.messageId),
      (m) => m.status === "host-accepted",
      "host acceptance",
    );
    assert.equal(accepted.delivery.receipt?.hostMessageId, "fake-1");
    assert.equal(fake.sent.length, 1);
    assert.deepEqual(fake.sent[0]?.route, t3Route);
    const prompt = fake.sent[0]?.prompt ?? "";
    assert.match(prompt, new RegExp(sent.messageId));
    assert.match(prompt, /changes doc-marsh01 --since 0 --by human --credential/);
    assert.doesNotMatch(
      prompt,
      /"secret"/,
      "the prompt names the credential file, never its contents",
    );

    const again = await human.call("steer.send", {
      agent: "claude",
      requestId: sendId,
      text: "Build on my head rename.",
      documentId: docId,
    });
    assert.equal(again.messageId, sent.messageId);
    await failsWith(
      human.call("steer.send", { agent: "claude", requestId: sendId, text: "Other words" }),
      "RequestConflict",
    );
    assert.equal(fake.sent.length, 1);

    const claude = await agentClient(rig, pair.credentialFile);
    const codex = await agentClient(rig, other.credentialFile);
    try {
      const inbox = await claude.call("inbox.read", {});
      assert.deepEqual(
        inbox.messages.map((m) => m.messageId),
        [sent.messageId],
      );
      assert.equal((await codex.call("inbox.read", {})).messages.length, 0);
      await failsWith(codex.call("inbox.ack", { messageId: sent.messageId }), "MessageMissing");
      await failsWith(
        claude.call("steer.send", { agent: "claude", requestId: requestId("x"), text: "spoof" }),
        "Forbidden",
      );

      await failsWith(
        claude.call("inbox.applied", {
          messageId: sent.messageId,
          documentId: docId,
          requestId: sendId,
        }),
        "SteeringUnacknowledged",
      );
      const acked = await claude.call("inbox.ack", { messageId: sent.messageId });
      assert.equal(acked.status, "acknowledged");
      assert.equal(acked.acknowledged?.pairingId, pair.pairingId);
      assert.equal(
        (await claude.call("inbox.ack", { messageId: sent.messageId })).status,
        "acknowledged",
      );

      const personRequest = requestId("person");
      committed(await human.call("apply", { request: rename(head, part, "Crown", personRequest) }));
      await failsWith(
        claude.call("inbox.applied", {
          messageId: sent.messageId,
          documentId: docId,
          requestId: personRequest,
        }),
        "Forbidden",
      );
      const proposalRequest = requestId("prop");
      const proposed = await claude.call("apply", {
        request: request(
          head + 1,
          {
            type: "proposal.create",
            proposal: "prop-skull",
            summary: "Bigger skull",
            content: { kind: "ops", ops: [{ op: "part.rename", part, label: "Big skull" }] },
          },
          proposalRequest,
        ),
      });
      assert.equal(proposed.kind, "committed", JSON.stringify(proposed));
      const applied = await claude.call("inbox.applied", {
        messageId: sent.messageId,
        documentId: docId,
        requestId: proposalRequest,
      });
      assert.equal(applied.status, "proposed");
      assert.equal(applied.applied, null);
      assert.equal(applied.report?.kind, "proposal");
      assert.deepEqual(applied.report?.proposal, { id: "prop-skull", version: 1 });
      assert.equal(applied.review?.state, "pending");
      const acceptRequest = requestId("accept");
      const acceptedAt = committed(
        await human.call("apply", {
          request: request(
            head + 1,
            { type: "proposal.accept", proposal: "prop-skull", version: 1 },
            acceptRequest,
          ),
        }),
      );
      const done = await until(
        () => status(rig, sent.messageId),
        (m) => m.status === "applied",
        "applied after the person accepts",
      );
      assert.equal(done.applied?.via, "proposal-accepted");
      assert.equal(done.applied?.revision, acceptedAt);
      assert.equal(done.applied?.requestId, acceptRequest);
      assert.equal(done.applied?.acceptedBy?.kind, "human");
      assert.equal(done.review?.acceptedRevision, acceptedAt);

      const next = await human.call("steer.send", {
        agent: "claude",
        requestId: requestId("next"),
        text: "And now?",
        documentId: docId,
      });
      assert.equal(next.cursor?.since, head);
    } finally {
      claude.close();
      codex.close();
    }
    const statuses = events.flatMap((e) =>
      e.event === "steer" && e.messageId === sent.messageId ? [String(e.status)] : [],
    );
    for (const expected of [
      "queued",
      "dispatching",
      "host-accepted",
      "acknowledged",
      "proposed",
      "applied",
    ])
      assert.ok(statuses.includes(expected), `steer event ${expected} in ${statuses.join(",")}`);
  });
});

test("applied means a real revision: proposals await review, can be discarded or superseded, and earlier requests never count", async () => {
  await withRig("review", async (rig) => {
    committed(await rig.human.call("apply", { request: generate() }));
    const part = (await rig.human.call("current", { documentId: docId })).document?.parts[1]?.id;
    assert.ok(part);
    const pair = await rig.human.call("pair.agent", { agent: "claude" });
    await rig.human.call("recipient.bind", { agent: "claude", route: t3Route });
    await rig.human.call("apply", {
      request: request(1, { type: "policy.set", agentDirectEdit: true }),
    });
    let claude = await agentClient(rig, pair.credentialFile);
    const earlyRequest = requestId("early");
    let head = committed(
      await claude.call("apply", { request: rename(1, part, "Early", earlyRequest) }),
    );

    const send = async (text: string) => {
      const sent = await rig.human.call("steer.send", {
        agent: "claude",
        requestId: requestId("m"),
        text,
        documentId: docId,
      });
      await until(
        () => status(rig, sent.messageId),
        (m) => m.status === "host-accepted",
        "acceptance",
      );
      await claude.call("inbox.ack", { messageId: sent.messageId });
      return sent.messageId;
    };
    const propose = async (proposal: string, label: string) => {
      const id = requestId("prop");
      const result = await claude.call("apply", {
        request: request(
          head,
          {
            type: "proposal.create",
            proposal,
            summary: label,
            content: { kind: "ops", ops: [{ op: "part.rename", part, label }] },
          },
          id,
        ),
      });
      assert.equal(result.kind, "committed", JSON.stringify(result));
      return id;
    };
    const link = (messageId: string, id: string) =>
      claude.call("inbox.applied", { messageId, documentId: docId, requestId: id });

    const first = await send("Use the earlier one?");
    await failsWith(link(first, earlyRequest), "InvalidArgument");
    assert.equal((await status(rig, first)).report, null);

    const directRequest = requestId("direct");
    head = committed(
      await claude.call("apply", { request: rename(head, part, "Direct", directRequest) }),
    );
    const direct = await link(first, directRequest);
    assert.equal(direct.status, "applied");
    assert.equal(direct.applied?.via, "direct");
    assert.equal(direct.applied?.revision, head);
    assert.equal((await link(first, directRequest)).status, "applied", "repeat is the same");
    const read = await claude.call("inbox.read", { all: true });
    assert.equal(read.messages.find((m) => m.messageId === first)?.applied?.via, "direct");
    await failsWith(link(first, earlyRequest), "RequestConflict");

    const second = await send("Try a proposal");
    const discardedRequest = await propose("prop-a", "Proposal A");
    assert.equal((await link(second, discardedRequest)).status, "proposed");
    const discardRequest = requestId("discard");
    await rig.human.call("apply", {
      request: request(head, { type: "proposal.discard", proposal: "prop-a" }, discardRequest),
    });
    const discarded = await until(
      () => status(rig, second),
      (m) => m.status === "proposal-discarded",
      "discard",
    );
    assert.equal(discarded.applied, null);
    assert.equal(discarded.review?.decisionRequestId, discardRequest);
    assert.equal(discarded.review?.decidedBy?.kind, "human");

    const third = await send("Another proposal");
    const v1Request = await propose("prop-b", "Proposal B");
    assert.equal((await link(third, v1Request)).review?.version, 1);
    const v2Request = requestId("refine");
    const refined = await claude.call("apply", {
      request: request(
        head,
        {
          type: "proposal.refine",
          proposal: "prop-b",
          version: 1,
          summary: "Proposal B, refined",
          content: { kind: "ops", ops: [{ op: "part.rename", part, label: "Proposal B2" }] },
        },
        v2Request,
      ),
    });
    assert.equal(refined.kind, "committed", JSON.stringify(refined));
    const superseded = await until(
      () => status(rig, third),
      (m) => m.status === "proposal-superseded",
      "superseded by the refinement",
    );
    assert.equal(superseded.review?.decisionRequestId, v2Request);
    assert.equal(superseded.review?.latestVersion, 2);
    const relinked = await link(third, v2Request);
    assert.equal(relinked.status, "proposed");
    assert.equal(relinked.review?.version, 2);
    await failsWith(link(third, v1Request), "RequestConflict");

    claude.close();
    await rig.restart();
    claude = await agentClient(rig, pair.credentialFile);
    assert.equal((await status(rig, third)).status, "proposed");
    const acceptRequest = requestId("accept");
    const acceptedAt = committed(
      await rig.human.call("apply", {
        request: request(
          head,
          { type: "proposal.accept", proposal: "prop-b", version: 2 },
          acceptRequest,
        ),
      }),
    );
    const applied = await until(
      () => status(rig, third),
      (m) => m.status === "applied",
      "acceptance applies",
    );
    assert.equal(applied.applied?.revision, acceptedAt);
    assert.equal(applied.applied?.requestId, acceptRequest);
    assert.deepEqual(applied.applied?.proposal, { id: "prop-b", version: 2 });
    assert.equal((await status(rig, second)).status, "proposal-discarded");

    head = acceptedAt;
    const fourth = await send("One more");
    const cRequest = await propose("prop-c", "Proposal C");
    await link(fourth, cRequest);
    await rig.human.call("apply", {
      request: request(head, {
        type: "proposal.refine",
        proposal: "prop-c",
        version: 1,
        summary: "The person's version",
        content: { kind: "ops", ops: [{ op: "part.rename", part, label: "Person C" }] },
      }),
    });
    committed(
      await rig.human.call("apply", {
        request: request(head, { type: "proposal.accept", proposal: "prop-c", version: 2 }),
      }),
    );
    const stale = await until(
      () => status(rig, fourth),
      (m) => m.review?.latestVersion === 2,
      "the person's version",
    );
    assert.equal(stale.status, "proposal-superseded");
    assert.equal(stale.applied, null);
    await failsWith(link(fourth, requestId("nope")), "ReceiptMissing");
    claude.close();
  });
});

test("offline routes retry; unknown outcomes wait for the person; a restart never resends blindly", async () => {
  await withRig("retry", async (rig) => {
    const { fake } = rig;
    await rig.human.call("pair.agent", { agent: "claude" });
    await rig.human.call("recipient.bind", { agent: "claude", route: t3Route });

    let offline = 2;
    fake.next = () =>
      offline-- > 0
        ? Promise.resolve({ kind: "offline", detail: "server not running" })
        : Promise.resolve({
            kind: "accepted",
            receipt: { transport: "t3-thread", delivery: "queued", at: Date.now() },
          });
    const first = await rig.human.call("steer.send", {
      agent: "claude",
      requestId: requestId("off"),
      text: "one",
    });
    const second = await rig.human.call("steer.send", {
      agent: "claude",
      requestId: requestId("off"),
      text: "two",
    });
    const done = await until(
      () => status(rig, second.messageId),
      (m) => m.status === "host-accepted",
      "both after the route came back",
    );
    assert.equal(done.delivery.attempts, 1);
    assert.equal((await status(rig, first.messageId)).delivery.attempts, 3);
    assert.deepEqual(
      fake.sent.map((s) => s.messageId),
      [first.messageId, first.messageId, first.messageId, second.messageId],
      "per-agent order is kept: the second waits behind the first",
    );

    fake.next = () => Promise.resolve({ kind: "unknown", detail: "timed out mid-send" });
    const unsure = await rig.human.call("steer.send", {
      agent: "claude",
      requestId: requestId("unk"),
      text: "three",
    });
    await until(
      () => status(rig, unsure.messageId),
      (m) => m.status === "delivery-unknown",
      "unknown",
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fake.sent.filter((s) => s.messageId === unsure.messageId).length, 1, "not resent");
    fake.next = () =>
      Promise.resolve({
        kind: "accepted",
        receipt: { transport: "t3-thread", delivery: "queued", at: Date.now() },
      });
    await rig.human.call("steer.retry", { messageId: unsure.messageId });
    await until(
      () => status(rig, unsure.messageId),
      (m) => m.status === "host-accepted",
      "retried",
    );

    fake.next = () => new Promise<DeliveryOutcome>(() => undefined);
    const hanging = await rig.human.call("steer.send", {
      agent: "claude",
      requestId: requestId("hang"),
      text: "four",
    });
    await until(
      () => status(rig, hanging.messageId),
      (m) => m.status === "dispatching",
      "dispatching",
    );
    const sentBefore = fake.sent.length;
    await rig.restart();
    const recovered = await status(rig, hanging.messageId);
    assert.equal(recovered.status, "delivery-unknown");
    assert.match(recovered.delivery.detail ?? "", /may already have it/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fake.sent.length, sentBefore, "nothing is resent after the restart");
    assert.equal((await status(rig, first.messageId)).status, "host-accepted");
  });
});

test("re-pairing or revoking revokes open messages and unbinds; nothing moves to another conversation", async () => {
  await withRig("revoke", async (rig) => {
    const { human, fake } = rig;
    const first = await human.call("pair.agent", { agent: "claude" });
    await human.call("recipient.bind", { agent: "claude", route: t3Route });
    fake.next = () => Promise.resolve({ kind: "offline", detail: "down" });
    const waiting = await human.call("steer.send", {
      agent: "claude",
      requestId: requestId("rv"),
      text: "pending",
    });
    const old = await agentClient(rig, first.credentialFile);
    try {
      const second = await human.call("pair.agent", { agent: "claude" });
      assert.notEqual(second.pairingId, first.pairingId);
      const revoked = await status(rig, waiting.messageId);
      assert.equal(revoked.status, "revoked");
      const view = await human.call("recipient.list", {});
      assert.equal(view.find((r) => r.agent === "claude")?.availability.state, "unbound");
      await failsWith(
        old.call("inbox.ack", { messageId: waiting.messageId }),
        "CredentialRejected",
      );
      await failsWith(
        human.call("steer.send", { agent: "claude", requestId: requestId("rv"), text: "x" }),
        "RecipientUnbound",
      );
      await human.call("recipient.bind", {
        agent: "claude",
        route: { ...t3Route, conversation: "thread:other" },
      });
      await failsWith(
        human.call("steer.retry", { messageId: waiting.messageId }),
        "SteeringSettled",
      );
      await human.call("pair.revoke", { agent: "claude" });
      assert.equal(
        (await human.call("recipient.list", {})).some((r) => r.agent === "claude"),
        false,
      );
    } finally {
      old.close();
    }
  });
});

test("a recipient changed after sending fails the message instead of retargeting it", async () => {
  await withRig("retarget", async (rig) => {
    const { human, fake } = rig;
    await human.call("pair.agent", { agent: "claude" });
    await human.call("recipient.bind", { agent: "claude", route: t3Route });
    fake.next = () => Promise.resolve({ kind: "offline", detail: "down" });
    const queued = await human.call("steer.send", {
      agent: "claude",
      requestId: requestId("rt"),
      text: "for the first thread",
    });
    await until(
      () => status(rig, queued.messageId),
      (m) => m.delivery.attempts >= 1,
      "attempt",
    );
    await human.call("recipient.bind", {
      agent: "claude",
      route: { ...t3Route, conversation: "thread:second" },
    });
    fake.next = () =>
      Promise.resolve({
        kind: "accepted",
        receipt: { transport: "t3-thread", at: Date.now() },
      });
    const failed = await until(
      () => status(rig, queued.messageId),
      (m) => m.status === "failed",
      "failed on recipient change",
    );
    assert.match(failed.delivery.detail ?? "", /not delivered/);
    assert.ok(
      fake.sent.every((s) => s.route.transport === "t3-thread" && s.route.conversation === thread),
    );
    await failsWith(human.call("steer.retry", { messageId: queued.messageId }), "RecipientChanged");
  });
});

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
    const view = await human.call("recipient.check", { agent: "codex" });
    assert.equal(view.availability.state, "inbox-only");
    assert.equal(view.availability.push, false);
    const sent = await human.call("steer.send", {
      agent: "codex",
      requestId: requestId("ib"),
      text: "read me",
    });
    assert.equal(sent.status, "inbox-only");
    const codex = await agentClient(rig, pair.credentialFile);
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
    await until(
      () => human.call("recipient.check", { agent: "claude" }),
      (v) => v.availability.state === "offline",
      "offline after disconnect",
    );
    const waiting = await human.call("steer.send", {
      agent: "claude",
      requestId: requestId("ch"),
      text: "later",
    });
    await until(
      () => status(rig, waiting.messageId),
      (m) => m.delivery.attempts >= 1,
      "attempt",
    );
    assert.equal((await status(rig, waiting.messageId)).status, "queued");
  });
});

test("a project replaced at the same path starts a fresh outbox; old routes never resume", async () => {
  const root = tempDir("steer-replaced");
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const fake = new FakeT3();
  fake.next = () => Promise.resolve({ kind: "offline", detail: "down" });
  const options: HostOptions = {
    path: project,
    stateDir,
    create: { label: "First" },
    human: person,
    durability: "normal",
    transports: [fake],
    steeringTiming: { retryBaseMs: 20 },
  };
  let host = await startHost(options);
  let human = await connect({ credential: { role: "human", project }, stateDir });
  await human.call("pair.agent", { agent: "claude" });
  await human.call("recipient.bind", { agent: "claude", route: t3Route });
  const old = await human.call("steer.send", {
    agent: "claude",
    requestId: requestId("rp"),
    text: "for the first project",
  });
  human.close();
  await host.close();
  fs.rmSync(project, { recursive: true, force: true });

  host = await startHost({ ...options, create: { label: "Second" } });
  human = await connect({ credential: { role: "human", project }, stateDir });
  try {
    assert.notEqual(host.project.info.projectId, "");
    assert.deepEqual(await human.call("recipient.list", {}), []);
    assert.equal((await human.call("steer.list", {})).messages.length, 0);
    await failsWith(human.call("steer.get", { messageId: old.messageId }), "MessageMissing");
    const kept = fs
      .readdirSync(hostFiles(project, { stateDir }).dir)
      .filter((f) => f.startsWith("steering.replaced-"));
    assert.ok(kept.length >= 1, "the first project's outbox is kept aside, not reused");
    const before = fake.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(fake.sent.length, before, "nothing from the old outbox is delivered");
  } finally {
    human.close();
    await host.close();
  }
});
