/** Tunable timings/values for the integration suite, named so the tests read
 *  intent instead of bare millisecond literals. */

/** Poll cadence while waiting on reactive keria/app state. */
export const POLL_INTERVAL_MS = 2000;

/** Max wait for a multisig group to reach "Active" (creationStatus COMPLETE).
 *  Generous: the 3-of-3 ceremony observed ~35s end-to-end. */
export const GROUP_ACTIVE_TIMEOUT_MS = 90000;

/** Max wait for a virtual member to receive + accept the group invitation. */
export const INVITATION_ACCEPT_TIMEOUT_MS = 60000;

/** Fail-fast budget for the "is keria up?" reachability probe. */
export const KERIA_REACHABLE_TIMEOUT_MS = 5000;

/** Per-test (per threshold row) Jest timeout — a full ceremony plus headroom. */
export const CASE_TIMEOUT_MS = 120000;

/** Default identifier theme used across the app (single, non-themed). */
export const DEFAULT_THEME = 0;
