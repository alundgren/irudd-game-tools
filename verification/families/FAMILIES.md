# Character families

The document registry defines the shape of each family. The character builder reads its typed data and exports clay, full, game and portrait GLBs. Run the family tests after editing a builder or adding a starter.

## Adding a family

Register its versioned feature schema in `packages/document`. Validate references to parts, joints and assets when a document is read. Implement geometry in `packages/character`. Use the shared placement functions for both drawing and editing so a pick or a drag uses the same frame as the mesh.

Prepare a starter with `src/prepare.ts`. Its fixture declares each asset by digest. Store original artwork in the source form or the bundled artwork collection. Exported scenes include the artwork used by visible materials.

## Verification commands

- `pnpm check:fast` exercises document and builder behavior.
- `pnpm check:participating` compares participating fixtures to reference exports.
- `pnpm gate:g4a-families` checks all 245 exports from 60 forms, including saved outfits.
- `pnpm gate:packaged-samples --packaged <directory> --commit <sha>` checks exports through a packaged workshop.

Run these scripts in `verification/families`. Textured comparisons use the hardware GPU and the local reference cache. See the [reference setup](../baseline/README.md).
