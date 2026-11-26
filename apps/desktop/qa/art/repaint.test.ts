// Paired turnaround painting through the desktop's own host options: a
// person's brief with real views and the source sheet, the paired agent's reply
// with a real restored sheet, the desktop's repaint translator, and the
// person's acceptance. The accepted document must be the one the character
// package's repaint makes from the same sheet when the person paints it by
// hand. That repaint is G0's: verification/families/test/repaint.test.ts runs
// G0's repaintRegions from 2761eb14 on the courier case, and the family gate's
// repaint oracle (`pnpm --filter @irudd/verification-families gate:g4a-families`)
// matches G0's recorded hardware paint panel session on harbour-trader.
//
// Cases:
// - courier on feline-worker, from tracked fixtures. Always runs.
// - harbour-trader with the 78,290-byte sheet G0 accepted in its recorded
//   session, from the ignored .reference-cache. Runs when that recording is
//   present and says so when it is not.
// - a reply after the person moved a part is drafted on the brief's revision
//   and leaves the head alone; a reply after the person repainted the same
//   region conflicts on rebase.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import {
  AssetEntry,
  Digest,
  PartId,
  applyOperations,
  assetCreditsNamespace,
  createRegistry,
  decodeOperations,
  documentDigest,
  familyFeatures,
  frameCreature,
  isJson,
  readDocument,
  validateDocument,
  type CharacterDocument,
  type Json,
} from "@irudd/document";
import { bundledAsset, bundledAssetNamed, repaintOperations } from "@irudd/character";
import { connect, uploadArt, type WorkshopClient } from "@irudd/workshop/client";
import { startHost, type RunningHost } from "@irudd/workshop/host";
import type { MethodResults } from "@irudd/workshop/wire";
import { repaintTranslator, shippedArtwork } from "../../src/main/art.js";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const fixturesDir = path.join(repository, "verification", "families", "fixtures");
const blobsDir = path.join(fixturesDir, "blobs");
/** Bytes from local reference material that is not tracked, such as the sheet G0 accepted. */
const referenceBlobsDir = path.join(repository, ".reference-cache", "g4a", "blobs");
const g0PaintDir = path.join(repository, ".reference-cache", "g0-paint");

/** A plain JSON copy, for values sent in a command. */
function json(value: unknown): Json {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  assert.ok(isJson(copy));
  return copy;
}

const decodeDigest = Schema.decodeUnknownSync(Digest);
const decodePart = Schema.decodeUnknownSync(PartId);
const decodeEntry = Schema.decodeUnknownSync(AssetEntry);
const registry = createRegistry({ features: familyFeatures, generators: [frameCreature] });
const person = { kind: "human", id: "tester", name: "Tester" } as const;
const characterAssets = path.join(repository, "packages", "character", "assets");

/** Bytes of a digest from the fixtures, the shipped assets or the local reference blobs. */
function bytesOf(digest: string): Uint8Array {
  const name = digest.replace(":", "-");
  for (const dir of [blobsDir, referenceBlobsDir]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return new Uint8Array(fs.readFileSync(file));
  }
  const asset = bundledAsset(decodeDigest(digest));
  if (asset) return new Uint8Array(fs.readFileSync(path.join(characterAssets, asset.file)));
  throw new Error(`No bytes for ${digest}.`);
}

function fixture(name: string): { raw: unknown; doc: CharacterDocument } {
  const raw: unknown = JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), "utf8"));
  const read = readDocument(raw, { registry });
  assert.ok(read.ok, name);
  return { raw, doc: read.value };
}

/** The same operations applied as the person's own edit, then validated. */
function painted(doc: CharacterDocument, ops: unknown): CharacterDocument {
  const decoded = decodeOperations(ops);
  assert.ok(decoded.ok, JSON.stringify(!decoded.ok && decoded.diagnostics));
  const applied = applyOperations(doc, decoded.value, {
    registry,
    retired: new Set(),
    idFor: (slot) => {
      throw new Error(`No generated slots in a repaint: ${slot}`);
    },
  });
  assert.ok(applied.ok, JSON.stringify(!applied.ok && applied.diagnostics));
  const checked = validateDocument(applied.value, { registry });
  assert.ok(checked.ok, JSON.stringify(!checked.ok && checked.diagnostics));
  return checked.value;
}

/** What the person's own repaint of a region from this sheet makes. */
function expected(base: CharacterDocument, part: string, digest: string, byteLength: number) {
  return painted(
    base,
    json(
      repaintOperations(
        base,
        [decodePart(part)],
        decodeEntry({ digest, mediaType: "image/webp", byteLength, role: "paint-atlas" }),
      ),
    ),
  );
}

interface Rig {
  readonly host: RunningHost;
  readonly human: WorkshopClient;
  readonly agent: WorkshopClient;
  readonly documentId: string;
}

async function withRig(name: string, body: (rig: Rig) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `irudd-art-repaint-${name}-`));
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const host = await startHost({
    path: project,
    stateDir,
    create: { label: "Repaint" },
    human: person,
    registry,
    durability: "normal",
    artTranslators: [repaintTranslator],
    shippedArtwork,
  });
  const human = await connect({ credential: { role: "human", project }, stateDir });
  const { raw, doc } = fixture(name);
  for (const asset of doc.assets) await uploadArt(human, bytesOf(asset.digest), "image/webp");
  const documentId = doc.id;
  const created = await human.call("apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId: `create-${name}-0001`,
      documentId,
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
  const agent = await connect({
    credential: { role: "agent", file: pair.credentialFile },
    stateDir,
  });
  try {
    await body({ host, human, agent, documentId });
  } finally {
    agent.close();
    human.close();
    await host.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The person's turnaround brief: the editor's whole view, a close-up and the body's current sheet. */
async function repaintBrief(rig: Rig, revision: number, body: string): Promise<string> {
  const doc = (await rig.human.call("current", { documentId: rig.documentId })).document;
  const atlas = doc?.parts.find((p) => p.id === body)?.paint?.atlas;
  assert.ok(atlas);
  // Editor views stand in as the restored sheets' own bytes: real pictures of this character.
  const source = await uploadArt(rig.human, bytesOf(atlas), "image/webp");
  const requested = await rig.human.call("art.request", {
    agent: "claude",
    requestId: `brief-${rig.documentId}-${revision}-${Date.now()}`,
    brief: {
      format: "irudd.art-brief",
      version: 1,
      kind: "turnaround",
      documentId: rig.documentId,
      revision,
      direction: "Repaint the body only; keep the cut, pose and registration.",
      attachments: [
        { role: "whole", digest: source.digest },
        { role: "source-sheet", digest: source.digest, label: "current body sheet" },
      ],
      parts: [body],
    },
  });
  assert.equal(requested.apply.translator, "repaint");
  return requested.artId;
}

async function reply(rig: Rig, artId: string, sheet: Uint8Array, id: string) {
  const staged = await uploadArt(rig.agent, sheet, "image/webp");
  return rig.agent.call("art.submit", {
    artId,
    submissionId: id,
    reply: {
      format: "irudd.art-reply",
      version: 1,
      kind: "turnaround",
      summary: "Body repainted",
      image: staged.digest,
    },
  });
}

async function accept(
  rig: Rig,
  s: MethodResults["art.submit"]["submission"],
): Promise<CharacterDocument> {
  const head = (await rig.human.call("current", { documentId: rig.documentId })).revision;
  const accepted = await rig.human.call("apply", {
    request: {
      format: "irudd.command",
      version: 1,
      requestId: `accept-${s.submissionId}`,
      documentId: rig.documentId,
      expectedRevision: head,
      command: { type: "proposal.accept", proposal: s.proposal?.id ?? "", version: 1 },
    },
  });
  assert.equal(accepted.kind, "committed", JSON.stringify(accepted));
  const doc = (await rig.human.call("current", { documentId: rig.documentId })).document;
  assert.ok(doc);
  return doc;
}

function expectedWithCredit(
  repaint: CharacterDocument,
  digest: string,
  artId: string,
  submission: MethodResults["art.submit"]["submission"],
): CharacterDocument {
  return {
    ...repaint,
    extensions: {
      ...repaint.extensions,
      [assetCreditsNamespace]: json({
        format: "irudd.asset-credits",
        version: 1,
        assets: [
          {
            digest,
            via: "paired-agent",
            submittedBy: submission.by,
            art: { id: artId, kind: "turnaround" },
            summary: submission.reply.summary,
          },
        ],
      }),
    },
  };
}

const sortedAssets = (doc: CharacterDocument) =>
  [...doc.assets].sort((a, b) => a.digest.localeCompare(b.digest));

test("the paired courier repaint of feline-worker is the person's own courier repaint", async () => {
  await withRig("feline-worker", async (rig) => {
    const courier = bundledAssetNamed("courier");
    assert.ok(courier);
    const sheet = new Uint8Array(fs.readFileSync(path.join(characterAssets, courier.file)));
    const base = fixture("feline-worker").doc;
    const artId = await repaintBrief(rig, 1, "p-body");
    const submitted = await reply(rig, artId, sheet, "courier-reply-0001");
    const s = submitted.submission;
    assert.equal(s.state, "proposed", JSON.stringify(s.diagnostics));
    assert.equal(s.translator, "repaint");
    assert.deepEqual(
      s.files.map((f) => [f.digest, f.mediaType, f.byteLength]),
      [[courier.digest, "image/webp", courier.byteLength]],
    );
    assert.equal(s.by.id, "claude");
    const ported = await accept(rig, s);
    const own = expected(base, "p-body", courier.digest, courier.byteLength);
    assert.equal(
      documentDigest(ported),
      documentDigest(own),
      "the bundled sheet keeps its original credit",
    );
    assert.deepEqual(sortedAssets(ported), sortedAssets(own));
    assert.equal(ported.parts.find((p) => p.id === "p-body")?.paint?.atlas, courier.digest);
  });
});

test("the paired repaint of harbour-trader with G0's accepted sheet is the person's own repaint", async (t) => {
  const record = path.join(g0PaintDir, "paint.json");
  if (!fs.existsSync(record)) {
    t.skip(`no G0 paint recording in ${g0PaintDir}; run verification/baseline/paint.py`);
    return;
  }
  const recorded: unknown = JSON.parse(fs.readFileSync(record, "utf8"));
  const digest = `sha256:${String(Reflect.get(Object(recorded), "artworkSha256"))}`;
  const file = path.join(referenceBlobsDir, digest.replace(":", "-"));
  if (!fs.existsSync(file)) {
    t.skip(`G0's accepted sheet is not in ${referenceBlobsDir}; run the family gate`);
    return;
  }
  const bytes = new Uint8Array(fs.readFileSync(file));
  assert.equal(bytes.byteLength, 78290);
  const base = fixture("harbour-trader").doc;
  await withRig("harbour-trader", async (rig) => {
    const artId = await repaintBrief(rig, 1, "p-body");
    const s = (await reply(rig, artId, bytes, "harbour-reply-0001")).submission;
    assert.equal(s.state, "proposed", JSON.stringify(s.diagnostics));
    assert.deepEqual(
      s.files.map((f) => [f.digest, f.byteLength]),
      [[digest, 78290]],
    );
    const ported = await accept(rig, s);
    assert.equal(
      documentDigest(ported),
      documentDigest(
        expectedWithCredit(expected(base, "p-body", digest, bytes.byteLength), digest, artId, s),
      ),
    );
  });
});

test("a repaint reply after the person's edits is stale, keeps the head and conflicts with their repaint", async () => {
  await withRig("feline-worker", async (rig) => {
    const courier = bundledAssetNamed("courier");
    assert.ok(courier);
    const sheet = new Uint8Array(fs.readFileSync(path.join(characterAssets, courier.file)));
    const artId = await repaintBrief(rig, 1, "p-body");
    // The person moves a forearm, then repaints the body themselves from another sheet.
    const base = (await rig.human.call("current", { documentId: rig.documentId })).document;
    assert.ok(base);
    const forearm = base.parts.find((p) => p.label === "left forearm");
    assert.ok(forearm);
    const moved = await rig.human.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: "person-move-0001",
        documentId: rig.documentId,
        expectedRevision: 1,
        command: {
          type: "edit",
          ops: [
            {
              op: "part.transform",
              part: forearm.id,
              translate: [0.01, 0.02, 0],
              rotate: [0, 0, Math.sin(0.1), Math.cos(0.1)],
            },
          ],
        },
      },
    });
    assert.equal(moved.kind, "committed");
    const s = (await reply(rig, artId, sheet, "stale-reply-0001")).submission;
    assert.equal(s.state, "proposed");
    assert.deepEqual(s.source, { baseRevision: 1, headAtSubmit: 2, stale: true });
    const head = await rig.human.call("current", { documentId: rig.documentId });
    assert.equal(head.revision, 2);
    assert.notDeepEqual(
      head.document?.parts.find((p) => p.id === forearm.id),
      forearm,
      "the head keeps the person's move",
    );
    const draft = await rig.human.call("draft", {
      documentId: rig.documentId,
      proposalId: s.proposal?.id ?? "",
    });
    assert.ok(draft.ok);
    if (!draft.ok) return;
    assert.equal(draft.stale, true);
    assert.equal(draft.preview.parts.find((p) => p.id === "p-body")?.paint?.atlas, courier.digest);
    assert.equal(draft.rebased.ok, true, "a repaint and a moved forearm do not conflict");

    // The person's own repaint of the same region, from the other sheet already in the document.
    const headDoc = head.document;
    assert.ok(headDoc);
    const other = headDoc.assets.find(
      (a) => a.digest !== headDoc.parts.find((p) => p.id === "p-body")?.paint?.atlas,
    );
    assert.ok(other);
    const own = await rig.human.call("apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: "person-repaint-0001",
        documentId: rig.documentId,
        expectedRevision: 2,
        command: {
          type: "edit",
          ops: json(repaintOperations(headDoc, [decodePart("p-body")], other)),
        },
      },
    });
    assert.equal(own.kind, "committed", JSON.stringify(own));
    const conflicted = await rig.human.call("draft", {
      documentId: rig.documentId,
      proposalId: s.proposal?.id ?? "",
    });
    assert.ok(conflicted.ok);
    assert.equal(
      conflicted.ok && conflicted.rebased.ok,
      false,
      "the agent's repaint conflicts with the person's",
    );
    const view = await rig.human.call("art.get", { artId });
    assert.equal(view.head, 3);
    assert.equal(view.submissions[0]?.proposal?.status, "draft");
  });
});
