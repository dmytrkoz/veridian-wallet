// Minimal config for the webpack compat guard (eslint-webpack-plugin).
// Checks only ES feature compatibility against .browserslistrc;
// full linting stays in .eslintrc.json / the CI lint job.
// Error.cause is exempted: engines without it ignore the options
// argument silently, so it degrades gracefully instead of crashing.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  // Non-compat plugins are registered (with no rules enabled) only so
  // eslint-disable comments in source referencing their rules resolve.
  plugins: [
    "ecmascript-compat",
    "@typescript-eslint",
    "react",
    "react-hooks",
    "import",
  ],
  rules: {
    // Keep in sync with the ecmascript-compat/compat rule in .eslintrc.json.
    "ecmascript-compat/compat": ["error", { polyfills: ["Error.cause"] }],
  },
  ignorePatterns: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/__tests__/**",
    "**/__mocks__/**",
  ],
};
