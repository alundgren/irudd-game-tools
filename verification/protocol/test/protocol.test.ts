import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chains, draftDiff, draftTraces, fast, fastDeep, traces } from "../src/bounds.js";
import {
  exhaustive,
  forgetfulReduce,
  missingOutcomes,
  namedTraces,
  randomTraces,
  runNamedTrace,
  staleReduce,
  staleVersionReduce,
} from "../src/differential.js";
import { explore, mutations } from "../src/model.js";

test("the model is independent of the implementation", () => {
  const source = readFileSync(new URL("../src/model.ts", import.meta.url), "utf8");
  const imports = source
    .split("\n")
    .filter((line) => /^\s*(import|export\b.*\bfrom)\b|\bimport\(|\brequire\(/.test(line));
  assert.deepEqual(imports, []);
});

test("the model satisfies I1-I13 at the fast bounds", () => {
  for (const b of [fast, fastDeep, draftDiff, chains]) {
    const r = explore(b);
    assert.equal(r.counterexample, undefined, JSON.stringify(r.counterexample));
    assert.ok(r.states > 100, `${b.name} explored only ${r.states} states`);
  }
});

test("every broken rule is caught by the invariant it breaks", () => {
  for (const [mutation, invariant] of mutations) {
    let found;
    for (const b of [chains, draftDiff, fast, fastDeep]) {
      found = explore(b, mutation).counterexample;
      if (found) break;
    }
    assert.equal(found?.violation.invariant, invariant, mutation);
  }
});

test("the real reducer matches the model on every request from every state", () => {
  const small = {
    ...fast,
    name: "fast-one",
    receivers: ["A"] as const,
    actors: ["human", "agent"] as const,
  };
  const r = exhaustive(small);
  assert.equal(r.mismatch, undefined, JSON.stringify(r.mismatch));
  assert.ok(r.cases > 20);
  assert.deepEqual(missingOutcomes(explore(small).outcomes, r.outcomes), []);
});

test("the real reducer matches the model on seeded random traces", () => {
  for (const [b, count] of [
    [traces, 20],
    [draftTraces, 60],
  ] as const) {
    const r = randomTraces(b, 11, count, 20);
    assert.equal(r.mismatch, undefined, JSON.stringify(r.mismatch));
  }
});

test("named scenarios give the specified outcomes in the model and the reducer", () => {
  for (const t of namedTraces) assert.equal(runNamedTrace(t).problem, undefined, t.name);
});

test("the comparison catches a reducer that forgets requests, revisions or draft versions", () => {
  assert.notEqual(randomTraces(traces, 1, 20, 30, forgetfulReduce).mismatch, undefined);
  assert.notEqual(randomTraces(traces, 1, 20, 30, staleReduce).mismatch, undefined);
  assert.notEqual(randomTraces(draftTraces, 1, 60, 20, staleVersionReduce).mismatch, undefined);
  for (const t of namedTraces.filter((n) => n.name.includes("concurrent")))
    assert.notEqual(runNamedTrace(t, staleVersionReduce).problem, undefined);
});
