// Minimal config for the webpack compat guard (eslint-webpack-plugin).
// Checks only ES feature compatibility against .browserslistrc;
// full linting stays in .eslintrc.json / the CI lint job.
// Error.cause is exempted: engines without it ignore the options
// argument silently, so it degrades gracefully instead of crashing.
const path = require("path");

module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
    // Type info is required for es-x prototype-method rules (e.g.
    // no-array-prototype-at) to fire: without it, `arr.at()` on a typed
    // array is not recognised and the guard silently misses it.
    // Absolute paths (not "./tsconfig.json") because eslint-webpack-plugin
    // runs ESLint with a cwd that may differ from the repo root; a relative
    // project path would fail to resolve there and silently disable the
    // type-aware rules, letting violations through the build.
    project: [path.join(__dirname, "tsconfig.json")],
    tsconfigRootDir: __dirname,
  },
  // eslint-plugin-es-x rules are activated from .browserslistrc via this
  // shared config. The "builtins" variant checks only runtime builtins
  // (e.g. Array.prototype.at, Object.hasOwn) that white-screen old engines
  // and cannot be transpiled away — modern syntax is down-levelled by
  // ts-loader/webpack, so linting it here only yields false positives
  // (e.g. top-level await, which MDN marks partial for Safari).
  extends: ["@automattic/eslint-config-target-es/rc/builtins"],
  // Non-compat plugins are registered (with no rules enabled) only so
  // eslint-disable comments in source referencing their rules resolve.
  plugins: [
    "@typescript-eslint",
    "react",
    "react-hooks",
    "import",
  ],
  rules: {
    // Keep in sync with the es-x exemptions in .eslintrc.json.
    "es-x/no-error-cause": "off",
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
