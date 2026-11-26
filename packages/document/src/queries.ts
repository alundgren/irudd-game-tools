import { applyChanges, diff, pathKey, pathsOverlap, type Change, type Path } from "./changes.js";
import type { Checked } from "./diagnostics.js";
import { fail, ok, diagnostic } from "./diagnostics.js";
import type { Actor } from "./commands.js";
import type { CharacterDocument } from "./schema.js";
import type { DocumentState, Proposal, RevisionRecord } from "./state.js";

export function documentAt(state: DocumentState, revision: number): CharacterDocument | undefined {
  return state.history[revision - 1]?.document;
}

export function changesSince(
  state: DocumentState,
  revision: number,
): ReadonlyArray<RevisionRecord> {
  return state.history.filter((r) => r.revision > revision);
}

export function diffRevisions(
  state: DocumentState,
  from: number,
  to: number,
): Checked<ReadonlyArray<Change>> {
  const a = documentAt(state, from);
  const b = documentAt(state, to);
  if (!a || !b)
    return fail([diagnostic("unknown-revision", [], `Unknown revision ${a ? to : from}.`)]);
  return ok(diff(a, b));
}

export interface FieldAttribution {
  readonly revision: number;
  readonly actor: Actor;
  readonly author: Actor;
}

export function attribution(state: DocumentState): ReadonlyMap<string, FieldAttribution> {
  const out = new Map<string, FieldAttribution>();
  for (const r of state.history)
    for (const c of r.changes)
      out.set(pathKey(c.path), { revision: r.revision, actor: r.actor, author: r.author });
  return out;
}

export function lastChange(state: DocumentState, path: Path): FieldAttribution | undefined {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const r = state.history[i];
    if (r?.changes.some((c) => pathsOverlap(c.path, path)))
      return { revision: r.revision, actor: r.actor, author: r.author };
  }
  return undefined;
}

export interface ProposalPreview {
  readonly proposal: Proposal;
  readonly preview: CharacterDocument;
  readonly changes: ReadonlyArray<Change>;
  readonly stale: boolean;
  readonly rebased: Checked<ReadonlyArray<Change>>;
}

export function previewProposal(state: DocumentState, id: string): Checked<ProposalPreview> {
  const proposal = state.proposals.get(id);
  if (!proposal) return fail([diagnostic("unknown-proposal", [], `There is no proposal ${id}.`)]);
  const base = documentAt(state, proposal.baseRevision);
  const head = state.document;
  if (!base || !head)
    return fail([diagnostic("unknown-revision", [], "The proposal's base is missing.")]);
  const preview = applyChanges(base, proposal.changes);
  if (!preview.ok) return preview;
  const stale = proposal.baseRevision !== state.head;
  const rebasedDoc = stale ? applyChanges(head, proposal.changes) : ok(preview.value);
  return ok({
    proposal,
    preview: preview.value,
    changes: proposal.changes,
    stale,
    rebased: rebasedDoc.ok ? ok(diff(head, rebasedDoc.value)) : rebasedDoc,
  });
}
