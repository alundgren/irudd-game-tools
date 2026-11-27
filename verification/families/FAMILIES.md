# Character families

The document registry defines the shape of each family. The character builder reads its typed data and exports clay, full, game and portrait GLBs. Run the family tests after editing a builder or adding a starter.

## Adding a family

Register its versioned feature schema in `packages/document`. Validate references to parts, joints and assets when a document is read. Implement geometry in `packages/character`. Use the shared placement functions for both drawing and editing so a pick or a drag uses the same frame as the mesh.

## Starters

The desktop workshop ships the documents in `fixtures/` as its starters. Most are prepared from a source form in `examples/`: edit `examples/<name>.form.json`, then run `node --import ../../packages/document/test/support/register.ts src/prepare.ts <name>` and format the fixture. A fixture declares each asset by digest. Store original artwork in the source form or the bundled artwork collection. Starters without a source form are edited as documents.

## Verification

Run `pnpm check:fast` in `verification/families` to exercise document and builder behavior. It also checks that each starter with a source form matches a fresh preparation of that form.
