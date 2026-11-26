export type Field = "x" | "y";
export const fields: ReadonlyArray<Field> = ["x", "y"];
export type Doc = Readonly<Record<Field, number>>;
export type ActorName = "human" | "agent";
export type ProjectName = "A" | "B";

export type ModelCommand =
  | { readonly type: "edit"; readonly field: Field; readonly value: number }
  | { readonly type: "undo"; readonly target: number }
  | { readonly type: "policy"; readonly direct: boolean }
  | { readonly type: "propose"; readonly id: string; readonly field: Field; readonly value: number }
  | {
      readonly type: "refine";
      readonly id: string;
      readonly version: number;
      readonly field: Field;
      readonly value: number;
    }
  | { readonly type: "accept"; readonly id: string; readonly version: number }
  | { readonly type: "discard"; readonly id: string };

export interface ModelEnvelope {
  readonly to: ProjectName;
  readonly doc: ProjectName;
  readonly actor: ActorName;
  readonly req: string;
  readonly expected: number;
  readonly command: ModelCommand;
}

export interface FieldChange {
  readonly field: Field;
  readonly before: number;
  readonly after: number;
}

export interface ModelRevision {
  readonly n: number;
  readonly kind: "create" | "edit" | "undo" | "proposal";
  readonly actor: ActorName | "init";
  readonly author: ActorName | "init";
  readonly req: string;
  readonly changes: ReadonlyArray<FieldChange>;
  readonly undoes?: number;
}

export interface ModelProposal {
  readonly author: ActorName;
  readonly lastEditor: ActorName;
  readonly base: number;
  readonly version: number;
  readonly change: FieldChange;
  readonly status: "draft" | "discarded" | "accepted";
}

export interface ModelReceipt {
  readonly payload: string;
  readonly revision: number;
}

export interface ProjectState {
  readonly head: number;
  readonly doc: Doc;
  readonly history: ReadonlyArray<ModelRevision>;
  readonly receipts: ReadonlyMap<string, ModelReceipt>;
  readonly direct: boolean;
  readonly proposals: ReadonlyMap<string, ModelProposal>;
  readonly quiet: ReadonlyArray<string>;
}

export type WorldState = Readonly<Record<ProjectName, ProjectState>>;

export type ModelOutcome =
  | { readonly kind: "committed"; readonly revision: number }
  | { readonly kind: "replayed"; readonly revision: number }
  | { readonly kind: "rejected"; readonly code: string };

export const initialDoc: Doc = { x: 0, y: 0 };

export function initialProject(direct = true): ProjectState {
  return {
    head: 1,
    doc: initialDoc,
    history: [{ n: 1, kind: "create", actor: "init", author: "init", req: "init", changes: [] }],
    receipts: new Map(),
    direct,
    proposals: new Map(),
    quiet: [],
  };
}

export function initialWorld(direct = true): WorldState {
  return { A: initialProject(direct), B: initialProject(direct) };
}

function commandKey(c: ModelCommand): string {
  switch (c.type) {
    case "edit":
      return `edit:${c.field}=${c.value}`;
    case "undo":
      return `undo:${c.target}`;
    case "policy":
      return `policy:${c.direct}`;
    case "propose":
      return `propose:${c.id}:${c.field}=${c.value}`;
    case "refine":
      return `refine:${c.id}@${c.version}:${c.field}=${c.value}`;
    case "accept":
      return `accept:${c.id}@${c.version}`;
    case "discard":
      return `discard:${c.id}`;
  }
}

export function payloadKey(e: ModelEnvelope): string {
  return `${e.doc}|${e.actor}|${e.req}|${e.expected}|${commandKey(e.command)}`;
}

export const mutations = [
  ["double-apply", "I1-one-effect"],
  ["reject-leaks", "I2-rejected-no-effect"],
  ["no-increment", "I3-revisions-consecutive"],
  ["undo-restores-snapshot", "I4-undo-preserves-other-edits"],
  ["reuse-replays", "I5-reused-id-fails"],
  ["no-dedupe", "I6-retry-returns-original-receipt"],
  ["global-receipts", "I7-projects-isolated"],
  ["unrecorded-undo", "I8-document-equals-history"],
  ["accept-stale", "I9-no-stale-commit"],
  ["accept-stale-draft", "I9-no-stale-commit"],
  ["undo-twice", "I10-single-undo-in-force"],
  ["undo-of-undo-unchecked", "I10-single-undo-in-force"],
  ["refine-ignores-version", "I11-draft-versions-linear"],
  ["agent-bypass", "I12-agent-policy"],
  ["agent-discards-any", "I12-agent-policy"],
  ["credit-acceptor", "I13-draft-editor-credited"],
] as const satisfies ReadonlyArray<readonly [string, InvariantId]>;
export type Mutation = "none" | (typeof mutations)[number][0];

export function isUndone(
  history: ReadonlyArray<ModelRevision>,
  target: number,
  depth = 0,
): boolean {
  if (depth > history.length) return false;
  return history.some((u) => u.undoes === target && !isUndone(history, u.n, depth + 1));
}

export function undosInForce(history: ReadonlyArray<ModelRevision>): Map<number, number> {
  const inForce = new Map<number, number>();
  for (const u of history)
    if (u.undoes !== undefined && !isUndone(history, u.n))
      inForce.set(u.undoes, (inForce.get(u.undoes) ?? 0) + 1);
  return inForce;
}

export function docAt(history: ReadonlyArray<ModelRevision>, n: number): Doc {
  return replayDoc(history.filter((r) => r.n <= n));
}

const documentWrites = new Set<ModelCommand["type"]>(["edit", "undo", "accept"]);

export function step(
  world: WorldState,
  e: ModelEnvelope,
  mutation: Mutation = "none",
): { readonly world: WorldState; readonly outcome: ModelOutcome } {
  const p = world[e.to];
  const refuse = (code: string) => ({ world, outcome: { kind: "rejected", code } as const });
  if (e.doc !== e.to) return refuse("wrong-document");

  const key = payloadKey(e);
  const seen = p.receipts.get(e.req);
  if (seen && mutation !== "no-dedupe") {
    if (seen.payload === key || mutation === "reuse-replays")
      return { world, outcome: { kind: "replayed", revision: seen.revision } };
    return refuse("request-reused");
  }
  const c = e.command;
  const agent = e.actor === "agent";
  if (c.type === "policy" && agent) return refuse("forbidden");
  if (agent && documentWrites.has(c.type) && !p.direct && mutation !== "agent-bypass")
    return refuse("proposal-required");

  const drafting = c.type === "propose" || c.type === "refine";
  if (drafting) {
    if (e.expected < 1 || e.expected > p.head) return refuse("unknown-revision");
  } else if (e.expected !== p.head && mutation !== "accept-stale") {
    if (mutation !== "reject-leaks") return refuse("stale-revision");
    const receipts = new Map(p.receipts);
    receipts.set(e.req, { payload: key, revision: p.head });
    return {
      world: { ...world, [e.to]: { ...p, receipts } },
      outcome: { kind: "rejected", code: "stale-revision" },
    };
  }

  const quiet = (next: Partial<ProjectState>) => {
    const receipts = new Map(p.receipts);
    receipts.set(e.req, { payload: key, revision: p.head });
    const project: ProjectState = { ...p, ...next, receipts, quiet: [...p.quiet, e.req] };
    return {
      world: { ...world, [e.to]: project },
      outcome: { kind: "committed", revision: p.head } as const,
    };
  };
  const withProposal = (id: string, proposal: ModelProposal) => {
    const proposals = new Map(p.proposals);
    proposals.set(id, proposal);
    return proposals;
  };

  if (c.type === "policy") {
    if (p.direct === c.direct) return refuse("no-change");
    return quiet({ direct: c.direct });
  }
  if (c.type === "propose" || c.type === "refine") {
    const existing = p.proposals.get(c.id);
    if (c.type === "propose" && existing) return refuse("duplicate-id");
    if (c.type === "refine") {
      if (!existing) return refuse("unknown-proposal");
      if (existing.status !== "draft") return refuse("proposal-closed");
      if (existing.version !== c.version && mutation !== "refine-ignores-version")
        return refuse("proposal-version");
    }
    const base = docAt(p.history, e.expected);
    if (base[c.field] === c.value) return refuse("no-change");
    return quiet({
      proposals: withProposal(c.id, {
        author: existing?.author ?? e.actor,
        lastEditor: e.actor,
        base: e.expected,
        version: (existing?.version ?? 0) + 1,
        change: { field: c.field, before: base[c.field], after: c.value },
        status: "draft",
      }),
    });
  }
  if (c.type === "discard") {
    const existing = p.proposals.get(c.id);
    if (!existing) return refuse("unknown-proposal");
    if (existing.status !== "draft") return refuse("proposal-closed");
    if (agent && !p.direct && existing.author !== e.actor && mutation !== "agent-discards-any")
      return refuse("forbidden");
    return quiet({ proposals: withProposal(c.id, { ...existing, status: "discarded" }) });
  }

  let changes: FieldChange[];
  let doc: Doc;
  let undoes: number | undefined;
  let kind: ModelRevision["kind"];
  let author: ActorName = e.actor;
  let proposals = p.proposals;
  if (c.type === "edit") {
    const { field, value } = c;
    if (p.doc[field] === value) return refuse("no-change");
    changes = [{ field, before: p.doc[field], after: value }];
    doc = { ...p.doc, [field]: value };
    kind = "edit";
  } else if (c.type === "accept") {
    const existing = p.proposals.get(c.id);
    if (!existing) return refuse("unknown-proposal");
    if (existing.status !== "draft") return refuse("proposal-closed");
    if (existing.version !== c.version) return refuse("proposal-version");
    if (existing.base !== p.head && mutation !== "accept-stale-draft")
      return refuse("stale-revision");
    const { field, before, after } = existing.change;
    if (p.doc[field] !== before) return refuse("conflict");
    changes = [{ field, before, after }];
    doc = { ...p.doc, [field]: after };
    kind = "proposal";
    if (mutation !== "credit-acceptor") author = existing.lastEditor;
    proposals = withProposal(c.id, { ...existing, status: "accepted" });
  } else {
    const wanted = c.target;
    const target = p.history.find((r) => r.n === wanted);
    if (!target) return refuse("unknown-revision");
    if (target.kind === "create") return refuse("not-undoable");
    if (mutation !== "undo-twice") {
      if (isUndone(p.history, target.n)) return refuse("already-undone");
      const after = [
        ...p.history,
        {
          n: p.head + 1,
          kind: "undo",
          actor: e.actor,
          author: e.actor,
          req: e.req,
          changes: [],
          undoes: target.n,
        } satisfies ModelRevision,
      ];
      if (
        mutation !== "undo-of-undo-unchecked" &&
        [...undosInForce(after).values()].some((count) => count > 1)
      )
        return refuse("already-undone");
    }
    if (mutation === "undo-restores-snapshot") {
      const before = replayDoc(p.history.filter((r) => r.n < target.n));
      changes = fields
        .filter((f) => before[f] !== p.doc[f])
        .map((f) => ({ field: f, before: p.doc[f], after: before[f] }));
      doc = before;
    } else {
      for (const ch of target.changes) if (p.doc[ch.field] !== ch.after) return refuse("conflict");
      changes = target.changes.map((ch) => ({
        field: ch.field,
        before: ch.after,
        after: ch.before,
      }));
      doc = { ...p.doc };
      for (const ch of changes) doc = { ...doc, [ch.field]: ch.after };
    }
    if (changes.length === 0) return refuse("no-change");
    undoes = target.n;
    kind = "undo";
  }

  const n = mutation === "no-increment" && kind === "undo" ? p.head : p.head + 1;
  const revision: ModelRevision = {
    n,
    kind,
    actor: e.actor,
    author,
    req: e.req,
    changes: mutation === "unrecorded-undo" && kind === "undo" ? [] : changes,
    ...(undoes === undefined ? {} : { undoes }),
  };
  const receipts = new Map(p.receipts);
  receipts.set(e.req, { payload: key, revision: n });
  const double = mutation === "double-apply";
  const history = double
    ? [...p.history, revision, { ...revision, n: n + 1, changes: [] }]
    : [...p.history, revision];
  const next: ProjectState = {
    ...p,
    head: double ? n + 1 : n,
    doc,
    history,
    receipts,
    proposals,
  };
  let out: WorldState = { ...world, [e.to]: next };
  if (mutation === "global-receipts") {
    const other: ProjectName = e.to === "A" ? "B" : "A";
    const shared = new Map(out[other].receipts);
    shared.set(e.req, { payload: key, revision: n });
    out = { ...out, [other]: { ...out[other], receipts: shared } };
  }
  return { world: out, outcome: { kind: "committed", revision: n } };
}

export function replayDoc(history: ReadonlyArray<ModelRevision>): Doc {
  let doc = initialDoc;
  for (const r of history) for (const c of r.changes) doc = { ...doc, [c.field]: c.after };
  return doc;
}

const keys = new WeakMap<ProjectState, string>();

const sorted = <T>(m: ReadonlyMap<string, T>): Array<[string, T]> =>
  [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function projectKey(p: ProjectState): string {
  let key = keys.get(p);
  if (key === undefined) {
    key = JSON.stringify([
      p.head,
      p.doc,
      p.history,
      sorted(p.receipts),
      p.direct,
      sorted(p.proposals),
      [...p.quiet].sort(),
    ]);
    keys.set(p, key);
  }
  return key;
}

function sameProject(a: ProjectState, b: ProjectState): boolean {
  return a === b || projectKey(a) === projectKey(b);
}

export function worldKey(w: WorldState): string {
  return projectKey(w.A) + "#" + projectKey(w.B);
}

export type InvariantId =
  | "I1-one-effect"
  | "I2-rejected-no-effect"
  | "I3-revisions-consecutive"
  | "I4-undo-preserves-other-edits"
  | "I5-reused-id-fails"
  | "I6-retry-returns-original-receipt"
  | "I7-projects-isolated"
  | "I8-document-equals-history"
  | "I9-no-stale-commit"
  | "I10-single-undo-in-force"
  | "I11-draft-versions-linear"
  | "I12-agent-policy"
  | "I13-draft-editor-credited";

export interface Violation {
  readonly invariant: InvariantId;
  readonly message: string;
}

export function checkState(w: WorldState): Violation | undefined {
  for (const name of ["A", "B"] as const) {
    const p = w[name];
    if (!p.history.every((r, i) => r.n === i + 1) || p.head !== p.history.length)
      return {
        invariant: "I3-revisions-consecutive",
        message: `${name}: revisions are not 1..head`,
      };
    const d = replayDoc(p.history);
    if (fields.some((f) => d[f] !== p.doc[f]))
      return {
        invariant: "I8-document-equals-history",
        message: `${name}: document differs from its history`,
      };
    const committedRequests = [
      ...p.history.filter((r) => r.kind !== "create").map((r) => r.req),
      ...p.quiet,
    ];
    if (
      new Set(committedRequests).size !== committedRequests.length ||
      committedRequests.length !== p.receipts.size
    )
      return { invariant: "I1-one-effect", message: `${name}: receipts and revisions disagree` };
    if ([...undosInForce(p.history).values()].some((count) => count > 1))
      return {
        invariant: "I10-single-undo-in-force",
        message: `${name}: a revision is undone twice`,
      };
  }
  return undefined;
}

export function checkTransition(
  before: WorldState,
  e: ModelEnvelope,
  outcome: ModelOutcome,
  after: WorldState,
): Violation | undefined {
  const p = before[e.to];
  const q = after[e.to];
  const other: ProjectName = e.to === "A" ? "B" : "A";
  if (!sameProject(before[other], after[other]))
    return {
      invariant: "I7-projects-isolated",
      message: `a request delivered to ${e.to} changed ${other}`,
    };
  const seen = e.doc === e.to ? p.receipts.get(e.req) : undefined;
  if (
    seen &&
    seen.payload === payloadKey(e) &&
    !(outcome.kind === "replayed" && outcome.revision === seen.revision)
  )
    return {
      invariant: "I6-retry-returns-original-receipt",
      message: `retry of ${e.req} did not replay revision ${seen.revision}`,
    };
  if (
    seen &&
    seen.payload !== payloadKey(e) &&
    !(outcome.kind === "rejected" && outcome.code === "request-reused")
  )
    return {
      invariant: "I5-reused-id-fails",
      message: `${e.req} reused with a different payload was not refused`,
    };
  if (outcome.kind !== "committed") {
    if (!sameProject(p, q))
      return {
        invariant: "I2-rejected-no-effect",
        message: `a ${outcome.kind} request changed ${e.to}`,
      };
    return undefined;
  }
  const c = e.command;
  const drafting = c.type === "propose" || c.type === "refine";
  if (!drafting && e.expected !== p.head)
    return {
      invariant: "I9-no-stale-commit",
      message: `a request for ${e.expected} committed at head ${p.head}`,
    };
  const draft = "id" in c ? p.proposals.get(c.id) : undefined;
  if (c.type === "accept" && draft?.base !== p.head)
    return {
      invariant: "I9-no-stale-commit",
      message: `a draft based on ${draft?.base} was accepted at head ${p.head}`,
    };
  if (
    (c.type === "refine" || c.type === "accept") &&
    (draft?.version !== c.version || draft.status !== "draft")
  )
    return {
      invariant: "I11-draft-versions-linear",
      message: `${c.type} of ${c.id} named version ${c.version}, not the open version ${draft?.version}`,
    };
  if (c.type === "refine" && q.proposals.get(c.id)?.version !== c.version + 1)
    return { invariant: "I11-draft-versions-linear", message: `refine skipped a version` };
  if (e.actor === "agent") {
    if (c.type === "policy" || (documentWrites.has(c.type) && !p.direct))
      return {
        invariant: "I12-agent-policy",
        message: `an agent's ${c.type} committed with direct editing off`,
      };
    if (c.type === "discard" && !p.direct && draft?.author !== "agent")
      return { invariant: "I12-agent-policy", message: `an agent discarded a person's draft` };
  }
  const appends = documentWrites.has(c.type);
  if (appends && (q.history.length !== p.history.length + 1 || outcome.revision !== q.head))
    return { invariant: "I1-one-effect", message: "a commit did not append exactly one revision" };
  if (!appends && (q.history.length !== p.history.length || outcome.revision !== p.head))
    return { invariant: "I1-one-effect", message: `a ${c.type} appended a revision` };
  if (c.type === "accept") {
    const added = q.history[q.history.length - 1];
    if (added?.author !== draft?.lastEditor || added?.actor !== e.actor)
      return {
        invariant: "I13-draft-editor-credited",
        message: `accepting ${c.id} credited ${added?.author}, not its editor ${draft?.lastEditor}`,
      };
  }
  if (c.type === "undo") {
    const t = c.target;
    const target = p.history.find((r) => r.n === t);
    const touched = new Set(target?.changes.map((ch) => ch.field));
    for (const f of fields) {
      if (!touched.has(f) && q.doc[f] !== p.doc[f])
        return {
          invariant: "I4-undo-preserves-other-edits",
          message: `undo of ${t} changed untouched field ${f}`,
        };
      const ch = target?.changes.find((x) => x.field === f);
      if (ch && q.doc[f] !== ch.before)
        return {
          invariant: "I4-undo-preserves-other-edits",
          message: `undo of ${t} did not restore ${f}`,
        };
    }
  }
  return undefined;
}

export interface Bounds {
  readonly name: string;
  readonly receivers: ReadonlyArray<ProjectName>;
  readonly documents: ReadonlyArray<ProjectName>;
  readonly actors: ReadonlyArray<ActorName>;
  readonly requestIds: ReadonlyArray<string>;
  readonly values: ReadonlyArray<number>;
  readonly maxRevision: number;
  readonly direct?: boolean;
  readonly policy?: boolean;
  readonly drafts?: { readonly ids: ReadonlyArray<string>; readonly maxVersion: number };
  readonly orderedIds?: boolean;
}

export function allowed(b: Bounds, world: WorldState, e: ModelEnvelope): boolean {
  if (!b.orderedIds) return true;
  const receipts = world[e.to].receipts;
  return receipts.has(e.req) || e.req === b.requestIds.find((id) => !receipts.has(id));
}

export function universe(b: Bounds): ModelEnvelope[] {
  const commands: ModelCommand[] = [];
  for (const field of fields)
    for (const value of b.values) commands.push({ type: "edit", field, value });
  for (let target = 1; target <= b.maxRevision; target++) commands.push({ type: "undo", target });
  if (b.policy) for (const direct of [false, true]) commands.push({ type: "policy", direct });
  for (const id of b.drafts?.ids ?? []) {
    commands.push({ type: "discard", id });
    for (const field of fields)
      for (const value of b.values) commands.push({ type: "propose", id, field, value });
    for (let version = 1; version <= (b.drafts?.maxVersion ?? 0); version++) {
      commands.push({ type: "accept", id, version });
      for (const field of fields)
        for (const value of b.values) commands.push({ type: "refine", id, version, field, value });
    }
  }
  const out: ModelEnvelope[] = [];
  for (const to of b.receivers)
    for (const doc of b.documents)
      for (const actor of b.actors)
        for (const req of b.requestIds)
          for (const command of commands)
            for (let expected = 1; expected <= b.maxRevision; expected++)
              out.push({ to, doc, actor, req, expected, command });
  return out;
}

export interface ExplorationResult {
  readonly bounds: string;
  readonly mutation: Mutation;
  readonly states: number;
  readonly transitions: number;
  readonly pruned: number;
  readonly depth: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly counterexample?: {
    readonly violation: Violation;
    readonly trace: ReadonlyArray<ModelEnvelope>;
  };
}

interface Node {
  readonly key: string;
  readonly world: WorldState;
}

export function explore(b: Bounds, mutation: Mutation = "none"): ExplorationResult {
  const envelopes = universe(b);
  const start = initialWorld(b.direct ?? true);
  const startKey = worldKey(start);
  const parents = new Map<string, { readonly from: string; readonly via: ModelEnvelope } | null>([
    [startKey, null],
  ]);
  const outcomes: Record<string, number> = {};
  let transitions = 0;
  let pruned = 0;
  let depth = 0;
  const result = (counterexample?: ExplorationResult["counterexample"]): ExplorationResult => ({
    bounds: b.name,
    mutation,
    states: parents.size,
    transitions,
    pruned,
    depth,
    outcomes,
    ...(counterexample ? { counterexample } : {}),
  });
  const traceTo = (key: string): ModelEnvelope[] => {
    const trace: ModelEnvelope[] = [];
    for (let at = parents.get(key); at; at = parents.get(at.from)) trace.unshift(at.via);
    return trace;
  };
  const initial = checkState(start);
  if (initial) return result({ violation: initial, trace: [] });

  let frontier: Node[] = [{ key: startKey, world: start }];
  while (frontier.length > 0) {
    const next: Node[] = [];
    for (const node of frontier)
      for (const e of envelopes) {
        if (!allowed(b, node.world, e)) continue;
        const { world, outcome } = step(node.world, e, mutation);
        if (outcome.kind === "committed" && outcome.revision > b.maxRevision) {
          pruned++;
          continue;
        }
        transitions++;
        const label = outcome.kind === "rejected" ? `rejected:${outcome.code}` : outcome.kind;
        outcomes[label] = (outcomes[label] ?? 0) + 1;
        const violation =
          checkTransition(node.world, e, outcome, world) ??
          (world === node.world ? undefined : checkState(world));
        if (violation) return result({ violation, trace: [...traceTo(node.key), e] });
        if (world === node.world) continue;
        const key = worldKey(world);
        if (parents.has(key)) continue;
        parents.set(key, { from: node.key, via: e });
        next.push({ key, world });
      }
    if (next.length > 0) depth++;
    frontier = next;
  }
  return result();
}

export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
