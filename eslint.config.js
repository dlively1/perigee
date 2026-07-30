import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "playwright-report/", "test-results/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      // Phaser's lifecycle guarantees presence for fields set in create().
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Determinism: gameplay code must route all randomness through the seeded
    // Rng (src/agent/rng.ts) so runs are reproducible per seed.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "Use the seeded Rng (src/agent/rng.ts) — gameplay must stay deterministic per seed.",
        },
      ],
    },
  },
);
