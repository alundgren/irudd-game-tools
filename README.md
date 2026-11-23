# irudd-game-tools

Open-source tools for making games. The first project explores how a game artist can steer and reroll individual features of a character, then use the same design as a 3D game asset and a 2D reference sheet.

## Character workshop

With Node.js 22 or later and npm installed, run `npm ci` and `npm run build`. Open `dist/character-view.html` directly in a WebGL 2 browser. The single file includes Three.js and the original procedural models and runs offline. Run `npm test` for the recipe checks.

Drag the model to orbit and scroll or pinch to zoom. Compare two characters on a metre grid, switch between three outfits, inspect their silhouettes, or reroll individual features. Undo applies to the selected character. Edits last for the current session.

The [character creator research plan](docs/character-creator.html) describes the staged 3D experiments and the later 2D reference-sheet study.

[MIT license](LICENSE).
