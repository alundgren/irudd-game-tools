# Export reference data

The family comparison tests use the browser workshop at commit `2761eb14` as their reference. [baseline.json](baseline.json) identifies the expected inputs and outputs by digest. Generated files belong in the ignored `.reference-cache/g0` directory.

To recreate the reference data, set `G` to the absolute path of this directory. In a clean worktree of the reference commit, run:

```sh
npm ci
node "$G/run-g0.mjs"
node "$G/check.mjs" --g0 .reference-cache/g0
```

Set `G0_DIR` to that cache when running the character family comparisons. Use `node "$G/check.mjs" --build` to check the reference build without a GPU capture. Private source models and captured frames stay local.
