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
import { pollUntil } from "../helpers/poll";
import { ONLINE_WAIT_TIMEOUT_MS, STABLE_ONLINE_MS } from "./constants";

/**
 * Resolve once the agent has stayed online continuously for stableMs — riding
 * out the first poll cycle's reconnect churn before the ceremony starts.
 */
export async function waitForStableOnline(
  stableMs = STABLE_ONLINE_MS,
  timeoutMs = ONLINE_WAIT_TIMEOUT_MS
): Promise<void> {
  let onlineSince: number | null = null;
  await pollUntil(
    async () => {
      if (!Agent.isOnline) {
        onlineSince = null;
        return false;
      }
      onlineSince ??= Date.now();
      return Date.now() - onlineSince >= stableMs;
    },
    {
      timeoutMs,
      intervalMs: 250,
      onTimeout: () =>
        `agent did not stay online for ${stableMs}ms within ${timeoutMs}ms`,
    }
  );
}
