import { randomPasscode } from "signify-ts";
import { Agent } from "../../src/core/agent/agent";
import {
  SecureStorage,
  KeyStoreKeys,
} from "../../src/core/storage/secureStorage/secureStorage";
import { getKeriaUrlsForTestRunner } from "../helpers/ssi-agent-urls.helper";
import { KERIA_REACHABLE_TIMEOUT_MS } from "./constants";
import { waitForStableOnline } from "./online";

/**
 * Boot the app's REAL Agent headless against the keria stack, and start the
 * real keriaNotifications poller so reactive flows (e.g. a multisig group
 * reaching "Active") run as they do in-app. Call once per file; pair with
 * teardownAppAgent.
 */
export async function bootAppAgent(): Promise<Agent> {
  const { bootUrl, connectUrl } = getKeriaUrlsForTestRunner();

  await assertKeriaReachable(bootUrl);

  // Once-per-file: a re-boot resets the bran but skips reconnect -> stale client.
  if (Agent.isOnline) {
    throw new Error(
      "bootAppAgent called while an agent is already online. Boot once per file " +
        "in beforeAll and tear down in afterAll."
    );
  }

  // Fresh bran => a brand-new keria agent per run (no stale group state).
  await SecureStorage.set(KeyStoreKeys.SIGNIFY_BRAN, randomPasscode());

  const agent = Agent.agent;
  await agent.setupLocalDependencies();
  if (!Agent.isOnline) {
    await agent.bootAndConnect({ bootUrl, url: connectUrl });
  }

  // Drive reactive finalization (multisig endorsements -> "Active") as in-app.
  agent.keriaNotifications.startPolling();
  void agent.keriaNotifications.pollNotifications();
  void agent.keriaNotifications.pollLongOperations();

  // Ride out the first poll cycle's reconnect churn (CI load) so the ceremony's
  // first synchronous op can't race a transient offline flip.
  await waitForStableOnline();

  return agent;
}

/** Stop the poller and flip the agent offline. */
export function teardownAppAgent(agent?: Agent): void {
  agent?.keriaNotifications.stopPolling();
  agent?.markAgentStatus(false);
}

async function assertKeriaReachable(bootUrl: string): Promise<void> {
  try {
    // Any HTTP response means keria is up; time-box so a filtered port fails fast.
    await fetch(bootUrl, {
      method: "GET",
      signal: AbortSignal.timeout(KERIA_REACHABLE_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(
      `KERIA not reachable at ${bootUrl}. Start the docker stack ` +
        "(docker compose up) before running integration tests. " +
        `Original error: ${String(e)}`
    );
  }
}
