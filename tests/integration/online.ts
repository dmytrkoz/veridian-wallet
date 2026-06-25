/**
 * Online-stability helper for the integration harness.
 *
 * The real keriaNotifications poller flips the agent offline + reconnects on a
 * transient network error. Under CI load keria can be slow enough that this
 * happens just after boot, so the ceremony's first synchronous op could race the
 * flip. waitForStableOnline rides out that first reconnect churn before the
 * ceremony starts (locally keria is fast and it never fires).
 */
import { Agent } from "../../src/core/agent/agent";
import { ONLINE_WAIT_TIMEOUT_MS, STABLE_ONLINE_MS } from "./constants";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Resolve once the agent has stayed online continuously for stableMs — riding
 * out the first poll cycle's reconnect churn before the ceremony starts.
 */
export async function waitForStableOnline(
  stableMs = STABLE_ONLINE_MS,
  timeoutMs = ONLINE_WAIT_TIMEOUT_MS
): Promise<void> {
  const start = Date.now();
  let onlineSince: number | null = null;
  while (true) {
    if (Agent.isOnline) {
      onlineSince ??= Date.now();
      if (Date.now() - onlineSince >= stableMs) return;
    } else {
      onlineSince = null;
    }
    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `agent did not stay online for ${stableMs}ms within ${timeoutMs}ms`
      );
    }
    await sleep(250);
  }
}
