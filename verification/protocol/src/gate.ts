// The g1-protocol gate: exhaustive exploration of the independent model at
// the full bounds, one counterexample per deliberately broken rule, and the
// differential comparison of the real reducer against the model, including
// broken reducers that the comparison must catch, fixed named scenarios and
// a coverage check that every outcome the model produces was also produced
// by the real reducer.
//
//   pnpm --filter @irudd/verification-protocol gate:g1-protocol
//
// Exits non-zero on any failure. Prints counts and wall times per check.

import { chains, deep, draftDiff, drafts, draftTraces, fast, pair, traces } from "./bounds.js";
import {
  exhaustive,
  forgetfulReduce,
  missingOutcomes,
  namedTraces,
  randomTraces,
  runNamedTrace,
  staleReduce,
  staleVersionReduce,
  type DifferentialResult,
} from "./differential.js";
import { explore, mutations, type Bounds } from "./model.js";

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
const tracesPerSeed = 100;
const traceLength = 30;

let failed = false;
const report = (name: string, ok: boolean, detail: string, ms: number): void => {
  if (!ok) failed = true;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name.padEnd(48)} ${ms.toFixed(0).padStart(6)} ms  ${detail}`,
  );
};
const timed = <T>(f: () => T): [T, number] => {
  const start = performance.now();
  const value = f();
  return [value, performance.now() - start];
};

console.log(`g1-protocol on Node ${process.version}`);
const total = performance.now();

const modelOutcomes: Record<string, number> = {};
for (const b of [pair, deep, drafts, chains]) {
  const [r, ms] = timed(() => explore(b));
  // Every outcome label the model produces is required of the real reducer.
  for (const [k, n] of Object.entries(r.outcomes)) modelOutcomes[k] = (modelOutcomes[k] ?? 0) + n;
  report(
    `model ${b.name}: invariants I1-I13`,
    r.counterexample === undefined,
    r.counterexample
      ? `${r.counterexample.violation.invariant}: ${r.counterexample.violation.message} after ${JSON.stringify(r.counterexample.trace)}`
      : `${r.states} states, ${r.transitions} transitions, depth ${r.depth}`,
    ms,
  );
}

// Cheapest bounds first; a mutant counts when any bound exposes it.
const mutantBounds: ReadonlyArray<Bounds> = [chains, drafts, pair, deep];
for (const [mutation, invariant] of mutations) {
  const [found, ms] = timed(() => {
    for (const b of mutantBounds) {
      const r = explore(b, mutation);
      if (r.counterexample) return { bounds: b.name, ...r.counterexample };
    }
    return undefined;
  });
  report(
    `mutant ${mutation} → ${invariant}`,
    found?.violation.invariant === invariant,
    found
      ? `${found.violation.invariant} in ${found.bounds} after ${found.trace.length} requests`
      : "no counterexample",
    ms,
  );
}

const realRuns: DifferentialResult[] = [];
for (const b of [fast, draftDiff, chains]) {
  const [r, ms] = timed(() => exhaustive(b));
  realRuns.push(r);
  report(
    `differential exhaustive ${b.name}`,
    r.mismatch === undefined,
    r.mismatch ? JSON.stringify(r.mismatch) : `${r.cases} states, ${r.steps} requests`,
    ms,
  );
}

for (const b of [traces, draftTraces]) {
  const [results, ms] = timed(() =>
    seeds.map((seed) => randomTraces(b, seed, tracesPerSeed, traceLength)),
  );
  realRuns.push(...results);
  const bad = results.find((r) => r.mismatch);
  report(
    `differential ${b.name} seeds ${seeds[0]}-${seeds[seeds.length - 1]}`,
    bad === undefined,
    bad
      ? `${bad.name}: ${JSON.stringify(bad.mismatch)}`
      : `${results.reduce((n, r) => n + r.cases, 0)} traces, ${results.reduce((n, r) => n + r.steps, 0)} requests of length ${traceLength}`,
    ms,
  );
}

for (const t of namedTraces) {
  const [r, ms] = timed(() => runNamedTrace(t));
  realRuns.push({ name: t.name, cases: 1, steps: t.steps.length, outcomes: r.outcomes });
  report(
    `named trace: ${t.name}`,
    r.problem === undefined,
    r.problem ?? `${t.steps.length} requests`,
    ms,
  );
}

{
  const [missing, ms] = timed(() =>
    missingOutcomes(modelOutcomes, ...realRuns.map((r) => r.outcomes)),
  );
  report(
    "coverage: every model outcome seen from the reducer",
    missing.length === 0,
    missing.length
      ? `never produced: ${missing.join(", ")}`
      : `${Object.keys(modelOutcomes).length} outcomes`,
    ms,
  );
}

for (const [name, impl, b] of [
  ["forgets request IDs", forgetfulReduce, traces],
  ["ignores expected revision", staleReduce, traces],
  ["ignores draft versions", staleVersionReduce, draftTraces],
] as const) {
  const [r, ms] = timed(() => randomTraces(b, 1, tracesPerSeed, traceLength, impl));
  report(
    `differential control: reducer ${name}`,
    r.mismatch !== undefined,
    r.mismatch ? `caught after ${r.mismatch.trace.length} requests` : "not caught",
    ms,
  );
}
{
  const [r, ms] = timed(() => exhaustive(draftDiff, staleVersionReduce));
  report(
    "differential control: stale versions, exhaustive drafts",
    r.mismatch !== undefined,
    r.mismatch ? `caught after ${r.mismatch.trace.length} requests` : "not caught",
    ms,
  );
}

console.log(
  `${failed ? "FAILED" : "passed"} in ${((performance.now() - total) / 1000).toFixed(1)} s`,
);
process.exitCode = failed ? 1 : 0;
