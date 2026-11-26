import { readExampleArtwork } from "../../../../tools/build/example-artwork.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createRegistry,
  familyFeatures,
  frameCreature,
  isJson,
  readDocument,
  sha256Digest,
  type Json,
} from "@irudd/document";
import { bundledAsset, bundledAssetNamed } from "@irudd/character";
import { connect } from "@irudd/workshop/client";
import { artParams } from "@irudd/workshop/wire";
import { windowMethods } from "../../src/shared/api.js";
import { workshop, type Workshop } from "../../src/renderer/bridge.js";
import { isWindowMethod, openWorkshop, type WorkshopLink } from "../../src/main/workshop.js";
import {
  briefNeeds,
  importedReply,
  readPicture,
  resendRequest,
  sniffImage,
  stagePicture,
  undelivered,
  undeliveredRequestId,
} from "../../src/renderer/art-files.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const exampleImages = readExampleArtwork(repository);
const fixtures = path.join(repository, "verification", "families", "fixtures");
const assets = path.join(repository, "character-view");
const registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });
const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-art-window-state-"));
process.env["IRUDD_STATE_DIR"] = stateRoot;
const scratch: string[] = [stateRoot];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function json(value: unknown): Json {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  assert.ok(isJson(copy));
  return copy;
}

const windowCaller = (link: WorkshopLink): Workshop =>
  workshop({ call: (method, params) => link.call(method, params) });

async function withWindow(
  body: (rig: {
    link: WorkshopLink;
    window: Workshop;
    agent: Awaited<ReturnType<typeof connect>>;
    documentId: string;
    sheet: Uint8Array;
  }) => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-art-window-"));
  scratch.push(root);
  const directory = path.join(root, "project");
  const link = await openWorkshop({ directory, create: { label: "Art window" }, registry });
  let agent: Awaited<ReturnType<typeof connect>> | undefined;
  try {
    const window = windowCaller(link);
    const courier = bundledAssetNamed("courier");
    assert.ok(courier);
    const sheet = new Uint8Array(fs.readFileSync(path.join(assets, courier.file)));
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(fixtures, "feline-worker.json"), "utf8"),
    );
    const read = readDocument(raw, { registry });
    assert.ok(read.ok);
    const documentId = read.value.id;
    for (const asset of read.value.assets) {
      const bytes = exampleImages.get(asset.digest);
      const bundled = bundledAsset(asset.digest);
      if (bytes) await stagePicture(window, bytes);
      else if (bundled)
        await stagePicture(
          window,
          new Uint8Array(fs.readFileSync(path.join(assets, bundled.file))),
        );
    }
    const created = await window.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: "window-create-0001",
        documentId,
        expectedRevision: 0,
        command: { type: "document.create", document: json(raw) },
      },
    });
    assert.equal(created.kind, "committed", JSON.stringify(created));
    const pair = await window.call("pair.agent", { agent: "claude", name: "Claude" });
    await window.call("recipient.bind", {
      agent: "claude",
      route: { transport: "inbox", host: "claude-code", environment: "local" },
    });
    agent = await connect({ credential: { role: "agent", file: pair.credentialFile } });
    await body({ link, window, agent, documentId, sheet });
  } finally {
    agent?.close();
    await link.close();
  }
}

test("every art method is a window method and main checks its parameters", async () => {
  for (const method of Object.keys(artParams)) assert.ok(isWindowMethod(method), method);
  assert.ok(windowMethods.every((m) => !m.startsWith("inbox.")));
  await withWindow(async ({ link }) => {
    const refused = await link.call("art.request", { agent: "claude", brief: { kind: "depth" } });
    assert.deepEqual(refused, {
      ok: false,
      error: { _tag: "InvalidArgument", message: "Invalid parameters for art.request." },
    });
    const caps = await workshop({ call: (m, p) => link.call(m, p) }).call("art.capabilities", {});
    assert.equal(caps.producer, "paired-agent");
    assert.deepEqual(
      caps.kinds.map((k) => [k.kind, k.apply.available, k.apply.translator]),
      [
        ["variation", true, "operations"],
        ["turnaround", true, "repaint"],
        ["trace", false, null],
        ["depth", false, null],
      ],
      "the desktop host applies variation and turnaround replies and records the rest",
    );
  });
});

test("a brief saved without its message is offered again as the same request, never as a new ask", async () => {
  await withWindow(async ({ link, window, agent, documentId, sheet }) => {
    const view = await stagePicture(window, sheet);
    const brief = {
      format: "irudd.art-brief",
      version: 1,
      kind: "variation",
      documentId,
      revision: 1,
      direction: "Lengthen the neck.",
      attachments: [{ role: "whole", digest: view.digest }],
    } as const;
    const sent = await window.call("art.request", {
      agent: "claude",
      requestId: "window-orphan-0001",
      brief,
    });
    const [listed] = (await window.call("art.list", { documentId, all: true })).requests;
    assert.ok(listed);
    assert.equal(undelivered(listed), false, "a delivered brief is not offered again");
    const orphan = { ...listed, steering: null };
    assert.equal(undelivered(orphan), true);
    const { attachments, direction, ...rest } = brief;
    const reordered = { attachments, direction, ...rest };
    assert.equal(undeliveredRequestId([orphan], "claude", reordered), "window-orphan-0001");
    assert.equal(
      undeliveredRequestId([orphan], "claude", { ...brief, direction: "Shorten it." }),
      undefined,
    );
    assert.equal(undeliveredRequestId([orphan], "codex", brief), undefined);
    assert.equal(undeliveredRequestId([listed], "claude", brief), undefined);
    const again = await link.call("art.request", resendRequest(orphan));
    assert.ok(again.ok, JSON.stringify(again));
    const value: unknown = again.ok ? again.value : undefined;
    assert.ok(
      typeof value === "object" && value !== null && "artId" in value && "messageId" in value,
    );
    assert.equal(value.artId, sent.artId);
    assert.equal(value.messageId, sent.messageId);
    await agent.call("art.submit", {
      artId: sent.artId,
      submissionId: "window-orphan-reply",
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "variation",
        summary: "Longer neck",
        operations: [{ op: "document.label", label: "Long-necked worker" }],
      },
    });
    const [answered] = (await window.call("art.list", { documentId, all: true })).requests;
    assert.ok(answered);
    assert.equal(undelivered({ ...answered, steering: null }), false);
    assert.equal(
      (await window.call("art.list", { documentId, all: true })).requests.length,
      1,
      "one request throughout",
    );
  });
});

test("the panel's brief, the agent's reply and a person's import travel the window path", async () => {
  await withWindow(async ({ link, window, agent, documentId, sheet }) => {
    const view = await stagePicture(window, sheet);
    assert.equal(view.digest, sha256Digest(sheet));
    assert.equal(view.mediaType, sniffImage(sheet));
    assert.ok(view.width >= 512 && view.width === view.height);

    assert.deepEqual(briefNeeds("turnaround", [], []), [
      "a painted region",
      "a view of the character",
    ]);
    assert.deepEqual(briefNeeds("turnaround", ["whole"], ["p-body"]), []);
    const brief = await window.call("art.request", {
      agent: "claude",
      requestId: "window-brief-0001",
      brief: {
        format: "irudd.art-brief",
        version: 1,
        kind: "turnaround",
        documentId,
        revision: 1,
        direction: "Repaint the body as a courier.",
        attachments: [{ role: "whole", digest: view.digest }],
        parts: ["p-body"],
      },
    });
    assert.equal(brief.state, "open");
    assert.equal(brief.steering?.status !== undefined, true);
    const back = await readPicture(window, brief.artId, view.digest);
    assert.deepEqual(back.bytes, sheet);

    await agent.call("art.put", {
      digest: view.digest,
      mediaType: "image/webp",
      offset: 0,
      total: sheet.byteLength,
      base64: Buffer.from(sheet).toString("base64"),
    });
    const replied = await agent.call("art.submit", {
      artId: brief.artId,
      submissionId: "window-reply-0001",
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "turnaround",
        summary: "Courier body",
        image: view.digest,
      },
    });
    assert.equal(replied.submission.state, "proposed");
    const listed = await window.call("art.list", { documentId, all: true });
    assert.equal(listed.requests[0]?.submissions[0]?.proposal?.status, "draft");

    assert.deepEqual(briefNeeds("depth", ["front"], []), [
      "one painted part to fit",
      "a side view",
    ]);
    assert.deepEqual(briefNeeds("depth", ["front", "side"], ["p-head"]), []);
    const depth = await window.call("art.request", {
      agent: "claude",
      requestId: "window-brief-0002",
      brief: {
        format: "irudd.art-brief",
        version: 1,
        kind: "depth",
        documentId,
        revision: 1,
        direction: "Depth for the portrait.",
        attachments: [
          { role: "front", digest: view.digest },
          { role: "side", digest: view.digest },
        ],
      },
    });
    assert.equal(depth.apply.available, false);
    const made = importedReply("depth", "Imported depth.png", { digest: view.digest });
    assert.ok("reply" in made);
    const outcome = await link.call("art.submit", {
      artId: depth.artId,
      submissionId: "window-import-0001",
      reply: made.reply,
    });
    assert.ok(outcome.ok, JSON.stringify(outcome));
    const recorded = (await window.call("art.get", { artId: depth.artId })).submissions[0];
    assert.equal(recorded?.state, "recorded");
    assert.equal(recorded.via, "person-import");
    assert.equal(recorded.by.kind, "human");

    assert.ok("problem" in importedReply("variation", "x", { json: { nope: 1 } }));
    assert.ok("problem" in importedReply("turnaround", "x", { json: [] }));

    const cancelled = await window.call("art.cancel", { artId: depth.artId });
    assert.equal(cancelled.state, "cancelled");
    await assert.rejects(
      agent.call("art.submit", {
        artId: depth.artId,
        submissionId: "window-late-0001",
        reply: {
          format: "irudd.art-reply",
          version: 1,
          kind: "depth",
          summary: "Late",
          image: view.digest,
        },
      }),
      /closed|cancel/i,
    );
  });
});
