/** Tunable timings/values for the integration suite, named so the tests read
 *  intent instead of bare millisecond literals. */

/** Poll cadence while waiting on reactive keria/app state. */
export const POLL_INTERVAL_MS = 2000;

/** Max wait for a multisig group to reach "Active" (creationStatus COMPLETE).
 *  Generous: the 2-of-3 ceremony observed ~33s end-to-end. */
export const GROUP_ACTIVE_TIMEOUT_MS = 90000;

/** Max wait for a virtual member to receive + accept the group invitation. */
export const INVITATION_ACCEPT_TIMEOUT_MS = 60000;

/** Fail-fast budget for the "is keria up?" reachability probe. */
export const KERIA_REACHABLE_TIMEOUT_MS = 5000;

/** Per-test (per threshold row) Jest timeout — a full ceremony plus headroom. */
export const CASE_TIMEOUT_MS = 120000;

/** Default identifier theme used across the app (single, non-themed). */
export const DEFAULT_THEME = 0;

/** Boot gate: require the agent to stay online this long before the ceremony,
 *  so the first poll cycle's reconnect churn can't flip it offline mid-arrange. */
export const STABLE_ONLINE_MS = 3000;

/** Max wait for the agent to come (back) online — used by the boot stable-online
 *  gate. The poller's connect()-on-error recovers within a poll cycle or two. */
export const ONLINE_WAIT_TIMEOUT_MS = 30000;
