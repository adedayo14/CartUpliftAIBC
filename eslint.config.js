// ESLint flat config for Cart Uplift (ESLint v9)
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  // Ignore patterns (replaces .eslintignore)
  {
    ignores: [
      "build/**",
      "public/build/**",
      "node_modules/**",
      // Ignore theme extension code (separate linting style and legacy patterns)
      "extensions/**",
      // Misc large/binary bundles
      "cartuplift-main.bundle",
      // Generated local history and Shopify dev bundles
      ".history/**",
      ".shopify/**",
    ],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        shopify: "readonly",
      },
    },
    settings: {
      react: { version: "detect" },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // Base recommended rules
      ...js.configs.recommended.rules,
      // React + hooks
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // TypeScript (no type-checking to keep it fast and simple)
      ...tseslint.configs.recommended.rules,

      // Project-specific noise control
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unescaped-entities": "off",
      "no-undef": "off",
      "no-empty": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      // Allow underscore-prefixed args/vars to be unused without error
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Node scripts: allow CommonJS requires and shebangs without noise
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "script",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: [
      "scripts/ml-seed-orders.js",
      "scripts/bulk-inventory-increase.js",
    ],
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "script" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Disable formatting-related rules to let Prettier handle formatting
  prettier,
];
