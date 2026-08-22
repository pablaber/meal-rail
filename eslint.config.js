import eslint from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";

const COLOR_LITERAL =
  /#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})\b|\b(?:rgb|hsl)a?\(/i;
const PALETTE_UTILITY =
  /^(?:[\w-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?$/;
const ALLOWED_PALETTE_UTILITIES = new Set([
  "focus-visible:ring-white",
  "focus-within:ring-white",
]);

const themeColors = {
  rules: {
    "no-component-colors": {
      meta: {
        type: "problem",
        docs: {
          description: "Keep component colors in src/theme.js",
        },
        messages: {
          literal: "Move color literals to src/theme.js.",
          utility: "Use a value from src/theme.js instead of '{{utility}}'.",
        },
        schema: [],
      },
      create(context) {
        const check = (node, value) => {
          if (COLOR_LITERAL.test(value)) {
            context.report({ node, messageId: "literal" });
          }

          for (const utility of value.split(/\s+/)) {
            if (
              PALETTE_UTILITY.test(utility) &&
              !ALLOWED_PALETTE_UTILITIES.has(utility)
            ) {
              context.report({
                node,
                messageId: "utility",
                data: { utility },
              });
            }
          }
        };

        return {
          Literal(node) {
            if (typeof node.value === "string") check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.raw);
          },
        };
      },
    },
  },
};

export default [
  {
    ignores: ["dist/**"],
  },
  eslint.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        __BUILD_ID__: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    plugins: {
      react,
      "theme-colors": themeColors,
    },
    rules: {
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
      "react/jsx-uses-vars": "error",
      // Core `no-undef` does not read JSX element names, so a component that
      // moved to another file and was never imported back is invisible to it —
      // the build succeeds and the screen white-screens on the first render
      // that reaches it. That is exactly how `IconPlus` left `App.jsx`.
      "react/jsx-no-undef": "error",
      "theme-colors/no-component-colors": "error",
    },
  },
  {
    files: ["src/theme.js"],
    rules: {
      "theme-colors/no-component-colors": "off",
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    files: ["vite.config.js", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
];
