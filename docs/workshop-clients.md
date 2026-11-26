# Command line and MCP agents

One process owns a workshop project at a time. That owner is either the desktop app or `irudd host`. The `irudd` command line and MCP agents connect to that owner, so a person and an agent always work on the same open project. Neither ever opens the project file itself. The interface is specified in the [workshop contract](../packages/workshop/CONTRACT.md#hosting-and-clients).

In a source checkout, run `apps\cli\bin\irudd.cmd` on Windows or `apps/cli/bin/irudd` elsewhere. Put that `bin` directory on `PATH` to type `irudd`.

## Serve a project

```
irudd host "D:\Characters\Marsh" --create --label "Marsh"
```

The host runs until Ctrl+C. The installed host offers the same seeded adult, frame creature and prepared forms as the desktop window. Use `--forms <dir>` to choose your own directory of `irudd.character` starters, including when running from source. If the desktop app already has the project open, it owns the project.

## Work as a person

Name the project once with `--project <dir>` or `IRUDD_PROJECT`. Then:

```
irudd status
irudd starters
irudd new doc-marsh01 --preset grazer
irudd new doc-walker7 --seed 7
irudd show doc-marsh01
irudd rename doc-marsh01 p-head Skull --base 1
irudd steer doc-marsh01 --base head --set tail.length=1.2
irudd proposals doc-marsh01
irudd preview doc-marsh01 prop-tail
irudd accept doc-marsh01 prop-tail --base 2
irudd reject doc-marsh01 prop-legs
irudd watch
```

- **Starters.** `frame-creature` is the protocol's reference generator, not a character family. Character families start from prepared forms or from `irudd new <id> --from form.json`.
- **Writes.** Every write takes `--base`: the revision you prepared it against, or `head`. If someone else changed the document first, the write is rejected and nothing is written. `irudd changes <doc> --since <rev>` shows what changed.
- **Retries.** Every write prints its request ID. Re-running with `--request-id <id>` is safe, and `irudd receipt <doc> <id>` checks a request without resending it.
- **Exit codes.** 0 ok, 2 usage, 3 no host or credential, 4 rejected, 5 host error.
- **Reference.** `irudd help` lists every command, and `irudd <command> --help` explains its options.

## Save and open characters

A character file (`.irudd-character`) holds an editable character: its
document, its whole history with undo, and every picture it uses. In the
desktop, choose **Save character…** next to the character list, and in
another project choose **Open character…**. From a shell:

```powershell
irudd save doc-marsh01 D:\characters --project D:\studio
irudd open "D:\characters\Marsh walker.irudd-character" --project D:\fresh
```

Opening works offline and checks the whole file before it writes anything.
Missing or altered pictures, a pose or paint layer that names something
absent, a feature this build lacks or a catalog that is not installed is
refused, and every problem is listed. The CLI exits with 4. The file is a
ZIP with `manifest.json`, `document.json`, `history.jsonl` and `assets/`;
the [service contract](../packages/workshop/CONTRACT.md#portable-characters)
describes it. JSON document archives from earlier builds open the same way.

## Connect an agent

```
irudd pair claude --name Claude
```

This prints a private credential path and the MCP server command, a stdio server:

```
irudd mcp --credential "<path printed by pair>"
```

What an agent can do:

- **Identity.** The host stamps the paired identity on everything the agent does.
- **Tools.** The agent reads documents and their changes, including a person's manual edits (`read_changes` with `by: "human"`), creates documents and drafts proposals.
- **Editing.** It edits directly only on documents where a person ran `irudd policy <doc> --agent-direct-edit on`.
- **Person-only actions.** No tool accepts proposals, changes policy or pairs agents.

`irudd pairs` lists paired agents. `irudd unpair claude` revokes one; its next connection is refused.

## Inspect an exported character

With the desktop open on your project, this example creates an editable reef cartographer and inspects its first revision. For an existing character, use its document ID and revision in the inspection command.

```
irudd review
irudd new doc-reef01 --starter reef-cartographer
irudd inspect doc-reef01 --revision 1 --preset game --sheet body --sheet motion --size 600x450 --pixel-ratio 2 --out review-reef
```

The output directory contains the GLB, 1200 × 900 PNGs, and a manifest with camera settings, the renderer, document revision, file hashes, triangle count, texture inventory, joints and clips. Each image comes from the exported model. You can orbit or edit the character in the desktop window while the inspection runs.

In a paired MCP session, use `inspect_character` for the manifest and the first images. Use `review_image` with a remaining image's SHA-256 to see it in the same conversation.

## Steer an agent

Bind a paired agent to the conversation it is already in, then send it instructions:

```
irudd route claude --inbox agent
irudd send claude "Build on my jaw edit" --doc doc-marsh01
```

The agent acknowledges each message with its own credential and links the edit or proposal it made. A proposal counts as applied only when you accept it. Routes, delivery states and per-host limits are in [workshop-steering.md](workshop-steering.md).

## Ask for artwork

The person sends a typed brief to the paired agent's conversation. The workshop never generates artwork or starts a model: the agent makes the picture, trace or operations with its own tools and answers in the same conversation.

```
irudd art request doc-marsh01 --agent claude --kind turnaround --part p-body --attach whole=view.png --attach source-sheet=sheet.png --direction "Weathered oilskin, same cut"
irudd art list
irudd art show <art-id> --out brief-dir
irudd art submit <art-id> --image sheet.png --summary "Oilskin repaint" --credential "<path printed by pair>"
irudd art cancel <art-id>
```

- **Kinds.** `variation` (document operations), `turnaround` (a square 2x2 sheet that repaints the named painted regions), `trace` (an `irudd.trace-map.v1`) and `depth` (a front depth picture). `irudd art capabilities` says which kinds this host turns into proposals. Both the desktop and the packaged headless host turn a returned sheet into a repaint proposal.
- **Trace and depth fits.** A trace or depth brief names one painted part (`--part`) and attaches that part's sheet as its front and left-facing profile panels; the desktop's art panel adds them with **Add sheet views**. When the desktop owns the project, a depth picture becomes the portrait's fitted depth field, and a trace map's region for the part (named by its ID) calibrates its face from `faceLandmarks` and adds `depthPairs` as depth pins, at most 24. Depth needs a traced face with calibrated landmarks; trace needs a painted head made of cross sections. Other parts are refused when the brief is sent. The proposal's summary names the regions and outlines a fit did not build. The packaged headless host has no canvas to draw the pictures with, so it checks and stores trace and depth replies without proposing them.
- **Build parts from a trace.** Choose **Build new parts from the map** under Trace in the art panel, or `irudd art request … --kind trace --intent build --part <painted part>`, to have the agent's trace map add parts instead of fitting one. The regions trace the chosen part's sheet: a `loft` becomes a painted swept part, a `volume` a painted solid, a `membrane` a thin painted sheet and a `path` a swept part along its spine. Each new part attaches to its parent region and lines up with the chosen part as they lie on the sheet. Name a region like an existing part to attach children to that part; it stays as it is. The proposal only adds parts. Its summary names what was built, what was kept and what could not be built and why; a map with nothing to build is refused. `irudd art capabilities` lists both trace intents. As with fits, only the desktop builds; the headless host records the map.
- **Replies.** Over MCP the agent uses `art_requests`, `art_brief` (the attached views arrive as images) and `art_submit`. A valid reply becomes the agent's proposal on the brief's revision. Review it with `proposals`, `preview`, `accept`, `reject` and `undo`. A reply that arrives after you edited the character stays a proposal and leaves your edit in place.
- **No image tool.** When the agent cannot make a picture, save the brief with `art show --out`, make the file elsewhere and import it with `irudd art submit <art-id> --image <file> --summary "…"` as yourself.
- **Source sheet.** A turnaround's `source-sheet` attachment must be the sheet the chosen regions paint from at the brief's revision; any other picture is refused before the brief is sent.
- **Credits.** Say who made a picture and its rights with `--author`, `--credit`, `--license` and `--source` on `art submit`, or `attribution` on MCP `art_submit`. Submitting a file is not authorship, so name the maker when you know it. When you accept the proposal, the character records how each new picture arrived, who submitted it and what was stated. Backups, restored projects and document archives keep that record, and exports add it to the GLB, with any stated credit or licence in its copyright. A picture already in the character, or one the build ships, keeps its original credit. Removing a picture removes its credit, and undoing the removal brings it back; adding the same bytes later records them as new. Two proposals that add different pictures keep both credits when one is rebased on the other. Pairings, messages, routes, credential paths and your art direction are never part of it.
- **Interrupted replies.** If the host stops while a reply is being drafted, its next start finishes or discards that reply using the project journal. Retrying the same reply, even with a new submission ID, never drafts a second proposal. Retrying `art request` with the same request ID sends a brief whose message was never written, unless the agent already answered it; nothing is sent when the host starts. The desktop shows such a brief as saved but not sent, with a button that sends it as the same request. After restoring an older backup, retrying a reply whose proposal the backup lost drafts it again; a proposal that still exists, or that you discarded, is not drafted twice.

## Limits

- **Same-account access.** Credentials are private to your OS account, but any program running as you can read them.
- **Restarts.** Between runs the host keeps pairings and the steering outbox (routes, messages, cursors). After it restarts, a connected MCP server reconnects on its next tool call, and a channel server re-watches its inbox.
