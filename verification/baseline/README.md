# G0 baseline: the reference workshop at 2761eb14

These scripts freeze the behaviour of the current browser workshop so the desktop port can
be compared with it. They read the unmodified reference build and write everything they
produce to the ignored `.reference-cache/g0/`. [`baseline.json`](baseline.json) records the
frozen measurements as text: counts, hashes, suite results and variance envelopes.
Exported GLBs, captured frames and anything derived from private reference material stay in
the cache.

The reference tree is the current directory and the scripts can live elsewhere, so run them
from a clean checkout of `2761eb14` or a commit whose runtime files match it
(`git diff --stat 2761eb14 HEAD -- . ':!AGENTS.md' ':!docs' ':!verification'` prints nothing).
The port branch itself no longer matches once the workspace changes land.

```sh
git worktree add --detach ../g0-ref 2761eb14 && cd ../g0-ref && npm ci
G=<this checkout>/verification/baseline
node $G/run-g0.mjs                 # about 1 h 15 min on the gaming PC; --quick for a 5-minute smoke run
node $G/time-modules.mjs           # optional: each test module on its own, about 11 min on an idle machine
G0_DIR=$PWD/.reference-cache/g0 node $G/freeze.mjs   # rewrites $G/baseline.json from that cache
```

To recheck the checked-in record without a GPU run, use a clean clone of `2761eb14` with either
line-ending setting:

```sh
git clone --no-checkout <irudd-game-tools> g0-lf && cd g0-lf
git config core.autocrlf false && git checkout --detach 2761eb14 && npm ci
node $G/check.mjs --build          # about 15 s: inventory, workflows, seeded digest, build hashes
node $G/check.mjs --g0 <cache>     # also regenerates baseline.json from a cache and re-decodes frames
node $G/run-g0.mjs --quick --skip-suite && node $G/check.mjs --run .reference-cache/g0
node $G/eol.mjs <irudd-game-tools> <work dir> <out dir> --build   # LF and CRLF clones side by side
```

The quick run uses Chrome under the GPU lock and takes about 5 minutes. `eol.mjs` needs no
browser and takes about 2 minutes, most of it `npm ci` in each clone.

### Hashes

Each inventoried file has three identifiers. `sha256` hashes the working-tree bytes, so for
text it depends on `core.autocrlf`: the frozen values come from a CRLF (Windows default)
checkout, which [`eol.mjs`](eol.mjs) shows for 196 of the 230 files. `gitBlob` is the blob id
at `2761eb14` and `canonicalSha256` hashes the stored LF bytes; both agree in every clone.
`frozen.corpus.hashes.canonical` holds the same aggregates over canonical bytes, and
`frozen.lineEndings` the LF and CRLF results, including the build hashes of each.

Captures carry a file hash for the retained Chrome PNG and a decoded record
`[width, height, mode, pixel digest]`, where the digest hashes the pixels as 8-bit RGBA rows.
Re-encoding a frame with Pillow changes its file hash and keeps the decoded record, so the
port compares decoded records. `capture-*/pixels.json` decodes every repeat and names the
repeat that disagrees with the others.

### Private reference material

Some studies, a Forms link and `dist/rig-study.html` exist only where the ignored sets from
[local references](../../docs/local-references.md) are installed. To freeze them, install
the sets at their ignored paths in a scratch clone of `2761eb14`, then run
`node $G/references.mjs <cache>/references-private` there and `browser.py references` on its
`dist` and on the public build. Only ids, labels, statuses, credits and hashes reach
`baseline.json`; the exports and the private files stay local.

Browser steps need Python 3.12 with `playwright`, `Pillow` and `numpy`, and the installed
Google Chrome (`channel="chrome"`). On Windows they run under
[`gpu-lock.ps1`](gpu-lock.ps1), which shares the workshop's `Local\ShapeFirstWorkshopBrowser`
mutex so only one hardware browser job uses the GPU at a time. A software renderer stops the
run unless `--allow-software` is passed; the fallback is then recorded.

| Script | What it freezes | Output in `.reference-cache/g0/` |
| --- | --- | --- |
| [`inventory.mjs`](inventory.mjs) | Every tracked example form, GLB, fixture and test module with SHA-256, structure, editor acceptance, artwork and where the repo mentions it; dependency pins | `inventory.json` |
| [`glb.mjs`](glb.mjs) | Offline GLB structure, integrity checks and an encoding-independent content digest | used by the others |
| [`seeded.mjs`](seeded.mjs) | Seeded generator output for 7 kinds × 11 seeds and the `#adult=` route, twice | `seeded-*.json`, `seeded/` |
| [`run-suite.mjs`](run-suite.mjs) | `node --test` counts and wall time | `suite/*.json`, `suite/*.tap` |
| [`time-modules.mjs`](time-modules.mjs) | Wall time of each test module alone | `suite/modules.json` |
| [`workflows.mjs`](workflows.mjs) | Editor tabs, panels, buttons, URL routes, player presets, server endpoints, randomness entry points, and which test modules cover each review and agent flow | `workflows.json` |
| [`browser.py`](browser.py) | Fresh GLB exports at every preset through the editor's own controls; player captures at fixed camera presets; the offline AI tab and hybrid forms (`flows`); what reference material switches on (`references`) | `export-*/`, `capture-*/`, `flows/`, `references-*/` |
| [`compare.py`](compare.py) | Export and capture variance; tracked GLBs against fresh exports; decoded frames, re-encoding and frame rechecks | `export-variance.json`, `shipped-vs-fresh.json`, `capture-*/variance.json`, `capture-*/pixels.json`, `capture-*/reencode.json` |
| [`references.mjs`](references.mjs) | Installed private sets, their file hashes, the ids they expose, builds with and without them, the tests that need them | `references-private/references-config.json` |
| [`eol.mjs`](eol.mjs) | Inventory and build in an LF and a CRLF clone | `eol.json`, `eol-lf/`, `eol-crlf/` |
| [`run-g0.mjs`](run-g0.mjs) | All of the above in order except `eol.mjs` | `manifest.json` |
| [`check.mjs`](check.mjs) | Recheck of `baseline.json` against the pinned source, a cache or a fresh run | prints results |

## Conventions

- The editor session starts on the tracked `#study=ranger` route, whose `Loaded` status is
  the editor's own readiness point. Forms are opened with **Forms → Open form** and exported
  with **Export GLB** at each **GLB detail** preset, with **Include skeleton and motion clips**
  left on. Forms with saved outfits are also exported at Game detail with **Export all saved
  outfits as selectable scenes**.
- `creature-dispatch` and `creature-pelt` are bare forms without the `irudd.form.v1`
  envelope. The editor rejects them with “Choose a saved form.”, which is recorded; their
  exports come from a copy that differs only by that envelope.
- Player captures use a 1280 × 800 viewport at device scale factor 1 and screenshot the
  `#stage` element after two consecutive identical frames. Each GLB is captured at the
  rest pose from every camera preset the file supports, at 50 % of its first clip's timeline,
  with its first expression in portrait view and as an ink silhouette. The first clip is Idle
  everywhere, and many of those motion shots match the rest pose pixel for pixel.
- The offline AI tab runs without a workshop server, so no provider is called. **Generate**
  exports the request, and a local echo proposal answers it through **Import proposal**:
  the request's id and revision with an empty operations list. The same proposal answers the
  two refinement requests.
- File hashes identify the exact artifact inspected. Parity uses the content digest and
  decoded pixels, because PNG compression can change a file hash without changing content.

### Reference-sheet repaint

Run `gpu-lock.ps1 paint.py <built-2761eb14-checkout> <output-directory>` from this folder.
The runner opens Harbour Trader in the original workshop and answers its turnaround request
with the tracked Courier atlas. It compares the proposal, accepts it, saves and reopens the
form in another browser context. On Chrome 158 and the RTX 5070 Ti, only the selected body's
atlas binding changed. Its 78,290 bytes matched the saved artwork ID, and the entire form
was identical after reopening. The report includes the request and build identifiers.
The source of the image is fixed so this check exercises how the workshop applies paint.
