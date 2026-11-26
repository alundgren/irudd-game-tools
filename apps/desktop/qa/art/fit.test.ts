// Paired depth and trace fits through the desktop's own host options: the
// person's brief for one painted portrait, the paired agent's reply, the
// desktop's depth and trace translators, and the person's preview, acceptance
// and undo. Run on fitted-portrait, whose head is a traced face.
//
// The translators draw pictures with the desktop's raster (its review
// worker). Here a stand-in raster draws the PNG depth pass this test makes
// by nearest sampling, and gives the sheet's quadrants a synthetic subject
// on magenta, so the panel frames are known; the hardware canvas runs in
// `pnpm --filter @irudd/desktop qa:art`. The fit arithmetic is checked
// against G0 in verification/families/test/art-fit.test.ts.
//
// Cases: a brief naming a part that cannot take the fit is refused when it
// is sent; a raster that is not ready fails the submission without recording
// it and the retry proposes; preview, accept and undo; a duplicate reply; a
// reply after the person's unrelated edit is stale, keeps the head and, once
// the agent refines it on the head, accepts with that edit kept; a cancelled
// request refuses its reply; a trace map's region fits face landmarks and
// depth pins and its other regions are named in the proposal, not built; a
// trace brief that builds adds the map's regions as parts under their
// parents, previewed, accepted, undone and redone exactly as proposed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { Schema } from "effect";
import {
  Digest,
  createRegistry,
  familyFeatures,
  figureAnatomy,
  figurePaint,
  figurePortraitDepth,
  frameCreature,
  isJson,
  readDocument,
  type CharacterDocument,
  type Json,
} from "@irudd/document";
import { bundledAsset } from "@irudd/character";
import {
  depthCanvas,
  depthFromPixels,
  panelCanvas,
  panelFromPixels,
} from "@irudd/character/art-fit";
import { traceBuildOperations } from "@irudd/character/trace-build";
import { connect, uploadArt, type WorkshopClient } from "@irudd/workshop/client";
import { ArtError, startHost, type RunningHost } from "@irudd/workshop/host";
import type { MethodResults } from "@irudd/workshop/wire";
import { desktopArtTranslators, shippedArtwork, type ArtRaster } from "../../src/main/art.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const fixturesDir = path.join(repository, "verification", "families", "fixtures");
const blobsDir = path.join(fixturesDir, "blobs");
const registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });
const person = { kind: "human", id: "tester", name: "Tester" } as const;
const headId = "p-head-and-neck";
const characterAssets = path.join(repository, "packages", "character", "assets");
const decodeDigest = Schema.decodeUnknownSync(Digest);

/** Bytes of a digest from the fixtures or the shipped assets. */
function bytesOf(digest: string): Uint8Array {
  const file = path.join(blobsDir, digest.replace(":", "-"));
  if (fs.existsSync(file)) return new Uint8Array(fs.readFileSync(file));
  const asset = bundledAsset(decodeDigest(digest));
  if (asset) return new Uint8Array(fs.readFileSync(path.join(characterAssets, asset.file)));
  throw new Error(`No bytes for ${digest}.`);
}

function json(value: unknown): Json {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  assert.ok(isJson(copy));
  return copy;
}

/** An 8-bit RGB PNG of `size` square from a pixel function. */
function png(size: number, pixel: (x: number, y: number) => readonly [number, number, number]) {
  const chunk = (type: string, data: Uint8Array) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array(0)),
    ]),
  );
}

/** A front depth pass on black: a lit ellipse. */
const depthPass = (shift: number) =>
  png(512, (x, y) => {
    const u = (x - 260 - shift) / 150;
    const v = (y - 280) / 205;
    const r = u * u + v * v;
    const g = r > 1 ? 0 : Math.round(70 + 175 * Math.sqrt(1 - r));
    return [g, g, g];
  });

/** The stand-in raster: nearest-sampled PNGs this test made, and a known subject for sheets. */
class TestRaster implements ArtRaster {
  ready = true;
  readonly calls: Array<{
    readonly mediaType: string;
    readonly size: number;
    readonly quadrant: number | null;
  }> = [];
  pixels(bytes: Uint8Array, mediaType: string, size: number, quadrant?: 0 | 1 | 2 | 3) {
    if (!this.ready) return Promise.reject(new ArtError("HostFailed", "The raster is starting."));
    this.calls.push({ mediaType, size, quadrant: quadrant ?? null });
    const out = new Uint8ClampedArray(size * size * 4);
    if (quadrant !== undefined) {
      // Magenta key with a subject: frames mid 325, feet 598, span 496 at 640 px.
      for (let i = 0; i < size * size; i++) out.set([255, 0, 255, 255], 4 * i);
      for (let y = 100; y <= 600; y++)
        for (let x = 250; x <= 400; x++) out.set([120, 100, 90, 255], 4 * (y * size + x));
      return Promise.resolve(out);
    }
    assert.equal(mediaType, "image/png");
    const view = Buffer.from(bytes);
    const width = view.readUInt32BE(16);
    const idat = view.indexOf("IDAT");
    const raw = inflateSync(view.subarray(idat + 4, idat + 4 + view.readUInt32BE(idat - 4)));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const sx = Math.floor(((x + 0.5) * width) / size);
        const sy = Math.floor(((y + 0.5) * width) / size);
        const at = sy * (width * 3 + 1) + 1 + sx * 3;
        out.set([raw[at] ?? 0, raw[at + 1] ?? 0, raw[at + 2] ?? 0, 255], 4 * (y * size + x));
      }
    return Promise.resolve(out);
  }
}

interface Rig {
  readonly host: RunningHost;
  readonly human: WorkshopClient;
  readonly agent: WorkshopClient;
  readonly raster: TestRaster;
  readonly documentId: string;
  readonly views: { readonly front: string; readonly side: string };
}

async function withRig(body: (rig: Rig) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "irudd-art-fit-"));
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const raster = new TestRaster();
  const host = await startHost({
    path: project,
    stateDir,
    create: { label: "Fit" },
    human: person,
    registry,
    durability: "normal",
    artTranslators: desktopArtTranslators(raster),
    shippedArtwork,
  });
  const human = await connect({ credential: { role: "human", project }, stateDir });
  let agent: WorkshopClient | undefined;
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, "fitted-portrait.json"), "utf8"),
    );
    const read = readDocument(raw, { registry });
    assert.ok(read.ok);
    for (const asset of read.value.assets)
      await uploadArt(
        human,
        bytesOf(asset.digest),
        asset.mediaType === "image/png" ? "image/png" : "image/webp",
      );
    const created = await human.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: "create-fit-0001",
        documentId: read.value.id,
        expectedRevision: 0,
        command: { type: "document.create", document: json(raw) },
      },
    });
    assert.equal(created.kind, "committed", JSON.stringify(created));
    const pair = await human.call("pair.agent", { agent: "claude", name: "Claude" });
    await human.call("recipient.bind", {
      agent: "claude",
      route: { transport: "inbox", host: "claude-code", environment: "local" },
    });
    agent = await connect({
      credential: { role: "agent", file: pair.credentialFile },
      stateDir,
    });
    // The sheet's front and profile panels, as the art panel attaches them.
    const front = await uploadArt(
      human,
      png(640, () => [200, 160, 150]),
      "image/png",
    );
    const side = await uploadArt(
      human,
      png(640, () => [190, 150, 140]),
      "image/png",
    );
    await body({
      host,
      human,
      agent,
      raster,
      documentId: read.value.id,
      views: { front: front.digest, side: side.digest },
    });
  } finally {
    agent?.close();
    human.close();
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function brief(
  rig: Rig,
  kind: "depth" | "trace",
  revision: number,
  part: string,
  requestId: string,
) {
  return rig.human.call("art.request", {
    agent: "claude",
    requestId,
    brief: {
      format: "irudd.art-brief",
      version: 1,
      kind,
      documentId: rig.documentId,
      revision,
      direction: kind === "depth" ? "Depth for the head." : "Fit the face to the portrait.",
      attachments: [
        { role: "front", digest: rig.views.front, label: "sheet front" },
        { role: "side", digest: rig.views.side, label: "sheet profile" },
      ],
      parts: [part],
    },
  });
}

async function current(rig: Rig): Promise<{ revision: number; doc: CharacterDocument }> {
  const at = await rig.human.call("current", { documentId: rig.documentId });
  assert.ok(at.document);
  return { revision: at.revision, doc: at.document };
}

const head = (doc: CharacterDocument) => {
  const part = doc.parts.find((p) => p.id === headId);
  assert.ok(part);
  return part;
};

async function command(rig: Rig, client: WorkshopClient, requestId: string, command: unknown) {
  const { revision } = await current(rig);
  return client.call("apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId,
      documentId: rig.documentId,
      expectedRevision: revision,
      command: json(command),
    },
  });
}

type Submission = MethodResults["art.submit"]["submission"];

async function submitDepth(rig: Rig, artId: string, picture: Uint8Array, submissionId: string) {
  const staged = await uploadArt(rig.agent, picture, "image/png");
  return rig.agent.call("art.submit", {
    artId,
    submissionId,
    reply: {
      format: "irudd.art-reply",
      version: 1,
      kind: "depth",
      summary: "Front depth pass",
      image: staged.digest,
    },
  });
}

test("a paired depth pass fits the portrait: refusal, retry, preview, accept, undo, stale and cancel", async () => {
  await withRig(async (rig) => {
    const capabilities = await rig.agent.call("art.capabilities", {});
    assert.deepEqual(
      capabilities.kinds.map((k) => [k.kind, k.apply.translator]),
      [
        ["variation", "operations"],
        ["turnaround", "repaint"],
        ["trace", "trace-fit"],
        ["depth", "portrait-depth"],
      ],
    );
    // The body is no portrait: the person hears so before anything is sent.
    await assert.rejects(brief(rig, "depth", 1, "p-body", "depth-body-0001"), (error: unknown) => {
      assert.match(
        String(Reflect.get(Object(error), "message")),
        /p-body is not a painted portrait/,
      );
      return true;
    });
    const base = await current(rig);
    const sent = await brief(rig, "depth", 1, headId, "depth-head-0001");
    assert.equal(sent.apply.translator, "portrait-depth");
    const picture = depthPass(0);

    // The raster is not ready: the submission fails and nothing is recorded.
    rig.raster.ready = false;
    await assert.rejects(
      submitDepth(rig, sent.artId, picture, "depth-reply-0001"),
      /raster is starting/,
    );
    assert.equal((await rig.human.call("art.get", { artId: sent.artId })).submissions.length, 0);
    rig.raster.ready = true;
    const s: Submission = (await submitDepth(rig, sent.artId, picture, "depth-reply-0001"))
      .submission;
    assert.equal(s.state, "proposed", JSON.stringify(s.diagnostics));
    assert.equal(s.translator, "portrait-depth");
    assert.deepEqual(rig.raster.calls.at(-1), {
      mediaType: "image/png",
      size: depthCanvas,
      quadrant: null,
    });

    // The preview shows the fitted field; the head is untouched until the person accepts.
    const raster = new TestRaster();
    const field = depthFromPixels(
      await raster.pixels(picture, "image/png", depthCanvas),
      depthCanvas,
      depthCanvas,
    );
    const draft = await rig.human.call("draft", {
      documentId: rig.documentId,
      proposalId: s.proposal?.id ?? "",
    });
    assert.ok(draft.ok);
    if (!draft.ok) return;
    assert.deepEqual(figurePortraitDepth.read(head(draft.preview).features)?.field, field);
    assert.equal((await current(rig)).revision, 1);
    const accepted = await command(rig, rig.human, "accept-depth-0001", {
      type: "proposal.accept",
      proposal: s.proposal?.id,
      version: 1,
    });
    assert.equal(accepted.kind, "committed", JSON.stringify(accepted));
    const fitted = await current(rig);
    assert.equal(fitted.revision, 2);
    assert.deepEqual(figurePortraitDepth.read(head(fitted.doc).features), {
      ...figurePortraitDepth.read(head(base.doc).features),
      field,
    });
    // Only the head's depth changed: every other part, the assets and the credits stay.
    assert.deepEqual(
      fitted.doc.parts.filter((p) => p.id !== headId),
      base.doc.parts.filter((p) => p.id !== headId),
    );
    assert.deepEqual(fitted.doc.extensions, base.doc.extensions, "a depth pass adds no picture");
    const view = await rig.human.call("art.get", { artId: sent.artId });
    assert.equal(view.submissions[0]?.proposal?.status, "accepted");
    assert.equal(view.submissions[0]?.proposal?.acceptedRevision, 2);

    // The same reply again stands for the first; undo restores the old field.
    const again = (await submitDepth(rig, sent.artId, picture, "depth-reply-0002")).submission;
    assert.equal(again.duplicateOf, "depth-reply-0001");
    const undone = await command(rig, rig.human, "undo-depth-0001", { type: "undo", target: 2 });
    assert.equal(undone.kind, "committed", JSON.stringify(undone));
    assert.deepEqual(head((await current(rig)).doc), head(base.doc));

    // A reply after the person moved a foot: drafted on the brief, the head keeps the move.
    const later = await brief(rig, "depth", 3, headId, "depth-head-0002");
    const foot = base.doc.parts.find((p) => p.id === "p-left-foot");
    assert.ok(foot);
    const move = await command(rig, rig.human, "move-foot-0001", {
      type: "edit",
      ops: [{ op: "part.transform", part: foot.id, translate: [0.02, 0, 0.01] }],
    });
    assert.equal(move.kind, "committed");
    const stale = (await submitDepth(rig, later.artId, depthPass(18), "depth-reply-0003"))
      .submission;
    assert.equal(stale.state, "proposed");
    assert.deepEqual(stale.source, { baseRevision: 3, headAtSubmit: 4, stale: true });
    const moved = await current(rig);
    assert.equal(moved.revision, 4);
    assert.deepEqual(head(moved.doc), head(base.doc));
    const staleDraft = await rig.human.call("draft", {
      documentId: rig.documentId,
      proposalId: stale.proposal?.id ?? "",
    });
    assert.ok(staleDraft.ok && staleDraft.stale && staleDraft.rebased.ok);
    const drafted = figurePortraitDepth.read(head(staleDraft.preview).features);
    assert.ok(drafted);
    const refused = await command(rig, rig.human, "accept-stale-0001", {
      type: "proposal.accept",
      proposal: stale.proposal?.id,
      version: 1,
    });
    assert.equal(refused.kind, "rejected");
    // The agent refines it on the head; the person accepts, keeping the move.
    const refined = await command(rig, rig.agent, "refine-stale-0001", {
      type: "proposal.refine",
      proposal: stale.proposal?.id,
      version: 1,
      summary: "Front depth pass, on the current revision",
      content: {
        kind: "ops",
        ops: [
          {
            op: "feature.set",
            feature: figurePortraitDepth.id,
            part: headId,
            value: figurePortraitDepth.json(drafted),
          },
        ],
      },
    });
    assert.equal(refined.kind, "committed", JSON.stringify(refined));
    const acceptRefined = await command(rig, rig.human, "accept-stale-0002", {
      type: "proposal.accept",
      proposal: stale.proposal?.id,
      version: 2,
    });
    assert.equal(acceptRefined.kind, "committed", JSON.stringify(acceptRefined));
    const both = await current(rig);
    assert.deepEqual(
      both.doc.parts.find((p) => p.id === foot.id),
      moved.doc.parts.find((p) => p.id === foot.id),
      "the person's move stays",
    );
    assert.deepEqual(figurePortraitDepth.read(head(both.doc).features), drafted);
    assert.notDeepEqual(drafted.field, figurePortraitDepth.read(head(base.doc).features)?.field);

    // A cancelled request refuses its reply.
    const closed = await brief(rig, "depth", both.revision, headId, "depth-head-0003");
    await rig.human.call("art.cancel", { artId: closed.artId });
    await assert.rejects(
      submitDepth(rig, closed.artId, depthPass(30), "depth-reply-0004"),
      /was closed/,
    );
  });
});

test("a paired trace map fits the head's face landmarks and depth pins and names what it did not build", async () => {
  await withRig(async (rig) => {
    // A hull is no horizontal loft: the trace fit refuses it when the brief is sent.
    await assert.rejects(
      brief(rig, "trace", 1, "p-vest-folded-collar", "trace-collar-0001"),
      /not a painted horizontal loft/,
    );
    const base = await current(rig);
    const sent = await brief(rig, "trace", 1, headId, "trace-head-0001");
    assert.equal(sent.apply.translator, "trace-fit");
    const submitted = await rig.agent.call("art.submit", {
      artId: sent.artId,
      submissionId: "trace-reply-0001",
      reply: {
        format: "irudd.art-reply",
        version: 1,
        kind: "trace",
        summary: "Face marks and depth pairs",
        traceMap: {
          format: "irudd.trace-map.v1",
          height: 0.32,
          regions: [
            {
              id: headId,
              method: "loft",
              front: [
                [0.3, 0.1],
                [0.7, 0.1],
                [0.7, 0.95],
                [0.3, 0.95],
              ],
              side: [
                [0.3, 0.1],
                [0.7, 0.1],
                [0.7, 0.95],
                [0.3, 0.95],
              ],
              faceLandmarks: [
                [0.43, 0.4],
                [0.57, 0.402],
                [0.5, 0.5],
                [0.5, 0.6],
                [0.5, 0.75],
              ],
              depthPairs: [
                [0.5, 0.5, 0.42, 0.5, 0.1],
                [0.45, 0.45, 0.5, 0.452, 0.08],
              ],
            },
            {
              id: "hat",
              parent: headId,
              method: "volume",
              front: [
                [0.3, 0.05],
                [0.7, 0.05],
                [0.7, 0.2],
                [0.3, 0.2],
              ],
              side: [
                [0.3, 0.05],
                [0.7, 0.05],
                [0.7, 0.2],
                [0.3, 0.2],
              ],
            },
          ],
        },
      },
    });
    const s = submitted.submission;
    assert.equal(s.state, "proposed", JSON.stringify(s.diagnostics));
    assert.equal(s.translator, "trace-fit");
    // The translator measured the head's own sheet: its front and left-facing profile panels.
    assert.deepEqual(
      rig.raster.calls.map((c) => [c.mediaType, c.size, c.quadrant]),
      [
        ["image/webp", panelCanvas, 0],
        ["image/webp", panelCanvas, 1],
      ],
    );
    const journal = await rig.human.call("inspect", { documentId: rig.documentId });
    const proposal = journal.proposals.find((p) => p.id === s.proposal?.id);
    assert.match(proposal?.summary ?? "", /Not built: hat/);
    assert.match(proposal?.summary ?? "", /keeps its traced cross sections/);
    const accepted = await command(rig, rig.human, "accept-trace-0001", {
      type: "proposal.accept",
      proposal: s.proposal?.id,
      version: 1,
    });
    assert.equal(accepted.kind, "committed", JSON.stringify(accepted));
    const fitted = await current(rig);
    const before = figurePaint.read(head(base.doc).features);
    const after = figurePaint.read(head(fitted.doc).features);
    assert.ok(before && after);
    assert.notDeepEqual(after.portrait, before.portrait, "the face is calibrated to the marks");
    assert.deepEqual(after.rest, before.rest, "the traced cross sections stay");
    assert.equal(figureAnatomy.read(head(fitted.doc).features)?.region, "face");
    const pins = figurePortraitDepth.read(head(fitted.doc).features)?.pins ?? [];
    assert.equal(
      pins.length,
      (figurePortraitDepth.read(head(base.doc).features)?.pins?.length ?? 0) + 2,
    );
    assert.equal(fitted.doc.parts.length, base.doc.parts.length, "the hat is not built");
    assert.deepEqual(
      fitted.doc.parts.filter((p) => p.id !== headId),
      base.doc.parts.filter((p) => p.id !== headId),
    );
  });
});

test("a trace brief that builds adds the map's regions as parts on the anchor's sheet: refusal, preview, accept, undo and redo", async () => {
  await withRig(async (rig) => {
    const trace = (await rig.agent.call("art.capabilities", {})).kinds.find(
      (k) => k.kind === "trace",
    );
    assert.deepEqual(
      trace?.intents?.map((i) => [i.intent, i.apply.translator]),
      [
        ["fit", "trace-fit"],
        ["build", "trace-build"],
      ],
    );
    const send = (part: string, requestId: string) =>
      rig.human.call("art.request", {
        agent: "claude",
        requestId,
        brief: {
          format: "irudd.art-brief",
          version: 1,
          kind: "trace",
          intent: "build",
          documentId: rig.documentId,
          revision: 1,
          direction: "Trace a satchel, its strap and tail, and a fin on the body's sheet.",
          attachments: [
            { role: "front", digest: rig.views.front, label: "sheet front" },
            { role: "side", digest: rig.views.side, label: "sheet profile" },
          ],
          parts: [part],
        },
      });
    // An unpainted part has no sheet to build on: refused before anything is sent.
    const base = await current(rig);
    const unpainted = base.doc.parts.find((p) => !p.paint);
    if (unpainted)
      await assert.rejects(
        send(unpainted.id, "build-unpainted-0001"),
        /not painted from a turnaround sheet/,
      );
    const sent = await send("p-body", "build-body-0001");
    assert.equal(sent.brief.intent, "build");
    assert.equal(sent.apply.translator, "trace-build");
    // The stand-in sheet's subject spans x 0.39–0.63 and y 0.16–0.94 of each panel.
    const rect = (x0: number, x1: number, y0: number, y1: number) =>
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ] as const;
    const regions = [
      {
        id: "body",
        method: "loft",
        front: rect(0.4, 0.62, 0.2, 0.9),
        side: rect(0.4, 0.62, 0.2, 0.9),
      },
      {
        id: "satchel",
        parent: "body",
        method: "volume",
        motionRole: "rigid",
        outfitRole: "accessory",
        front: rect(0.42, 0.6, 0.5, 0.6),
        side: rect(0.42, 0.6, 0.5, 0.6),
      },
      {
        id: "strap",
        parent: "satchel",
        method: "loft",
        front: rect(0.45, 0.55, 0.62, 0.7),
        side: rect(0.45, 0.55, 0.62, 0.7),
      },
      {
        id: "tail",
        parent: "satchel",
        method: "path",
        spine: [0.55, 0.62, 0.7, 0.78].map((y) => [0.5, y, 0.5, y, 0.02, 0.018] as const),
      },
      {
        id: "fin",
        parent: "body",
        method: "membrane",
        correspondence: "opposite",
        front: rect(0.4, 0.6, 0.3, 0.4),
        side: rect(0.45, 0.5, 0.3, 0.4),
      },
      {
        id: "cloud",
        parent: "body",
        method: "volume",
        front: rect(0.05, 0.15, 0.2, 0.3),
        side: rect(0.05, 0.15, 0.2, 0.3),
      },
    ] as const;
    const reply = {
      format: "irudd.art-reply",
      version: 1,
      kind: "trace",
      summary: "Satchel, strap, tail and fin",
      traceMap: { format: "irudd.trace-map.v1", height: 1.77, regions },
    } as const;
    const s = (
      await rig.agent.call("art.submit", {
        artId: sent.artId,
        submissionId: "build-reply-0001",
        reply,
      })
    ).submission;
    assert.equal(s.state, "proposed", JSON.stringify(s.diagnostics));
    assert.equal(s.translator, "trace-build");
    // The translator measured all four views of the body's own sheet.
    assert.deepEqual(
      rig.raster.calls.map((c) => [c.mediaType, c.size, c.quadrant]),
      [0, 1, 2, 3].map((q) => ["image/webp", panelCanvas, q]),
    );
    // The proposal is exactly the character package's build on the same panels.
    const stand = new TestRaster();
    const panel = async (q: 0 | 1 | 2 | 3) =>
      panelFromPixels(
        await stand.pixels(new Uint8Array(0), "image/webp", panelCanvas, q),
        panelCanvas,
      );
    const expected = traceBuildOperations(
      base.doc,
      "p-body",
      regions,
      [await panel(0), await panel(1), await panel(2), await panel(3)],
      1.77,
    );
    assert.deepEqual(
      expected.built.map((b) => [b.region, b.method, b.part.id, b.part.parent]),
      [
        ["satchel", "volume", "p-satchel", "p-body"],
        ["strap", "loft", "p-strap", "p-satchel"],
        ["tail", "path", "p-tail", "p-satchel"],
        ["fin", "membrane", "p-fin", "p-body"],
      ],
    );
    const journal = await rig.human.call("inspect", { documentId: rig.documentId });
    const proposal = journal.proposals.find((p) => p.id === s.proposal?.id);
    assert.match(
      proposal?.summary ?? "",
      /Built 4: satchel \(volume\), strap \(loft\), tail \(path\), fin \(membrane\)\./,
    );
    assert.match(proposal?.summary ?? "", /Kept as they are: body \(p-body\)\./);
    assert.match(
      proposal?.summary ?? "",
      /Not built: cloud \(Select a larger overlapping region\)/,
    );
    const draft = await rig.human.call("draft", {
      documentId: rig.documentId,
      proposalId: s.proposal?.id ?? "",
    });
    assert.ok(draft.ok);
    if (!draft.ok) return;
    assert.deepEqual(
      draft.preview.parts.filter((p) => !base.doc.parts.some((q) => q.id === p.id)),
      expected.built.map((b) => b.part).sort((a, b) => (a.id < b.id ? -1 : 1)),
      "the preview adds exactly the built parts (the document keeps parts in ID order)",
    );
    assert.equal((await current(rig)).revision, 1, "a preview commits nothing");
    const accepted = await command(rig, rig.human, "accept-build-0001", {
      type: "proposal.accept",
      proposal: s.proposal?.id,
      version: 1,
    });
    assert.equal(accepted.kind, "committed", JSON.stringify(accepted));
    const built = await current(rig);
    assert.equal(built.revision, 2);
    assert.deepEqual(built.doc, draft.preview, "accepted as previewed");
    assert.deepEqual(
      built.doc.parts.filter((p) => base.doc.parts.some((q) => q.id === p.id)),
      base.doc.parts,
      "every existing part stays as it was",
    );
    assert.deepEqual(
      built.doc.assets,
      base.doc.assets,
      "the parts paint from the sheet already declared",
    );
    // Each built part is an ordinary editable part: the person moves the satchel and its strap follows.
    const moved = await command(rig, rig.human, "move-satchel-0001", {
      type: "edit",
      ops: [{ op: "part.transform", part: "p-satchel", translate: [0.03, 0, 0] }],
    });
    assert.equal(moved.kind, "committed", JSON.stringify(moved));
    const undoMove = await command(rig, rig.human, "undo-move-0001", { type: "undo", target: 3 });
    assert.equal(undoMove.kind, "committed");
    // Undo the build, then redo it by undoing that undo.
    const undone = await command(rig, rig.human, "undo-build-0001", { type: "undo", target: 2 });
    assert.equal(undone.kind, "committed", JSON.stringify(undone));
    assert.deepEqual(
      (await current(rig)).doc.parts,
      base.doc.parts,
      "undo removes the built parts",
    );
    const { revision: undoRevision } = await current(rig);
    const redone = await command(rig, rig.human, "redo-build-0001", {
      type: "undo",
      target: undoRevision,
    });
    assert.equal(redone.kind, "committed", JSON.stringify(redone));
    assert.deepEqual((await current(rig)).doc.parts, built.doc.parts, "redo restores them");
    const view = await rig.human.call("art.get", { artId: sent.artId });
    assert.equal(view.submissions[0]?.proposal?.status, "accepted");
  });
});
