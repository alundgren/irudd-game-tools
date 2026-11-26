import { Schema } from "effect";
import { headAccess, type Access } from "./access.js";
import { applyChanges, ChangeSchema } from "./changes.js";
import { Actor, commandFormat } from "./commands.js";
import { diagnostic, type Diagnostic, type DiagnosticPath } from "./diagnostics.js";
import { digestBrand, documentDigest } from "./document.js";
import { canonicalJson, isJson, isJsonObject, type Json } from "./json.js";
import { decodeWith, type Environment } from "./registry.js";
import { emptyState, reduce } from "./reducer.js";
import {
  CharacterDocument,
  Digest,
  DocumentId,
  JsonValue,
  ProposalId,
  type CharacterDocument as Document,
  type DocumentId as DocumentIdType,
} from "./schema.js";
import { digestJson } from "./sha256.js";
import {
  entryDigest,
  FrozenMap,
  FrozenSet,
  journalFormat,
  journalVersion,
  detach,
  makeState,
  own,
  undoStatus,
  type DocumentState,
  type JournalEntry,
  type Proposal,
  type Receipt,
  type RevisionKind,
  type RevisionRecord,
} from "./state.js";

const commandTypes = [
  "document.create",
  "document.generate",
  "document.upgrade",
  "edit",
  "undo",
  "restore",
  "proposal.create",
  "proposal.refine",
  "proposal.discard",
  "proposal.accept",
  "policy.set",
] as const;
type CommandType = (typeof commandTypes)[number];
const isCommandType = (value: Json | undefined): value is CommandType =>
  commandTypes.some((t) => t === value);

const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Status = Schema.Literals(["draft", "discarded", "accepted"]);

const ProposalRecord = Schema.Struct({
  id: ProposalId,
  author: Actor,
  lastEditor: Actor,
  baseRevision: Count,
  version: Count,
  summary: Schema.String,
  changes: Schema.Array(ChangeSchema),
  status: Status,
  acceptedRevision: Schema.optionalKey(Count),
});

const ReceiptRecord = Schema.Struct({
  requestId: Schema.String,
  payload: Digest,
  documentId: DocumentId,
  command: Schema.Literals(commandTypes),
  revision: Count,
  documentDigest: Digest,
  appended: Schema.Boolean,
  proposal: Schema.optionalKey(
    Schema.Struct({ id: Schema.String, version: Count, status: Status }),
  ),
});

const RevisionEffect = Schema.Struct({
  kind: Schema.Literals(["create", "edit", "undo", "restore", "proposal", "upgrade"]),
  author: Actor,
  changes: Schema.Array(ChangeSchema),
  document: Schema.optionalKey(CharacterDocument),
  digest: Digest,
  undoes: Schema.optionalKey(Count),
  restores: Schema.optionalKey(Count),
  proposal: Schema.optionalKey(Schema.Struct({ id: Schema.String, version: Count })),
  summary: Schema.optionalKey(Schema.String),
});

const EntryRecord = Schema.Struct({
  format: Schema.Literal(journalFormat),
  version: Schema.Literal(journalVersion),
  sequence: Count,
  previous: Schema.NullOr(Digest),
  envelope: JsonValue,
  receipt: ReceiptRecord,
  effect: Schema.Struct({
    revision: Schema.optionalKey(RevisionEffect),
    proposal: Schema.optionalKey(ProposalRecord),
    policy: Schema.optionalKey(Schema.Struct({ agentDirectEdit: Schema.Boolean })),
  }),
  digest: Digest,
});

const EnvelopeHeader = Schema.Struct({
  format: Schema.Literal(commandFormat),
  version: Count,
  requestId: Schema.String,
  documentId: DocumentId,
  actor: Actor,
  expectedRevision: Count,
  command: Schema.Struct({
    type: Schema.String,
    target: Schema.optionalKey(Count),
    revision: Schema.optionalKey(Count),
    proposal: Schema.optionalKey(Schema.String),
  }),
});
const decodeHeader = Schema.decodeUnknownResult(EnvelopeHeader, { onExcessProperty: "ignore" });

const revisionKinds: Readonly<Record<CommandType, RevisionKind | undefined>> = {
  "document.create": "create",
  "document.generate": "create",
  "document.upgrade": "upgrade",
  edit: "edit",
  undo: "undo",
  restore: "restore",
  "proposal.accept": "proposal",
  "proposal.create": undefined,
  "proposal.refine": undefined,
  "proposal.discard": undefined,
  "policy.set": undefined,
};

export type Recovery =
  | {
      readonly ok: true;
      readonly state: DocumentState;
      readonly access: Access;
    }
  | {
      readonly ok: false;
      readonly index: number;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    };

export interface OpenOptions {
  readonly last?: { readonly sequence: number; readonly digest: string };
}

export function journalJson(entry: JournalEntry): Json {
  return entry;
}

export function documentAccess(state: DocumentState, env: Environment): Access {
  return state.document ? headAccess(state.document, env.registry) : { mode: "writable" };
}

const same = (a: Json | undefined, b: Json | undefined): boolean =>
  canonicalJson(a ?? null) === canonicalJson(b ?? null);

class Corrupt {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  constructor(diagnostics: ReadonlyArray<Diagnostic>) {
    this.diagnostics = diagnostics;
  }
}

function corrupt(path: DiagnosticPath, message: string, detail?: Json): Corrupt {
  return new Corrupt([diagnostic("journal-integrity", path, message, detail)]);
}

export function openJournal(
  documentId: DocumentIdType,
  entries: ReadonlyArray<unknown>,
  env: Environment,
  options: OpenOptions = {},
): Recovery {
  let head = 0;
  let document: Document | undefined;
  let policy = own({ agentDirectEdit: false });
  const history: RevisionRecord[] = [];
  const receipts = new Map<string, Receipt>();
  const proposals = new Map<string, Proposal>();
  const retired = new Set<string>();
  const undos = new Map<number, ReadonlyArray<number>>();
  const journal: JournalEntry[] = [];
  const nullDigest = digestBrand(digestJson(null));

  for (let i = 0; i < entries.length; i++) {
    try {
      const entry = readEntry(entries[i], i, journal[journal.length - 1]);
      const header = decodeHeader(entry.envelope);
      if (header._tag === "Failure")
        throw corrupt([i, "envelope"], `Entry ${i + 1} holds no readable command envelope.`);
      const e = header.success;
      const type = e.command.type;
      const { receipt, effect } = entry;
      if (e.documentId !== documentId || receipt.documentId !== documentId)
        throw corrupt([i, "envelope", "documentId"], `Entry ${i + 1} belongs to another document.`);
      if (digestJson(entry.envelope) !== receipt.payload)
        throw corrupt(
          [i, "receipt", "payload"],
          `Entry ${i + 1}'s receipt is for another request.`,
        );
      if (receipt.requestId !== e.requestId || receipt.command !== type || !isCommandType(type))
        throw corrupt([i, "receipt"], `Entry ${i + 1}'s receipt does not match its envelope.`);
      if (receipts.has(e.requestId))
        throw corrupt([i, "receipt", "requestId"], `Request ${e.requestId} is recorded twice.`);

      const kind = revisionKinds[receipt.command];
      const rev = effect.revision;
      if ((kind === undefined) !== (rev === undefined) || (rev && rev.kind !== kind))
        throw corrupt([i, "effect"], `Entry ${i + 1}'s effect does not fit a ${type} command.`);
      if (receipt.appended !== (rev !== undefined))
        throw corrupt(
          [i, "receipt", "appended"],
          `Entry ${i + 1}'s receipt misstates its revision.`,
        );

      const proposal = effect.proposal;
      if (type.startsWith("proposal.")) {
        if (!proposal || proposal.id !== e.command.proposal)
          throw corrupt([i, "effect", "proposal"], `Entry ${i + 1} lacks its proposal.`);
        const before = proposals.get(proposal.id);
        const legal = ((): boolean => {
          switch (type) {
            case "proposal.create":
              return (
                !before &&
                proposal.version === 1 &&
                proposal.status === "draft" &&
                same(proposal.author, e.actor) &&
                same(proposal.lastEditor, e.actor)
              );
            case "proposal.refine":
              return (
                before?.status === "draft" &&
                proposal.version === before.version + 1 &&
                proposal.status === "draft" &&
                same(proposal.author, before.author) &&
                same(proposal.lastEditor, e.actor)
              );
            case "proposal.discard":
              return (
                before?.status === "draft" && same(proposal, { ...before, status: "discarded" })
              );
            default:
              return (
                before?.status === "draft" &&
                same(proposal, { ...before, status: "accepted", acceptedRevision: head + 1 })
              );
          }
        })();
        if (!legal || proposal.baseRevision < 1 || proposal.baseRevision > head)
          throw corrupt(
            [i, "effect", "proposal"],
            `Entry ${i + 1}'s proposal change is not legal.`,
          );
        if (
          !same(receipt.proposal, {
            id: proposal.id,
            version: proposal.version,
            status: proposal.status,
          })
        )
          throw corrupt(
            [i, "receipt", "proposal"],
            `Entry ${i + 1}'s receipt misstates the proposal.`,
          );
      } else if (proposal || receipt.proposal)
        throw corrupt([i, "effect", "proposal"], `Entry ${i + 1} records an unexpected proposal.`);

      if ((type === "policy.set") !== (effect.policy !== undefined))
        throw corrupt([i, "effect", "policy"], `Entry ${i + 1}'s policy effect does not fit.`);
      if (effect.policy && effect.policy.agentDirectEdit === policy.agentDirectEdit)
        throw corrupt(
          [i, "effect", "policy"],
          `Entry ${i + 1} records a policy that changes nothing.`,
        );

      if (rev) {
        const n = head + 1;
        if (receipt.revision !== n)
          throw corrupt([i, "receipt", "revision"], `Entry ${i + 1} should append revision ${n}.`);
        let next: Document;
        if (rev.kind === "create") {
          if (head !== 0 || rev.document === undefined || rev.changes.length)
            throw corrupt([i, "effect", "revision"], `Entry ${i + 1} creates the document twice.`);
          next = rev.document;
        } else {
          if (!document || rev.document !== undefined)
            throw corrupt(
              [i, "effect", "revision"],
              `Entry ${i + 1} edits a document that does not exist.`,
            );
          const applied = applyChanges(document, rev.changes);
          if (!applied.ok)
            throw corrupt(
              [i, "effect", "revision", "changes"],
              `Revision ${n}'s changes do not apply.`,
            );
          next = applied.value;
        }
        const digest = documentDigest(next);
        if (digest !== rev.digest || digest !== receipt.documentDigest)
          throw corrupt(
            [i, "effect", "revision", "digest"],
            `Revision ${n} does not reproduce its digest.`,
            {
              recorded: rev.digest,
              actual: digest,
            },
          );
        const target = type === "undo" ? e.command.target : undefined;
        const restored = type === "restore" ? e.command.revision : undefined;
        if (
          rev.undoes !== target ||
          rev.restores !== restored ||
          (target !== undefined && (target < 2 || target >= n)) ||
          (restored !== undefined && (restored < 1 || restored >= n))
        )
          throw corrupt(
            [i, "effect", "revision"],
            `Revision ${n} names the wrong earlier revision.`,
          );
        const author = rev.kind === "proposal" ? proposal?.lastEditor : e.actor;
        if (!same(rev.author, author))
          throw corrupt(
            [i, "effect", "revision", "author"],
            `Revision ${n}'s author is not recorded correctly.`,
          );
        if (
          !same(
            rev.proposal,
            rev.kind === "proposal" && proposal
              ? { id: proposal.id, version: proposal.version }
              : undefined,
          )
        )
          throw corrupt(
            [i, "effect", "revision", "proposal"],
            `Revision ${n} names the wrong proposal.`,
          );
        const owned = own(next);
        history.push(
          own({
            revision: n,
            kind: rev.kind,
            actor: e.actor,
            author: rev.author,
            requestId: e.requestId,
            changes: rev.changes,
            document: owned,
            digest,
            ...(rev.undoes === undefined ? {} : { undoes: rev.undoes }),
            ...(rev.restores === undefined ? {} : { restores: rev.restores }),
            ...(rev.proposal === undefined ? {} : { proposal: rev.proposal }),
            ...(rev.summary === undefined ? {} : { summary: rev.summary }),
          }),
        );
        const present = new Set<string>(next.parts.map((p) => p.id));
        for (const p of document?.parts ?? []) if (!present.has(p.id)) retired.add(p.id);
        for (const id of present) retired.delete(id);
        if (rev.undoes !== undefined)
          undos.set(rev.undoes, Object.freeze([...(undos.get(rev.undoes) ?? []), n]));
        head = n;
        document = owned;
      } else {
        const current = history[history.length - 1]?.digest ?? nullDigest;
        if (receipt.revision !== head || receipt.documentDigest !== current)
          throw corrupt([i, "receipt"], `Entry ${i + 1}'s receipt names the wrong head.`);
      }
      if (proposal) proposals.set(proposal.id, own(proposal));
      if (effect.policy) policy = own(effect.policy);
      receipts.set(e.requestId, own(receipt));
      journal.push(entry);
    } catch (error) {
      if (error instanceof Corrupt) return { ok: false, index: i, diagnostics: error.diagnostics };
      throw error;
    }
  }

  const last = journal[journal.length - 1];
  if (
    options.last &&
    (last?.sequence !== options.last.sequence || last.digest !== options.last.digest)
  )
    return {
      ok: false,
      index: journal.length,
      diagnostics: [
        diagnostic(
          "journal-integrity",
          [journal.length],
          `The journal ends at entry ${journal.length}; storage last committed entry ${options.last.sequence}.`,
        ),
      ],
    };

  const state = makeState({
    documentId,
    head,
    document,
    history: Object.freeze(history),
    receipts: new FrozenMap(receipts),
    proposals: new FrozenMap(proposals),
    policy,
    retired: new FrozenSet(retired),
    undone: new FrozenSet(undoStatus(head, undos).undone),
    undos: new FrozenMap(undos),
    journal: Object.freeze(journal),
  });
  return { ok: true, state, access: documentAccess(state, env) };
}

function readEntry(raw: unknown, i: number, previous: JournalEntry | undefined): JournalEntry {
  if (!isJson(raw) || !isJsonObject(raw))
    throw corrupt([i], `Entry ${i + 1} is not a JSON object.`);
  if (raw["format"] !== journalFormat)
    throw new Corrupt([
      diagnostic(
        "unsupported-format",
        [i, "format"],
        `Entry ${i + 1} is not an ${journalFormat} entry.`,
      ),
    ]);
  const version = raw["version"];
  if (typeof version === "number" && version > journalVersion)
    throw new Corrupt([
      diagnostic(
        "unsupported-format",
        [i, "version"],
        `Journal version ${version} needs a newer build; this build reads version ${journalVersion}.`,
        { version, supported: journalVersion },
      ),
    ]);
  const receipt = raw["receipt"];
  const command = isJsonObject(receipt) ? receipt["command"] : undefined;
  if (typeof command === "string" && !isCommandType(command))
    throw new Corrupt([
      diagnostic(
        "unsupported-format",
        [i, "receipt", "command"],
        `Entry ${i + 1} records a ${command} command, which needs a newer build.`,
      ),
    ]);
  const decoded = decodeWith(EntryRecord, detach(raw), [i]);
  if (!decoded.ok) throw new Corrupt(decoded.diagnostics);
  const { digest: _digest, ...body } = decoded.value;
  const entry: JournalEntry = own(decoded.value);
  if (entryDigest(body) !== entry.digest || canonicalJson(raw) !== canonicalJson(entry))
    throw corrupt([i, "digest"], `Entry ${i + 1} does not match its digest.`);
  if (entry.sequence !== i + 1)
    throw corrupt([i, "sequence"], `Entry ${i + 1} is numbered ${entry.sequence}.`);
  if (entry.previous !== (previous?.digest ?? null))
    throw corrupt([i, "previous"], `Entry ${i + 1} does not follow entry ${i}.`);
  return entry;
}

export function replayJournal(
  documentId: DocumentIdType,
  entries: ReadonlyArray<unknown>,
  env: Environment,
):
  | { readonly ok: true; readonly state: DocumentState }
  | {
      readonly ok: false;
      readonly index: number;
      readonly diagnostics: ReadonlyArray<Diagnostic>;
    } {
  let state = emptyState(documentId);
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i];
    const stored = isJson(item) && isJsonObject(item) ? item : undefined;
    const envelope = stored?.["envelope"];
    const step = reduce(state, envelope, env);
    if (step.outcome.kind !== "committed")
      return {
        ok: false,
        index: i,
        diagnostics:
          step.outcome.kind === "rejected"
            ? step.outcome.diagnostics
            : [diagnostic("request-reused", [i], "The journal repeats a request.")],
      };
    if (!stored || canonicalJson(journalJson(step.outcome.entry)) !== canonicalJson(stored))
      return {
        ok: false,
        index: i,
        diagnostics: [
          diagnostic(
            "journal-integrity",
            [i],
            "Re-running this entry gave a different result. Forensic replay needs the generators, codecs, assets and catalog the journal was written with.",
            { recorded: stored?.["digest"] ?? null, actual: step.outcome.entry.digest },
          ),
        ],
      };
    state = step.state;
  }
  return { ok: true, state };
}
