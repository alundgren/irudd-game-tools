// Timing for the project service on this machine: `pnpm --filter @irudd/workshop bench`.
// Not part of the test suite; it prints one JSON summary to record in CONTRACT.md.
import path from "node:path";
import os from "node:os";
import { Effect } from "effect";
import { createProject, openProject } from "@irudd/workshop";
import {
  docId,
  generate,
  human,
  percentile,
  pngBytes,
  registry,
  rename,
  run,
  tempDir,
} from "./support/fixtures.js";

const edits = Number(process.env["BENCH_EDITS"] ?? 2000);

const time = async <A>(work: () => Promise<A>): Promise<{ value: A; ms: number }> => {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
};

const stats = (values: ReadonlyArray<number>) => ({
  p50: round(percentile(values, 50)),
  p95: round(percentile(values, 95)),
  p99: round(percentile(values, 99)),
  mean: round(values.reduce((a, b) => a + b, 0) / values.length),
});
const round = (n: number) => Math.round(n * 1000) / 1000;

async function commits(durability: "full" | "normal", count: number) {
  const dir = tempDir(`bench-${durability}`);
  return run(
    Effect.gen(function* () {
      const project = yield* createProject({ path: dir, label: "Bench", registry, durability });
      const session = yield* project.session({ actor: human });
      yield* session.apply(generate());
      const part = (yield* project.current(docId)).document?.parts[0]?.id ?? "";
      const latencies: number[] = [];
      for (let i = 0; i < count; i++) {
        const started = performance.now();
        const result = yield* session.apply(rename(i + 1, part, `Edit ${i}`));
        latencies.push(performance.now() - started);
        if (result.kind !== "committed") throw new Error("bench edit was not committed");
      }
      return { dir, latencies };
    }),
  );
}

const full = await commits("full", edits);
const normal = await commits("normal", Math.min(edits, 500));

const reopen = await time(() =>
  run(Effect.flatMap(openProject({ path: full.dir, registry }), (p) => p.current(docId))),
);
const warmRead = await run(
  Effect.gen(function* () {
    const project = yield* openProject({ path: full.dir, registry });
    yield* project.current(docId);
    const started = performance.now();
    for (let i = 0; i < 1000; i++) yield* project.current(docId);
    return (performance.now() - started) / 1000;
  }),
);

const blobTimes = await run(
  Effect.gen(function* () {
    const project = yield* openProject({ path: full.dir, registry });
    const session = yield* project.session({ actor: human });
    const out: Record<string, { put: number; read: number }> = {};
    for (const mib of [1, 16, 64]) {
      const bytes = pngBytes(mib * 1024 * 1024 - (mib === 64 ? 1 : 0));
      const a = performance.now();
      const put = yield* session.putBlob({ bytes, mediaType: "image/png" });
      const b = performance.now();
      yield* project.blob(put.digest);
      out[`${mib}MiB`] = { put: round(b - a), read: round(performance.now() - b) };
    }
    return out;
  }),
);

const maintenance = await run(
  Effect.gen(function* () {
    const project = yield* openProject({ path: full.dir, registry });
    const v = performance.now();
    const report = yield* project.verify;
    const verifyMs = performance.now() - v;
    const b = performance.now();
    const backup = yield* project.backup(path.join(tempDir("bench-backup"), "copy.irudd-backup"));
    const backupMs = performance.now() - b;
    const e = performance.now();
    const archive = yield* project.exportArchive(docId);
    const exportMs = performance.now() - e;
    return {
      verifyOk: report.ok,
      verifyMs,
      backupBytes: backup.bytes,
      backupMs,
      archive,
      exportMs,
    };
  }),
);
const imported = await time(() =>
  run(
    Effect.gen(function* () {
      const project = yield* createProject({
        path: tempDir("bench-import"),
        label: "Import",
        registry,
      });
      const session = yield* project.session({ actor: human });
      return yield* session.importArchive(maintenance.archive);
    }),
  ),
);

console.log(
  JSON.stringify(
    {
      when: new Date().toISOString(),
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model,
      edits,
      commitMs: { full: stats(full.latencies), normal: stats(normal.latencies) },
      reopenMs: { entries: edits + 1, cold: round(reopen.ms) },
      currentReadMs: round(warmRead),
      blobsMs: blobTimes,
      verifyMs: round(maintenance.verifyMs),
      backup: { bytes: maintenance.backupBytes, ms: round(maintenance.backupMs) },
      archive: {
        bytes: maintenance.archive.length,
        exportMs: round(maintenance.exportMs),
        importMs: round(imported.ms),
      },
    },
    null,
    2,
  ),
);
