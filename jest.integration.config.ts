// Integration test config: runs the app's REAL Agent/services with REAL
// signify-ts against a REAL keria stack, headless in Node (no emulator).
// Separate from the jsdom unit config (jest.config.ts) — these tests require
// the docker keria stack up and are run via `npm run test:integration`.
export default {
  clearMocks: false,
  collectCoverage: false,
  // The app's keriaNotifications poll loops run for the app's lifetime;
  // stopPolling only pauses them, so the suite can't self-exit without this.
  forceExit: true,
  // Serial: one shared keria stack -> one ceremony at a time, no contention.
  maxWorkers: 1,
  moduleFileExtensions: [
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "tsx",
    "json",
    "node",
    "yaml",
  ],
  moduleNameMapper: {
    // The wdio harness helpers use ESM ".js" extensions on relative imports;
    // strip them so jest/ts-jest resolves the ".ts" sources.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
      "<rootDir>/src/ui/__mocks__/fileMock.ts",
    "\\.(css|scss)$": "<rootDir>/src/ui/__mocks__/styleMock.ts",
  },
  testEnvironment: "node",
  testMatch: ["**/tests/integration/**/*.itest.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/credential-server-ui/"],
  transformIgnorePatterns: [
    "node_modules/(?!(@ionic/react|@ionic/react-router|@ionic/core|@stencil/core|ionicons|swiper|ssr-window|@capgo/capacitor-native-biometric)/)",
  ],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
    "^.+\\.(js|jsx)$": "babel-jest",
    "\\.yaml$": "jest-transform-yaml",
  },
  // fake-indexeddb gives @ionic/storage's IndexedDB driver a backend in Node.
  setupFiles: ["fake-indexeddb/auto"],
  setupFilesAfterEnv: ["<rootDir>/tests/integration/jest.setup.ts"],
  testTimeout: 180000,
};
