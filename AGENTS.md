# Working on irudd-game-tools

## Working with a person in the desktop workshop

Use the workshop tools in the conversation the person paired. They connect to the project open in the desktop app. The person can keep sculpting while you work.

- Call `workshop_status` and `list_documents` to find the shared character. To create one, use `list_starters` and pass the chosen starter ID to `create_document`.
- When a steering message arrives, acknowledge it and read the person's changes since its cursor with `read_changes` and `by: "human"`. Read the current document before proposing an edit. Link your proposal or edit receipt to the steering message.
- For an artwork request, use `art_brief` to read the direction, target revision and attached images. Check `art_capabilities` for the kinds of replies the host can apply. Use the current conversation's image tools when available and return the result with `art_submit`. If the conversation lacks the required tool, the person can save the brief and import the result. [Artwork commands](docs/workshop-clients.md#ask-for-artwork)
- To judge the result, call `review_capabilities`, then `inspect_character` with the document ID, committed revision and export preset. It returns actual GLB renders plus geometry, texture and rig measurements. Use `review_image` for additional views. The person's camera stays available throughout.
- For a shell-based agent, the same project accepts CLI calls with the credential path issued for the pairing. In this checkout, start with `apps\cli\bin\irudd.cmd --help` on Windows. Pairing and command examples are in [the client guide](docs/workshop-clients.md).

## Developing the software

This repository houses tools for game creation. The first design study is in [the character creator research plan](docs/character-creator.html). Its experiments and proposed data contracts are open for testing. Record measured results separately from predictions.

Keep character recipes, generated assets and export formats distinct. Keep character assets and examples suitable for a public MIT project and record the origin and license of any contributed art. Use local validation. Before pushing documentation changes run `git diff --check HEAD`, check local links, and open the HTML at desktop and phone widths.

Keep explanations in documentation. Code must pass the repository-wide no-comments rule (`pnpm check:comments`). Preserve interpreter directives and required legal notices.

## Tests, documentation and distribution

- Budget a test against the regression it catches and the wall time it adds to developers' usual edit loop. Reuse existing coverage. For a costly check, record its cold and warm times, the failure it detects and when to run it. Keep focused checks fast. Run GPU comparisons, full-corpus checks, real-host exercises and installer rehearsals locally at their relevant gates.
- Write the README for a person deciding whether to install the app. Aim for one page with its purpose, installation instructions and one highlight image showing the workshop in use. A compact architecture diagram can extend it slightly. Put feature documentation in docs and agent instructions here.
- Use Scope's source-install and update model. An installer owns a per-user clone, builds a pinned main commit locally and keeps project data separate. Stage successful updates, then let the user restart. Failed and cancelled builds leave the running app usable. Keep the app and CLI on the same active build.
- Use zero GitHub Actions workflows and zero GitHub Releases. Developers run checks locally and installations update directly from Git.
- The [desktop dependency baseline](docs/desktop-dependencies.md) lists the intended direct dependencies. At port kickoff, refresh stable versions, verify the combination and record exact pins in the workspace catalog and lockfile. Use a frozen lockfile for installs and updates.

## Rendering

Use hardware GPU acceleration whenever a usable GPU is available. This applies to the live editor and player, headless and offline rendering during builds, and visual tests, screenshots and benchmarks. Use the platform’s hardware renderer without hard-coding a GPU vendor or model. Use software rendering only when hardware rendering is unavailable, and identify that fallback in the results.

For repeatable comparisons, fix the scene, seed, camera, lighting, resolution and animation time, and wait for assets to load. Allow small pixel differences across machines.

## Reference material

Keep practice rigs, source models, reference images and comparison sheets containing third-party material local, including intermediate copies in Git history. Document sources with links and record measurements in text. Use the ignored `.reference-cache/` directory for new practice material.

Give public characters and presets original names. Keep commercial game titles, franchise character names and fan-recreation links out of example labels, prompts and galleries. For assets licensed for redistribution, retain the upstream attribution and license, identify modifications where required, and ship the notices with the files.
