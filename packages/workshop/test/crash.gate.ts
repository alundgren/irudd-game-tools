import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Effect } from "effect";
import { createProject, openProject, type CommandRequest } from "@irudd/workshop";
import { connect } from "@irudd/workshop/client";
import { startHost } from "@irudd/workshop/host";
import { inbox, person } from "./support/art-fixtures.js";
import {
  docId,
  failure,
  generate,
  human,
  percentile,
  registerHook,
  registry,
  rename,
  request,
  requestId,
  run,
  supportDir,
  tempDir,
} from "./support/fixtures.js";

const childScript = path.join(supportDir, "child.ts");

interface Running {
  readonly child: ChildProcess;
  readonly events: Array<Record<string, unknown>>;
  readonly until: (
    predicate: (event: Record<string, unknown>) => boolean,
  ) => Promise<Record<string, unknown>>;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function start(options: Record<string, unknown>, script = childScript): Running {
  const child = spawn(
    process.execPath,
    ["--import", registerHook, script, JSON.stringify(options)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const events: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (event: Record<string, unknown>) => boolean;
    resolve: (event: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }> = [];
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on("exit", (code, signal) => {
      for (const w of waiters.splice(0))
        w.reject(
          new Error(
            `child exited (${code ?? signal}) before the event: ${stderr} ${JSON.stringify(events.slice(-3))}`,
          ),
        );
      resolve({ code, signal });
    }),
  );
  if (child.stdout)
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== "object" || parsed === null) return;
      const event: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
      events.push(event);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w?.predicate(event)) {
          waiters.splice(i, 1);
          w.resolve(event);
        }
      }
    });
  const until = (predicate: (event: Record<string, unknown>) => boolean) => {
    const seen = events.find(predicate);
    if (seen) return Promise.resolve(seen);
    return new Promise<Record<string, unknown>>((resolve, reject) =>
      waiters.push({ predicate, resolve, reject }),
    );
  };
  return { child, events, until, exited };
}

async function seed(dir: string): Promise<string> {
  return run(
    Effect.gen(function* () {
      const project = yield* createProject({ path: dir, label: "Crash", registry });
      const session = yield* project.session({ actor: human });
      yield* session.apply(generate());
      return (yield* project.current(docId)).document?.parts[0]?.id ?? "";
    }),
  );
}

async function reopenAndVerify(dir: string) {
  const started = performance.now();
  return run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: dir, registry });
      const current = yield* project.current(docId);
      const reopenMs = performance.now() - started;
      const report = yield* project.verify;
      assert.equal(report.ok, true, JSON.stringify(report));
      const journal = yield* project.journal(docId);
      return { current, journal, reopenMs };
    }),
  );
}

async function retry(dir: string, envelope: CommandRequest) {
  return run(
    Effect.gen(function* () {
      const project = yield* openProject({ path: dir, registry });
      const session = yield* project.session({ actor: human });
      const result = yield* session.apply(envelope);
      const journal = yield* project.journal(docId);
      return { result, journal };
    }),
  );
}

test("a killed owner's lock is released by the OS; the next service opens at once", async () => {
  const dir = tempDir("crash-lock");
  await seed(dir);
  const holder = start({ path: dir, mode: "hold" });
  await holder.until((e) => e["event"] === "ready");
  const locked = await failure(openProject({ path: dir, registry, lockTimeoutMs: 50 }));
  assert.equal(locked._tag, "ProjectLocked");
  const killedAt = performance.now();
  holder.child.kill("SIGKILL");
  await holder.exited;
  const view = await run(
    Effect.flatMap(openProject({ path: dir, registry }), (p) => p.current(docId)),
  );
  const ms = performance.now() - killedAt;
  assert.equal(view.revision, 1);
  console.log(`# lock released and project reopened ${ms.toFixed(1)} ms after the kill`);
});

for (const kind of ["edit", "policy"] as const) {
  const make = (part: string): CommandRequest =>
    kind === "edit"
      ? rename(1, part, "Crash edit")
      : request(1, { type: "policy.set", agentDirectEdit: true });

  test(`${kind}: a crash inside the append transaction leaves the old state; the retry commits once`, async () => {
    const dir = tempDir(`crash-before-${kind}`);
    const envelope = make(await seed(dir));
    const crashing = start({ path: dir, mode: "crash-before", request: envelope });
    const exit = await crashing.exited;
    assert.ok(
      !crashing.events.some((e) => e["event"] === "returned"),
      "the child died before replying",
    );
    assert.notEqual(exit.code, 0);

    const after = await reopenAndVerify(dir);
    assert.equal(after.journal.length, 1, "no part of the entry survived");
    assert.equal(after.current.revision, 1);
    assert.equal(after.current.policy.agentDirectEdit, false);

    const again = await retry(dir, envelope);
    assert.equal(again.result.kind, "committed");
    assert.equal(again.journal.length, 2);
    console.log(`# ${kind} crash-before: reopen ${after.reopenMs.toFixed(1)} ms`);
  });

  test(`${kind}: a crash after the commit keeps the new state; the retry replays the receipt`, async () => {
    const dir = tempDir(`crash-after-${kind}`);
    const envelope = make(await seed(dir));
    const crashing = start({ path: dir, mode: "crash-after", request: envelope });
    await crashing.exited;
    assert.ok(!crashing.events.some((e) => e["event"] === "returned"));

    const after = await reopenAndVerify(dir);
    assert.equal(after.journal.length, 2, "the committed entry survived the crash");
    assert.equal(after.current.journal?.sequence, 2);
    if (kind === "edit") assert.equal(after.current.revision, 2);
    else {
      assert.equal(after.current.revision, 1, "a policy entry advances the journal, not the head");
      assert.equal(after.current.policy.agentDirectEdit, true);
    }

    const again = await retry(dir, envelope);
    assert.equal(again.result.kind, "replayed");
    assert.deepEqual(
      again.result.kind === "replayed" && again.result.receipt,
      after.journal[1]?.receipt,
    );
    assert.equal(again.journal.length, 2);
    console.log(`# ${kind} crash-after: reopen ${after.reopenMs.toFixed(1)} ms`);
  });
}

test("random kills in a stream of writes lose no acknowledged commit, and the in-flight retry lands once", async () => {
  const dir = tempDir("crash-stream");
  await seed(dir);
  const rounds = 6;
  const latencies: number[] = [];
  const reopenTimes: number[] = [];
  const acked = new Set<string>();
  let lastSequence = 1;
  const inFlightOutcomes = { acknowledged: 0, replayed: 0, committed: 0 };
  for (let round = 0; round < rounds; round++) {
    const target = 5 + ((round * 7) % 23);
    const stream = start({ path: dir, mode: "stream" });
    await stream.until(
      (e) => e["event"] === "ack" && Number(e["sequence"]) >= lastSequence + target,
    );
    stream.child.kill("SIGKILL");
    await stream.exited;

    for (const e of stream.events)
      if (e["event"] === "ack") {
        acked.add(String(e["requestId"]));
        latencies.push(Number(e["ms"]));
      }
    const sent = stream.events.filter((e) => e["event"] === "sent");
    const inFlight = sent[sent.length - 1]?.["request"];
    assert.ok(typeof inFlight === "object" && inFlight !== null);
    const inFlightId = String(Reflect.get(inFlight, "requestId"));

    const after = await reopenAndVerify(dir);
    reopenTimes.push(after.reopenMs);
    const stored = new Set(after.journal.map((entry) => entry.receipt.requestId));
    for (const id of acked) assert.ok(stored.has(id), `acknowledged ${id} is durable`);
    assert.equal(stored.size, after.journal.length, "no request was stored twice");

    if (!acked.has(inFlightId)) {
      const envelope: CommandRequest = {
        format: "irudd.command",
        version: 1,
        requestId: inFlightId,
        documentId: String(Reflect.get(inFlight, "documentId")),
        expectedRevision: Number(Reflect.get(inFlight, "expectedRevision")),
        command: commandOf(Reflect.get(inFlight, "command")),
      };
      const again = await retry(dir, envelope);
      const wasStored = stored.has(inFlightId);
      assert.equal(
        again.result.kind,
        wasStored ? "replayed" : "committed",
        `retry of ${inFlightId}`,
      );
      inFlightOutcomes[wasStored ? "replayed" : "committed"] += 1;
      assert.equal(
        again.journal.filter((entry) => entry.receipt.requestId === inFlightId).length,
        1,
      );
      lastSequence = again.journal.length;
    } else {
      inFlightOutcomes.acknowledged += 1;
      lastSequence = after.journal.length;
    }
  }
  const summary = {
    rounds,
    commits: lastSequence,
    inFlight: inFlightOutcomes,
    commitMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: Math.max(...latencies),
    },
    reopenMs: { p50: percentile(reopenTimes, 50), max: Math.max(...reopenTimes) },
  };
  console.log("# stream crash summary " + JSON.stringify(summary));
});

function commandOf(value: unknown): CommandRequest["command"] {
  assert.ok(typeof value === "object" && value !== null);
  const type: unknown = Reflect.get(value, "type");
  if (type === "policy.set")
    return { type, agentDirectEdit: Reflect.get(value, "agentDirectEdit") === true };
  const ops: unknown = Reflect.get(value, "ops");
  const op: unknown = Array.isArray(ops) ? ops[0] : undefined;
  assert.ok(type === "edit" && typeof op === "object" && op !== null);
  return {
    type,
    ops: [
      {
        op: "part.rename",
        part: String(Reflect.get(op, "part")),
        label: String(Reflect.get(op, "label")),
      },
    ],
  };
}

const artHostScript = path.join(supportDir, "art-host.ts");

for (const point of ["submission-pending", "proposal-committed"] as const)
  test(`an art reply whose host is killed at ${point} is settled once on restart`, async () => {
    const root = tempDir(`crash-art-${point}`);
    const project = path.join(root, "project");
    const stateDir = path.join(root, "state");
    const base = {
      path: project,
      stateDir,
      human: person,
      durability: "full" as const,
    };
    try {
      const setup = await startHost({ ...base, create: { label: "Art crash" } });
      const human = await connect({ credential: { role: "human", project }, stateDir });
      await human.call("apply", { request: generate() });
      const pair = await human.call("pair.agent", { agent: "claude", name: "Claude" });
      await human.call("recipient.bind", { agent: "claude", route: inbox });
      const part = (await human.call("current", { documentId: docId })).document?.parts[1]?.id;
      assert.ok(part);
      const connected = await connect({
        credential: { role: "agent", file: pair.credentialFile },
        stateDir,
      });
      const requested = await human.call("art.request", {
        agent: "claude",
        requestId: requestId("art"),
        brief: {
          format: "irudd.art-brief",
          version: 1,
          kind: "variation",
          documentId: docId,
          revision: 1,
          direction: "Give it a heron's head.",
          attachments: [],
          parts: [part],
        },
      });
      human.close();
      connected.close();
      await setup.close();

      const host = start({ path: project, stateDir, cut: point }, artHostScript);
      await host.until((e) => e["event"] === "ready");
      const agent = await connect({
        credential: { role: "agent", file: pair.credentialFile },
        stateDir,
      });
      const reply = {
        format: "irudd.art-reply",
        version: 1,
        kind: "variation",
        summary: "Heron head",
        operations: [{ op: "part.rename", part, label: "Heron head" }],
      } as const;
      const submissionId = requestId("sub");
      const killedAt = performance.now();
      await assert.rejects(
        agent.call("art.submit", { artId: requested.artId, submissionId, reply }),
      );
      await host.until((e) => e["event"] === "cut");
      const exit = await host.exited;
      assert.notEqual(exit.code, 0, "the host was killed, not stopped");
      agent.close();

      const restarted = await startHost(base);
      const restartMs = performance.now() - killedAt;
      const person2 = await connect({ credential: { role: "human", project }, stateDir });
      const agent2 = await connect({
        credential: { role: "agent", file: pair.credentialFile },
        stateDir,
      });
      try {
        const artProposals = async () =>
          (await person2.call("inspect", { documentId: docId })).proposals.filter((p) =>
            p.id.startsWith(`prop-${requested.artId}-`),
          );
        const view = await person2.call("art.get", { artId: requested.artId });
        if (point === "proposal-committed") {
          assert.equal(view.submissions.length, 1, "the committed reply was settled");
          assert.equal(view.submissions[0]?.state, "proposed");
          assert.equal((await artProposals()).length, 1);
          const message = await person2.call("steer.get", { messageId: requested.messageId });
          assert.equal(message.status, "proposed");
        } else {
          assert.equal(view.submissions.length, 0, "the uncommitted reply was dropped");
          assert.equal((await artProposals()).length, 0);
        }
        const retried = await agent2.call("art.submit", {
          artId: requested.artId,
          submissionId: requestId("sub"),
          reply,
        });
        assert.equal(retried.submission.state, "proposed");
        assert.equal(retried.submission.proposal?.id, `prop-${requested.artId}-1`);
        assert.equal(
          retried.submission.duplicateOf,
          point === "proposal-committed" ? submissionId : null,
        );
        assert.equal((await artProposals()).length, 1, "one proposal, never two");
        const report = await person2.call("verify", {});
        assert.equal(report.ok, true, JSON.stringify(report));
        console.log(`# art ${point}: kill to restarted host ${restartMs.toFixed(0)} ms`);
      } finally {
        agent2.close();
        person2.close();
        await restarted.close();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
