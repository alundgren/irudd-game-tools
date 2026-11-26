# @irudd/workshop contract

The project service is the only writer of a project. Desktop, the
authenticated transport, the CLI and MCP all rely on the interface below. It
builds on the [document contract](../document/CONTRACT.md): every write goes
through `reduce`, and every recovery goes through `openJournal`.

## Entries

- `@irudd/workshop` is the storage entry. It exports `createProject`,
  `openProject` and `restoreProject`, together with the contract. Only a host
  imports it.
- `@irudd/workshop/host` owns a project and serves it to local clients:
  `hostProject`, `startHost`, `attachOrHost`, `workshopRegistry`,
  `workshopStarters` and `loadForms`. Desktop main and the headless host
  (`irudd host`, bin `irudd-host`) import it.
- `@irudd/workshop/contract` holds the types, error classes and format
  constants only.
- `@irudd/workshop/wire` holds the typed frames, the method table with its
  parameter schemas, the result types and the agent limits. It is pure: no
  Node and no storage, so the desktop renderer may import its types.
- `@irudd/workshop/endpoint` holds per-user state paths, the endpoint and
  credential files, and the HMAC proofs. It uses Node.
- `@irudd/workshop/client` provides `connect`, the reply shape guards and
  helpers for building commands.

The CLI and MCP import only `contract`, `wire`, `endpoint` and `client`, and
talk to the project's host. The static rule `client-reaches-no-storage-writer`
enforces this, and `revision-writes-through-service` keeps `src/storage/`
private to `src/service/`.

## Opening

```ts
createProject({ path, label, registry, catalog?, lockTimeoutMs?, durability? }): Effect<Project, ProjectError, Scope>
openProject({ path, registry, catalog?, lockTimeoutMs?, durability? }): Effect<Project, ProjectError, Scope>
restoreProject({ backup, path, registry, catalog? }): Effect<VerifyReport, ProjectError>
```

- **Files.** `path` is the project directory, and the project itself is the
  single file `workshop.sqlite` inside it. It holds every document's journal,
  a header row per document and the content-addressed blobs. A closed project
  is just that one file.
- **Lifetime.** The project lives as long as its `Scope`. Closing the scope
  closes SQLite and releases the lock. Once closed, every method fails with
  `ProjectClosed`.
- **One owner.** SQLite runs in WAL mode with `locking_mode = EXCLUSIVE`, set
  before WAL is first entered, so there is no shared-memory file. Opening
  takes an exclusive file lock with a write, and the lock is held until close.
  A second open, in this process or another, waits `lockTimeoutMs` (default
  250 ms) and then fails with `ProjectLocked`. When the owning process dies,
  the OS releases the lock. A client that finds a project locked connects to
  its owner and does not open the file.
- **Durability.** `durability: "full"` is the default (`synchronous = FULL`):
  an acknowledged commit survives power loss. `"normal"` survives process
  crashes but can lose the last commits on power loss.
- **Opening failures.** A newer project format, a file that is not a project
  and a damaged SQLite file each fail with `ProjectUnreadable` and a `reason`.

## Callers and writes

```ts
project.session({ actor }): Effect<Session, InvalidArgument>
session.apply(request: unknown): Effect<ApplyResult, StorageFailed | JournalDamaged | ProjectClosed>
```

- **Binding a caller.** The transport authenticates the caller and binds a
  session once per connection: the desktop window is a person, an MCP
  connection is an agent. The session writes its actor into every envelope. A
  request may leave `actor` out. A request that names a different actor is
  rejected with `forbidden` at `["actor"]`.
- **Results.** `ApplyResult` is one of:
  - `committed`: carries the receipt, the entry's `{sequence, digest}` and
    the head's access. The entry is durable before the result returns.
  - `replayed`: carries the original receipt. Nothing is written.
  - `rejected`: carries diagnostics. Nothing is written.

  A rejected command is a normal result, not an error.

- **One commit, one transaction.** The journal row and the header move from
  the previous `{sequence, digest}` to the new one in a single transaction.
  This holds for every committed entry, including `policy.set` and the draft
  commands, which advance the journal without moving the head. When a document
  is reopened, its header is passed to `openJournal` as `last`, so a journal
  cut short at its end fails recovery.
- **Write order.** One permit serialises writes, cache fills, verification
  and backups within the project. Reads use the immutable published state and
  do not wait. The append and publish steps cannot be interrupted.
- **Concurrent requests.** Of several requests prepared against the same
  revision, one commits and the rest get `stale-revision`. Copies of the same
  request ID produce one commit, and the other copies replay it.
- **When a write fails.** A failed append (`StorageFailed`) leaves the outcome
  of the commit unknown to the caller. The service drops its cached state and
  recovers the document from disk on next use, so retrying with the same
  request ID either commits once or replays the original receipt.
- **Defence in depth.** The append is conditional on the stored header still
  being at the expected `{sequence, digest}`. A store moved by someone else
  fails with `StorageFailed` (`append-diverged`) and writes nothing.

## Reads

| Method                              | Returns                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `documents`                         | `DocumentSummary[]` from the header table: label, revision, document digest, `{sequence, digest}`, `updatedAt`. Loads no journal    |
| `current(id)`                       | head revision, document, digest, access (`writable`, `upgrade-required` or `read-only`, with diagnostics), policy, journal position |
| `inspect(id)`                       | `current` plus history items (actor, author, kind, undo state, change count) and every proposal                                     |
| `changes(id, {since, by?})`         | `RevisionDelta[]` with field changes after `since`. `by: "human"` gives a person's manual edits                                     |
| `diff(id, from, to)`                | net field changes, or diagnostics                                                                                                   |
| `draft(id, proposalId)`             | the proposal, its preview on its own base, `stale`, and the rebased changes                                                         |
| `receipt(id, requestId)`            | the receipt of an earlier request, so a client that lost a reply can check it without resending                                     |
| `journal(id, after?)`               | stored `JournalEntry` values, in order                                                                                              |
| `blob(digest)` / `blobInfo(digest)` | bytes, re-hashed on every read, or their metadata                                                                                   |

A read of a document that was never committed fails with `DocumentMissing`. A
malformed ID fails with `InvalidArgument`. Every result is plain JSON data
except blob bytes, which are a `Uint8Array`.

## Artwork

- **Staging.** `session.putBlob({bytes, mediaType, digest?})` verifies a
  private copy of the bytes before storing them:
  - size between 1 byte and 64 MiB
  - a media type that documents accept
  - a matching file signature (PNG, JPEG, WebP or GLB)
  - the SHA-256 digest, when one is given

  A failure is `BlobRejected` with diagnostics.

- **Immutability.** Stored blobs never change. A second put of the same bytes
  reports `stored: "existing"`.
- **References.** `Environment.assets` lists stored blobs only, so a document
  cannot reference artwork until it is staged. Such a reference is rejected
  with `missing-asset`.
- **Damage.** Bytes that rot on disk are reported as `BlobMissing` with
  `reason: "damaged"` on read, and in `verify`.

## Verification, backup and restore

- **`verify`** runs `PRAGMA integrity_check`, recovers every journal from its
  rows, re-hashes every blob, and reports referenced blobs that are missing as
  well as unreferenced blobs (staged or abandoned uploads).
- **`backup(destination)`**:
  1. Copies the whole file with SQLite's online backup, while holding the
     write permit.
  2. Opens the copy and runs `verify` on it.
  3. Flushes the copy to disk and moves it into place.

  The result is one consistent file holding journals and artwork. If the copy
  fails verification, it is removed. A backup never overwrites an existing
  file.

- **`restoreProject`** copies a backup into a new directory, verifies it in
  full and then moves it into place. On any failure the directory is removed.

## Portable characters

`exportArchive(id)` writes an `irudd.character-package` version 1, and
`saveCharacter(id, destination)` writes it to a file that must not exist yet. A
partial sibling file is flushed and then moved into place. The file is a plain
ZIP (`.irudd-character`) with fixed timestamps:

| Entry                | Holds                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`      | format and version, document ID, label, head revision and digest, the journal's `last` anchor and entry count, required features, catalog dependencies by digest, metadata namespaces and one record per asset |
| `document.json`      | the head document as canonical JSON, readable without the history                                                                                                                                              |
| `history.jsonl`      | the whole journal, one canonical entry per line                                                                                                                                                                |
| `assets/<hex>.<ext>` | every blob any revision references, as raw bytes named by SHA-256                                                                                                                                              |

`session.importArchive(bytes)` and `session.openCharacter(path)` read a
package or an earlier `irudd.document-archive` version 1 JSON file (one
canonical file with base64 blobs), chosen by the first bytes. Every check runs
before anything is written:

- the ZIP structure: no encryption or ZIP64, safe and unique names, no
  overlapping data, each entry inflated within its declared size and checked
  against its CRC-32, and no files the manifest does not list
- every asset, the same way `putBlob` checks it, against its manifest record
- `document.json` with `readDocument` against this build and project:
  required features, part, pose and paint references, declared assets
  (present here or in the file) and installed catalogs by digest
- the journal, recovered with `openJournal` using `last`. Its head must be
  `document.json` byte for byte and match the manifest's revision and digest.
  A JSON archive's head gets the same `readDocument` check.
- that every blob any revision references is present, either in the file or
  in the project

The document and its new blobs are then written in one transaction. It comes
back with the same digests, receipts, drafts, policy, metadata and undo
state, and later commits continue its sequence. Failures:

- `DocumentExists` when the project already holds the document
- `ArchiveRejected{path, diagnostics}` for everything else, with a message
  naming the first three problems. Diagnostic paths start at the file part
  (`document.json`, `history.jsonl`, `manifest.json`, `package`) or at
  `["assets", digest]`. A newer package or archive version is
  `unsupported-format`.

The wire methods `document.save {documentId, path}` and
`document.open {path}` are for people only and take absolute paths on the
host's machine. A successful open emits a commit event with
`command: "document.open"`. The CLI (`irudd save`, `irudd open`) and the
desktop's Save character… and Open character… buttons call them.

## Errors

Errors are `Data.TaggedError` values whose fields are plain, plus a readable
`message`. A transport can send them as `{_tag, ...fields}`. `projectErrorTags`
lists every tag:

- `ProjectMissing`, `ProjectExists`, `ProjectLocked`,
  `ProjectUnreadable{reason}`, `ProjectClosed`
- `StorageFailed{operation}`
- `JournalDamaged{documentId, index, diagnostics}`
- `DocumentMissing`, `DocumentExists`
- `InvalidArgument{path}`
- `BlobRejected{diagnostics}`, `BlobMissing{reason}`
- `ArchiveRejected{path, diagnostics}`

A damaged document fails reads and writes with `JournalDamaged`. Other
documents in the project keep working.

## Hosting and clients

One process owns a project: desktop main or `irudd host <dir>`. Every other
caller connects to that owner over an OS-local endpoint, so the CLI, MCP and
a second desktop window all see the same open project and one write path.

```ts
import { attachOrHost } from "@irudd/workshop/host";

const opened = await attachOrHost({ path, kind: "desktop", create: { label }, forms });
if (opened.mode === "host") {
  await opened.host.call("apply", { request: envelopeWithoutActor });
  opened.host.onCommit((event) => refresh(event.documentId));
} else {
  await opened.client.call("subscribe", {});
  opened.client.onEvent((event) => refresh(event.documentId));
}
```

- **Endpoint.** A Windows named pipe
  (`\\.\pipe\irudd-workshop-<key>-<instance>`) or a Unix socket. `<key>`
  hashes the resolved project path, and every host start uses a new instance.
  The host writes `endpoint.json` (address, pid, instance, projectId) under
  per-user state: `%LOCALAPPDATA%\irudd\workshop\hosts\<key>\`,
  `~/Library/Application Support/irudd/workshop/...` or
  `$XDG_STATE_HOME/irudd/workshop/...`. `$IRUDD_STATE_DIR` overrides the root.
  Nothing is written into the project directory, so backups never copy
  credentials.
- **Authentication.** Every connection proves a key with HMAC-SHA-256 over
  both nonces, and so does the host. A secret never crosses the wire, and a
  process squatting on the pipe is detected (`HostImpostor`).
  - The person's key (`human.key`) is regenerated each time the host starts.
  - An agent's key comes from pairing. `irudd pair <id>` (person only) writes
    `agents/<id>.json` and records the derived key in `pairings.json`.
  - Pairings survive restarts. Re-pairing rotates the key, and revoking it
    applies to the next handshake. Pairings for a project replaced at the
    same path do not carry over.
- **Host-stamped identity.** The host binds the actor when a connection
  authenticates: the configured person (by default the OS account) or
  `{kind: "agent", id: <paired id>}`.
  - A request that names any actor is rejected with `forbidden` at
    `["actor"]`.
  - Agents may call only `agentMethods`. `pair.*` and `verify` answer
    `Forbidden`, and `policy.set` is refused at the host before the reducer
    sees it.
  - The reducer still requires proposals from agents unless a person enabled
    `agentDirectEdit`, and proposal acceptance follows the same rule.
- **Methods.** `wire/protocol.ts` lists them, with params schemas and
  `MethodResults`:
  - reads: `project.info`, `whoami`, `starters`, `documents`, `current`,
    `inspect`, `changes`, `diff`, `draft`, `receipt`
  - writes: `apply`, plus `start`, which creates a document from a starter
  - `subscribe`, which sends `commit` events on this connection
  - person only: `pair.agent`, `pair.list`, `pair.revoke`, `verify`

  Desktop calls the same table in-process with `host.call`.

- **Starters.** `starters` lists only what the registry really holds.
  - `generator` starters: `frame-creature` is marked `reference: true`, since
    it is the protocol's reference generator and not a character family. It
    has presets (`default`, `grazer`, `crawler`, `serpent`) and seeded
    variations: a seed always gives the same parameters.
  - `form` starters: prepared `irudd.character` documents the host was given
    with `forms` or `--forms <dir>`. `start` sends `document.create` with the
    new document ID.
  - Registered family features are listed separately.
- **Idempotency and staleness.** Every write carries a document ID, a base
  revision (`expectedRevision`) and a request ID. A repeat replays the
  original receipt, including after a host restart. A command against an old
  head is rejected with `stale-revision`, and nothing is written. A reply
  lost to a dropped connection is reported as `ConnectionLost`, with the
  outcome unknown; `receipt` or a retry with the same ID resolves it.
- **Frames.** One UTF-8 JSON value per line, at most 32 MiB, decoded with the
  wire schemas before use. A handshake must finish within 5 s.
- **Lifetime.** Closing the host destroys its connections, removes
  `endpoint.json` and `human.key` (only if they are still its own) and then
  closes the project. A killed host leaves a stale endpoint. Clients detect it
  (the pid is gone, or the connect fails) and say how to restart.

## Steering

The host keeps a steering outbox per project and OS account
(`steering.sqlite` beside the pairings, recording the project ID). The person
binds the paired agent to an inbox or a connected Claude channel. Sending a new message or artwork brief requires a live authenticated connection for that pairing.

States are kept apart: host-accepted (the conversation's host took it),
acknowledged (`inbox.ack` on a connection authenticated with that pairing),
reported (`inbox.applied` links a request the agent committed after the
message) and applied (a revision changed the character: the agent's direct
revision, or the person's acceptance of exactly the linked proposal version).
A linked proposal stays `proposed` until the person decides. Every change
emits a `steer` event to human subscribers and `onSteer` listeners. Routes,
evidence and gaps are in [docs/workshop-steering.md](../../docs/workshop-steering.md).

## Review

People and agents export a committed revision and inspect the GLB it
produced through the project's host (`review.capabilities`, `review.export`,
`review.inspect`, `review.read`; `src/wire/review.ts`).

- **Renderer.** One renderer at a time, registered with the host. The desktop
  registers its review worker in process when it owns the project, or over its
  person connection (`review.serve`, people only) when `irudd host` owns it.
  The newest registration wins.
- **Isolation.** The worker is a hidden, sandboxed window in its own in-memory
  session with no preload. It loads only its own page, the bundled sheets and
  the inputs of the job in hand. It draws with its own WebGL context, stage and
  camera from `@irudd/player`. It never draws in the person's window and never
  captures a screen.
- **Startup.** The worker opens after the person's window has loaded. The
  project never waits for it.
- **Availability.** Without a renderer, capabilities say why and list what a
  person can do. Every review request fails with `RendererUnavailable` and
  the same actions.
- **Pinned revision.** A job reads the revision it names, or the head at
  request time, and the blobs that revision declares (a missing one is
  `ArtworkUnresolved`).
- **Verified output.** The host checks the renderer's output before issuing
  it:
  - the GLB's provenance stamp names that document, digest, revision and
    preset; otherwise `ReviewMismatch` and nothing is issued
  - each PNG's size matches its reported size
- **Revision binding.** Every result carries `source`:
  - document, revision, document digest
  - the head at request and at completion
  - `headMoved` when an edit landed meanwhile
- **Repeatability.** `repeat` compares the GLB with the previous export of the
  same digest, revision, preset and build.
- **Issued artifacts.** Outputs live under the host's state directory in
  `review/`, indexed by project ID. `review.read` serves only artifacts this
  host issued for this project. It reads in chunks and re-hashes every file on
  each read; anything else is `ArtifactUnknown`. `readArtifact` in the client
  checks the SHA-256 of what arrived.
- **Jobs.**
  - Jobs run one at a time, with a 300 s timeout (`RenderTimeout`).
  - A renderer that disconnects fails its running job with `RendererLost`.
  - A renderer that registers again serves the next job.
  - Attached renderers upload outputs in order with `review.put` and finish
    with `review.complete`, both only from the serving connection.
- **Exports.** Exports are deterministic: the GLB writer places embedded
  images in a fixed order, so the same revision, preset and build export
  byte-identical files.

## Art direction

A person asks the paired agent for artwork with a typed brief; the agent
answers in the same conversation (`src/wire/art.ts`, `src/art/`).

- **Brief.** `art.request` (people only) takes `irudd.art-brief` version 1:
  kind (`variation`, `turnaround`, `trace`, `depth`), document, the committed
  revision the views show, direction, up to 8 picture attachments by role
  (`whole`, `close-up`, `front`, `side`, `back`, `source-sheet`,
  `reference`), and kind fields (painted `parts` to repaint, `height`,
  `protected` regions, and a trace brief's `intent`). A trace brief fits its
  named part unless its `intent` is `build`: then the map's regions become
  new parts. A brief without an intent, including every stored one, is a fit;
  only a trace brief may carry one. Pictures are staged first with `art.put`: chunks in
  order, then the project's blob checks (signature, digest, size) and a header
  read of the frame size (64 to 8192 px per edge). The host checks the
  revision, the parts and the attachments a kind needs, then sends the brief as
  a steering message to the agent's bound conversation. A turnaround's
  `source-sheet` attachments must be the sheet its parts paint from at the
  brief's revision. A repeated request ID with the same brief returns the same
  request (`art-<24 hex>`), and sends its steering message if the host stopped
  before writing it, unless the agent already answered the request (it found
  the brief in `art.list`): then nothing is sent again. The brief is compared
  as canonical JSON, so key order does not matter.
- **Producer.** The host launches no model, tool or process for art. The reply
  comes from the paired agent on a connection authenticated with the brief's
  pairing (`art.submit`), or from a person importing a file the agent could not
  make (`via: "person-import"`). Another agent, or an earlier pairing, sees
  `ArtMissing` or `Forbidden`; a revoked credential is `CredentialRejected`.
- **Reply.** `irudd.art-reply` version 1 by kind: document operations; a
  turnaround sheet (square within 2 %, at least 512 px); an
  `irudd.trace-map.v1` (outlines of 4 to 12 normalised points, unique IDs,
  parents present, no cycles); or a depth picture framed like the front view.
  The reply is kept exactly as submitted with the SHA-256 of its canonical
  JSON, and its files with their measured sizes.
- **Proposal.** A translator turns a valid reply into operations, and the host
  creates `prop-<art id>-<n>` on the brief's revision through the submitter's
  session, so the journal names the agent as author. The agent's submission
  acknowledges and links the steering message, which then follows the
  proposal: `proposed`, `applied` on acceptance, `proposal-discarded`.
  Variation replies are their own operations. Other kinds need a translator
  registered with `artTranslators` or `registerArtTranslator`; without one a
  valid reply is `recorded`, and `art.capabilities` says why and what to do.
  A translator may be asynchronous and reads any project blob's verified
  bytes (the reply's picture, the brief's attachments, the document's
  sheets). Its `check` refuses a brief whose target cannot take the reply
  when the person sends it, its `guidance` lines join the steering prompt,
  and the notes it returns (what the reply carried that its operations leave
  out) end the proposal's summary. A translator that cannot run now throws
  an `ArtError`: the call fails, nothing is recorded, and retrying the same
  submission translates it again. A trace translator names the intent it
  answers (absent: fit); the brief's intent picks the translator that checks
  the brief, guides the agent and translates the reply, and
  `art.capabilities` lists trace's `intents` with their own availability. The
  desktop's depth and trace fits and its trace build draw pictures with its
  review worker's canvas, so the packaged headless host records those
  replies.
- **Trace build.** The brief names one painted part, the anchor; the regions
  trace its sheet (all four views) at its standing height. A loft is a painted sweep, a volume a painted hull, a
  membrane a hull with its edge correspondence and a path a sweep along its
  spine. A part is placed relative to the anchor's own
  sheet point, so it registers with the anchor wherever the person moved
  it, and attaches under its parent region. A region named like an existing
  part (its ID, label or traced region) is that part: it stays as it is and
  its children attach to it. A region that cannot be traced, placed or held
  by the document is left out and its children attach to its nearest built
  ancestor; the summary names what was built, kept and left out, and a map
  with nothing to build is rejected with every reason. The proposal only adds
  parts.
- **Retries and duplicates.** The same submission ID with the same reply
  replays; with a different reply it is `RequestConflict`. A new submission ID
  carrying an earlier reply records `duplicateOf` and drafts nothing new. The
  proposal's journal request ID is `art.` and 40 hex digits of SHA-256 over
  the art ID, route, submitter and reply digest, so the same reply always
  makes the same commit, whatever submission ID carried it. Proposal numbers
  skip `prop-<art id>-<n>` IDs the journal already holds.
- **Restored backups.** A submission whose proposal is missing from the
  journal (no proposal with its ID and no receipt for its request ID) was lost
  when an older backup was restored. A new submission ID carrying that reply
  drafts it afresh instead of recording a duplicate; the same submission ID
  from the same submitter drafts it again under its recorded proposal and
  request IDs, unless another submission of that reply already has a live
  proposal. A discarded or accepted proposal is still in the journal, so a
  discarded reply is not proposed again.
- **Earlier hosts' proposals.** Art log version 1 hosts derived the journal
  request ID from the submission ID (`art.` and 40 hex digits of SHA-256 over
  the art ID and submission ID). Before drafting, the host looks that receipt
  up for the submission ID it was given and adopts its proposal when it is a
  `proposal.create` of `prop-<art id>-<n>` on the brief's revision, authored
  by the same caller, and no recorded or pending submission claims it. A
  retry under a different submission ID cannot be matched to such a proposal.
- **Recovery.** `art.sqlite`, the steering outbox and the project are
  separate files. A reply that becomes a proposal is first stored as pending
  with its request ID and proposal ID, then committed, then moved into the
  submissions in one transaction, then linked to the steering message. The
  next host start, or the next submission to the request, settles a pending
  reply from the journal receipt: committed, it becomes the proposed
  submission and is linked; otherwise it is dropped and the retry runs again.
  On start the host also links each open request's latest proposal that a
  stopped host left unlinked, and a replayed submission makes a missing link.
  `HostOptions.artCut` (tests only) stops a call at `request-stored`,
  `submission-pending`, `proposal-committed` or `submission-recorded`.
- **Credits.** A reply may carry `attribution` (`author`, `credit`,
  `license`, `source`: what the submitter states about who made the picture
  and its rights). An art proposal ends with `extension.set` of the
  document's `irudd.asset-credits` (`src/credits.ts` in `@irudd/document`):
  for each new picture its operations add, how it arrived (`paired-agent` or
  `person-import`), `submittedBy` (the submitting actor, not necessarily the
  maker), the art ID and kind, the summary and the stated attribution. A
  picture the brief's revision already declares, or one the build ships (form
  artwork and `HostOptions.shippedArtwork`), keeps its first credit. A
  credit lives as long as its asset: `asset.remove`, by hand or in a
  proposal, retires it in the reducer, and undoing the removal restores it.
  Entries an earlier build left for removed pictures never pass to bytes added
  again; an art proposal that writes the record compacts them. A record that
  cannot be read is never overwritten: a reply adding a picture is rejected
  with a diagnostic, while replies that add no picture still propose. A
  record holds at most 64 credits when written; readers accept more. Change
  paths address one credit as `["extensions", "irudd.asset-credits",
  digest]` when the record is in its written form (sorted by digest, valid
  entries, no other fields), so concurrent proposals that credit different
  pictures rebase cleanly, two that leave a credit in the same state agree,
  and two that credit one picture differently conflict at that credit.
  Whole-record changes stored by earlier builds still replay as written and
  apply credit by credit when the record moved on. A reply that writes the
  extension itself is rejected. Credits reach the head only when the person
  accepts, and then travel with the journal through `backup`,
  `restoreProject` and `exportArchive`. Pairing IDs, message IDs, routes,
  credential paths and the art direction stay in host state. An export puts
  a project picture's credit in `asset.extras.irudd.artwork` and a stated
  credit or licence in `asset.copyright`; bundled files keep their shipped
  origin.
- **Stale replies.** A reply that arrives after the head moved is still drafted
  on the brief's revision (`source.stale`). It is reviewable with `draft` and
  never replaces the head; accepting it is refused as `stale-revision` until it
  is refined against the head.
- **Invalid replies.** A reply of the wrong kind, a missing or misshapen picture,
  a translator failure or operations the reducer rejects are recorded as
  `rejected` with diagnostics, and nothing is proposed. A reply that fails the
  wire schema never reaches the service.
- **Cancellation.** `art.cancel` closes the request and withdraws an
  undelivered message; later replies fail with `ArtClosed`.
- **Storage.** Briefs and replies are in `art.sqlite` (`irudd.art-log`
  version 2; a version 1 log gains its `pending` table on open) beside the
  steering outbox, never in the project; pictures are project blobs.

## Using the storage entry directly

```ts
import { Effect } from "effect";
import { openProject } from "@irudd/workshop";

const program = Effect.gen(function* () {
  const project = yield* openProject({ path, registry });
  const person = yield* project.session({ actor: { kind: "human", id: "user" } });
  const result = yield* person.apply(envelopeWithoutActor);
  return result;
});
await Effect.runPromise(Effect.scoped(program));
```

A long-lived host keeps the scope open for as long as the window or service
runs, for example with `Effect.runFork` or a `Layer.scoped` that it owns.
