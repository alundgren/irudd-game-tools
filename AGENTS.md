# Working on irudd-game-tools

This repository houses tools for game creation. The first design study is in [the character creator research plan](docs/character-creator.html). Its experiments and proposed data contracts are open for testing. Record measured results separately from predictions.

Keep character recipes, generated assets and export formats distinct. Keep character assets and examples suitable for a public MIT project and record the origin and license of any contributed art. Use local validation. Before pushing documentation changes run `git diff --check HEAD`, check local links, and open the HTML at desktop and phone widths. GitHub Actions are reserved for releases.

## Rendering

Use hardware GPU acceleration whenever a usable GPU is available. This applies to the live editor and player, headless and offline rendering during builds, and visual tests, screenshots and benchmarks. Use the platform’s hardware renderer without hard-coding a GPU vendor or model. Use software rendering only when hardware rendering is unavailable, and identify that fallback in the results.

For repeatable comparisons, fix the scene, seed, camera, lighting, resolution and animation time, and wait for assets to load. Allow small pixel differences across machines.

## Reference material

Keep practice rigs, source models, reference images and comparison sheets containing third-party material local, including intermediate copies in Git history. Document sources with links and record measurements in text. Use the ignored `.reference-cache/` directory for new practice material.
