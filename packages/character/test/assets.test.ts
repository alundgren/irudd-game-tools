import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assetCreditsNamespace,
  createRegistry,
  decodeWith,
  defaultFrameCreatureParams,
  digestBrand,
  DocumentId,
  emptyState,
  frameCreature,
  memoryEnvironment,
  reduce,
  sha256Digest,
} from "@irudd/document";
import { assetResolver, bundledAssets, type BundledAsset } from "../src/assets.js";
import { creditArtwork, creditsFor } from "../src/export.js";

const read = (asset: BundledAsset) =>
  new Uint8Array(readFileSync(new URL(`../assets/${asset.file}`, import.meta.url)));

test("every bundled file matches its manifest digest, size and origin", () => {
  for (const asset of bundledAssets) {
    const bytes = read(asset);
    assert.equal(sha256Digest(bytes), asset.digest, asset.file);
    assert.equal(bytes.byteLength, asset.byteLength, asset.file);
    assert.ok(asset.origin.source.length > 0, asset.file);
  }
});

test("the resolver refuses bytes that do not hash to the digest", () => {
  const [asset] = bundledAssets;
  assert.ok(asset);
  const bytes = read(asset);
  const tampered = Uint8Array.from(bytes);
  tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
  assert.equal(assetResolver({ bundled: () => bytes }).resolve(asset.digest)?.source, "bundled");
  assert.equal(assetResolver({ bundled: () => tampered }).resolve(asset.digest), undefined);
  const blob = new Uint8Array([1, 2, 3]);
  const digest = digestBrand(sha256Digest(blob));
  const project = (bytes: Uint8Array) =>
    assetResolver({
      bundled: () => undefined,
      project: () => ({ bytes, mediaType: "image/webp" }),
    });
  assert.equal(project(blob).resolve(digest)?.source, "project");
  assert.equal(project(new Uint8Array([1, 2, 4])).resolve(digest), undefined);
});

test("credits list third-party material only", () => {
  const [asset] = bundledAssets;
  assert.ok(asset);
  assert.deepEqual(
    creditsFor([{ digest: asset.digest, source: "bundled", origin: asset.origin }]),
    [],
  );
  assert.deepEqual(
    creditsFor([
      {
        digest: asset.digest,
        source: "project",
        origin: {
          kind: "credited",
          license: "CC-BY-4.0",
          source: "example",
          credit: "Sheet by A. Artist, CC BY 4.0",
        },
      },
    ]),
    ["Sheet by A. Artist, CC BY 4.0"],
  );
});

test("project artwork carries the document's credit; bundled files keep their shipped origin", () => {
  const id = decodeWith(DocumentId, "doc-credited");
  assert.ok(id.ok);
  const { state } = reduce(
    emptyState(id.value),
    {
      format: "irudd.command",
      version: 1,
      requestId: "req-credited",
      expectedRevision: 0,
      documentId: id.value,
      actor: { kind: "human", id: "artist" },
      command: {
        type: "document.generate",
        label: "Credited walker",
        generator: frameCreature.id,
        version: frameCreature.version,
        params: defaultFrameCreatureParams,
      },
    },
    memoryEnvironment(createRegistry({ generators: [frameCreature] })),
  );
  assert.ok(state.document);
  const [bundled] = bundledAssets;
  assert.ok(bundled);
  const stated = digestBrand(`sha256:${"a".repeat(64)}`);
  const silent = digestBrand(`sha256:${"b".repeat(64)}`);
  const credit = (digest: string, extra: Record<string, string>) => ({
    digest,
    via: "paired-agent",
    submittedBy: { kind: "agent", id: "claude", name: "Claude" },
    art: { id: "art-0123456789abcdef01234567", kind: "turnaround" },
    summary: "Oilskin repaint",
    ...extra,
  });
  const entry = (digest: typeof stated) =>
    ({ digest, mediaType: "image/png", byteLength: 10, role: "paint-atlas" }) as const;
  const doc = {
    ...state.document,
    assets: [entry(stated), entry(silent), entry(bundled.digest)],
    extensions: {
      [assetCreditsNamespace]: {
        format: "irudd.asset-credits",
        version: 1,
        assets: [
          credit(stated, { author: "Ada Weaver", license: "CC-BY-4.0" }),
          credit(silent, {}),
          credit(bundled.digest, { credit: "Claimed by a submitter" }),
        ],
      },
    },
  };
  const artwork = creditArtwork(doc, [
    { digest: bundled.digest, source: "bundled", file: bundled.file, origin: bundled.origin },
    { digest: stated, source: "project" },
    { digest: silent, source: "project" },
  ]);
  assert.equal(artwork[0]?.credit, undefined, "a bundled file keeps its shipped origin");
  assert.equal(artwork[1]?.credit?.author, "Ada Weaver");
  assert.equal(artwork[1]?.credit?.submittedBy.id, "claude");
  assert.equal(artwork[2]?.credit?.summary, "Oilskin repaint");
  assert.deepEqual(creditsFor(artwork), ["turnaround artwork by Ada Weaver (CC-BY-4.0)"]);
});
