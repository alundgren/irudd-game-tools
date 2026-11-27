import { defineConfig } from "vite-plus";

const legacy = ["character-view/**", "scripts/**", "examples/**", "docs/**", "dist/**"];

const generated = [
  "pnpm-lock.yaml",
  "**/node_modules/**",
  "apps/player/dist/**",
  "apps/desktop/dist/**",
  "apps/desktop/qa/dist/**",
];

const prose = ["README.md", "AGENTS.md", "LICENSE"];

export default defineConfig({
  fmt: {
    ignorePatterns: [...legacy, ...generated, ...prose],
  },
  lint: {
    ignorePatterns: [...legacy, ...generated],
    plugins: ["eslint", "typescript", "unicorn", "oxc", "import"],
    categories: { correctness: "error" },
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
      "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "import/no-dynamic-require": ["error", { esmodule: true }],
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-argument": "error",
      "typescript/triple-slash-reference": [
        "error",
        { lib: "never", path: "never", types: "never" },
      ],
      "no-restricted-properties": [
        "error",
        ...["getBuiltinModule", "binding", "_linkedBinding", "dlopen"].map((property) => ({
          property,
          message: "Import the module statically so the dependency graph sees the edge.",
        })),
      ],
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
