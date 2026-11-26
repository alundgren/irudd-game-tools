import { defineConfig } from "vite-plus";

// Frozen legacy sources stay outside format and lint coverage until their family moves
// into packages/ or apps/. Remove an entry when its family is ported.
const legacy = [
  "character-view/**",
  "scripts/**",
  "examples/**",
  "docs/**",
  "dist/**",
  "verification/baseline/**",
];

// Files owned by other tools.
const generated = [
  "pnpm-lock.yaml",
  "**/node_modules/**",
  "apps/player/dist/**",
  "apps/desktop/dist/**",
  "apps/desktop/qa/dist/**",
];

// Human prose keeps its hand formatting.
const prose = ["README.md", "AGENTS.md", "LICENSE"];

export default defineConfig({
  fmt: {
    ignorePatterns: [...legacy, ...generated, ...prose],
  },
  lint: {
    ignorePatterns: [...legacy, ...generated],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    categories: { correctness: "error" },
    // typeAware runs oxlint-tsgolint for the no-unsafe-* rules. tsc 7.0.2 stays the type checker;
    // typeCheck stays off so lint never reports compiler diagnostics of its own.
    options: { reportUnusedDisableDirectives: "error", typeAware: true },
    rules: {
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 10,
        },
      ],
      // Only `as const` is allowed. Narrow with a type guard or schema decode instead.
      "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      // Module specifiers must be literal so the dependency graph sees every edge.
      "import/no-dynamic-require": ["error", { esmodule: true }],
      // Flag unsafe uses that the type-aware rules identify at the expression site.
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-argument": "error",
      // Libraries and declarations come from tsconfig lib/types and imports, never directives.
      "typescript/triple-slash-reference": [
        "error",
        { lib: "never", path: "never", types: "never" },
      ],
      // Module loading that bypasses import statements and so the dependency graph.
      "no-restricted-properties": [
        "error",
        ...["getBuiltinModule", "binding", "_linkedBinding", "dlopen"].map((property) => ({
          property,
          message: "Import the module statically so the dependency graph sees the edge.",
        })),
      ],
      // node:test registers top-level tests through returned promises it awaits itself.
      "typescript/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe", "suite"] },
          ],
        },
      ],
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
    },
  },
});
