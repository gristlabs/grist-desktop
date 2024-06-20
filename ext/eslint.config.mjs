import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


export default [
  {languageOptions: { globals: globals.browser }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "semi": ["warn", "always"],
      "eqeqeq": ["warn", "always"],
      "sort-imports": ["warn", {}],
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];
