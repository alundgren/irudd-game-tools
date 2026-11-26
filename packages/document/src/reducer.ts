import { Schema } from "effect";
import { headAccess, markWritable, type Access } from "./access.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { canonicalJson, isJson, isJsonObject, type Json } from "./json.js";
import { digestJson } from "./sha256.js";
import { applyChanges, diff, invert, pathsOverlap, type Change } from "./changes.js";
import {
  documentDigest,
  documentJson,
  readDocument,
  digestBrand,
  type ReadOptions,
} from "./document.js";
import { derivePartId, generateParts } from "./generation.js";
import { applyOperations, requireDeclaredFeatures, type OperationContext } from "./ops.js";
import type { Environment } from "./registry.js";
import {
  documentFormat,
  documentVersion,
  type CharacterDocument,
  type Digest,
  type DocumentId,
} from "./schema.js";
import {
  CommandEnvelope,
  type Actor,
  type Command,
  type CommandEnvelope as Envelope,
  type ProposalContent,
} from "./commands.js";
import {
  FrozenMap,
  FrozenSet,
  detach,
  makeState,
  own,
  sealEntry,
  undoStatus,
  type DocumentState,
  type JournalEffect,
  type JournalEntry,
  type Proposal,
  type Receipt,
  type RevisionKind,
  type RevisionRecord,
} from "./state.js";

export type ReceiptKind = Command["type"];

export type Outcome =
  | {
      readonly kind: "committed";
      readonly receipt: Receipt;
      readonly entry: JournalEntry;
    }
  | { readonly kind: "replayed"; readonly receipt: Receipt }
  | { readonly kind: "rejected"; readonly diagnostics: ReadonlyArray<Diagnostic> };

export interface Step {
  readonly state: DocumentState;
  readonly outcome: Outcome;
}

export function emptyState(documentId: DocumentId): DocumentState {
  return makeState({
    documentId,
    head: 0,
    document: undefined,
    history: Object.freeze([]),
    receipts: new FrozenMap(),
    proposals: new FrozenMap(),
    policy: own({ agentDirectEdit: false }),
    retired: new FrozenSet(),
    undone: new FrozenSet(),
    undos: new FrozenMap(),
    journal: Object.freeze([]),
  });
}

const decodeEnvelope = Schema.decodeUnknownResult(CommandEnvelope, {
  onExcessProperty: "error",
  errors: "all",
});

const accessExempt = new Set<ReceiptKind>(["policy.set", "proposal.discard", "document.upgrade"]);

function accessDiagnostics(access: Exclude<Access, { readonly mode: "writable" }>): Diagnostic[] {
  if (access.mode === "upgrade-required") return [...access.diagnostics];
  return [
    diagnostic(
      "read-only",
      ["documentId"],
      "This build cannot edit the document. It stays readable, and earlier requests still replay.",
    ),
    ...access.diagnostics,
  ];
}

function reject(state: DocumentState, diagnostics: ReadonlyArray<Diagnostic>): Step {
  return { state, outcome: { kind: "rejected", diagnostics } };
}
function rejectOne(state: DocumentState, ...args: Parameters<typeof diagnostic>): Step {
  return reject(state, [diagnostic(...args)]);
}

const documentWrites = new Set<ReceiptKind>([
  "document.create",
  "document.generate",
  "document.upgrade",
  "edit",
  "undo",
  "restore",
  "proposal.accept",
]);

export function lastTouch(
  state: DocumentState,
  path: ReadonlyArray<string>,
  since = 0,
): RevisionRecord | undefined {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const r = state.history[i];
    if (!r || r.revision <= since) break;
    if (r.changes.some((c) => pathsOverlap(c.path, path))) return r;
  }
  return undefined;
}

function attributeConflicts(
  state: DocumentState,
  diagnostics: ReadonlyArray<Diagnostic>,
  since = 0,
): Diagnostic[] {
  return diagnostics.map((d) => {
    if (d.code !== "conflict") return d;
    const path = d.path.map(String);
    const touch = lastTouch(state, path, since);
    if (!touch) return d;
    const base = isJsonObject(d.detail) ? d.detail : {};
    return {
      ...d,
      detail: {
        ...base,
        editedIn: {
          revision: touch.revision,
          actor: { kind: touch.author.kind, id: touch.author.id },
        },
      },
    };
  });
}

function retire(
  previous: CharacterDocument | undefined,
  next: CharacterDocument,
  retired: ReadonlySet<string>,
): FrozenSet<string> {
  const out = new Set(retired);
  const present = new Set<string>(next.parts.map((p) => p.id));
  for (const p of previous?.parts ?? []) if (!present.has(p.id)) out.add(p.id);
  for (const id of present) out.delete(id);
  return new FrozenSet(out);
}

function withUndo(
  undos: ReadonlyMap<number, ReadonlyArray<number>>,
  target: number,
  undo: number,
): FrozenMap<number, ReadonlyArray<number>> {
  const next = new Map(undos);
  next.set(target, Object.freeze([...(undos.get(target) ?? []), undo]));
  return new FrozenMap(next);
}

interface Accepted {
  readonly document?: CharacterDocument;
  readonly kind?: RevisionKind;
  readonly author?: Actor;
  readonly undoes?: number;
  readonly restores?: number;
  readonly proposal?: Proposal;
  readonly policy?: { readonly agentDirectEdit: boolean };
  readonly summary?: string;
}

function commit(
  state: DocumentState,
  envelope: Envelope,
  payload: Digest,
  raw: Json,
  env: Environment,
  accepted: Accepted,
): Step {
  let head = state.head;
  let history = state.history;
  let document = state.document;
  let retired = state.retired;
  let undos = state.undos;
  let undone = state.undone;
  let revision: JournalEffect["revision"];
  if (accepted.document && accepted.kind) {
    const previous = state.document;
    const next = own(accepted.document);
    markWritable(next, env.registry);
    const changes = previous ? diff(previous, next) : [];
    head = state.head + 1;
    const author = accepted.author ?? envelope.actor;
    const digest = documentDigest(next);
    const extra = {
      ...(accepted.undoes === undefined ? {} : { undoes: accepted.undoes }),
      ...(accepted.restores === undefined ? {} : { restores: accepted.restores }),
      ...(accepted.proposal
        ? { proposal: { id: accepted.proposal.id, version: accepted.proposal.version } }
        : {}),
      ...(accepted.summary === undefined ? {} : { summary: accepted.summary }),
    };
    const record: RevisionRecord = own({
      revision: head,
      kind: accepted.kind,
      actor: envelope.actor,
      author,
      requestId: envelope.requestId,
      changes,
      document: next,
      digest,
      ...extra,
    });
    revision = {
      kind: accepted.kind,
      author,
      changes: record.changes,
      ...(accepted.kind === "create" ? { document: next } : {}),
      digest,
      ...extra,
    };
    history = Object.freeze([...history, record]);
    document = next;
    retired = retire(previous, next, retired);
    if (accepted.undoes !== undefined) {
      undos = withUndo(undos, accepted.undoes, head);
      undone = new FrozenSet(undoStatus(head, undos).undone);
    }
  }
  let proposals = state.proposals;
  const proposal = accepted.proposal ? own(accepted.proposal) : undefined;
  if (proposal) {
    const map = new Map(proposals);
    map.set(proposal.id, proposal);
    proposals = new FrozenMap(map);
  }
  const policy = accepted.policy ? own(accepted.policy) : state.policy;
  const receipt: Receipt = own({
    requestId: envelope.requestId,
    payload,
    documentId: state.documentId,
    command: envelope.command.type,
    revision: head,
    documentDigest: document
      ? (history[history.length - 1]?.digest ?? documentDigest(document))
      : digestBrand(digestJson(null)),
    appended: head !== state.head,
    ...(proposal
      ? { proposal: { id: proposal.id, version: proposal.version, status: proposal.status } }
      : {}),
  });
  const effect: JournalEffect = {
    ...(revision ? { revision } : {}),
    ...(proposal ? { proposal } : {}),
    ...(accepted.policy ? { policy } : {}),
  };
  const entry = sealEntry(state.journal[state.journal.length - 1], raw, receipt, effect);
  const receipts = new Map(state.receipts);
  receipts.set(envelope.requestId, receipt);
  return {
    state: makeState({
      documentId: state.documentId,
      head,
      document,
      history,
      receipts: new FrozenMap(receipts),
      proposals,
      policy,
      retired,
      undone,
      undos,
      journal: Object.freeze([...state.journal, entry]),
    }),
    outcome: { kind: "committed", receipt, entry },
  };
}

function validateFresh(doc: CharacterDocument, options: ReadOptions) {
  return readDocument(detach(documentJson(doc)), options);
}

function context(state: DocumentState, envelope: Envelope, env: Environment): OperationContext {
  return {
    registry: env.registry,
    retired: state.retired,
    idFor: (slot) => derivePartId(state.documentId, envelope.requestId, slot),
  };
}

function finish(
  state: DocumentState,
  previous: CharacterDocument,
  candidate: CharacterDocument,
  env: Environment,
  history: "new-content" | "from-history" = "new-content",
):
  | { readonly ok: true; readonly document: CharacterDocument }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> } {
  const checked = validateFresh(candidate, { registry: env.registry, environment: env });
  if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics };
  const next = checked.value;
  if (next.id !== previous.id)
    return {
      ok: false,
      diagnostics: [diagnostic("immutable-id", ["id"], "A document keeps its ID.")],
    };
  if (diff(previous, next).length === 0)
    return {
      ok: false,
      diagnostics: [diagnostic("no-change", [], "The command leaves the document unchanged.")],
    };
  const before = new Set<string>(previous.parts.map((p) => p.id));
  const reused =
    history === "from-history"
      ? []
      : next.parts.filter((p) => !before.has(p.id) && state.retired.has(p.id));
  if (reused.length)
    return {
      ok: false,
      diagnostics: reused.map((p) =>
        diagnostic(
          "retired-id",
          ["parts", p.id],
          `Part ID ${p.id} belonged to a removed part; choose a new one.`,
        ),
      ),
    };
  return { ok: true, document: next };
}

function sameActor(a: Actor, b: Actor): boolean {
  return a.kind === b.kind && a.id === b.id;
}

function generatorIdentity(base: CharacterDocument, next: CharacterDocument): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (canonicalJson(base.generation ?? null) !== canonicalJson(next.generation ?? null))
    out.push(
      diagnostic(
        "forbidden",
        ["content", "document", "generation"],
        "A replacement keeps the recorded generator and base. Use the generation ops to change them.",
      ),
    );
  const before = new Map(base.parts.map((p) => [p.id, p.slot]));
  for (const p of next.parts) {
    const had = before.get(p.id);
    if (before.has(p.id) ? had !== p.slot : p.slot !== undefined)
      out.push(
        diagnostic(
          "forbidden",
          ["content", "document", "parts", p.id, "slot"],
          "Only the generator assigns slots; a replacement keeps each part's slot.",
        ),
      );
  }
  return out;
}

function proposalTarget(
  state: DocumentState,
  envelope: Envelope,
  base: CharacterDocument,
  content: ProposalContent,
  env: Environment,
):
  | { readonly ok: true; readonly changes: ReadonlyArray<Change> }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<Diagnostic> } {
  let candidate: CharacterDocument;
  if (content.kind === "ops") {
    const applied = applyOperations(base, content.ops, context(state, envelope, env));
    if (!applied.ok) return { ok: false, diagnostics: applied.diagnostics };
    candidate = applied.value;
  } else {
    const read = readDocument(content.document, { registry: env.registry });
    if (!read.ok)
      return {
        ok: false,
        diagnostics: read.diagnostics.map((d) => ({
          ...d,
          path: ["content", "document", ...d.path],
        })),
      };
    candidate = requireDeclaredFeatures(read.value, env.registry);
    const identity = generatorIdentity(base, candidate);
    if (identity.length) return { ok: false, diagnostics: identity };
  }
  const done = finish(state, base, candidate, env);
  if (!done.ok) return done;
  return { ok: true, changes: diff(base, done.document) };
}

function documentAtRevision(state: DocumentState, revision: number): CharacterDocument | undefined {
  return state.history[revision - 1]?.document;
}

export function reduce(state: DocumentState, input: unknown, env: Environment): Step {
  if (!isJson(input))
    return rejectOne(state, "schema", ["envelope"], "A command envelope is plain JSON.");
  const decoded = decodeEnvelope(detach(input));
  if (decoded._tag === "Failure")
    return rejectOne(state, "schema", ["envelope"], decoded.failure.message);
  const envelope = own(decoded.success);
  const raw: Json = envelope;
  const payload = digestBrand(digestJson(raw));

  if (envelope.documentId !== state.documentId)
    return rejectOne(
      state,
      "wrong-document",
      ["documentId"],
      `This request is for ${envelope.documentId}, not ${state.documentId}.`,
    );

  const known = state.receipts.get(envelope.requestId);
  if (known) {
    if (known.payload === payload) return { state, outcome: { kind: "replayed", receipt: known } };
    return rejectOne(
      state,
      "request-reused",
      ["requestId"],
      `Request ${envelope.requestId} was already used for a different command.`,
      {
        receipt: { revision: known.revision, command: known.command },
      },
    );
  }

  const c = envelope.command;
  const agent = envelope.actor.kind === "agent";
  if (c.type === "policy.set" && agent)
    return rejectOne(
      state,
      "forbidden",
      ["actor"],
      "Only a person can change whether agents edit directly.",
    );
  if (agent && state.head > 0 && documentWrites.has(c.type) && !state.policy.agentDirectEdit)
    return rejectOne(
      state,
      "proposal-required",
      ["command"],
      "Direct editing is off for agents on this document. Send a proposal instead.",
    );
  if (state.document && !accessExempt.has(c.type)) {
    const access = headAccess(state.document, env.registry);
    if (access.mode !== "writable") return reject(state, accessDiagnostics(access));
  }

  if (c.type === "document.create" || c.type === "document.generate") {
    if (state.head !== 0)
      return rejectOne(state, "already-created", ["command"], "This document already exists.");
    if (envelope.expectedRevision !== 0)
      return rejectOne(
        state,
        "stale-revision",
        ["expectedRevision"],
        "Create a document against revision 0.",
        {
          expected: envelope.expectedRevision,
          head: state.head,
        },
      );
    let candidate: CharacterDocument;
    if (c.type === "document.create") {
      const read = readDocument(c.document, { registry: env.registry, environment: env });
      if (!read.ok)
        return reject(
          state,
          read.diagnostics.map((d) => ({ ...d, path: ["command", "document", ...d.path] })),
        );
      candidate = read.value;
    } else {
      const generated = generateParts(env.registry, c, (slot) =>
        derivePartId(state.documentId, envelope.requestId, slot),
      );
      if (!generated.ok) return reject(state, generated.diagnostics);
      candidate = requireDeclaredFeatures(
        {
          format: documentFormat,
          version: documentVersion,
          id: state.documentId,
          label: c.label,
          requires: [],
          catalog: [],
          assets: [],
          parts: generated.value.parts,
          poses: [],
          generation: generated.value.generation,
          features: {},
          extensions: {},
        },
        env.registry,
      );
    }
    if (candidate.id !== state.documentId)
      return rejectOne(
        state,
        "wrong-document",
        ["command", "document", "id"],
        "The document ID must match the envelope.",
      );
    const checked = validateFresh(candidate, { registry: env.registry, environment: env });
    if (!checked.ok) return reject(state, checked.diagnostics);
    return commit(state, envelope, payload, raw, env, { document: checked.value, kind: "create" });
  }

  const current = state.document;
  if (!current || state.head === 0)
    return rejectOne(state, "not-created", ["documentId"], "Create the document first.");

  const isBaseCommand = c.type === "proposal.create" || c.type === "proposal.refine";
  if (isBaseCommand) {
    if (envelope.expectedRevision < 1 || envelope.expectedRevision > state.head)
      return rejectOne(
        state,
        "unknown-revision",
        ["expectedRevision"],
        `Revision ${envelope.expectedRevision} does not exist.`,
        {
          head: state.head,
        },
      );
  } else if (envelope.expectedRevision !== state.head)
    return rejectOne(
      state,
      "stale-revision",
      ["expectedRevision"],
      `This command was prepared against revision ${envelope.expectedRevision}; the document is at ${state.head}. Fetch the changes and try again.`,
      { expected: envelope.expectedRevision, head: state.head },
    );

  switch (c.type) {
    case "edit": {
      const applied = applyOperations(current, c.ops, context(state, envelope, env));
      if (!applied.ok) return reject(state, attributeConflicts(state, applied.diagnostics, 0));
      const done = finish(state, current, applied.value, env);
      if (!done.ok) return reject(state, done.diagnostics);
      return commit(state, envelope, payload, raw, env, {
        document: done.document,
        kind: "edit",
        ...(c.summary === undefined ? {} : { summary: c.summary }),
      });
    }
    case "document.upgrade": {
      const access = headAccess(current, env.registry);
      if (access.mode === "writable")
        return rejectOne(
          state,
          "no-change",
          ["command"],
          "The document already uses this build's feature versions.",
        );
      if (access.mode === "read-only") return reject(state, accessDiagnostics(access));
      const done = finish(state, current, access.upgraded, env);
      if (!done.ok) return reject(state, done.diagnostics);
      return commit(state, envelope, payload, raw, env, {
        document: done.document,
        kind: "upgrade",
      });
    }
    case "undo": {
      const target = state.history[c.target - 1];
      if (!target)
        return rejectOne(
          state,
          "unknown-revision",
          ["command", "target"],
          `Revision ${c.target} does not exist.`,
        );
      if (target.kind === "create")
        return rejectOne(
          state,
          "not-undoable",
          ["command", "target"],
          "The revision that created the document cannot be undone.",
        );
      if (target.kind === "upgrade")
        return rejectOne(
          state,
          "not-undoable",
          ["command", "target"],
          "A feature upgrade cannot be undone; restore an earlier revision instead.",
        );
      {
        const undo = state.head + 1;
        const after = undoStatus(undo, withUndo(state.undos, c.target, undo)).inForce;
        for (const [revision, by] of after) {
          if (by.length < 2) continue;
          const other = by.find((u) => u !== undo) ?? null;
          return rejectOne(
            state,
            "already-undone",
            ["command", "target"],
            revision === c.target
              ? `Revision ${c.target} is already undone.`
              : `Undoing revision ${c.target} would undo revision ${revision} again; revision ${other} already undoes it.`,
            revision === c.target ? { by: other } : { revision, by: other },
          );
        }
      }
      const reverted = applyChanges(current, invert(target.changes));
      if (!reverted.ok)
        return reject(state, attributeConflicts(state, reverted.diagnostics, c.target));
      const done = finish(state, current, reverted.value, env, "from-history");
      if (!done.ok) return reject(state, done.diagnostics);
      return commit(state, envelope, payload, raw, env, {
        document: done.document,
        kind: "undo",
        undoes: c.target,
      });
    }
    case "restore": {
      const earlier = documentAtRevision(state, c.revision);
      if (!earlier)
        return rejectOne(
          state,
          "unknown-revision",
          ["command", "revision"],
          `Revision ${c.revision} does not exist.`,
        );
      const done = finish(state, current, earlier, env, "from-history");
      if (!done.ok) return reject(state, done.diagnostics);
      return commit(state, envelope, payload, raw, env, {
        document: done.document,
        kind: "restore",
        restores: c.revision,
      });
    }
    case "proposal.create":
    case "proposal.refine": {
      const existing = state.proposals.get(c.proposal);
      if (c.type === "proposal.create" && existing)
        return rejectOne(
          state,
          "duplicate-id",
          ["command", "proposal"],
          `Proposal ${c.proposal} already exists.`,
        );
      if (c.type === "proposal.refine") {
        if (!existing)
          return rejectOne(
            state,
            "unknown-proposal",
            ["command", "proposal"],
            `There is no proposal ${c.proposal}.`,
          );
        if (existing.status !== "draft")
          return rejectOne(
            state,
            "proposal-closed",
            ["command", "proposal"],
            `Proposal ${c.proposal} is ${existing.status}.`,
          );
        if (existing.version !== c.version)
          return rejectOne(
            state,
            "proposal-version",
            ["command", "version"],
            `Proposal ${c.proposal} is at version ${existing.version}.`,
            {
              version: existing.version,
            },
          );
      }
      const base = documentAtRevision(state, envelope.expectedRevision);
      if (!base)
        return rejectOne(state, "unknown-revision", ["expectedRevision"], "Unknown base revision.");
      const target = proposalTarget(state, envelope, base, c.content, env);
      if (!target.ok) return reject(state, target.diagnostics);
      const proposal: Proposal = {
        id: c.proposal,
        author: existing?.author ?? envelope.actor,
        lastEditor: envelope.actor,
        baseRevision: envelope.expectedRevision,
        version: (existing?.version ?? 0) + 1,
        summary: c.summary,
        changes: target.changes,
        status: "draft",
      };
      return commit(state, envelope, payload, raw, env, { proposal });
    }
    case "proposal.discard": {
      const existing = state.proposals.get(c.proposal);
      if (!existing)
        return rejectOne(
          state,
          "unknown-proposal",
          ["command", "proposal"],
          `There is no proposal ${c.proposal}.`,
        );
      if (existing.status !== "draft")
        return rejectOne(
          state,
          "proposal-closed",
          ["command", "proposal"],
          `Proposal ${c.proposal} is ${existing.status}.`,
        );
      if (agent && !state.policy.agentDirectEdit && !sameActor(existing.author, envelope.actor))
        return rejectOne(
          state,
          "forbidden",
          ["actor"],
          `Proposal ${c.proposal} belongs to ${existing.author.id}. An agent discards only its own drafts while direct editing is off.`,
        );
      return commit(state, envelope, payload, raw, env, {
        proposal: { ...existing, status: "discarded" },
      });
    }
    case "proposal.accept": {
      const existing = state.proposals.get(c.proposal);
      if (!existing)
        return rejectOne(
          state,
          "unknown-proposal",
          ["command", "proposal"],
          `There is no proposal ${c.proposal}.`,
        );
      if (existing.status !== "draft")
        return rejectOne(
          state,
          "proposal-closed",
          ["command", "proposal"],
          `Proposal ${c.proposal} is ${existing.status}.`,
        );
      if (existing.version !== c.version)
        return rejectOne(
          state,
          "proposal-version",
          ["command", "version"],
          `Proposal ${c.proposal} is at version ${existing.version}.`,
          {
            version: existing.version,
          },
        );
      if (existing.baseRevision !== state.head)
        return rejectOne(
          state,
          "stale-revision",
          ["command", "proposal"],
          `Proposal ${c.proposal} was drafted against revision ${existing.baseRevision}; the document is at ${state.head}. Refine it against the current revision.`,
          { base: existing.baseRevision, head: state.head },
        );
      const applied = applyChanges(current, existing.changes);
      if (!applied.ok)
        return reject(state, attributeConflicts(state, applied.diagnostics, existing.baseRevision));
      const done = finish(state, current, applied.value, env);
      if (!done.ok) return reject(state, done.diagnostics);
      return commit(state, envelope, payload, raw, env, {
        document: done.document,
        kind: "proposal",
        author: existing.lastEditor,
        summary: existing.summary,
        proposal: {
          ...existing,
          status: "accepted",
          acceptedRevision: state.head + 1,
        },
      });
    }
    case "policy.set":
      if (state.policy.agentDirectEdit === c.agentDirectEdit)
        return rejectOne(state, "no-change", ["command"], "The policy is already set that way.");
      return commit(state, envelope, payload, raw, env, {
        policy: { agentDirectEdit: c.agentDirectEdit },
      });
  }
}
