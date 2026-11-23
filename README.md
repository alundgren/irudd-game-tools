# irudd-game-tools

Open-source tools for making games. The first project explores how a game artist can steer and reroll individual features of a character, then use the same design as a 3D game asset and a 2D reference sheet.

## Character workshop

With Node.js 22 or later, run `npm ci` and `npm start`. Open the localhost URL printed by the workshop. **Generate variation** uses your installed, signed-in Codex CLI when clicked. For offline use, run `npm run build` and open `dist/character-view.html` directly in a WebGL 2 browser. The offline view can export its AI request and load an agent’s JSON response. Run `npm test` for local checks.

One form is active at a time. Start fresh, or open an editable [reference study](docs/creator-benchmarks.md) from **Forms**. Select a part, preview a relative adjustment and apply it. Neutral controls mean zero additional change. AI direction combines the current form, proposed nudges and written steering. Inspect the candidate, toggle back to the current shape, then accept or discard. Accepted forms can be saved as JSON and exported as GLB. The editor keeps the current form in browser storage when available.

[Research plan and later 2D reference-sheet study](docs/character-creator.html) · [Credited character-creator benchmarks](docs/creator-benchmarks.md)

Geometry and examples are original procedural work. The face, fabric, jacket and four-view turnaround artwork was generated specifically for this project with the OpenAI image generation tool and is distributed with the project under MIT. Source examples from commercial games are linked for study. The three painted volumes are editable lofts reconstructed from separate front and profile outlines with a four-view texture bake. **Forms → Trace a volume** also accepts your own turnaround. Imported art travels with the saved form. Three.js supplies rendering and GLB export under MIT.

[MIT license](LICENSE).
