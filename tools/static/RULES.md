# Source and bundle checks

Run `pnpm check` from the repository root. It checks code comments, formatting, lint, TypeScript programs, workspace dependencies and import boundaries. [policy.ts](policy.ts) declares the programs, allowed imports and scoped exceptions. Run `pnpm check:fixtures` when changing a rule.

The document package and workshop wire contract must run in a renderer without Node globals. Storage is owned by the project host. The renderer reaches the host through a validated preload bridge. Desktop windows use sandboxing, context isolation and web security with Node integration disabled.

Run `pnpm check:bundles` after building the desktop and offline player. The checker reads the generated module inventories and compares the preload API against [desktop-contract.ts](desktop-contract.ts). The packaging script also checks the CLI, MCP server, host and updater bundles before it assembles the application.
