/**
 * Online-stability helpers for the integration harness.
 *
 * The real keriaNotifications poller runs against keria for the app's lifetime
 * and, on a transient network error, flips the agent offline + reconnects
 * (OnlineOnly decorator / poller). Under CI load keria is slow enough that this
 * happens during/just after boot, so a synchronous arrange op can race the flip
 * and throw KERIA_CONNECTION_BROKEN. Locally keria is fast and it never fires.
 *
 * These mirror what the in-app UI does: wait for "connected", and retry an op
 * that hit a transient "not connected".
 */
import { Agent } from "../../src/core/agent/agent";
import {
  ONLINE_RETRY_ATTEMPTS,
  ONLINE_WAIT_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  STABLE_ONLINE_MS,
} from "./constants";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Resolve once the agent is online, or throw after timeoutMs. */
export async function waitForOnline(
  timeoutMs = ONLINE_WAIT_TIMEOUT_MS
): Promise<void> {
  const start = Date.now();
  while (!Agent.isOnline) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`agent did not come online within ${timeoutMs}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

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

const isOfflineError = (e: unknown): boolean =>
  e instanceof Error && e.message === Agent.KERIA_CONNECTION_BROKEN;

/**
 * Run an arrange-phase keria op, retrying only on a transient "not connected"
 * (the poller flipped offline under load); the poller's connect() recovers, so
 * we wait for online and retry. Any other error propagates immediately.
 */
export async function withOnlineRetry<T>(
  fn: () => Promise<T>,
  attempts = ONLINE_RETRY_ATTEMPTS
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isOfflineError(e)) throw e;
      lastErr = e;
      // No point waiting after the last attempt — we're about to throw.
      if (i < attempts - 1) await waitForOnline();
    }
  }
  throw new Error(
    `op still offline after ${attempts} attempts: ${String(lastErr)}`
  );
}
