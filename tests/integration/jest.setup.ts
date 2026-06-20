// Shims that let the app's core run headless in Node. The unit suite
// (src/core/agent/agent.test.ts) mocks these same seams; here we provide
// working in-memory/Node stand-ins instead so the real code paths run.

// SecureStorage normally wraps a native Capacitor plugin. Replace it with an
// in-memory store so the bran (and any other secrets) work in Node.
jest.mock("../../src/core/storage/secureStorage/secureStorage", () => {
  const store = new Map<string, string>();
  // Reuse the real KeyStoreKeys enum so the keys can't drift from the source.
  // Safe to requireActual: the module's only native import (@evva plugin) goes
  // through @capacitor/core's registerPlugin, which is mocked to {} below.
  const { KeyStoreKeys } = jest.requireActual(
    "../../src/core/storage/secureStorage/secureStorage"
  );
  const SecureStorage = {
    KEY_NOT_FOUND_ERRORS: ["Item with given key does not exist"],
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    wipe: jest.fn(async () => {
      store.clear();
    }),
  };
  return { SecureStorage, KeyStoreKeys };
});

// Capacitor's native bridge isn't present in Node. isNativePlatform() === false
// makes the Agent select IonicSession (IndexedDB, backed by fake-indexeddb).
jest.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => "web",
    isPluginAvailable: () => false,
  },
  registerPlugin: () => ({}),
  WebPlugin: class {},
}));

// Cardano peer-connection pulls browser/native-only deps and is irrelevant to
// the multisig flow under test (mirrors agent.test.ts).
jest.mock("../../src/core/cardano/walletConnect/peerConnection", () => ({
  PeerConnection: { peerConnection: { start: jest.fn(), getConnectedDApp: jest.fn() } },
}));
