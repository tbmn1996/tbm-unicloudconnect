import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build-Artefakte, generierte Design-Templates und Subprojekte nicht linten.
    ignores: [
      "dist/**",
      "out/**",
      ".vite/**",
      "GUI Design/**",
      "transcription-worker/**",
    ],
  },
  {
    rules: {
      // Unbenutzte Variablen/Argumente sind Fehler, ausser bewusst mit _ markiert.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
);
