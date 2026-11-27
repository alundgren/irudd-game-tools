import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import {
  artDigest,
  connect,
  readArtFile,
  uploadArt,
  WorkshopError,
  type WorkshopClient,
} from "@irudd/workshop/client";
import {
  startHost,
  workshopRegistry,
  type ArtCut,
  type ArtTranslator,
  type HostOptions,
  type RunningHost,
} from "@irudd/workshop/host";
import { Effect } from "effect";
import {
  applyChanges,
  assetCredits,
  assetCreditsNamespace,
  decodeWith,
  storedAssetCredits,
} from "@irudd/document";
import { createProject, openProject, restoreProject } from "@irudd/workshop";
import { ArtBrief as ArtBriefSchema, ArtReply, type artParams } from "@irudd/workshop/wire";
import type { ArtBrief, MethodResults, RecipientRoute } from "@irudd/workshop/wire";
import { docId, generate, rename, request, requestId, tempDir } from "./support/fixtures.js";
import { png } from "./support/png.js";

const require = createRequire(import.meta.url);
const childProcess: unknown = require("node:child_process");
assert.ok(typeof childProcess === "object" && childProcess !== null);
const launched: string[] = [];
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original: unknown = Reflect.get(childProcess, name);
  if (typeof original !== "function") continue;
  Reflect.set(childProcess, name, function (this: unknown, ...args: unknown[]): unknown {
    launched.push(`${name} ${String(args[0])}`);
    const result: unknown = Reflect.apply(original, this, args);
    return result;
  });
}
syncBuiltinESMExports();

type ArtBriefInput = (typeof artParams)["art.request"]["Encoded"]["brief"];
type ArtReplyInput = (typeof artParams)["art.submit"]["Encoded"]["reply"];

const person = { kind: "human", id: "tester", name: "Tester" } as const;
const route = {
  transport: "claude-channel",
  host: "claude-code",
  environment: "local",
  server: "irudd",
  instance: "chn-000000000000000000000001",
} as const satisfies RecipientRoute;

interface ChannelLog {
  readonly sent: { prompt: string }[];
}

interface Rig {
  readonly root: string;
  readonly project: string;
  readonly stateDir: string;
  readonly fake: ChannelLog;
  readonly host: RunningHost;
  readonly human: WorkshopClient;
  readonly agent: WorkshopClient;
  readonly credentialFile: string;
  readonly pairingId: string;
  close(): Promise<void>;
}

interface RigOptions {
  readonly translators?: ReadonlyArray<ArtTranslator>;
  readonly cut?: HostOptions["artCut"];
  readonly shipped?: ReadonlyArray<string>;
}

async function openRig(root: string, o: RigOptions = {}, earlier?: Rig): Promise<Rig> {
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const fake: ChannelLog = { sent: [] };
  const options: HostOptions = {
    path: project,
    stateDir,
    create: { label: "Art test" },
    human: person,
    durability: "normal",
    artTranslators: o.translators ?? [],
    ...(o.cut ? { artCut: o.cut } : {}),
    ...(o.shipped ? { shippedArtwork: o.shipped } : {}),
    steeringTiming: { retryBaseMs: 20, deliverTimeoutMs: 2000 },
  };
  const host = await startHost(options);
  const human = await connect({ credential: { role: "human", project }, stateDir });
  let credentialFile = earlier?.credentialFile ?? "";
  let pairingId = earlier?.pairingId ?? "";
  if (!earlier) {
    await human.call("apply", { request: generate() });
    const pair = await human.call("pair.agent", { agent: "claude", name: "Claude" });
    credentialFile = pair.credentialFile;
    pairingId = pair.pairingId;
  }
  const agent = await connect({ credential: { role: "agent", file: credentialFile }, stateDir });
  await agent.call("inbox.watch", {
    push: "claude-channel",
    instance: route.instance,
    server: route.server,
  });
  agent.onEvent((event) => {
    if (event.event === "inbox") {
      fake.sent.push({ prompt: event.prompt });
      void agent.call("inbox.pushed", { messageId: event.messageId }).catch(() => undefined);
    }
  });
  if (!earlier) await human.call("recipient.bind", { agent: "claude", route });
  return {
    root,
    project,
    stateDir,
    fake,
    host,
    human,
    agent,
    credentialFile,
    pairingId,
    close: async () => {
      agent.close();
      human.close();
      await host.close();
    },
  };
}

async function withRig(
  name: string,
  body: (rig: Rig) => Promise<void>,
  translators: ReadonlyArray<ArtTranslator> = [],
): Promise<void> {
  const root = tempDir(`art-${name}`);
  const rig = await openRig(root, { translators });
  try {
    await body(rig);
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
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

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline)
      assert.fail(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const committed = (result: MethodResults["apply"]): number => {
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result.kind === "committed" ? result.receipt.revision : -1;
};

async function views(rig: Rig) {
  const front = await uploadArt(
    rig.human,
    png(640, 640, [200, 120, 90], { at: 100, size: 50, rgb: [10, 10, 10] }),
  );
  const side = await uploadArt(rig.human, png(640, 640, [90, 120, 200]));
  return { front, side };
}

function brief(
  kind: ArtBrief["kind"],
  revision: number,
  attachments: ReadonlyArray<{
    readonly role: ArtBrief["attachments"][number]["role"];
    readonly digest: string;
    readonly label?: string;
  }>,
  extra: { readonly parts?: ReadonlyArray<string>; readonly height?: number } = {},
): ArtBriefInput {
  return {
    format: "irudd.art-brief",
    version: 1,
    kind,
    documentId: docId,
    revision,
    direction: "Make the head read as a heron's: long beak, narrow skull.",
    attachments,
    ...extra,
  };
}

type VariationReply = Extract<ArtReplyInput, { readonly kind: "variation" }>;
const variation = (part: string, label: string, summary = "Heron head"): VariationReply => ({
  format: "irudd.art-reply",
  version: 1,
  kind: "variation",
  summary,
  operations: [{ op: "part.rename", part, label }],
});

async function headPart(rig: Rig): Promise<string> {
  const part = (await rig.human.call("current", { documentId: docId })).document?.parts[1]?.id;
  assert.ok(part);
  return part;
}

test("an offline brief preserves its images for a human import without sending a message", async () => {
  await withRig("offline-file", async (rig) => {
    const { front } = await views(rig);
    const request = {
      agent: "offline",
      offline: true,
      requestId: requestId("file"),
      brief: brief("variation", 1, [{ role: "front", digest: front.digest }]),
    };
    const saved = await rig.human.call("art.request", request);
    assert.equal(saved.steering, null);
    assert.equal(rig.fake.sent.length, 0);
    assert.equal((await rig.human.call("art.request", request)).artId, saved.artId);
    assert.deepEqual(
      (await readArtFile(rig.human, saved.artId, front.digest)).bytes.length,
      front.byteLength,
    );
    const reply = await rig.human.call("art.submit", {
      artId: saved.artId,
      submissionId: requestId("import"),
      reply: variation(await headPart(rig), "Heron"),
    });
    assert.equal(reply.submission.state, "proposed");
    assert.equal(reply.submission.via, "person-import");
  });
});

test("a brief with attachments reaches the bound conversation and the reply is the agent's proposal", async () => {
  await withRig("flow", async (rig) => {
    const { human, agent, fake } = rig;
    const { front, side } = await views(rig);
    assert.equal(front.width, 640);
    assert.equal(front.mediaType, "image/png");
    const part = await headPart(rig);
    const requested = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief(
        "variation",
        1,
        [
          { role: "front", digest: front.digest, label: "editor front" },
          { role: "side", digest: side.digest },
        ],
        { parts: [part] },
      ),
    });
    assert.match(requested.artId, /^art-[0-9a-f]{24}$/);
    assert.equal(requested.state, "open");
    assert.deepEqual(
      requested.attachments.map((a) => [a.role, a.width, a.height, a.mediaType]),
      [
        ["front", 640, 640, "image/png"],
        ["side", 640, 640, "image/png"],
      ],
    );

    await until(
      () => human.call("steer.get", { messageId: requested.messageId }),
      (m) => m.status === "host-accepted",
      "delivery",
    );
    assert.equal(fake.sent.length, 1);
    const prompt = fake.sent[0]?.prompt ?? "";
    assert.match(prompt, new RegExp(`art show ${requested.artId} --out`));
    assert.match(prompt, new RegExp(`art submit ${requested.artId} --ops`));
    assert.match(prompt, new RegExp(front.digest));
    assert.doesNotMatch(prompt, /irudd propose /);

    const listed = await agent.call("art.list", {});
    assert.deepEqual(
      listed.requests.map((r) => r.artId),
      [requested.artId],
    );
    const bytes = await readArtFile(agent, requested.artId, front.digest);
    assert.equal(bytes.bytes.length, front.byteLength);
    await failsWith(
      agent.call("art.request", {
        agent: "claude",
        requestId: requestId("x"),
        brief: requested.brief,
      }),
      "Forbidden",
    );

    const submitted = await agent.call("art.submit", {
      artId: requested.artId,
      submissionId: requestId("sub"),
      reply: variation(part, "Heron head"),
    });
    assert.equal(submitted.outcome, "new");
    const s = submitted.submission;
    assert.equal(s.state, "proposed", JSON.stringify(s.diagnostics));
    assert.equal(s.via, "agent");
    assert.deepEqual(s.by, { kind: "agent", id: "claude", name: "Claude" });
    assert.equal(s.translator, "operations");
    assert.equal(s.proposal?.status, "draft");
    assert.equal(s.proposal?.baseRevision, 1);
    assert.deepEqual(s.source, { baseRevision: 1, headAtSubmit: 1, stale: false });
    assert.equal(submitted.request.state, "answered");

    const inspected = await human.call("inspect", { documentId: docId });
    assert.equal(inspected.revision, 1);
    const proposal = inspected.proposals.find((p) => p.id === s.proposal?.id);
    assert.equal(proposal?.author.id, "claude");
    const linked = await human.call("steer.get", { messageId: requested.messageId });
    assert.equal(linked.status, "proposed");
    assert.equal(linked.acknowledged?.agent, "claude");

    const accepted = committed(
      await human.call("apply", {
        request: request(1, {
          type: "proposal.accept",
          proposal: s.proposal?.id ?? "",
          version: 1,
        }),
      }),
    );
    assert.equal(accepted, 2);
    const after = await human.call("art.get", { artId: requested.artId });
    assert.equal(after.submissions[0]?.proposal?.status, "accepted");
    assert.equal(after.submissions[0]?.proposal?.acceptedRevision, 2);
    await until(
      () => human.call("steer.get", { messageId: requested.messageId }),
      (m) => m.status === "applied",
      "applied",
    );
    committed(await human.call("apply", { request: request(2, { type: "undo", target: 2 }) }));
    const undone = await human.call("current", { documentId: docId });
    assert.notEqual(undone.document?.parts.find((p) => p.id === part)?.label, "Heron head");
  });
});

test("a retried reply replays, a changed one conflicts and a repeated one is a duplicate", async () => {
  await withRig("dedupe", async (rig) => {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const part = await headPart(rig);
    const r = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "front", digest: front.digest }]),
    });
    const id = requestId("sub");
    const first = await agent.call("art.submit", {
      artId: r.artId,
      submissionId: id,
      reply: variation(part, "Heron"),
    });
    const again = await agent.call("art.submit", {
      artId: r.artId,
      submissionId: id,
      reply: variation(part, "Heron"),
    });
    assert.equal(again.outcome, "replayed");
    assert.deepEqual(again.submission.proposal?.id, first.submission.proposal?.id);
    await failsWith(
      agent.call("art.submit", {
        artId: r.artId,
        submissionId: id,
        reply: variation(part, "Egret"),
      }),
      "RequestConflict",
    );
    const duplicate = await agent.call("art.submit", {
      artId: r.artId,
      submissionId: requestId("sub"),
      reply: variation(part, "Heron"),
    });
    assert.equal(duplicate.submission.duplicateOf, id);
    assert.equal(duplicate.submission.proposal?.id, first.submission.proposal?.id);
    const inspected = await human.call("inspect", { documentId: docId });
    assert.equal(inspected.proposals.length, 1, "a duplicate drafts nothing new");
    const same = await human.call("art.request", {
      agent: "claude",
      requestId: r.requestId,
      brief: r.brief,
    });
    assert.equal(same.artId, r.artId);
    await failsWith(
      human.call("art.request", {
        agent: "claude",
        requestId: r.requestId,
        brief: { ...r.brief, direction: "other" },
      }),
      "RequestConflict",
    );
  });
});

test("a reply after a manual edit is a stale proposal that leaves the head alone", async () => {
  await withRig("stale", async (rig) => {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const part = await headPart(rig);
    const r = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "front", digest: front.digest }]),
    });
    committed(await human.call("apply", { request: rename(1, part, "Person's skull") }));
    const s = (
      await agent.call("art.submit", {
        artId: r.artId,
        submissionId: requestId("sub"),
        reply: variation(part, "Heron head"),
      })
    ).submission;
    assert.equal(s.state, "proposed");
    assert.deepEqual(s.source, { baseRevision: 1, headAtSubmit: 2, stale: true });
    const current = await human.call("current", { documentId: docId });
    assert.equal(current.revision, 2);
    assert.equal(current.document?.parts.find((p) => p.id === part)?.label, "Person's skull");
    const draft = await human.call("draft", {
      documentId: docId,
      proposalId: s.proposal?.id ?? "",
    });
    assert.ok(draft.ok);
    assert.equal(draft.ok && draft.stale, true);
    assert.equal(draft.ok && draft.preview.parts.find((p) => p.id === part)?.label, "Heron head");
    const refused = await human.call("apply", {
      request: request(2, { type: "proposal.accept", proposal: s.proposal?.id ?? "", version: 1 }),
    });
    assert.equal(refused.kind, "rejected");
    assert.equal(refused.kind === "rejected" && refused.diagnostics[0]?.code, "stale-revision");
    committed(
      await human.call("apply", {
        request: request(2, { type: "proposal.discard", proposal: s.proposal?.id ?? "" }),
      }),
    );
    await until(
      () => human.call("steer.get", { messageId: r.messageId }),
      (m) => m.status === "proposal-discarded",
      "discard",
    );
    const view = await human.call("art.get", { artId: r.artId });
    assert.equal(view.submissions[0]?.proposal?.status, "discarded");
    assert.equal(view.stale, true);
  });
});

test("invalid replies are recorded with diagnostics and propose nothing", async () => {
  await withRig("invalid", async (rig) => {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const part = await headPart(rig);
    const r = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "front", digest: front.digest }]),
    });
    const wrongKind = await agent.call("art.submit", {
      artId: r.artId,
      submissionId: requestId("sub"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "depth",
        summary: "depth",
        image: front.digest,
      },
    });
    assert.equal(wrongKind.submission.state, "rejected");
    assert.deepEqual(wrongKind.submission.diagnostics[0]?.path, ["reply", "kind"]);
    const badOp = await agent.call("art.submit", {
      artId: r.artId,
      submissionId: requestId("sub"),
      reply: {
        ...variation(part, "x"),
        operations: [{ op: "part.rename", part: "p-nothing-here", label: "x" }],
      },
    });
    assert.equal(badOp.submission.state, "rejected");
    assert.ok(badOp.submission.diagnostics.length > 0);
    assert.equal(decodeWith(ArtReply, { kind: "variation" }).ok, false);
    assert.equal((await human.call("inspect", { documentId: docId })).proposals.length, 0);
    assert.equal((await human.call("art.get", { artId: r.artId })).state, "open");
    const good = await agent.call("art.submit", {
      artId: r.artId,
      submissionId: requestId("sub"),
      reply: variation(part, "Heron"),
    });
    assert.equal(good.submission.state, "proposed");
    await failsWith(
      human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief: brief("trace", 1, [{ role: "front", digest: "sha256:" + "0".repeat(64) }]),
      }),
      "ArtRejected",
    );
    await failsWith(
      human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief: brief("variation", 9, []),
      }),
      "ArtRejected",
    );
  });
});

test("a cancelled request refuses later replies", async () => {
  await withRig("cancel", async (rig) => {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const part = await headPart(rig);
    const r = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "front", digest: front.digest }]),
    });
    await agent.call("inbox.ack", { messageId: r.messageId });
    const cancelled = await human.call("art.cancel", { artId: r.artId });
    assert.equal(cancelled.state, "cancelled");
    assert.match(cancelled.closed?.detail ?? "", /after the agent read the brief/);
    await failsWith(
      agent.call("art.submit", {
        artId: r.artId,
        submissionId: requestId("sub"),
        reply: variation(part, "Heron"),
      }),
      "ArtClosed",
    );
    await failsWith(agent.call("art.cancel", { artId: r.artId }), "Forbidden");
    assert.equal((await agent.call("art.list", {})).requests.length, 0);
    assert.equal((await agent.call("art.list", { all: true })).requests.length, 1);
  });
});

test("only the brief's pairing sees and answers it", async () => {
  await withRig("pairing", async (rig) => {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const part = await headPart(rig);
    const r = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "front", digest: front.digest }]),
    });
    const other = await human.call("pair.agent", { agent: "codex" });
    const codex = await connect({
      credential: { role: "agent", file: other.credentialFile },
      stateDir: rig.stateDir,
    });
    try {
      assert.equal((await codex.call("art.list", {})).requests.length, 0);
      await failsWith(codex.call("art.get", { artId: r.artId }), "ArtMissing");
      await failsWith(
        codex.call("art.read", { artId: r.artId, digest: front.digest }),
        "ArtMissing",
      );
      await failsWith(
        codex.call("art.submit", {
          artId: r.artId,
          submissionId: requestId("sub"),
          reply: variation(part, "Heron"),
        }),
        "ArtMissing",
      );
    } finally {
      codex.close();
    }
    await human.call("pair.agent", { agent: "claude" });
    await failsWith(
      agent.call("art.submit", {
        artId: r.artId,
        submissionId: requestId("sub"),
        reply: variation(part, "Heron"),
      }),
      "CredentialRejected",
    );
  });
});

test("turnaround, trace and depth replies are checked; without a translator they are recorded", async () => {
  await withRig("kinds", async (rig) => {
    const { human, agent } = rig;
    const { front, side } = await views(rig);
    const caps = await agent.call("art.capabilities", {});
    assert.equal(caps.producer, "paired-agent");
    const apply = Object.fromEntries(caps.kinds.map((k) => [k.kind, k.apply.available]));
    assert.deepEqual(apply, { variation: true, turnaround: false, trace: false, depth: false });
    assert.match(
      caps.kinds.find((k) => k.kind === "depth")?.apply.reason ?? "",
      /has no depth translator/,
    );

    const depth = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("depth", 1, [
        { role: "front", digest: front.digest },
        { role: "side", digest: side.digest },
      ]),
    });
    const wide = await uploadArt(agent, png(800, 400, [128, 128, 128]));
    const misframed = await agent.call("art.submit", {
      artId: depth.artId,
      submissionId: requestId("sub"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "depth",
        summary: "depth",
        image: wide.digest,
      },
    });
    assert.equal(misframed.submission.state, "rejected");
    assert.match(misframed.submission.diagnostics[0]?.message ?? "", /frame it like/);
    const gray = await uploadArt(
      agent,
      png(640, 640, [120, 120, 120], { at: 300, size: 40, rgb: [245, 245, 245] }),
    );
    const recorded = await agent.call("art.submit", {
      artId: depth.artId,
      submissionId: requestId("sub"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "depth",
        summary: "depth",
        image: gray.digest,
      },
    });
    assert.equal(recorded.submission.state, "recorded");
    assert.deepEqual(
      recorded.submission.files.map((f) => [f.width, f.height]),
      [[640, 640]],
    );
    assert.equal(recorded.request.apply.available, false);
    assert.equal(
      (await readArtFile(human, depth.artId, gray.digest)).bytes.length,
      gray.byteLength,
    );

    const trace = await human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief(
        "trace",
        1,
        [
          { role: "front", digest: front.digest },
          { role: "side", digest: side.digest },
        ],
        { height: 1.2 },
      ),
    });
    const outline = [
      [0.4, 0.1],
      [0.6, 0.1],
      [0.6, 0.9],
      [0.4, 0.9],
    ] as const;
    const map = {
      format: "irudd.trace-map.v1" as const,
      height: 1.2,
      regions: [
        { id: "body", method: "loft" as const, front: outline, side: outline },
        { id: "head", parent: "body", method: "loft" as const, front: outline, side: outline },
      ],
    };
    const traced = await agent.call("art.submit", {
      artId: trace.artId,
      submissionId: requestId("sub"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "trace",
        summary: "two regions",
        traceMap: map,
      },
    });
    assert.equal(traced.submission.state, "recorded");
    const cycle = decodeWith(ArtReply, {
      format: "irudd.art-reply",
      version: 1,
      kind: "trace",
      summary: "cycle",
      traceMap: { ...map, regions: [{ ...map.regions[0], parent: "head" }, map.regions[1]] },
    });
    assert.equal(cycle.ok, false);
    assert.match(cycle.ok ? "" : (cycle.diagnostics[0]?.message ?? ""), /cycle/);

    const sheet = await uploadArt(
      human,
      png(1024, 1024, [255, 0, 255], { at: 200, size: 300, rgb: [40, 90, 60] }),
    );
    const depthImport = await human.call("art.submit", {
      artId: depth.artId,
      submissionId: requestId("imp"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "depth",
        summary: "imported",
        image: sheet.digest,
      },
    });
    assert.equal(depthImport.submission.via, "person-import");
    assert.equal(depthImport.submission.pairingId, null);
  });
});

test("a trace brief's intent picks its translator; a brief without one fits as before", async () => {
  await withRig("intents-bare", async (rig) => {
    const trace = (await rig.agent.call("art.capabilities", {})).kinds.find(
      (k) => k.kind === "trace",
    );
    assert.deepEqual(
      trace?.intents?.map((i) => [i.intent, i.apply.available]),
      [
        ["fit", false],
        ["build", false],
      ],
    );
    assert.match(trace?.intents?.[1]?.apply.reason ?? "", /no trace build translator/);
    const { front, side } = await views(rig);
    const attached = [
      { role: "front" as const, digest: front.digest },
      { role: "side" as const, digest: side.digest },
    ];
    const depth = decodeWith(ArtBriefSchema, { ...brief("depth", 1, attached), intent: "build" });
    assert.equal(depth.ok, false);
    assert.match(depth.ok ? "" : (depth.diagnostics[0]?.message ?? ""), /Only a trace brief/);
    await assert.rejects(
      rig.human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief: { ...brief("depth", 1, attached), intent: "build" },
      }),
      /Only a trace brief/,
    );
  });

  const calls: string[] = [];
  const fit: ArtTranslator = {
    kind: "trace",
    id: "fixture-fit",
    guidance: ["Fit guidance."],
    check: () => {
      calls.push("fit check");
      return undefined;
    },
    translate: ({ brief: b }) => {
      calls.push("fit");
      return [{ op: "part.rename", part: b.parts?.[0] ?? "", label: "Fitted" }];
    },
  };
  const build: ArtTranslator = {
    kind: "trace",
    intent: "build",
    id: "fixture-build",
    guidance: ["Build guidance."],
    check: (b) => {
      calls.push("build check");
      return b.parts?.length === 1 ? undefined : "Select a painted part of the sheet to build on.";
    },
    translate: ({ brief: b }) => {
      calls.push("build");
      return {
        operations: [{ op: "part.rename", part: b.parts?.[0] ?? "", label: "Built" }],
        notes: ["Not built: fin (outside the sheet)."],
      };
    },
  };
  await withRig(
    "intents",
    async (rig) => {
      const { human, agent } = rig;
      const { front, side } = await views(rig);
      const attached = [
        { role: "front" as const, digest: front.digest },
        { role: "side" as const, digest: side.digest },
      ];
      const part = await headPart(rig);
      const trace = (await agent.call("art.capabilities", {})).kinds.find(
        (k) => k.kind === "trace",
      );
      assert.equal(trace?.apply.translator, "fixture-fit", "the kind's apply is the default fit");
      assert.deepEqual(
        trace?.intents?.map((i) => [i.intent, i.apply.translator]),
        [
          ["fit", "fixture-fit"],
          ["build", "fixture-build"],
        ],
      );
      await failsWith(
        human.call("art.request", {
          agent: "claude",
          requestId: requestId("art"),
          brief: { ...brief("trace", 1, attached), intent: "build" },
        }),
        "ArtRejected",
      );
      assert.deepEqual(calls, ["build check"]);
      const built = await human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief: { ...brief("trace", 1, attached, { parts: [part] }), intent: "build" },
      });
      assert.equal(built.brief.intent, "build");
      assert.equal(built.apply.translator, "fixture-build");
      await until(
        () => human.call("steer.get", { messageId: built.messageId }),
        (m) => m.status === "host-accepted",
        "build instructions",
      );
      const prompt = rig.fake.sent.at(-1)?.prompt ?? "";
      assert.match(prompt, /Intent: build/);
      assert.match(prompt, /Build guidance\./);
      assert.match(prompt, /becomes a new editable part/);
      assert.doesNotMatch(prompt, /Fit guidance\./);
      const fitted = await human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief: brief("trace", 1, attached, { parts: [part] }),
      });
      assert.equal("intent" in fitted.brief, false);
      assert.equal(fitted.apply.translator, "fixture-fit");
      await until(
        () => human.call("steer.get", { messageId: fitted.messageId }),
        (m) => m.status === "host-accepted",
        "fit instructions",
      );
      assert.match(rig.fake.sent.at(-1)?.prompt ?? "", /Fit guidance\./);
      assert.doesNotMatch(rig.fake.sent.at(-1)?.prompt ?? "", /Intent: build/);

      const map = {
        format: "irudd.trace-map.v1" as const,
        height: 1.2,
        regions: [
          {
            id: "fin",
            method: "volume" as const,
            front: [
              [0.4, 0.1],
              [0.6, 0.1],
              [0.6, 0.9],
              [0.4, 0.9],
            ] as const,
            side: [
              [0.4, 0.1],
              [0.6, 0.1],
              [0.6, 0.9],
              [0.4, 0.9],
            ] as const,
          },
        ],
      };
      const reply = {
        format: "irudd.art-reply" as const,
        version: 1 as const,
        kind: "trace" as const,
        summary: "A fin",
        traceMap: map,
      };
      calls.length = 0;
      const answer = await agent.call("art.submit", {
        artId: built.artId,
        submissionId: requestId("sub"),
        reply,
      });
      assert.equal(answer.submission.state, "proposed");
      assert.equal(answer.submission.translator, "fixture-build");
      const fitAnswer = await agent.call("art.submit", {
        artId: fitted.artId,
        submissionId: requestId("sub"),
        reply,
      });
      assert.equal(fitAnswer.submission.translator, "fixture-fit");
      assert.deepEqual(calls, ["build", "fit"]);
      const proposals = (await human.call("inspect", { documentId: docId })).proposals;
      const summary = (id: string | undefined) => proposals.find((p) => p.id === id)?.summary;
      assert.equal(
        summary(answer.submission.proposal?.id),
        `trace for ${built.artId}: A fin (Not built: fin (outside the sheet).)`,
      );
    },
    [fit, build],
  );
});

test("a registered turnaround translator drafts the repaint; a small or non-square sheet is refused", async () => {
  const repaint: ArtTranslator = {
    kind: "turnaround",
    id: "fixture-repaint",
    translate: ({ files }) => [
      {
        op: "asset.add",
        asset: {
          digest: files[0]?.digest ?? "",
          mediaType: files[0]?.mediaType ?? "",
          byteLength: files[0]?.byteLength ?? 0,
          role: "paint-atlas",
        },
      },
    ],
  };
  await withRig(
    "turnaround",
    async (rig) => {
      const { human, agent } = rig;
      const { front } = await views(rig);
      await failsWith(
        human.call("art.request", {
          agent: "claude",
          requestId: requestId("art"),
          brief: brief("turnaround", 1, [{ role: "whole", digest: front.digest }], {
            parts: [await headPart(rig)],
          }),
        }),
        "ArtRejected",
      );
      assert.equal(
        (await agent.call("art.capabilities", {})).kinds.find((k) => k.kind === "turnaround")?.apply
          .translator,
        "fixture-repaint",
      );
      assert.equal(rig.fake.sent.length, 0);
    },
    [repaint],
  );
});

const fixtureRepaint: ArtTranslator = {
  kind: "turnaround",
  id: "fixture-repaint",
  translate: ({ brief, files }) => {
    const f = files[0];
    if (!f) throw new Error("no sheet");
    return [
      {
        op: "asset.add",
        asset: {
          digest: f.digest,
          mediaType: f.mediaType,
          byteLength: f.byteLength,
          role: "paint-atlas",
        },
      },
      ...(brief.parts ?? []).map((part) => ({
        op: "part.set",
        part,
        set: { paint: { atlas: f.digest } },
      })),
    ];
  },
};

let sheets = 0;
const sheetPng = () => {
  sheets += 1;
  return png(1024, 1024, [255, 0, 255], { at: 100 + sheets * 7, size: 300, rgb: [30, 60, 90] });
};

async function paintHead(rig: Rig, revision: number) {
  const sheet = await uploadArt(rig.human, sheetPng());
  const part = await headPart(rig);
  const head = committed(
    await rig.human.call("apply", {
      request: request(revision, {
        type: "edit",
        ops: [
          {
            op: "asset.add",
            asset: {
              digest: sheet.digest,
              mediaType: "image/png",
              byteLength: sheet.byteLength,
              role: "paint-atlas",
            },
          },
          { op: "part.set", part, set: { paint: { atlas: sheet.digest } } },
        ],
      }),
    }),
  );
  return { part, sheet, head };
}

type TurnaroundReply = Extract<ArtReplyInput, { readonly kind: "turnaround" }>;
const turnaround = (
  image: string,
  summary: string,
  attribution?: TurnaroundReply["attribution"],
): TurnaroundReply => ({
  format: "irudd.art-reply",
  version: 1,
  kind: "turnaround",
  summary,
  image,
  ...(attribution ? { attribution } : {}),
});

const accept = async (rig: Rig, revision: number, proposal: string | undefined) =>
  committed(
    await rig.human.call("apply", {
      request: request(revision, { type: "proposal.accept", proposal: proposal ?? "", version: 1 }),
    }),
  );

test("a turnaround brief's source sheet must be the sheet its regions paint from at that revision", async () => {
  await withRig(
    "source-sheet",
    async (rig) => {
      const { human } = rig;
      const { front } = await views(rig);
      const first = await paintHead(rig, 1);
      const turn = (revision: number, sheet: string) =>
        human.call("art.request", {
          agent: "claude",
          requestId: requestId("art"),
          brief: brief(
            "turnaround",
            revision,
            [
              { role: "whole", digest: front.digest },
              { role: "source-sheet", digest: sheet },
            ],
            { parts: [first.part] },
          ),
        });
      const wrong = await failsWith(turn(first.head, front.digest), "ArtRejected");
      assert.match(wrong.message, /Attachment 2 is not the source sheet/);
      assert.match(wrong.message, new RegExp(first.sheet.digest));
      assert.equal((await turn(first.head, first.sheet.digest)).state, "open");

      const second = await paintHead(rig, first.head);
      assert.equal((await turn(first.head, first.sheet.digest)).state, "open");
      await failsWith(turn(second.head, first.sheet.digest), "ArtRejected");
      assert.equal((await turn(second.head, second.sheet.digest)).state, "open");
      assert.equal(rig.fake.sent.length, 3, "refused briefs are never sent");
    },
    [fixtureRepaint],
  );
});

test("accepted artwork carries its credits through backup, restore and a portable archive", async () => {
  const backupDir = tempDir("art-credits-backup");
  const backup = path.join(backupDir, "copy.irudd-backup");
  const root = tempDir("art-credits");
  const bundled = sheetPng();
  const rig = await openRig(root, { translators: [fixtureRepaint], shipped: [artDigest(bundled)] });
  let archive: Uint8Array = new Uint8Array();
  let credited: unknown;
  try {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const painted = await paintHead(rig, 1);
    const ask = (
      revision: number,
      sheet: string,
      kind: "turnaround" | "variation" = "turnaround",
    ) =>
      human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief:
          kind === "turnaround"
            ? brief(
                "turnaround",
                revision,
                [
                  { role: "whole", digest: front.digest },
                  { role: "source-sheet", digest: sheet },
                ],
                { parts: [painted.part] },
              )
            : brief("variation", revision, [{ role: "whole", digest: front.digest }]),
      });
    const credits = async () => {
      const doc = (await human.call("current", { documentId: docId })).document;
      assert.ok(doc);
      return { doc, credits: assetCredits(doc), stored: storedAssetCredits(doc) };
    };

    const byAgent = await ask(painted.head, painted.sheet.digest);
    const made = await uploadArt(agent, sheetPng());
    const agentReply = await agent.call("art.submit", {
      artId: byAgent.artId,
      submissionId: requestId("sub"),
      reply: turnaround(made.digest, "Oilskin repaint", {
        author: "the conversation's image tool",
        credit: "Oilskin repaint generated for the marsh walker",
        license: "CC0-1.0",
        source: "image tool in the paired conversation",
      }),
    });
    assert.equal(agentReply.submission.state, "proposed", JSON.stringify(agentReply));
    assert.equal((await credits()).credits.size, 0);
    let head = await accept(rig, painted.head, agentReply.submission.proposal?.id);

    const byPerson = await ask(head, made.digest);
    const imported = await uploadArt(human, sheetPng());
    const personReply = await human.call("art.submit", {
      artId: byPerson.artId,
      submissionId: requestId("imp"),
      reply: turnaround(imported.digest, "Scanned linen", {
        author: "Ada Weaver",
        credit: "Linen scan by Ada Weaver",
        license: "CC-BY-4.0",
      }),
    });
    assert.equal(personReply.submission.via, "person-import");
    head = await accept(rig, head, personReply.submission.proposal?.id);
    const both = await credits();
    assert.deepEqual(both.credits.get(made.digest), {
      digest: made.digest,
      via: "paired-agent",
      submittedBy: { kind: "agent", id: "claude", name: "Claude" },
      art: { id: byAgent.artId, kind: "turnaround" },
      summary: "Oilskin repaint",
      author: "the conversation's image tool",
      credit: "Oilskin repaint generated for the marsh walker",
      license: "CC0-1.0",
      source: "image tool in the paired conversation",
    });
    const scan = both.credits.get(imported.digest);
    assert.deepEqual(scan?.submittedBy, person, "the person submitted the bytes");
    assert.equal(scan?.author, "Ada Weaver", "someone else made them");
    assert.equal(scan?.via, "person-import");

    const reuse = await ask(head, imported.digest);
    const reused = await human.call("art.submit", {
      artId: reuse.artId,
      submissionId: requestId("imp"),
      reply: turnaround(made.digest, "Back to oilskin", { author: "Somebody else" }),
    });
    head = await accept(rig, head, reused.submission.proposal?.id);
    const shippedAsk = await ask(head, made.digest);
    const shippedSheet = await uploadArt(agent, bundled);
    const shippedReply = await agent.call("art.submit", {
      artId: shippedAsk.artId,
      submissionId: requestId("sub"),
      reply: turnaround(shippedSheet.digest, "Bundled sheet", { author: "Claude" }),
    });
    head = await accept(rig, head, shippedReply.submission.proposal?.id);
    const kept = await credits();
    assert.equal(kept.credits.get(made.digest)?.author, "the conversation's image tool");
    assert.equal(kept.credits.get(made.digest)?.submittedBy.id, "claude");
    assert.equal(kept.credits.has(shippedSheet.digest), false, "shipped bytes keep their origin");
    assert.ok(kept.doc.assets.some((a) => a.digest === shippedSheet.digest));

    const removal = await ask(head, shippedSheet.digest, "variation");
    const removed = await agent.call("art.submit", {
      artId: removal.artId,
      submissionId: requestId("sub"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "variation",
        summary: "drop the unused linen scan",
        operations: [{ op: "asset.remove", digest: imported.digest }],
      },
    });
    assert.equal(removed.submission.state, "proposed", JSON.stringify(removed.submission));
    head = await accept(rig, head, removed.submission.proposal?.id);
    const after = await credits();
    assert.deepEqual(
      after.stored.map((c) => c.digest),
      [made.digest],
      "the removed picture's credit is gone from the stored record",
    );

    const forged = await ask(head, shippedSheet.digest, "variation");
    const refused = await agent.call("art.submit", {
      artId: forged.artId,
      submissionId: requestId("sub"),
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "variation",
        summary: "forged credit",
        operations: [{ op: "extension.set", namespace: assetCreditsNamespace, value: null }],
      },
    });
    assert.equal(refused.submission.state, "rejected");
    assert.match(refused.submission.diagnostics[0]?.message ?? "", /host writes/);

    const text = JSON.stringify(after.doc);
    for (const secret of [
      rig.pairingId,
      byAgent.messageId,
      route.instance,
      rig.credentialFile,
      "heron",
    ])
      assert.ok(!text.includes(secret), `the document holds ${secret}`);

    credited = after.doc.extensions[assetCreditsNamespace];
    assert.ok(credited);
    await Effect.runPromise(rig.host.project.backup(backup));
    archive = await Effect.runPromise(rig.host.project.exportArchive(docId));
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }

  const restored = path.join(tempDir("art-credits-restored"), "project");
  const other = tempDir("art-credits-archive");
  try {
    const fromBackup = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* restoreProject({ backup, path: restored, registry: workshopRegistry() });
          const project = yield* openProject({ path: restored, registry: workshopRegistry() });
          return (yield* project.current(docId)).document?.extensions[assetCreditsNamespace];
        }),
      ),
    );
    assert.deepEqual(fromBackup, credited, "a restored backup keeps the credits");
    const fromArchive = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const project = yield* createProject({
            path: other,
            label: "Receiver",
            registry: workshopRegistry(),
          });
          const session = yield* project.session({ actor: person });
          yield* session.importArchive(archive);
          return (yield* project.current(docId)).document?.extensions[assetCreditsNamespace];
        }),
      ),
    );
    assert.deepEqual(fromArchive, credited, "an imported archive keeps the credits");
  } finally {
    for (const dir of [backupDir, path.dirname(restored), other])
      fs.rmSync(dir, { recursive: true, force: true });
  }
});

const repaintBrief = (
  rig: Rig,
  front: string,
  revision: number,
  sheet: string,
  parts: ReadonlyArray<string>,
) =>
  rig.human.call("art.request", {
    agent: "claude",
    requestId: requestId("art"),
    brief: brief(
      "turnaround",
      revision,
      [
        { role: "whole", digest: front },
        { role: "source-sheet", digest: sheet },
      ],
      { parts },
    ),
  });

const currentDoc = async (rig: Rig) => {
  const doc = (await rig.human.call("current", { documentId: docId })).document;
  assert.ok(doc);
  return doc;
};

test("concurrent repaints of different regions merge their credits; one region twice still conflicts", async () => {
  await withRig(
    "concurrent-credits",
    async (rig) => {
      const { human, agent } = rig;
      const { front } = await views(rig);
      const doc = await currentDoc(rig);
      const [a, b] = [doc.parts[1]?.id, doc.parts[2]?.id];
      assert.ok(a && b);
      const s1 = await uploadArt(human, sheetPng());
      const s2 = await uploadArt(human, sheetPng());
      const add = (s: { digest: string; byteLength: number }) =>
        ({
          op: "asset.add",
          asset: {
            digest: s.digest,
            mediaType: "image/png",
            byteLength: s.byteLength,
            role: "paint-atlas",
          },
        }) as const;
      const painted = committed(
        await human.call("apply", {
          request: request(1, {
            type: "edit",
            ops: [
              add(s1),
              add(s2),
              { op: "part.set", part: a, set: { paint: { atlas: s1.digest } } },
              { op: "part.set", part: b, set: { paint: { atlas: s2.digest } } },
            ],
          }),
        }),
      );
      const reply = async (artId: string, maker: string) => {
        const made = await uploadArt(agent, sheetPng());
        const s = await agent.call("art.submit", {
          artId,
          submissionId: requestId("sub"),
          reply: turnaround(made.digest, `repaint by ${maker}`, { author: maker }),
        });
        assert.equal(s.submission.state, "proposed", JSON.stringify(s.submission));
        return { digest: made.digest, proposal: s.submission.proposal?.id ?? "" };
      };
      const first = await reply(
        (await repaintBrief(rig, front.digest, painted, s1.digest, [a])).artId,
        "Ada",
      );
      const second = await reply(
        (await repaintBrief(rig, front.digest, painted, s2.digest, [b])).artId,
        "Bo",
      );
      const third = await reply(
        (await repaintBrief(rig, front.digest, painted, s1.digest, [a])).artId,
        "Cy",
      );
      const head = await accept(rig, painted, first.proposal);

      const d = await human.call("draft", { documentId: docId, proposalId: second.proposal });
      assert.ok(d.ok && d.stale);
      assert.ok(d.rebased.ok, JSON.stringify(d.rebased));
      const rebased = applyChanges(await currentDoc(rig), d.rebased.changes);
      assert.ok(rebased.ok);
      committed(
        await human.call("apply", {
          request: request(head, {
            type: "proposal.refine",
            proposal: second.proposal,
            version: 1,
            summary: "repaint by Bo, on the current head",
            content: { kind: "replace", document: rebased.value },
          }),
        }),
      );
      committed(
        await human.call("apply", {
          request: request(head, {
            type: "proposal.accept",
            proposal: second.proposal,
            version: 2,
          }),
        }),
      );
      const merged = assetCredits(await currentDoc(rig));
      assert.equal(merged.get(first.digest)?.author, "Ada");
      assert.equal(merged.get(second.digest)?.author, "Bo");

      const clash = await human.call("draft", { documentId: docId, proposalId: third.proposal });
      assert.ok(clash.ok && !clash.rebased.ok);
      if (clash.ok && !clash.rebased.ok) {
        const paths = clash.rebased.diagnostics.map((x) => x.path.join("/"));
        assert.ok(paths.includes(`parts/${a}/paint`), paths.join(", "));
        assert.ok(!paths.some((p) => p.includes(assetCreditsNamespace)), "the credits merge");
      }
    },
    [fixtureRepaint],
  );
});

test("a manual removal retires a picture's credit, undo restores it, and the same bytes later carry their new maker", async () => {
  await withRig(
    "removed-credit",
    async (rig) => {
      const { human, agent } = rig;
      const { front } = await views(rig);
      const painted = await paintHead(rig, 1);
      const made = await uploadArt(agent, sheetPng());
      const byAgent = await agent.call("art.submit", {
        artId: (
          await repaintBrief(rig, front.digest, painted.head, painted.sheet.digest, [painted.part])
        ).artId,
        submissionId: requestId("sub"),
        reply: turnaround(made.digest, "first", { author: "Original Maker", license: "CC-BY-4.0" }),
      });
      let head = await accept(rig, painted.head, byAgent.submission.proposal?.id);
      const scan = await uploadArt(human, sheetPng());
      const imported = await human.call("art.submit", {
        artId: (await repaintBrief(rig, front.digest, head, made.digest, [painted.part])).artId,
        submissionId: requestId("imp"),
        reply: turnaround(scan.digest, "scan", { author: "Ada Weaver" }),
      });
      head = await accept(rig, head, imported.submission.proposal?.id);

      const remove = () =>
        human.call("apply", {
          request: request(head, {
            type: "edit",
            ops: [{ op: "asset.remove", digest: made.digest }],
          }),
        });
      const removedAt = committed(await remove());
      head = removedAt;
      let doc = await currentDoc(rig);
      assert.deepEqual(
        storedAssetCredits(doc).map((c) => c.author),
        ["Ada Weaver"],
        "the removed picture's credit left with it",
      );
      head = committed(
        await human.call("apply", { request: request(head, { type: "undo", target: removedAt }) }),
      );
      doc = await currentDoc(rig);
      assert.equal(
        assetCredits(doc).get(made.digest)?.author,
        "Original Maker",
        "undo restores it",
      );
      assert.equal(assetCredits(doc).get(scan.digest)?.author, "Ada Weaver");

      head = committed(await remove());
      const again = await human.call("art.submit", {
        artId: (await repaintBrief(rig, front.digest, head, scan.digest, [painted.part])).artId,
        submissionId: requestId("imp"),
        reply: turnaround(made.digest, "reimport", { author: "Someone New", license: "CC0-1.0" }),
      });
      head = await accept(rig, head, again.submission.proposal?.id);
      const credit = assetCredits(await currentDoc(rig)).get(made.digest);
      assert.equal(credit?.author, "Someone New", "no credit is inherited from before the removal");
      assert.equal(credit?.via, "person-import");
      assert.equal(credit?.license, "CC0-1.0");
    },
    [fixtureRepaint],
  );
});

test("a record holding stale credits is compacted without losing the new one; an unreadable record is refused", async () => {
  await withRig(
    "stale-credits",
    async (rig) => {
      const { human, agent } = rig;
      const { front } = await views(rig);
      const painted = await paintHead(rig, 1);
      const made = await uploadArt(agent, sheetPng());
      const stale = (digest: string, author: string) => ({
        digest,
        via: "person-import",
        submittedBy: person,
        art: { id: "art-old", kind: "turnaround" },
        summary: "old",
        author,
      });
      const old = [
        stale(made.digest, "Stale Maker"),
        ...Array.from({ length: 63 }, (_, i) =>
          stale("sha256:" + i.toString(16).padStart(64, "0"), `Old ${i}`),
        ),
      ].sort((x, y) => (x.digest < y.digest ? -1 : 1));
      const setRecord = (revision: number, value: unknown) =>
        human.call("apply", {
          request: request(revision, {
            type: "edit",
            ops: [{ op: "extension.set", namespace: assetCreditsNamespace, value }],
          }),
        });
      let head = committed(
        await setRecord(painted.head, { format: "irudd.asset-credits", version: 1, assets: old }),
      );
      const s = await agent.call("art.submit", {
        artId: (await repaintBrief(rig, front.digest, head, painted.sheet.digest, [painted.part]))
          .artId,
        submissionId: requestId("sub"),
        reply: turnaround(made.digest, "65th", { author: "New Maker" }),
      });
      assert.equal(s.submission.state, "proposed", JSON.stringify(s.submission.diagnostics));
      head = await accept(rig, head, s.submission.proposal?.id);
      const doc = await currentDoc(rig);
      assert.deepEqual(
        storedAssetCredits(doc).map((c) => [c.digest, c.author]),
        [[made.digest, "New Maker"]],
        "stale entries are compacted and the new credit replaces the stale one for its bytes",
      );

      const broken = { format: "irudd.asset-credits", version: 1, assets: "unreadable" };
      head = committed(await setRecord(head, broken));
      const other = await uploadArt(agent, sheetPng());
      const refused = await agent.call("art.submit", {
        artId: (await repaintBrief(rig, front.digest, head, made.digest, [painted.part])).artId,
        submissionId: requestId("sub"),
        reply: turnaround(other.digest, "over a broken record", { author: "New Maker" }),
      });
      assert.equal(refused.submission.state, "rejected");
      assert.match(refused.submission.diagnostics[0]?.message ?? "", /cannot be read/);
      assert.deepEqual((await currentDoc(rig)).extensions[assetCreditsNamespace], broken);
      const rename = await agent.call("art.submit", {
        artId: (
          await human.call("art.request", {
            agent: "claude",
            requestId: requestId("art"),
            brief: brief("variation", head, [{ role: "whole", digest: front.digest }]),
          })
        ).artId,
        submissionId: requestId("sub"),
        reply: variation(painted.part, "Heron"),
      });
      assert.equal(rename.submission.state, "proposed");
    },
    [fixtureRepaint],
  );
});

test("shipped bytes never take over a stale credit left for them", async () => {
  const root = tempDir("art-shipped-stale");
  const bundled = sheetPng();
  const rig = await openRig(root, { translators: [fixtureRepaint], shipped: [artDigest(bundled)] });
  try {
    const { human, agent } = rig;
    const { front } = await views(rig);
    const painted = await paintHead(rig, 1);
    const sheet = await uploadArt(agent, bundled);
    let head = committed(
      await human.call("apply", {
        request: request(painted.head, {
          type: "edit",
          ops: [
            {
              op: "extension.set",
              namespace: assetCreditsNamespace,
              value: {
                format: "irudd.asset-credits",
                version: 1,
                assets: [
                  {
                    digest: sheet.digest,
                    via: "person-import",
                    submittedBy: person,
                    art: { id: "art-old", kind: "turnaround" },
                    summary: "old",
                    author: "Stale Maker",
                  },
                ],
              },
            },
          ],
        }),
      }),
    );
    const s = await agent.call("art.submit", {
      artId: (await repaintBrief(rig, front.digest, head, painted.sheet.digest, [painted.part]))
        .artId,
      submissionId: requestId("sub"),
      reply: turnaround(sheet.digest, "bundled sheet", { author: "Claude" }),
    });
    head = await accept(rig, head, s.submission.proposal?.id);
    const doc = await currentDoc(rig);
    assert.ok(doc.assets.some((a) => a.digest === sheet.digest));
    assert.equal(assetCredits(doc).has(sheet.digest), false, "shipped bytes keep their own origin");
    assert.deepEqual(storedAssetCredits(doc), []);
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

class Cut extends Error {}

async function cutReply(name: string, point: ArtCut) {
  const root = tempDir(`art-cut-${name}`);
  let armed = false;
  const first = await openRig(root, {
    translators: [fixtureRepaint],
    cut: (at) => {
      if (armed && at === point) {
        armed = false;
        throw new Cut(at);
      }
    },
  });
  const { front } = await views(first);
  const painted = await paintHead(first, 1);
  const requested = await first.human.call("art.request", {
    agent: "claude",
    requestId: requestId("art"),
    brief: brief(
      "turnaround",
      painted.head,
      [
        { role: "whole", digest: front.digest },
        { role: "source-sheet", digest: painted.sheet.digest },
      ],
      { parts: [painted.part] },
    ),
  });
  const made = await uploadArt(first.agent, sheetPng());
  const reply = turnaround(made.digest, "Cut repaint");
  const submissionId = requestId("sub");
  armed = true;
  await assert.rejects(
    first.agent.call("art.submit", { artId: requested.artId, submissionId, reply }),
  );
  await first.close();
  const rig = await openRig(root, { translators: [fixtureRepaint] }, first);
  return { rig, root, requested, reply, submissionId };
}

const artProposals = async (rig: Rig, artId: string) =>
  (await rig.human.call("inspect", { documentId: docId })).proposals.filter((p) =>
    p.id.startsWith(`prop-${artId}-`),
  );

test("a host stopped after the proposal commit links it on restart, and a fresh submission ID is a duplicate", async () => {
  const { rig, root, requested, reply, submissionId } = await cutReply(
    "committed",
    "proposal-committed",
  );
  try {
    const view = await rig.human.call("art.get", { artId: requested.artId });
    assert.equal(view.submissions.length, 1, "the pending reply was settled from the journal");
    const settled = view.submissions[0];
    assert.equal(settled?.submissionId, submissionId);
    assert.equal(settled?.state, "proposed");
    assert.equal(settled?.proposal?.id, `prop-${requested.artId}-1`);
    assert.equal(settled?.proposal?.status, "draft");
    const message = await rig.human.call("steer.get", { messageId: requested.messageId });
    assert.equal(message.status, "proposed", "the steering message follows the proposal");

    const fresh = await rig.agent.call("art.submit", {
      artId: requested.artId,
      submissionId: requestId("sub"),
      reply,
    });
    assert.equal(fresh.submission.duplicateOf, submissionId);
    assert.equal(fresh.submission.proposal?.id, settled?.proposal?.id);
    const again = await rig.agent.call("art.submit", {
      artId: requested.artId,
      submissionId,
      reply,
    });
    assert.equal(again.outcome, "replayed");
    assert.equal((await artProposals(rig, requested.artId)).length, 1, "one proposal, never two");
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a host stopped before the proposal commit drops the pending reply; the retry drafts it once", async () => {
  const { rig, root, requested, reply } = await cutReply("pending", "submission-pending");
  try {
    const view = await rig.human.call("art.get", { artId: requested.artId });
    assert.equal(view.submissions.length, 0);
    assert.equal((await artProposals(rig, requested.artId)).length, 0);
    const retried = await rig.agent.call("art.submit", {
      artId: requested.artId,
      submissionId: requestId("sub"),
      reply,
    });
    assert.equal(retried.submission.state, "proposed");
    assert.equal(retried.submission.proposal?.id, `prop-${requested.artId}-1`);
    assert.equal((await artProposals(rig, requested.artId)).length, 1);
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a host stopped before the steering link makes it on restart", async () => {
  const { rig, root, requested, submissionId } = await cutReply("link", "submission-recorded");
  try {
    const view = await rig.human.call("art.get", { artId: requested.artId });
    assert.equal(view.submissions[0]?.submissionId, submissionId);
    const message = await rig.human.call("steer.get", { messageId: requested.messageId });
    assert.equal(message.status, "proposed");
    assert.equal(message.report?.requestId, view.submissions[0]?.proposal?.requestId);
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a brief stored before its steering message is sent by the request's retry", async () => {
  const root = tempDir("art-cut-request");
  let armed = true;
  const rig = await openRig(root, {
    cut: (at) => {
      if (armed && at === "request-stored") {
        armed = false;
        throw new Cut(at);
      }
    },
  });
  try {
    const { front } = await views(rig);
    const part = await headPart(rig);
    const params = {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "whole", digest: front.digest }], { parts: [part] }),
    };
    await assert.rejects(rig.human.call("art.request", params));
    const stored = (await rig.human.call("art.list", {})).requests[0];
    assert.equal(stored?.steering, null, "the brief is stored without its message");
    const retried = await rig.human.call("art.request", params);
    assert.equal(retried.artId, stored?.artId);
    assert.ok(retried.steering, "the retry sent the steering message");
    await until(
      () => rig.human.call("steer.get", { messageId: retried.messageId }),
      (m) => m.status === "host-accepted",
      "delivery",
    );
    assert.equal(rig.fake.sent.length, 1);
    assert.equal((await rig.human.call("art.request", params)).messageId, retried.messageId);
    assert.equal(rig.fake.sent.length, 1, "a further retry sends nothing new");
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an art log written before pending replies existed opens and keeps its requests", async () => {
  const root = tempDir("art-log-v1");
  const first = await openRig(root);
  const { front } = await views(first);
  const part = await headPart(first);
  const requested = await first.human.call("art.request", {
    agent: "claude",
    requestId: requestId("art"),
    brief: brief("variation", 1, [{ role: "whole", digest: front.digest }], { parts: [part] }),
  });
  const log = path.join(first.host.files.dir, "art.sqlite");
  await first.close();
  const db = new DatabaseSync(log);
  db.exec("DROP TABLE pending");
  db.exec("UPDATE meta SET value = '1' WHERE key = 'version'");
  db.close();
  const rig = await openRig(root, {}, first);
  try {
    assert.equal(
      (await rig.human.call("art.get", { artId: requested.artId })).artId,
      requested.artId,
    );
    const submitted = await rig.agent.call("art.submit", {
      artId: requested.artId,
      submissionId: requestId("sub"),
      reply: variation(part, "Migrated head"),
    });
    assert.equal(submitted.submission.state, "proposed");
  } finally {
    await rig.close();
  }
  const reopened = new DatabaseSync(log, { readOnly: true });
  try {
    assert.equal(
      reopened.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.["value"],
      "2",
    );
  } finally {
    reopened.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an orphaned brief is listed for recovery, sent only on its own retry and never once answered", async () => {
  const root = tempDir("art-orphan-brief");
  let cuts = 2;
  const first = await openRig(root, {
    cut: (at) => {
      if (cuts > 0 && at === "request-stored") {
        cuts -= 1;
        throw new Cut(at);
      }
    },
  });
  const { front } = await views(first);
  const part = await headPart(first);
  const ask = (direction: string) => ({
    agent: "claude",
    requestId: requestId("art"),
    brief: {
      ...brief("variation", 1, [{ role: "whole", digest: front.digest }], { parts: [part] }),
      direction,
    },
  });
  try {
    await assert.rejects(first.human.call("art.request", ask("Make it a heron.")));
    await assert.rejects(first.human.call("art.request", ask("Make it an egret.")));
  } finally {
    await first.close();
  }
  const rig = await openRig(root, {}, first);
  try {
    const listed = (await rig.human.call("art.list", {})).requests;
    assert.equal(listed.length, 2);
    assert.ok(listed.every((r) => r.steering === null && r.state === "open"));
    assert.equal(rig.fake.sent.length, 0, "a restart sends no stored brief by itself");
    const [answered, waiting] = listed;
    assert.ok(answered && waiting);
    const reply = await rig.agent.call("art.submit", {
      artId: answered.artId,
      submissionId: requestId("sub"),
      reply: variation(part, "Answered without its message"),
    });
    assert.equal(reply.submission.state, "proposed");
    const retry = (r: typeof answered) =>
      rig.human.call("art.request", { agent: r.agent, requestId: r.requestId, brief: r.brief });
    const noSend = await retry(answered);
    assert.equal(noSend.steering, null, "an answered brief is not sent again");
    assert.equal(noSend.state, "answered");
    assert.equal(rig.fake.sent.length, 0);
    const sent = await retry(waiting);
    assert.equal(sent.artId, waiting.artId, "the same request, not a new ask");
    assert.ok(sent.steering);
    await until(
      () => rig.human.call("steer.get", { messageId: sent.messageId }),
      (m) => m.status === "host-accepted",
      "delivery",
    );
    assert.equal(rig.fake.sent.length, 1);
    assert.match(rig.fake.sent[0]?.prompt ?? "", new RegExp(waiting.artId));
    assert.equal((await retry(waiting)).messageId, sent.messageId);
    assert.equal(rig.fake.sent.length, 1, "a further retry sends nothing new");
    assert.equal((await rig.human.call("art.list", { all: true })).requests.length, 2);
  } finally {
    await rig.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("after an older backup is restored, a reply whose proposal it lost is drafted once; kept and discarded ones are not", async () => {
  const root = tempDir("art-restore");
  const backupDir = tempDir("art-restore-backup");
  const backupFile = path.join(backupDir, "older.irudd-backup");
  const first = await openRig(root);
  const { front } = await views(first);
  const part = await headPart(first);
  const r = await first.human.call("art.request", {
    agent: "claude",
    requestId: requestId("art"),
    brief: brief("variation", 1, [{ role: "whole", digest: front.digest }], { parts: [part] }),
  });
  const submit = (rig: Rig, submissionId: string, label: string) =>
    rig.agent.call("art.submit", {
      artId: r.artId,
      submissionId,
      reply: variation(part, label, label),
    });
  const sub = { discarded: requestId("sub"), heron: requestId("sub"), egret: requestId("sub") };
  let discarded: MethodResults["art.submit"];
  let heron: MethodResults["art.submit"];
  let egret: MethodResults["art.submit"];
  try {
    discarded = await submit(first, sub.discarded, "Discarded");
    committed(
      await first.human.call("apply", {
        request: request(1, {
          type: "proposal.discard",
          proposal: discarded.submission.proposal?.id ?? "",
        }),
      }),
    );
    await Effect.runPromise(first.host.project.backup(backupFile));
    heron = await submit(first, sub.heron, "Heron");
    egret = await submit(first, sub.egret, "Egret");
  } finally {
    await first.close();
  }
  fs.renameSync(first.project, first.project + ".newer");
  await Effect.runPromise(
    restoreProject({ backup: backupFile, path: first.project, registry: workshopRegistry() }),
  );
  const rig = await openRig(root, {}, first);
  try {
    const statuses = async () =>
      Object.fromEntries((await artProposals(rig, r.artId)).map((p) => [p.id, p.status]));
    const before = await rig.human.call("art.get", { artId: r.artId });
    assert.deepEqual(
      before.submissions.map((s) => s.proposal?.status),
      ["discarded", "missing", "missing"],
    );
    const same = await submit(rig, sub.heron, "Heron");
    assert.equal(same.outcome, "replayed");
    assert.equal(same.submission.proposal?.id, heron.submission.proposal?.id);
    assert.equal(same.submission.proposal?.status, "draft");
    const twin = await submit(rig, requestId("sub"), "Heron");
    assert.equal(twin.submission.duplicateOf, sub.heron);
    const fresh = await submit(rig, requestId("sub"), "Egret");
    assert.equal(fresh.submission.duplicateOf, null);
    assert.equal(fresh.submission.proposal?.status, "draft");
    assert.notEqual(fresh.submission.proposal?.id, egret.submission.proposal?.id);
    const replayed = await submit(rig, sub.egret, "Egret");
    assert.equal(replayed.outcome, "replayed");
    assert.equal(replayed.submission.proposal?.status, "missing", "recovered once, not twice");
    const again = await submit(rig, requestId("sub"), "Discarded");
    assert.equal(again.submission.duplicateOf, sub.discarded);
    assert.equal(again.submission.proposal?.status, "discarded");
    assert.deepEqual(await statuses(), {
      [discarded.submission.proposal?.id ?? ""]: "discarded",
      [heron.submission.proposal?.id ?? ""]: "draft",
      [fresh.submission.proposal?.id ?? ""]: "draft",
    });
  } finally {
    await rig.close();
    for (const dir of [root, backupDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a proposal an earlier host committed under the submission-derived request ID is adopted by that submission's retry", async () => {
  await withRig("legacy-receipt", async (rig) => {
    const { front } = await views(rig);
    const part = await headPart(rig);
    const r = await rig.human.call("art.request", {
      agent: "claude",
      requestId: requestId("art"),
      brief: brief("variation", 1, [{ role: "whole", digest: front.digest }], { parts: [part] }),
    });
    const legacyId = (submissionId: string) =>
      `art.${createHash("sha256").update(`${r.artId}\u0000${submissionId}`).digest("hex").slice(0, 40)}`;
    const create = (
      client: WorkshopClient,
      submissionId: string,
      proposal: string,
      label: string,
    ) =>
      client.call("apply", {
        request: {
          format: "irudd.command",
          version: 1,
          requestId: legacyId(submissionId),
          documentId: docId,
          expectedRevision: 1,
          command: {
            type: "proposal.create",
            proposal,
            summary: `variation for ${r.artId}: ${label}`,
            content: { kind: "ops", ops: variation(part, label).operations },
          },
        },
      });
    const subA = requestId("sub");
    committed(await create(rig.agent, subA, `prop-${r.artId}-1`, "Heron"));
    const adopted = await rig.agent.call("art.submit", {
      artId: r.artId,
      submissionId: subA,
      reply: variation(part, "Heron"),
    });
    assert.equal(adopted.submission.state, "proposed");
    assert.equal(adopted.submission.proposal?.id, `prop-${r.artId}-1`);
    assert.equal(adopted.submission.proposal?.requestId, legacyId(subA));
    assert.equal((await artProposals(rig, r.artId)).length, 1, "no second proposal");
    const message = await rig.human.call("steer.get", { messageId: r.messageId });
    assert.equal(message.status, "proposed", "the steering message follows the adopted proposal");

    const subB = requestId("sub");
    committed(await create(rig.human, subB, `prop-${r.artId}-7`, "Person's own"));
    const separate = await rig.agent.call("art.submit", {
      artId: r.artId,
      submissionId: subB,
      reply: variation(part, "Egret"),
    });
    assert.equal(separate.submission.state, "proposed");
    assert.notEqual(separate.submission.proposal?.id, `prop-${r.artId}-7`);
    const all = await artProposals(rig, r.artId);
    assert.deepEqual(
      [...all].sort((p, q) => (p.id < q.id ? -1 : 1)).map((p) => [p.id, p.author.kind]),
      [
        [`prop-${r.artId}-1`, "agent"],
        [`prop-${r.artId}-7`, "human"],
        [`prop-${r.artId}-8`, "agent"],
      ],
    );
  });
});

test("an adopted earlier-host proposal lost to a restore is recovered once, whichever submission retries", async () => {
  const root = tempDir("art-legacy-restore");
  const backupDir = tempDir("art-legacy-restore-backup");
  const backupFile = path.join(backupDir, "older.irudd-backup");
  const first = await openRig(root);
  const { front } = await views(first);
  const part = await headPart(first);
  const r = await first.human.call("art.request", {
    agent: "claude",
    requestId: requestId("art"),
    brief: brief("variation", 1, [{ role: "whole", digest: front.digest }], { parts: [part] }),
  });
  await Effect.runPromise(first.host.project.backup(backupFile));
  const subA = requestId("sub");
  const legacyId = `art.${createHash("sha256").update(`${r.artId}\u0000${subA}`).digest("hex").slice(0, 40)}`;
  const reply = variation(part, "Heron");
  try {
    committed(
      await first.agent.call("apply", {
        request: {
          format: "irudd.command",
          version: 1,
          requestId: legacyId,
          documentId: docId,
          expectedRevision: 1,
          command: {
            type: "proposal.create",
            proposal: `prop-${r.artId}-1`,
            summary: "variation (earlier host)",
            content: { kind: "ops", ops: variation(part, "Heron").operations },
          },
        },
      }),
    );
    const adopted = await first.agent.call("art.submit", {
      artId: r.artId,
      submissionId: subA,
      reply,
    });
    assert.equal(adopted.submission.proposal?.requestId, legacyId);
  } finally {
    await first.close();
  }
  fs.renameSync(first.project, first.project + ".newer");
  await Effect.runPromise(
    restoreProject({ backup: backupFile, path: first.project, registry: workshopRegistry() }),
  );
  const rig = await openRig(root, {}, first);
  try {
    const fresh = await rig.agent.call("art.submit", {
      artId: r.artId,
      submissionId: requestId("sub"),
      reply,
    });
    assert.equal(fresh.submission.duplicateOf, null);
    assert.equal(fresh.submission.proposal?.status, "draft");
    const again = await rig.agent.call("art.submit", { artId: r.artId, submissionId: subA, reply });
    assert.equal(again.outcome, "replayed");
    assert.equal((await artProposals(rig, r.artId)).length, 1);
  } finally {
    await rig.close();
    for (const dir of [root, backupDir]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no art step launches a process", () => {
  assert.deepEqual(launched, []);
});
