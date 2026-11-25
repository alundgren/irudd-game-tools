# Local reference material

The workshop is compared with other people's rigs, scans and avatars. Those source files stay on the machine that downloaded them. So do the fits measured from them and every picture that shows a reference beside the workshop's result. Git ignores all of it.

The repository holds the code that makes the comparisons, the source addresses, the licences and attributions, and the measured numbers.

## What a fresh checkout does

`npm ci`, `npm run build` and `npm test` need none of the reference material. The build prints which reference studies it found. With none:

- The workshop's study list has no scan studies, no measured torso and no 3D reference fits.
- **Fit a 3D reference…** still opens. Its model list is empty, and **Choose a GLB file…** loads a model from your disk for the session.
- **Compare the editable torso with a rigged 3D reference** is left out of the Forms tab, and `dist/rig-study.html` is not built.
- One test that reopens the saved torso fit is skipped.
- Documents state their numbers in text. Comparison pictures appear only where the picture file exists.

The adult body, face, hair and clothing data in `character-view/human-*.json` are a separate matter. They come from CC0 MakeHuman assets, are part of the workshop and are tracked. [Their licence and origin](licenses/makehuman-cc0.md)

## What is installed here

```text
npm run references
```

lists every optional set, whether its files are present and the commands that rebuild it. To build and test a full local copy as a fresh checkout would, without moving any files:

```text
WORKSHOP_REFERENCES=none npm run build
WORKSHOP_REFERENCES=none npm test
```

In PowerShell, set `$env:WORKSHOP_REFERENCES = "none"` first. Build again without the variable to bring the reference studies back.

## The optional sets

Each file belongs at the path shown. The workshop looks for it there and nowhere else.

| Set | Local files | Switches on | Source |
| --- | --- | --- | --- |
| Momentum Human Rig, rest pose | `examples/mhr-reference.glb`, `examples/mhr-fit.json` | The rig comparison page, the measured torso study, the rest-pose entry under **Fit a 3D reference…** | [MHR v1.0.1](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1), Apache-2.0 |
| Six MHR benchmark bodies | `examples/human-targets/` | Six benchmark adults under **Fit a 3D reference…**, and the benchmark scripts | MHR v1.0.1, Apache-2.0 |
| Benchmark fits and pictures | `examples/human-targets-fits/`, `docs/media/human-benchmark/` | Result tables and comparison sheets for [the benchmark](human-benchmark.md) | Measured from the six bodies |
| Workshop fits to the six bodies | `examples/workshop-body-fits.json`, `docs/media/workshop-body-fits.webp` | Six editable-fit studies, the comparison sheet in [the avatar notes](adult-surface.md) | Measured from the six bodies |
| Scan preview studies | `examples/reference-fits.json`, `docs/media/scan-study-*.webp` | Six body scan studies, the figures in [the scan study page](body-scan-studies.html) | Vendor pages listed in [`examples/body-references.json`](../examples/body-references.json) |
| Scanned head fits | `examples/head-targets-fits/`, `docs/media/head-study/` | The editable head study | Scans listed in [`scripts/head-study/hs_targets.py`](../scripts/head-study/hs_targets.py) |
| Blender Studio profile comparison | `docs/media/humanoid-reference-profiles.webp` | One figure in [the research plan](character-creator.html#humanoid-reference) | [Human Base Meshes v1.4.1](https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip), CC0 |
| Rocketbox dressed avatars | `.reference-cache/rocketbox/` | A separate comparison page, `dist/rocketbox-study.html` | [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox), MIT |

Downloads, intermediate files and scratch renders go in `.reference-cache/`, which is also ignored.

## Rebuilding a set

The commands run from the repository root after `npm ci`. The Python steps need Python 3.12 with `numpy`, `scipy`, `moderngl`, `opencv-python`, `pillow`, `requests` and `torch`. The rest-pose rig needs Blender.

**MHR archive.** Both MHR sets start from the release's `assets.zip`.

```text
node scripts/local-references.mjs --fetch
```

downloads it to `.reference-cache/mhr/assets.zip` and checks SHA-256 `e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94`. A file that is already there is checked and kept.

**Rest-pose rig and torso fit.** Extract `assets/lod1.fbx` from the archive into `.reference-cache/mhr/`.

```text
blender -b --factory-startup --python-exit-code 1 --python scripts/export-mhr-reference.py -- .reference-cache/mhr/lod1.fbx examples/mhr-reference.glb
node scripts/fit-rig-surface.mjs
npm run build
```

[What the comparison measures](mhr-reference.md)

**Six benchmark bodies.**

```text
python scripts/human-benchmark/build-targets.py .reference-cache/mhr
```

The script reads the six identities, proportions and poses from the tracked [`target-identities.json`](../scripts/human-benchmark/target-identities.json) and writes the meshes and `examples/human-targets/manifest.json`. The manifest records the hashes of the meshes built on this machine. Another processor or torch build can differ in the last bits of a coordinate, so hashes are compared locally. `--select` repeats the seeded draw and the pose solve and rewrites the identities file.

**Benchmark fits and pictures.** About 25 minutes on 16 cores.

```text
python scripts/human-benchmark/run.py .reference-cache/human-benchmark
python scripts/human-benchmark/report.py .reference-cache/human-benchmark
python scripts/human-benchmark/tables.py
```

**Workshop fits to the six bodies.** Needs Chrome, Playwright for Python and a running workshop.

```text
npm start
python scripts/check-workshop-fits.py .reference-cache/ui-fit --workshop http://127.0.0.1:4179
```

**Scan preview studies.** The script downloads the vendor's preview images into the cache folder and fits the figure to them.

```text
python scripts/body-fidelity.py .reference-cache/body-scans --fit
```

Copy `.reference-cache/body-scans/reference-fits.json` to `examples/reference-fits.json` to list the six studies in the workshop. No script in the repository writes the clay comparison sheets `docs/media/scan-study-*.webp` or `docs/media/humanoid-reference-profiles.webp`. Keep the existing files.

**Scanned head fits.** `--install` copies the fits from the cache to `examples/head-targets-fits/`.

```text
python scripts/head-study/prepare-targets.py .reference-cache/head-study
python scripts/head-study/run.py .reference-cache/head-study --install
```

**Rocketbox dressed avatars.** `node scripts/rocketbox-study/fetch.mjs` downloads the pinned source files and prints the two Blender conversion lines. The two fitted recipes in `.reference-cache/rocketbox/studies.js` were made on one machine and have to be copied from it. Then run `node scripts/rocketbox-study/build.mjs`.

## Adding a comparison

- Put source files, fits derived from them and any picture that shows the source under a path `.gitignore` already covers, or add the path there first.
- Read optional data through [`examples/local-references.js`](../examples/local-references.js). A study, test or page that needs it leaves itself out when the value is empty. A static `import` of an ignored file breaks the public build.
- In a tracked Markdown document, name a local file as inline code. In a tracked HTML document, give a picture, or a block that depends on one, the attribute `data-local="media/the-picture.webp"`. The page shows it when that picture loads. Copy the one style rule and the short script from [the scan study page](body-scan-studies.html).
- Record the source address, licence, attribution and the measured numbers in the tracked document.
