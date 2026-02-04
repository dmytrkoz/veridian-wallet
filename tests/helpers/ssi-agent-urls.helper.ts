const BOOT_PORT = 3903;
const CONNECT_PORT = 3901;

const ANDROID_EMULATOR_HOST = "10.0.2.2";

/**
 * Get KERIA URLs for the **test runner** (Node.js on the host).
 * Use this for RemoteInitiator and any code that runs in the WDIO process.
 * Never uses 10.0.2.2 (that is only for the app inside the emulator to reach the host).
 * Uses 127.0.0.1 or KERIA_IP when set to a host-reachable IP (e.g. for physical devices).
 */
export function getKeriaUrlsForTestRunner(): { bootUrl: string; connectUrl: string } {
  const envHost = process.env.KERIA_IP || "127.0.0.1";
  const host = envHost === ANDROID_EMULATOR_HOST ? "127.0.0.1" : envHost;
  return {
    bootUrl: `http://${host}:${BOOT_PORT}`,
    connectUrl: `http://${host}:${CONNECT_PORT}`,
  };
}

/**
 * Get SSI Agent URLs for the **app** (device/emulator).
 * For Android emulator, uses 10.0.2.2 so the app can reach the host's KERIA.
 * Can be overridden with KERIA_IP (for iOS or physical devices).
 */
export function getSSIAgentUrls(): { bootUrl: string; connectUrl: string } {
  const DEFAULT_HOST = "127.0.0.1";

  const isAndroidEmulator = (() => {
    const args = process.argv.join(' ');
    if (args.includes('wdio.emu.android') || args.includes('wdio.android')) {
      return true;
    }

    const npmScript = process.env.npm_lifecycle_script || '';
    if (npmScript.includes('android')) {
      return true;
    }

    if (process.env.ANDROID_EMULATOR === 'true') {
      return true;
    }

    if (!process.env.KERIA_IP) {
      return true;
    }

    return false;
  })();

  const keriaIP = process.env.KERIA_IP;
  const host = isAndroidEmulator
    ? ANDROID_EMULATOR_HOST
    : (keriaIP || DEFAULT_HOST);

  return {
    bootUrl: `http://${host}:${BOOT_PORT}`,
    connectUrl: `http://${host}:${CONNECT_PORT}`,
  };
}
