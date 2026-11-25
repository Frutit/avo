import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig([
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "../app/*", "../../app/*"],
              message: "Shared lib modules must not import app routes.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", ".react-router/**", ".wrangler/**", "build/**", "coverage/**"]),
]);
