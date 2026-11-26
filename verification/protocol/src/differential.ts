// Differential check: drive the real reducer through the published
// @irudd/document entry and the independent model with the same requests, and
// compare every outcome and the abstract state after it.
//
// The abstraction: field x is the label of part p-x, field y the label of
// part p-y, value n is the label "value n". A model draft "q" is the real
// proposal "prop-q", whose content renames one part. Each model project is one
// real document. Setup creates both documents and, when the bounds start with
// direct editing, lets agents edit directly; its request IDs never collide
// with the model's.

import {
  createRegistry,
  decodeWith,
  DocumentId,
  emptyState,
  isUndone as realIsUndone,
  memoryEnvironment,
  reduce,
  type CommandEnvelopeInput,
  type DocumentState,
  type Environment,
  type Outcome,
  type Step,
} from "@irudd/document";
import {
  allowed,
  checkState,
  fields,
  initialWorld,
  isUndone,
  prng,
  step as modelStep,
  universe,
  worldKey,
  type Bounds,
  type Field,
  type ModelEnvelope,
  type ModelOutcome,
  type ProjectName,
  type ProjectState,
  type WorldState,
} from "./model.js";

export type Reduce = (state: DocumentState, input: unknown, env: Environment) => Step;

export const environment: Environment = memoryEnvironment(createRegistry());

const documentIds: Readonly<Record<ProjectName, string>> = {
  A: "doc-protocol-a",
  B: "doc-protocol-b",
};
const partFor: Readonly<Record<Field, string>> = { x: "p-x", y: "p-y" };
const fieldFor: Readonly<Record<string, Field>> = { "p-x": "x", "p-y": "y" };
const actors = {
  human: { kind: "human", id: "person" },
  agent: { kind: "agent", id: "assistant" },
} as const;
const setupRequests = new Set(["setup-create", "setup-policy"]);

const label = (value: number): string => `value ${value}`;
const requestId = (req: string): string => `${req}-request`;
const proposalId = (id: string): string => `prop-${id}`;

function part(id: string, parent: string | null, y: number): Record<string, unknown> {
  return {
    id,
    label: label(0),
    parent,
    shape: "box",
    position: [0, y, 0],
    rotation: [0, 0, 0, 1],
    size: [0.2, 0.2, 0.2],
    color: "#808080",
    sculpt: [],
    features: {},
  };
}

function envelope(
  project: ProjectName,
  actor: keyof typeof actors,
  requestId: string,
  expectedRevision: number,
  command: CommandEnvelopeInput["command"],
): CommandEnvelopeInput {
  return {
    format: "irudd.command",
    version: 1,
    requestId,
    documentId: documentIds[project],
    actor: actors[actor],
    expectedRevision,
    command,
  };
}

function renameContent(field: Field, value: number) {
  return {
    kind: "ops" as const,
    ops: [{ op: "part.rename" as const, part: partFor[field], label: label(value) }],
  };
}

/** The real command for a model command. */
export function toRealCommand(c: ModelEnvelope["command"]): CommandEnvelopeInput["command"] {
  switch (c.type) {
    case "edit":
      return { type: "edit", ops: renameContent(c.field, c.value).ops };
    case "undo":
      return { type: "undo", target: c.target };
    case "policy":
      return { type: "policy.set", agentDirectEdit: c.direct };
    case "propose":
      return {
        type: "proposal.create",
        proposal: proposalId(c.id),
        summary: "draft",
        content: renameContent(c.field, c.value),
      };
    case "refine":
      return {
        type: "proposal.refine",
        proposal: proposalId(c.id),
        version: c.version,
        summary: "draft",
        content: renameContent(c.field, c.value),
      };
    case "accept":
      return { type: "proposal.accept", proposal: proposalId(c.id), version: c.version };
    case "discard":
      return { type: "proposal.discard", proposal: proposalId(c.id) };
  }
}

/** The real request for a model request. */
export function toReal(e: ModelEnvelope): CommandEnvelopeInput {
  return envelope(e.doc, e.actor, requestId(e.req), e.expected, toRealCommand(e.command));
}

export type RealWorld = Readonly<Record<ProjectName, DocumentState>>;

/** Both real documents at revision 1; agents edit directly when `direct`. */
export function initialRealWorld(direct = true): RealWorld {
  const create = (project: ProjectName): DocumentState => {
    const id = documentIds[project];
    const decoded = decodeWith(DocumentId, id);
    if (!decoded.ok) throw new Error(`Bad document ID ${id}`);
    let s = emptyState(decoded.value);
    const setup = [
      envelope(project, "human", "setup-create", 0, {
        type: "document.create",
        document: {
          format: "irudd.character",
          version: 1,
          id,
          label: `Protocol ${project}`,
          requires: [{ feature: "core.parts", version: 1 }],
          catalog: [],
          assets: [],
          parts: [part("p-x", null, 0), part("p-y", "p-x", 0.3)],
          poses: [],
          features: {},
          extensions: {},
        },
      }),
    ];
    if (direct)
      setup.push(
        envelope(project, "human", "setup-policy", 1, {
          type: "policy.set",
          agentDirectEdit: true,
        }),
      );
    for (const e of setup) {
      const next = reduce(s, e, environment);
      if (next.outcome.kind !== "committed")
        throw new Error(`Setup failed: ${JSON.stringify(next.outcome)}`);
      s = next.state;
    }
    return s;
  };
  return { A: create("A"), B: create("B") };
}

export function abstractOutcome(outcome: Outcome): ModelOutcome {
  if (outcome.kind === "rejected")
    return { kind: "rejected", code: outcome.diagnostics[0]?.code ?? "(no diagnostic)" };
  return { kind: outcome.kind, revision: outcome.receipt.revision };
}

export const outcomeLabel = (o: ModelOutcome): string =>
  o.kind === "rejected" ? `rejected:${o.code}` : o.kind;

const valueOf = (text: unknown): number | undefined => {
  const match = typeof text === "string" ? /^value (\d+)$/.exec(text) : null;
  return match ? Number(match[1]) : undefined;
};

function fieldValue(state: DocumentState, field: Field): number | undefined {
  return valueOf(state.document?.parts.find((p) => p.id === partFor[field])?.label);
}

/** The model-visible part of a real document state, as a comparable string. */
export function abstractReal(state: DocumentState): string {
  const doc = Object.fromEntries(fields.map((f) => [f, fieldValue(state, f)]));
  const history = state.history.map((r) => [
    r.revision,
    r.kind,
    r.revision === 1 ? "init" : r.actor.kind,
    r.revision === 1 ? "init" : r.author.kind,
    r.revision === 1 ? "init" : r.requestId,
    r.undoes ?? null,
    realIsUndone(state, r.revision),
  ]);
  const receipts = [...state.receipts.values()]
    .filter((r) => !setupRequests.has(r.requestId))
    .map((r) => [r.requestId, r.revision])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  const proposals = [...state.proposals.values()]
    .map((p) => {
      const c = p.changes.length === 1 ? p.changes[0] : undefined;
      return [
        p.id,
        p.author.kind,
        p.lastEditor.kind,
        p.baseRevision,
        p.version,
        c?.path[0] === "parts" && c.path[2] === "label"
          ? (fieldFor[c.path[1] ?? ""] ?? null)
          : null,
        valueOf(c?.before) ?? null,
        valueOf(c?.after) ?? null,
        p.status,
      ];
    })
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return JSON.stringify([
    state.head,
    doc,
    history,
    receipts,
    state.policy.agentDirectEdit,
    proposals,
  ]);
}

/** The same abstraction computed from the model. */
export function abstractModel(p: ProjectState): string {
  const history = p.history.map((r) => [
    r.n,
    r.kind,
    r.actor,
    r.author,
    r.kind === "create" ? "init" : requestId(r.req),
    r.undoes ?? null,
    isUndone(p.history, r.n),
  ]);
  const receipts = [...p.receipts]
    .map(([req, r]) => [requestId(req), r.revision])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  const proposals = [...p.proposals]
    .map(([id, d]) => [
      proposalId(id),
      d.author,
      d.lastEditor,
      d.base,
      d.version,
      d.change.field,
      d.change.before,
      d.change.after,
      d.status,
    ])
    .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
  return JSON.stringify([p.head, p.doc, history, receipts, p.direct, proposals]);
}

export interface Mismatch {
  readonly trace: ReadonlyArray<ModelEnvelope>;
  readonly expected: string;
  readonly actual: string;
}

export interface DifferentialResult {
  readonly name: string;
  /** Distinct model states compared (exhaustive) or traces run (random). */
  readonly cases: number;
  readonly steps: number;
  /** How often the real reducer gave each outcome, by label. */
  readonly outcomes: Readonly<Record<string, number>>;
  readonly mismatch?: Mismatch;
}

const sameOutcome = (a: ModelOutcome, b: ModelOutcome): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

function compareStep(
  model: WorldState,
  real: RealWorld,
  e: ModelEnvelope,
  impl: Reduce,
  outcomes: Record<string, number>,
): { model: WorldState; real: RealWorld; outcome: ModelOutcome; problem?: [string, string] } {
  const m = modelStep(model, e);
  const r = impl(real[e.to], toReal(e), environment);
  const nextReal: RealWorld = { ...real, [e.to]: r.state };
  const actual = abstractOutcome(r.outcome);
  const key = outcomeLabel(actual);
  outcomes[key] = (outcomes[key] ?? 0) + 1;
  if (!sameOutcome(m.outcome, actual))
    return {
      model: m.world,
      real: nextReal,
      outcome: m.outcome,
      problem: [JSON.stringify(m.outcome), JSON.stringify(actual)],
    };
  if (m.outcome.kind !== "committed" && r.state !== real[e.to])
    return {
      model: m.world,
      real: nextReal,
      outcome: m.outcome,
      problem: ["rejected request returns the same state", "a new state object"],
    };
  for (const project of ["A", "B"] as const) {
    const expected = abstractModel(m.world[project]);
    const got = abstractReal(nextReal[project]);
    if (expected !== got)
      return { model: m.world, real: nextReal, outcome: m.outcome, problem: [expected, got] };
  }
  return { model: m.world, real: nextReal, outcome: m.outcome };
}

/**
 * Lock-step exhaustive comparison: every model-reachable state within the
 * bounds, every request in the universe from it.
 */
export function exhaustive(b: Bounds, impl: Reduce = reduce): DifferentialResult {
  const envelopes = universe(b);
  type Node = { model: WorldState; real: RealWorld; trace: ReadonlyArray<ModelEnvelope> };
  const start = initialWorld(b.direct ?? true);
  const seen = new Set<string>([worldKey(start)]);
  const outcomes: Record<string, number> = {};
  let frontier: Node[] = [{ model: start, real: initialRealWorld(b.direct ?? true), trace: [] }];
  let steps = 0;
  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier)
      for (const e of envelopes) {
        if (!allowed(b, node.model, e)) continue;
        const peek = modelStep(node.model, e);
        if (peek.outcome.kind === "committed" && peek.outcome.revision > b.maxRevision) continue;
        steps++;
        const s = compareStep(node.model, node.real, e, impl, outcomes);
        const trace = [...node.trace, e];
        if (s.problem)
          return {
            name: b.name,
            cases: seen.size,
            steps,
            outcomes,
            mismatch: { trace, expected: s.problem[0], actual: s.problem[1] },
          };
        if (s.outcome.kind !== "committed") continue;
        const key = worldKey(s.model);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ model: s.model, real: s.real, trace });
      }
    frontier = next;
  }
  return { name: b.name, cases: seen.size, steps, outcomes };
}

/**
 * Seeded random traces over the universe, including retries of earlier
 * requests, reordering and requests for the other project. Traces are not
 * pruned at the bound's revision limit.
 */
export function randomTraces(
  b: Bounds,
  seed: number,
  traces: number,
  length: number,
  impl: Reduce = reduce,
): DifferentialResult {
  const random = prng(seed);
  const envelopes = universe(b);
  const outcomes: Record<string, number> = {};
  let steps = 0;
  for (let t = 0; t < traces; t++) {
    let model = initialWorld(b.direct ?? true);
    let real = initialRealWorld(b.direct ?? true);
    const trace: ModelEnvelope[] = [];
    for (let i = 0; i < length; i++) {
      // Mix fresh requests against the head (so traces get deep), retries and
      // reuses of earlier requests, and arbitrary requests from the universe.
      const roll = random();
      const fresh = envelopes.filter(
        (e) =>
          e.doc === e.to && e.expected === model[e.to].head && !model[e.to].receipts.has(e.req),
      );
      const pool =
        roll < 0.25 && trace.length > 0
          ? trace
          : roll < 0.75 && fresh.length > 0
            ? fresh
            : envelopes;
      const pick = pool[Math.floor(random() * pool.length)];
      if (!pick) continue;
      trace.push(pick);
      steps++;
      const s = compareStep(model, real, pick, impl, outcomes);
      if (s.problem)
        return {
          name: `${b.name} seed ${seed}`,
          cases: t + 1,
          steps,
          outcomes,
          mismatch: { trace, expected: s.problem[0], actual: s.problem[1] },
        };
      model = s.model;
      real = s.real;
    }
  }
  return { name: `${b.name} seed ${seed}`, cases: traces, steps, outcomes };
}

/** Outcome labels the model produced that the real runs never did. */
export function missingOutcomes(
  required: Readonly<Record<string, number>>,
  ...seen: ReadonlyArray<Readonly<Record<string, number>>>
): string[] {
  return Object.keys(required)
    .filter((k) => !seen.some((s) => (s[k] ?? 0) > 0))
    .sort();
}

// ── Named traces: fixed scenarios with the outcomes they must produce ──────

export interface NamedTrace {
  readonly name: string;
  readonly direct: boolean;
  /** Each request with the outcome the specification requires. */
  readonly steps: ReadonlyArray<readonly [ModelEnvelope, string]>;
}

const on = (
  actor: ModelEnvelope["actor"],
  req: string,
  expected: number,
  command: ModelEnvelope["command"],
): ModelEnvelope => ({ to: "A", doc: "A", actor, req, expected, command });

export const namedTraces: ReadonlyArray<NamedTrace> = [
  {
    // The reviewer's chain: edit, undo 2, undo 3, undo 2, edit, undo 4, continued.
    name: "branched undo and undo of undo",
    direct: true,
    steps: [
      [on("human", "u1", 1, { type: "edit", field: "x", value: 1 }), "committed 2"],
      [on("human", "u2", 2, { type: "undo", target: 2 }), "committed 3"],
      [on("human", "u3", 3, { type: "undo", target: 3 }), "committed 4"],
      [on("human", "u4", 4, { type: "undo", target: 2 }), "committed 5"],
      [on("human", "u5", 5, { type: "edit", field: "x", value: 1 }), "committed 6"],
      // Undoing 4 brings 3 back while 5 still undoes 2.
      [on("human", "u6", 6, { type: "undo", target: 4 }), "rejected:already-undone"],
      [on("human", "u6", 6, { type: "undo", target: 5 }), "rejected:conflict"],
      [on("human", "u6", 6, { type: "undo", target: 6 }), "committed 7"],
      [on("human", "u7", 7, { type: "undo", target: 5 }), "committed 8"],
      [on("human", "u8", 8, { type: "undo", target: 4 }), "committed 9"],
      [on("human", "u9", 9, { type: "undo", target: 8 }), "rejected:already-undone"],
      [on("human", "u9", 9, { type: "undo", target: 9 }), "committed 10"],
      [on("human", "u10", 10, { type: "undo", target: 2 }), "committed 11"],
      [on("human", "u11", 11, { type: "undo", target: 10 }), "rejected:already-undone"],
      [on("human", "u11", 11, { type: "undo", target: 11 }), "committed 12"],
      [on("human", "u11", 11, { type: "undo", target: 11 }), "replayed 12"],
      [on("agent", "u11", 12, { type: "undo", target: 12 }), "rejected:request-reused"],
    ],
  },
  {
    // A person and an agent refine the same draft from version 1; the second is stale.
    name: "concurrent refinement of one draft",
    direct: false,
    steps: [
      [on("agent", "d1", 1, { type: "propose", id: "q", field: "x", value: 1 }), "committed 1"],
      [on("human", "d2", 1, { type: "edit", field: "y", value: 2 }), "committed 2"],
      [
        on("human", "d3", 2, { type: "refine", id: "q", version: 1, field: "x", value: 2 }),
        "committed 2",
      ],
      [
        on("agent", "d4", 1, { type: "refine", id: "q", version: 1, field: "x", value: 3 }),
        "rejected:proposal-version",
      ],
      [on("agent", "d4", 2, { type: "accept", id: "q", version: 2 }), "rejected:proposal-required"],
      [on("human", "d4", 2, { type: "accept", id: "q", version: 1 }), "rejected:proposal-version"],
      [on("human", "d4", 2, { type: "accept", id: "q", version: 2 }), "committed 3"],
      [on("agent", "d5", 3, { type: "discard", id: "q" }), "rejected:proposal-closed"],
      [
        on("agent", "d5", 3, { type: "refine", id: "q", version: 2, field: "x", value: 3 }),
        "rejected:proposal-closed",
      ],
      [on("human", "d5", 3, { type: "propose", id: "w", field: "y", value: 1 }), "committed 3"],
      [on("agent", "d6", 3, { type: "discard", id: "w" }), "rejected:forbidden"],
      [on("agent", "d6", 3, { type: "policy", direct: true }), "rejected:forbidden"],
      [on("human", "d6", 3, { type: "policy", direct: true }), "committed 3"],
      [on("agent", "d7", 3, { type: "discard", id: "w" }), "committed 3"],
      [on("agent", "d8", 3, { type: "undo", target: 3 }), "committed 4"],
    ],
  },
  {
    // A draft accepted after the head moved is stale even when the field is untouched.
    name: "stale draft base",
    direct: true,
    steps: [
      [on("agent", "s1", 1, { type: "propose", id: "q", field: "x", value: 1 }), "committed 1"],
      [on("human", "s2", 1, { type: "edit", field: "y", value: 1 }), "committed 2"],
      [on("human", "s3", 2, { type: "accept", id: "q", version: 1 }), "rejected:stale-revision"],
      [
        on("agent", "s3", 2, { type: "refine", id: "q", version: 1, field: "x", value: 1 }),
        "committed 2",
      ],
      [on("human", "s4", 2, { type: "accept", id: "q", version: 2 }), "committed 3"],
    ],
  },
];

/**
 * Run a named trace through the model and the real reducer in lock step. Both
 * must give the outcome the trace names, agree on every state, and the model
 * must hold its state invariants after every step.
 */
export function runNamedTrace(
  t: NamedTrace,
  impl: Reduce = reduce,
): { readonly problem?: string; readonly outcomes: Readonly<Record<string, number>> } {
  const outcomes: Record<string, number> = {};
  let model = initialWorld(t.direct);
  let real = initialRealWorld(t.direct);
  for (const [i, [e, want]] of t.steps.entries()) {
    const s = compareStep(model, real, e, impl, outcomes);
    const got =
      s.outcome.kind === "rejected"
        ? outcomeLabel(s.outcome)
        : `${s.outcome.kind} ${s.outcome.revision}`;
    if (got !== want)
      return { problem: `${t.name} step ${i + 1}: model gave ${got}, expected ${want}`, outcomes };
    if (s.problem)
      return {
        problem: `${t.name} step ${i + 1}: model ${s.problem[0]} but reducer ${s.problem[1]}`,
        outcomes,
      };
    const violation = checkState(s.model);
    if (violation) return { problem: `${t.name} step ${i + 1}: ${violation.message}`, outcomes };
    model = s.model;
    real = s.real;
  }
  return { outcomes };
}

// ── Broken implementations for the differential negative control ───────────

/** Forgets request IDs: a retry is executed again as a new request. */
export const forgetfulReduce: Reduce = (state, input, env) => {
  const step = reduce(state, input, env);
  if (step.outcome.kind !== "replayed" || typeof input !== "object" || input === null) return step;
  return reduce(state, { ...input, requestId: `retry-${step.outcome.receipt.requestId}` }, env);
};

/** Ignores the expected revision: a stale request is applied to the head. */
export const staleReduce: Reduce = (state, input, env) => {
  if (typeof input !== "object" || input === null) return reduce(state, input, env);
  return reduce(state, { ...input, expectedRevision: state.head }, env);
};

/** Ignores draft versions: a refinement or acceptance of a stale version wins. */
export const staleVersionReduce: Reduce = (state, input, env) => {
  if (typeof input !== "object" || input === null || !("command" in input))
    return reduce(state, input, env);
  const command: unknown = input.command;
  if (
    typeof command !== "object" ||
    command === null ||
    !("type" in command) ||
    (command.type !== "proposal.refine" && command.type !== "proposal.accept") ||
    !("proposal" in command) ||
    typeof command.proposal !== "string"
  )
    return reduce(state, input, env);
  const current = state.proposals.get(command.proposal);
  if (!current) return reduce(state, input, env);
  return reduce(state, { ...input, command: { ...command, version: current.version } }, env);
};
