# @irudd/document contract

This is the interface that storage and builders and generators rely
on. Everything is imported from the package entry `@irudd/document`; nothing
deeper is public. The package is pure: no Node, DOM, Three or file access.
Storage supplies bytes and lookups through `Environment`.

## Writes

One function owns every document write:

```ts
reduce(state: DocumentState, input: unknown, env: Environment): Step
// Step = { state, outcome }
// outcome.kind: "committed" | "replayed" | "rejected"
```

- `input` is an `irudd.command` v1 envelope (`CommandEnvelopeInput`):
  - `requestId` (8–128 characters, stable across client retries)
  - `documentId`
  - `actor` `{kind: "human" | "agent", id, name?}`
  - `expectedRevision`
  - `command`
- The reducer checks a request in this order:
  1. decode
  2. document identity
  3. request ID (a known ID replays its receipt, or is refused as `request-reused`)
  4. actor policy
  5. what this build can do with the head (`upgrade-required` or `read-only`, see Storage)
  6. expected revision
  7. the command
- A rejection returns the **same state object**. A commit returns its receipt
  and one journal entry (`outcome.entry`, also the last element of
  `state.journal`). Document writes (create, generate, upgrade, edit, undo,
  restore, proposal acceptance) append exactly one revision (`head + 1`).
  Policy changes and proposal create, refine and discard append none.
- Commands:
  - `document.create`
  - `document.generate`
  - `document.upgrade` (applies this build's feature upgrades as one revision; not undoable)
  - `edit {ops}`
  - `undo {target}`
  - `restore {revision}`
  - the proposal commands `proposal.create` / `refine` / `discard` / `accept`; create and refine take `{kind: "ops" | "replace"}` content
  - `policy.set` (people only)
- Agents get `proposal-required` for document writes unless the document's
  policy allows direct edits. Either actor may create the initial document. Any actor may create or refine a draft; only
  the acceptor's policy decides the write. While direct editing is off, an
  agent discards only drafts it created (`forbidden` otherwise).
- A `replace` draft keeps the recorded generator, its base and every part's
  slot. Only the generator assigns slots (the rule `part.add` follows too);
  a replacement that changes them is `forbidden` at the exact path.
- Undo: a revision has at most one undo in force. Undoing an undo brings its
  target back, which may re-instate an older undo; when that would leave a
  revision undone twice, the request is `already-undone` with
  `detail {revision, by}`. `isUndone(state, r)` and `undoneBy(state, r)`
  report the current status.
- Ownership: the reducer copies its input before decoding, so later changes
  to the caller's objects never reach the state, and it never freezes them.
  Everything reachable from a `DocumentState` (head, history, journal,
  receipts, proposals, maps and sets) is deeply frozen; maps and sets expose
  only read methods.
- Diagnostics are `{code, path, message, detail?}`. The codes are listed in
  `diagnosticCodes`. A conflict's detail names `editedIn {revision, actor}`.

## Storage

- **Durable record.** Persist `state.journal` in order, one
  `JournalEntry` per commit, plus the blobs documents reference. Nothing
  else is authoritative. Store `canonicalJson(journalJson(entry))`.
- **Entry format** `irudd.journal` version 1:
  `{format, version, sequence, previous, envelope, receipt, effect, digest}`.
  - `sequence` counts from 1; `previous` is the previous entry's `digest`
    (null for the first); `digest` covers the canonical entry without it.
  - `envelope` is the decoded request; `receipt.payload` is its digest.
  - `effect` holds what the command did: `revision` (kind, author, field
    changes from the previous head, the document digest, and the whole
    document for creation), `proposal` (the draft as left by the command,
    including discarded and accepted drafts) and `policy`.
- **Committing.** Append `step.outcome.entry` atomically, then publish
  `step.state`. Keep the last committed `{sequence, digest}` in the store's
  own header so truncation at the end is detectable. A retry with the same
  request ID and payload gets `replayed` and the original receipt, so
  storage needs no separate deduplication.
- **Recovery.** `openJournal(documentId, entries, env, {last?})` →
  `{ok: true, state, access}` or `{ok: false, index, diagnostics}`.
  - It rebuilds the state from the recorded effects only. It never runs a
    generator, feature codec or op. Materialised documents, the recorded
    generator base, revisions, receipts, every proposal, undo relations
    and policy come back unchanged, with the same digests.
  - Supply the separately persisted last sequence and digest to detect a missing tail. The digest chain checks consistency of stored records. Authenticating the writer and authorizing requests are service responsibilities. Forensic replay rechecks the original commands.
  - It checks every entry's format, digest, sequence and link; that each
    receipt matches its envelope and the head it reports; that each
    revision's changes reproduce its recorded digest; and that proposal
    and policy effects are legal transitions. The first failure fails the
    whole journal (`journal-integrity`, or `unsupported-format` for a newer
    journal version or command type) with its entry index. Nothing partial
    is returned. A missing receipt is a failure.
  - `DocumentState` cannot be built any other way: it carries a
    module-private brand.
- **Access.** `access` (also `documentAccess(state, env)`) says what this
  build can do with the head:
  - `writable`: the head validates unchanged.
  - `upgrade-required`: it validates only after feature upgrades. Writes
    are refused with `upgrade-required` until `document.upgrade` appends the
    upgraded head as its own revision.
  - `read-only`: this build cannot validate it, for example an unknown or
    newer feature or a retired generator. Writes are refused with
    `read-only` followed by the reasons.
  - In every mode, reads and queries work, earlier requests replay their
    original receipts, and `policy.set` and `proposal.discard` work. A
    generator whose output changed under the same `id@version` does not
    affect recovery. The stored base keeps being the merge base.
- **Forensic replay.** `replayJournal(documentId, entries, env)` re-runs
  every envelope with `reduce` and requires byte-identical entries. It is
  meaningful only in the environment the journal was written with (same
  generators, codecs, assets and catalog). A difference in a newer build is
  expected and is not corruption; use `openJournal` to recover.
- **Blobs.** `Environment.assets.lookup(digest)` reports complete,
  hash-verified blobs only. Use `verifyAssetBytes(entry, bytes)` when ingesting.
  Unstaged or mismatched blobs fail validation with `missing-asset` or
  `asset-mismatch` at `["assets", digest]`.
- **Catalogs.** `Environment.catalog.lookup(id)` gives the installed catalog
  digest (`catalog-missing` or `catalog-mismatch` at `["catalog", id]`).
- **Reading documents.** `readDocument(raw, {registry, environment?})` is the
  single validator for imported documents. It runs feature upgrades, then
  schema, integrity and environment checks. `documentDigest` and
  `canonicalJson` give stable bytes for storage and comparison.
- **Queries.** `documentAt`, `changesSince`, `diffRevisions`, `attribution`,
  `lastChange` and `previewProposal` are read-only.

## Builders and generators

- **Generators.**
  - Register with `defineGenerator({id, version, label, schema, toJson, generate})`.
  - `generate` returns base slots (`BaseSlotInput[]`) keyed by stable slot names. Its output is schema-checked before use.
  - A generator that throws while producing slots rejects the request with `generator-failed`.
  - The registry key is `id@version`. An unknown pair is `unsupported-generator`.
- **Merging generator output.** `generation.steer`, `generation.scale` and
  `generation.rebuild` are ordinary `edit` ops. They run a three-way merge of
  the stored base, the current document and the new output:
  - position, rotation and size edits on generated slots are carried into the new generated frame. A manual label takes precedence over a generated label. A hand-added child keeps its parent-local transform and dimensions when its parent is resized
  - sculpt displacements are stored in normalised part coordinates
  - incompatible edits to shape, colour or parent and removals that would lose an edit or a pose reference give an atomic `conflict` at the affected field path
  - `generation.rebuild` with `discardEdits: true` resets generated parts.
- **Gesture ops.** Builders emit ops, never documents. Operations that map to
  gestures:
  - `part.transform` (translate in the parent frame, then rotate and scale locally)
  - `sculpt.at` (a world-space pick resolved against the frame at command time)
  - `part.add`, `part.remove {cascade}`, `part.set`, `pose.set`
- **One gesture is one `edit` envelope**, so one gesture is one revision.
- **Families.** `defineFeature({id, version, scope, schema, toJson, upgrades,
  references})`:
  - `upgrades[i]` lifts version `i + 1` to `i + 2`
  - `references` declares part or pose IDs for integrity checks
  - unknown or newer features are refused before decode
- **Geometry.** The entry exports pure vector, quaternion, frame and affine
  helpers (`add`, `rotate`, `quatMultiply`, `toFrame`, `composeAffine`,
  `invertAffine`, `decomposeAffine` …).
- **Attachment.** A part's position and rotation are stored in its parent's
  child basis. The core basis is the parent's rigid metric frame. A feature may
  declare a scaled basis with `childBasis(payload, size)`; `figure.assembly`
  does (`size`, or `size / frameSize`), so figure children follow their
  parent's shape when it is resized, without their stored values changing.
  - `partPlacements(doc, registry)` gives every part's `frame`, `node` (its
    unit primitive, frame · S(size)) and `children` basis as affine maps. It
    is the one placement: builders must agree with it (the families suite
    checks the built scene), and nested rotation under a non-uniform basis
    shears exactly as the legacy builder does.
  - Placements are the rest placement. A family deformation after it (the
    `figure.build` warp) moves pivots only; builders expose it.
  - `partFrame(doc, id)` is the rigid core frame. It equals the placement
    only when no part on the chain declares a basis.
  - World picks and directions: `toPartLocal` and `displacementInWorld` take
    the registry; `sculpt.at` resolves through the placement of the command's
    registry. `worldDeltaInParent` turns a world drag into a `part.transform`
    translation. `reattachInPlace` gives the `part.set` values that keep a
    part and its children in place under a new parent, or refuses with
    `shear` or `children`.
  - Generator merges never rewrite a hand-made part. Under a rigid parent it
    keeps its metric offset, so a hand-added horn sinks 5.5 mm into a head
    scaled by 1.05; under a figure-assembled parent it stays seated
    (`test/attachment.test.ts`).
