import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultFrameCreatureParams } from "@irudd/document";
import path from "node:path";
import { connect, runningHosts, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import { attachOrHost, startHost, type RunningHost } from "@irudd/workshop/host";
import { hostFiles } from "@irudd/workshop/endpoint";
import type { MethodResults } from "@irudd/workshop/wire";
import { docId, rename, request, requestId, tempDir } from "./support/fixtures.js";

const person = { kind: "human", id: "tester", name: "Tester" } as const;

async function withHost(
  name: string,
  body: (host: RunningHost, options: { project: string; stateDir: string }) => Promise<void>,
): Promise<void> {
  const root = tempDir(name);
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const host = await startHost({
    path: project,
    stateDir,
    create: { label: "Host test" },
    human: person,
    durability: "normal",
  });
  try {
    await body(host, { project, stateDir });
  } finally {
    await host.close();
  }
}

const committed = (result: MethodResults["apply"]): number => {
  assert.equal(result.kind, "committed", JSON.stringify(result));
  return result.kind === "committed" ? result.receipt.revision : -1;
};

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

test("a person and a paired agent share one owner; the host stamps both identities", async () => {
  await withHost("roles", async (host, { project, stateDir }) => {
    const human = await connect({ credential: { role: "human", project }, stateDir });
    assert.deepEqual(human.welcome.actor, person);

    const starters = await human.call("starters", {});
    const frame = starters.starters.find((s) => s.id === "frame-creature");
    assert.ok(frame?.reference, "the frame creature is marked as the reference generator");
    assert.ok(starters.families.some((f) => f.id === "figure.assembly"));

    const started = await human.call("start", {
      documentId: docId,
      requestId: requestId("start"),
      starter: "frame-creature",
      preset: "default",
    });
    assert.equal(committed(started.result), 1);
    const seeded = await human.call("start", {
      documentId: "doc-seeded01",
      requestId: requestId("seed"),
      starter: "frame-creature",
      seed: 7,
    });
    const again = await human.call("start", {
      documentId: "doc-seeded02",
      requestId: requestId("seed"),
      starter: "frame-creature",
      seed: 7,
    });
    assert.deepEqual(seeded.params, again.params, "a seed gives the same parameters");
    committed(seeded.result);

    const paired = await human.call("pair.agent", { agent: "claude", name: "Claude" });
    assert.ok(fs.existsSync(paired.credentialFile));
    const agent = await connect({
      credential: { role: "agent", file: paired.credentialFile },
      stateDir,
    });
    assert.deepEqual(agent.welcome.actor, { kind: "agent", id: "claude", name: "Claude" });
    assert.ok(!agent.welcome.methods.includes("pair.agent"));

    const current = await human.call("current", { documentId: docId });
    const part = current.document?.parts[1]?.id;
    assert.ok(part);
    const manual = await human.call("apply", { request: { ...rename(1, part, "Left foreleg") } });
    assert.equal(committed(manual), 2);
    const delta = await agent.call("changes", { documentId: docId, since: 1, by: "human" });
    assert.equal(delta.deltas.length, 1);
    assert.equal(delta.deltas[0]?.actor.id, "tester");

    const direct = await agent.call("apply", { request: { ...rename(2, part, "Agent name") } });
    assert.equal(direct.kind, "rejected");
    assert.equal(
      direct.kind === "rejected" ? direct.diagnostics[0]?.code : "",
      "proposal-required",
    );
    const policy = await agent.call("apply", {
      request: { ...request(2, { type: "policy.set", agentDirectEdit: true }) },
    });
    assert.equal(
      policy.kind === "rejected" ? policy.diagnostics[0]?.path.join(".") : "",
      "command.type",
    );
    const spoofed = await agent.call("apply", {
      request: { ...rename(2, part, "Spoof"), actor: { kind: "human", id: "tester" } },
    });
    assert.equal(
      spoofed.kind === "rejected" ? spoofed.diagnostics[0]?.path.join(".") : "",
      "actor",
    );
    await failsWith(agent.call("pair.agent", { agent: "other" }), "Forbidden");

    const proposal = request(2, {
      type: "proposal.create",
      proposal: "prop-tail",
      summary: "Longer tail",
      content: {
        kind: "ops",
        ops: [
          {
            op: "generation.steer",
            params: { ...defaultFrameCreatureParams, tail: { length: 1.1 } },
          },
        ],
      },
    });
    const created = await agent.call("apply", { request: { ...proposal } });
    assert.equal(created.kind, "committed", JSON.stringify(created));
    const duplicate = await agent.call("apply", { request: { ...proposal } });
    assert.equal(duplicate.kind, "replayed");
    const accept = await agent.call("apply", {
      request: { ...request(2, { type: "proposal.accept", proposal: "prop-tail", version: 1 }) },
    });
    assert.equal(
      accept.kind === "rejected" ? accept.diagnostics[0]?.code : "",
      "proposal-required",
    );
    const preview = await human.call("draft", { documentId: docId, proposalId: "prop-tail" });
    assert.ok(preview.ok);

    const events: number[] = [];
    await agent.call("subscribe", {});
    agent.onEvent((event) => {
      if (event.event === "commit") events.push(event.revision);
    });
    const accepted = await human.call("apply", {
      request: { ...request(2, { type: "proposal.accept", proposal: "prop-tail", version: 1 }) },
    });
    assert.equal(committed(accepted), 3);
    const stale = await human.call("apply", { request: { ...rename(2, part, "Stale") } });
    assert.equal(stale.kind === "rejected" ? stale.diagnostics[0]?.code : "", "stale-revision");
    const head = await agent.call("current", { documentId: docId });
    assert.equal(
      head.document?.parts[1]?.label,
      "Left foreleg",
      "the manual edit survives the accepted proposal",
    );
    await waitFor(() => events.includes(3));

    const inspected = await host.call("inspect", { documentId: docId });
    assert.equal(inspected.history.length, 3);

    await human.call("pair.revoke", { agent: "claude" });
    await failsWith(
      connect({ credential: { role: "agent", file: paired.credentialFile }, stateDir }),
      "CredentialMissing",
    );
    agent.close();
    human.close();
  });
});

test("wrong keys and impostor endpoints are refused; a stopped host is reported", async () => {
  await withHost("auth", async (host, { project, stateDir }) => {
    const files = hostFiles(project, { stateDir });
    const human = await connect({ credential: { role: "human", project }, stateDir });
    const paired = await human.call("pair.agent", { agent: "codex" });
    human.close();
    const credential: unknown = JSON.parse(fs.readFileSync(paired.credentialFile, "utf8"));
    const forged = path.join(path.dirname(paired.credentialFile), "forged.json");
    fs.writeFileSync(
      forged,
      JSON.stringify({
        ...(typeof credential === "object" ? credential : {}),
        secret: "not-the-secret",
      }),
    );
    await failsWith(
      connect({ credential: { role: "agent", file: forged }, stateDir }),
      "HostImpostor",
    );
    const unknown = path.join(path.dirname(paired.credentialFile), "unknown.json");
    fs.writeFileSync(
      unknown,
      JSON.stringify({ ...(typeof credential === "object" ? credential : {}), agent: "stranger" }),
    );
    await failsWith(
      connect({ credential: { role: "agent", file: unknown }, stateDir }),
      "CredentialRejected",
    );

    await host.close();
    assert.ok(!fs.existsSync(files.endpoint), "a closed host removes its endpoint");
    await failsWith(
      connect({ credential: { role: "human", project }, stateDir }),
      "HostUnavailable",
    );
  });
});

test("a second owner attaches to the first instead of opening the file", async () => {
  await withHost("attach", async (_host, { project, stateDir }) => {
    const second = await attachOrHost({
      path: project,
      stateDir,
      human: person,
      lockTimeoutMs: 20,
    });
    assert.equal(second.mode, "attached");
    const client: WorkshopClient | undefined =
      second.mode === "attached" ? second.client : undefined;
    const info = await client?.call("project.info", {});
    assert.equal(info?.label, "Host test");
    client?.close();
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > until) assert.fail("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a local agent pairs itself once, and a person's unpair keeps it out", async () => {
  await withHost("auto-pair", async (_host, { project, stateDir }) => {
    assert.deepEqual(
      runningHosts({ stateDir }).map((e) => hostFiles(e.project, { stateDir }).key),
      [hostFiles(project, { stateDir }).key],
    );
    const human = await connect({ credential: { role: "human", project }, stateDir });
    const auto = { agent: "claude", name: "Claude Code", auto: true } as const;
    const first = await human.call("pair.agent", auto);
    const again = await human.call("pair.agent", auto);
    assert.equal(again.pairingId, first.pairingId, "a second session reuses the pairing");
    const agent = await connect({
      credential: { role: "agent", file: first.credentialFile },
      stateDir,
    });
    assert.equal(agent.welcome.role, "agent");
    agent.close();

    await human.call("pair.revoke", { agent: "claude" });
    await failsWith(human.call("pair.agent", auto), "Forbidden");
    const repaired = await human.call("pair.agent", { agent: "claude" });
    assert.notEqual(repaired.pairingId, first.pairingId);
    assert.equal((await human.call("pair.agent", auto)).pairingId, repaired.pairingId);
    human.close();
  });
  assert.equal(runningHosts({ stateDir: path.join(tempDir("no-hosts"), "state") }).length, 0);
});
