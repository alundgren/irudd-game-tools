// Named bounds for the protocol model. The fast tier uses the small ones; the
// g1-protocol gate uses all of them.

import type { Bounds } from "./model.js";

/** Two projects, one actor, two request IDs, revisions up to 3. */
export const fast: Bounds = {
  name: "fast",
  receivers: ["A", "B"],
  documents: ["A", "B"],
  actors: ["human"],
  requestIds: ["r1", "r2"],
  values: [1, 2],
  maxRevision: 3,
};

/** One project and one actor, deep enough for an undo after a later edit. */
export const fastDeep: Bounds = {
  name: "fast-deep",
  receivers: ["A"],
  documents: ["A"],
  actors: ["human"],
  requestIds: ["r1", "r2", "r3", "r4"],
  values: [1, 2],
  maxRevision: 5,
};

/** Two projects and two actors sharing request IDs, revisions up to 3. */
export const pair: Bounds = {
  name: "pair",
  receivers: ["A", "B"],
  documents: ["A", "B"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2"],
  values: [1, 2],
  maxRevision: 3,
};

/**
 * One project, two actors and four request IDs: every interleaving of four
 * edits and undos, with stale, retried and reused requests between them.
 * Misdirected requests and isolation are covered by `pair`.
 */
export const deep: Bounds = {
  name: "deep",
  receivers: ["A"],
  documents: ["A"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2", "r3", "r4"],
  values: [1, 2],
  maxRevision: 5,
};

/** Random traces: both projects, three request IDs, no revision limit. */
export const traces: Bounds = {
  name: "traces",
  receivers: ["A", "B"],
  documents: ["A", "B"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  values: [1, 2, 3],
  maxRevision: 8,
};

/**
 * Drafts and policy at small bounds: one project, a person and an agent, one
 * draft ID, agents start without direct editing.
 */
export const fastDrafts: Bounds = {
  name: "fast-drafts",
  receivers: ["A"],
  documents: ["A"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2", "r3"],
  values: [1],
  maxRevision: 3,
  direct: false,
  policy: true,
  drafts: { ids: ["q"], maxVersion: 2 },
};

/** Drafts for exhaustive comparison with the reducer: three ordered request IDs. */
export const draftDiff: Bounds = { ...fastDrafts, name: "draft-diff", orderedIds: true };

/** Drafts for the gate: four requests, so two refinements race and the winner is accepted. */
export const drafts: Bounds = {
  ...fastDrafts,
  name: "drafts",
  requestIds: ["r1", "r2", "r3", "r4"],
  orderedIds: true,
};

/**
 * Undo chains: deep enough for edit, undo, undo of the undo, undo again, edit
 * and undo of the redo (revision 7), the shortest trace that undoes a
 * revision twice when undo-of-undo is not checked.
 */
export const chains: Bounds = {
  name: "chains",
  receivers: ["A"],
  documents: ["A"],
  actors: ["human"],
  requestIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  values: [1],
  maxRevision: 7,
  orderedIds: true,
};

/** Random traces with drafts and policy: both projects, two draft IDs, no revision limit. */
export const draftTraces: Bounds = {
  ...traces,
  name: "draft-traces",
  direct: false,
  policy: true,
  drafts: { ids: ["q", "w"], maxVersion: 3 },
};
