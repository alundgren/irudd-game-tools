// Review in the host, with fake renderers: prepared forms staging their
// artwork, revision pinning, head movement during a job, issued-artifact
// reads, provenance checks, and a renderer served over a person's connection
// that disconnects and registers again. The real renderer is the desktop's
// review worker; apps/desktop/scripts/qa-review.ts exercises it on the GPU.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { restoreProject } from "@irudd/workshop";
import { connect, WorkshopError, type WorkshopClient } from "@irudd/workshop/client";
import {
  loadForms,
  startHost,
  workshopRegistry,
  type RenderOutput,
  type ReviewRenderer,
  type RunningHost,
} from "@irudd/workshop/host";
import type { HostEvent, RenderJob, RendererInfo } from "@irudd/workshop/wire";
import { docId, generate, rename, request, requestId, tempDir } from "./support/fixtures.js";

const person = { kind: "human", id: "tester", name: "Tester" } as const;
const repository = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const fixtures = path.join(repository, "verification", "families", "fixtures");

const info: RendererInfo = {
  kind: "desktop-worker",
  build: "test-build",
  versions: { electron: "0", chrome: "0" },
  gpu: { vendor: "Test", renderer: "Test GPU", webgl: "WebGL 2.0", software: false },
  supports: {
    views: ["threequarter", "front", "side", "back", "overhead", "portrait"],
    portraitViews: ["portrait"],
    surfaces: ["source", "clay", "ink"],
    lights: ["studio"],
    pixelRatios: [1, 2, 3],
    maxEdge: 4096,
  },
};

/** A GLB holding only a JSON chunk with the provenance stamp. */
function fakeGlb(stamp: Record<string, unknown>, padding = 0): Uint8Array {
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0", extras: { irudd: stamp } },
      pad: "x".repeat(padding),
    }),
  );
  const padded = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + padded).fill(0x20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  return bytes;
}

function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function output(job: RenderJob, tamper: Partial<Record<string, unknown>> = {}): RenderOutput {
  const glb = fakeGlb({
    format: "irudd.export",
    version: 1,
    document: job.documentId,
    digest: job.documentDigest,
    revision: job.revision,
    preset: job.preset,
    build: info.build,
    ...tamper,
  });
  const files = new Map<string, Uint8Array>([["model.glb", glb]]);
  const images = (job.inspect ? ["front", "side"] : []).map((view) => {
    const width = (job.inspect?.width ?? 0) * (job.inspect?.pixelRatio ?? 1);
    const height = (job.inspect?.height ?? 0) * (job.inspect?.pixelRatio ?? 1);
    files.set(`${view}.png`, fakePng(width, height));
    return {
      name: `${view}.png`,
      kind: "body" as const,
      width,
      height,
      recipe: { view },
      render: { calls: 3, triangles: 100 },
    };
  });
  return {
    files,
    result: {
      glb: "model.glb",
      exportMs: 1,
      credits: [],
      inventory: {
        vertices: 10,
        triangles: 4,
        images: [],
        materials: [],
        joints: [],
        animations: [],
      },
      gpu: { vendor: "Test", renderer: "Test GPU", software: false },
      ...(job.inspect
        ? {
            inspection: {
              model: { heightMetres: 1 },
              motion: [],
              images,
              readiness: { loaded: true },
              renderMs: 1,
              notes: [],
            },
          }
        : {}),
    },
  };
}

async function withHost(
  name: string,
  body: (
    host: RunningHost,
    options: { project: string; stateDir: string; root: string },
  ) => Promise<void>,
  forms?: string,
): Promise<void> {
  const root = tempDir(name);
  const project = path.join(root, "project");
  const stateDir = path.join(root, "state");
  const host = await startHost({
    path: project,
    stateDir,
    create: { label: "Review test" },
    human: person,
    durability: "normal",
    transports: [],
    ...(forms ? { forms: loadForms(forms).forms } : {}),
  });
  try {
    await body(host, { project, stateDir, root });
  } finally {
    await host.close();
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

/** A forms directory with feline-worker and the two sheets it declares. */
function feline(root: string, withArtwork: boolean): string {
  const dir = path.join(root, "forms");
  fs.mkdirSync(path.join(dir, "artwork"), { recursive: true });
  fs.copyFileSync(path.join(fixtures, "feline-worker.json"), path.join(dir, "feline-worker.json"));
  if (!withArtwork) return dir;
  const files = [
    {
      from: path.join(
        fixtures,
        "blobs",
        "sha256-543dc50b834dd7f7193bd18878c35c52b6c64a07e88308e83f12e498e2906a98",
      ),
      file: "artwork/body.webp",
      origin: { kind: "project", license: "MIT", source: "examples/feline-worker.form.json" },
    },
    {
      from: path.join(repository, "packages", "character", "assets", "surveyor.atlas.webp"),
      file: "artwork/surveyor.atlas.webp",
      origin: { kind: "project", license: "MIT", source: "character-view/surveyor.atlas.webp" },
    },
  ].map((f) => {
    const bytes = fs.readFileSync(f.from);
    fs.writeFileSync(path.join(dir, ...f.file.split("/")), bytes);
    return {
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      mediaType: "image/webp",
      byteLength: bytes.byteLength,
      file: f.file,
      origin: f.origin,
    };
  });
  fs.writeFileSync(
    path.join(dir, "artwork.json"),
    JSON.stringify({ format: "irudd.form-artwork", version: 1, files }),
  );
  return dir;
}

test("a painted form stages its artwork before the revision, keeps it in backups, and an unresolved digest writes nothing", async () => {
  const root = tempDir("forms");
  const forms = feline(root, true);
  const loaded = loadForms(forms);
  assert.deepEqual(loaded.problems, []);
  assert.equal(loaded.forms[0]?.artwork?.length, 2);
  await withHost(
    "forms-host",
    async (host, { root: hostRoot }) => {
      const starters = await host.call("starters", {});
      const form = starters.starters.find((s) => s.id === "feline-worker");
      assert.ok(form?.artwork?.every((a) => a.shipped && a.origin?.license === "MIT"));
      const started = await host.call("start", {
        documentId: "doc-feline-a",
        requestId: requestId(),
        starter: "feline-worker",
      });
      assert.equal(started.result.kind, "committed", JSON.stringify(started.result));
      assert.deepEqual(
        started.artwork?.map((a) => a.stored),
        ["new", "new"],
      );
      const current = await host.call("current", { documentId: "doc-feline-a" });
      for (const asset of current.document?.assets ?? [])
        assert.ok(await Effect.runPromise(host.project.blobInfo(asset.digest)));
      // A second start reuses the stored bytes.
      const again = await host.call("start", {
        documentId: "doc-feline-b",
        requestId: requestId(),
        starter: "feline-worker",
      });
      assert.deepEqual(
        again.artwork?.map((a) => a.stored),
        ["existing", "existing"],
      );
      const backup = path.join(hostRoot, "backup.sqlite");
      await Effect.runPromise(host.project.backup(backup));
      const restored = path.join(hostRoot, "restored");
      const report = await Effect.runPromise(
        restoreProject({ backup, path: restored, registry: workshopRegistry() }),
      );
      assert.equal(report.ok, true);
      assert.equal(report.blobs.missing.length, 0);
    },
    forms,
  );

  const bare = feline(path.join(root, "bare"), false);
  await withHost(
    "forms-bare",
    async (host) => {
      const error = await failsWith(
        host.call("start", {
          documentId: "doc-feline-a",
          requestId: requestId(),
          starter: "feline-worker",
        }),
        "ArtworkUnresolved",
      );
      assert.match(error.message, /sha256:543dc50b/);
      assert.deepEqual(await host.call("documents", {}), []);
    },
    bare,
  );

  // A tampered file is reported and not offered.
  fs.writeFileSync(path.join(forms, "artwork", "body.webp"), "tampered");
  assert.match(loadForms(forms).problems.join(" "), /does not match its digest/);
});

test("without a renderer review says why and what to do; nothing falls back", async () => {
  await withHost("unavailable", async (host, { project, stateDir }) => {
    await host.call("apply", { request: generate() });
    const caps = await host.call("review.capabilities", {});
    assert.equal(caps.available, false);
    assert.ok(caps.actions && caps.actions.length > 0);
    const agentPair = await host.call("pair.agent", { agent: "reviewer" });
    const agent = await connect({
      credential: { role: "agent", file: agentPair.credentialFile },
      stateDir,
    });
    try {
      const error = await failsWith(
        agent.call("review.export", { documentId: docId, preset: "clay" }),
        "RendererUnavailable",
      );
      assert.ok(Array.isArray(error.detail["actions"]));
      await failsWith(agent.call("review.serve", { renderer: info }), "Forbidden");
    } finally {
      agent.close();
    }
    void project;
  });
});

test("a job is pinned to its revision while the head moves, and only issued artifacts are readable", async () => {
  await withHost("pinned", async (host, { stateDir }) => {
    const created = await host.call("apply", { request: generate() });
    assert.equal(created.kind, "committed");
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const seen: RenderJob[] = [];
    const renderer: ReviewRenderer = {
      info,
      async render(job) {
        seen.push(job);
        await gate;
        return output(job);
      },
    };
    const unregister = host.registerRenderer(renderer);
    const pending = host.call("review.export", { documentId: docId, preset: "full" });
    while (seen.length === 0) await new Promise((r) => setTimeout(r, 5));
    const current = await host.call("current", { documentId: docId });
    const part = current.document?.parts[0]?.id ?? "";
    const moved = await host.call("apply", { request: rename(1, part, "Renamed mid-render") });
    assert.equal(moved.kind, "committed");
    release();
    const exported = await pending;
    assert.equal(exported.source.revision, 1);
    assert.equal(exported.source.requested, "head");
    assert.deepEqual(exported.source.head, { atRequest: 1, atCompletion: 2 });
    assert.equal(exported.source.headMoved, true);
    assert.equal(exported.source.documentDigest, current.documentDigest);
    assert.equal(seen[0]?.documentDigest, current.documentDigest);
    assert.equal(exported.renderer.via, "in-process");

    // Chunked reads reassemble to the issued SHA-256.
    const parts: Buffer[] = [];
    let offset = 0;
    for (;;) {
      const chunk = await host.call("review.read", {
        sha256: exported.glb.sha256,
        offset,
        length: 64,
      });
      parts.push(Buffer.from(chunk.base64, "base64"));
      offset += Buffer.from(chunk.base64, "base64").byteLength;
      if (chunk.done) break;
    }
    assert.equal(
      createHash("sha256").update(Buffer.concat(parts)).digest("hex"),
      exported.glb.sha256,
    );

    // The same revision again: identical bytes, recorded as a repeat.
    const repeat = await host.call("review.export", {
      documentId: docId,
      revision: 1,
      preset: "full",
    });
    assert.deepEqual(repeat.repeat, { previous: exported.glb.sha256, identical: true });
    assert.equal(repeat.source.headMoved, false);

    // Agents read issued artifacts only.
    const pairing = await host.call("pair.agent", { agent: "reviewer" });
    const agent = await connect({
      credential: { role: "agent", file: pairing.credentialFile },
      stateDir,
    });
    try {
      const chunk = await agent.call("review.read", { sha256: exported.glb.sha256 });
      assert.equal(chunk.done, true);
      await failsWith(agent.call("review.read", { sha256: "0".repeat(64) }), "ArtifactUnknown");
      await failsWith(
        agent.call("review.export", { documentId: docId, revision: 9, preset: "clay" }),
        "RevisionMissing",
      );
    } finally {
      agent.close();
    }
    unregister();
  });
});

/** A forms directory with field-wardrobe, which has saved outfits, and its three sheets. */
function wardrobeForms(root: string): string {
  const dir = path.join(root, "forms");
  fs.mkdirSync(path.join(dir, "artwork"), { recursive: true });
  fs.copyFileSync(
    path.join(fixtures, "field-wardrobe.json"),
    path.join(dir, "field-wardrobe.json"),
  );
  const blob = (hex: string) => path.join(fixtures, "blobs", `sha256-${hex}`);
  const files = [
    blob("1f14b91745b427f807191eae2e86d0e579ebada4d700cd364029f689516e30f3"),
    blob("48d8557541e91c3f1b542dd99649489fde674df15d460a3822c9a4f3834e4e81"),
    path.join(repository, "packages", "character", "assets", "courier.atlas.webp"),
  ].map((from, i) => {
    const bytes = fs.readFileSync(from);
    const file = `artwork/sheet-${i}.webp`;
    fs.writeFileSync(path.join(dir, ...file.split("/")), bytes);
    return {
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      mediaType: "image/webp",
      byteLength: bytes.byteLength,
      file,
      origin: { kind: "project", license: "MIT", source: "examples/field-wardrobe.form.json" },
    };
  });
  fs.writeFileSync(
    path.join(dir, "artwork.json"),
    JSON.stringify({ format: "irudd.form-artwork", version: 1, files }),
  );
  return dir;
}

test("a wardrobe export names its saved outfits and is its own artifact", async () => {
  const root = tempDir("wardrobe-forms");
  const looks = ["Rescue watch", "Field tabard", "Wet weather"];
  await withHost(
    "wardrobe",
    async (host) => {
      const started = await host.call("start", {
        documentId: "doc-wardrobe",
        requestId: requestId(),
        starter: "field-wardrobe",
      });
      assert.equal(started.result.kind, "committed", JSON.stringify(started.result));
      const jobs: RenderJob[] = [];
      let stampLooks = true;
      host.registerRenderer({
        info,
        render: async (job) => {
          jobs.push(job);
          return output(job, job.wardrobe && stampLooks ? { wardrobe: { looks } } : {});
        },
      });
      const worn = await host.call("review.export", { documentId: "doc-wardrobe", preset: "clay" });
      assert.equal(worn.wardrobe, null);
      assert.equal(jobs[0]?.wardrobe, undefined, "a single-scene request is unchanged");
      const all = await host.call("review.export", {
        documentId: "doc-wardrobe",
        preset: "clay",
        wardrobe: true,
      });
      assert.equal(jobs[1]?.wardrobe, true);
      assert.deepEqual(all.wardrobe, { looks });
      assert.notEqual(all.glb.sha256, worn.glb.sha256);
      assert.equal(all.repeat, null, "the wardrobe export is not compared with the single scene");
      const again = await host.call("review.export", {
        documentId: "doc-wardrobe",
        preset: "clay",
        wardrobe: true,
      });
      assert.deepEqual(again.repeat, { previous: all.glb.sha256, identical: true });
      // A renderer that drops the outfits from the stamp issues nothing.
      stampLooks = false;
      const error = await failsWith(
        host.call("review.export", { documentId: "doc-wardrobe", preset: "clay", wardrobe: true }),
        "ReviewMismatch",
      );
      assert.match(error.message, /wardrobe differ/);
    },
    wardrobeForms(root),
  );
  await withHost("wardrobe-none", async (host) => {
    await host.call("apply", { request: generate() });
    host.registerRenderer({ info, render: async (job) => output(job) });
    await failsWith(
      host.call("review.export", { documentId: docId, preset: "clay", wardrobe: true }),
      "InvalidArgument",
    );
  });
});

test("a renderer that returns another revision's GLB issues nothing", async () => {
  await withHost("mismatch", async (host) => {
    await host.call("apply", { request: generate() });
    host.registerRenderer({
      info,
      render: async (job) => output(job, { revision: job.revision + 1 }),
    });
    const error = await failsWith(
      host.call("review.export", { documentId: docId, preset: "clay" }),
      "ReviewMismatch",
    );
    assert.match(error.message, /revision differ/);
    await failsWith(
      host.call("review.inspect", {
        documentId: docId,
        preset: "clay",
        shots: [{ view: "nowhere" }],
      }),
      "InvalidArgument",
    );
  });
});

const isJob = (value: unknown): value is RenderJob =>
  typeof value === "object" && value !== null && "jobId" in value && "documentDigest" in value;

/** Serve as the renderer on a person's connection, answering jobs until told to drop. */
function serve(client: WorkshopClient, options: { hold?: boolean } = {}): { jobs: RenderJob[] } {
  const jobs: RenderJob[] = [];
  client.onEvent((event: HostEvent) => {
    if (event.event !== "review-job") return;
    const typed = event.job;
    if (!isJob(typed)) return;
    jobs.push(typed);
    if (options.hold) return;
    void (async () => {
      const out = output(typed);
      for (const [name, bytes] of out.files) {
        for (let at = 0; at < bytes.byteLength; at += 40)
          await client.call("review.put", {
            jobId: typed.jobId,
            name,
            offset: at,
            total: bytes.byteLength,
            base64: Buffer.from(bytes.subarray(at, at + 40)).toString("base64"),
          });
      }
      await client.call("review.complete", {
        jobId: typed.jobId,
        ok: true,
        result: JSON.parse(JSON.stringify(out.result)),
      });
    })();
  });
  return { jobs };
}

test("an attached desktop serves the renderer over its connection; a disconnect fails the job and a reconnect serves again", async () => {
  await withHost("remote", async (host, { project, stateDir }) => {
    await host.call("apply", { request: generate() });
    const pairing = await host.call("pair.agent", { agent: "reviewer" });
    const agent = await connect({
      credential: { role: "agent", file: pairing.credentialFile },
      stateDir,
    });
    try {
      const desktop = await connect({ credential: { role: "human", project }, stateDir });
      serve(desktop);
      const served = await desktop.call("review.serve", { renderer: info });
      assert.equal(served.renderer.via, "attached");
      const inspected = await agent.call("review.inspect", {
        documentId: docId,
        preset: "game",
        width: 128,
        height: 96,
        pixelRatio: 2,
      });
      assert.equal(inspected.images.length, 2);
      assert.deepEqual(
        inspected.images.map((i) => [i.width, i.height]),
        [
          [256, 192],
          [256, 192],
        ],
      );
      assert.equal(inspected.metrics.geometry.triangles, 4);
      assert.equal(inspected.recipe.pixelRatio, 2);
      const png = await agent.call("review.read", { sha256: inspected.images[0]?.sha256 ?? "" });
      assert.equal(png.mediaType, "image/png");

      // The serving desktop goes away mid-job.
      desktop.close();
      const holding = await connect({ credential: { role: "human", project }, stateDir });
      const held = serve(holding, { hold: true });
      await holding.call("review.serve", { renderer: info });
      const pending = agent.call("review.export", { documentId: docId, preset: "clay" });
      while (held.jobs.length === 0) await new Promise((r) => setTimeout(r, 5));
      holding.close();
      await failsWith(pending, "RendererLost");
      for (let i = 0; i < 100 && (await agent.call("review.capabilities", {})).available; i++)
        await new Promise((r) => setTimeout(r, 10));
      assert.equal((await agent.call("review.capabilities", {})).available, false);

      // It reconnects and serves again.
      const again = await connect({ credential: { role: "human", project }, stateDir });
      serve(again);
      await again.call("review.serve", { renderer: info });
      const exported = await agent.call("review.export", { documentId: docId, preset: "clay" });
      assert.equal(exported.source.revision, 1);
      again.close();
    } finally {
      agent.close();
    }
  });
});

void request;
