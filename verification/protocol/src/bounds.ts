import type { Bounds } from "./model.js";

export const fast: Bounds = {
  name: "fast",
  receivers: ["A", "B"],
  documents: ["A", "B"],
  actors: ["human"],
  requestIds: ["r1", "r2"],
  values: [1, 2],
  maxRevision: 3,
};

export const fastDeep: Bounds = {
  name: "fast-deep",
  receivers: ["A"],
  documents: ["A"],
  actors: ["human"],
  requestIds: ["r1", "r2", "r3", "r4"],
  values: [1, 2],
  maxRevision: 5,
};

export const pair: Bounds = {
  name: "pair",
  receivers: ["A", "B"],
  documents: ["A", "B"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2"],
  values: [1, 2],
  maxRevision: 3,
};

export const deep: Bounds = {
  name: "deep",
  receivers: ["A"],
  documents: ["A"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2", "r3", "r4"],
  values: [1, 2],
  maxRevision: 5,
};

export const traces: Bounds = {
  name: "traces",
  receivers: ["A", "B"],
  documents: ["A", "B"],
  actors: ["human", "agent"],
  requestIds: ["r1", "r2", "r3", "r4", "r5", "r6"],
  values: [1, 2, 3],
  maxRevision: 8,
};

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

export const draftDiff: Bounds = { ...fastDrafts, name: "draft-diff", orderedIds: true };

export const drafts: Bounds = {
  ...fastDrafts,
  name: "drafts",
  requestIds: ["r1", "r2", "r3", "r4"],
  orderedIds: true,
};

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

export const draftTraces: Bounds = {
  ...traces,
  name: "draft-traces",
  direct: false,
  policy: true,
  drafts: { ids: ["q", "w"], maxVersion: 3 },
};
