/**
 * API contract between E2E tests and backend (KERIA/Signify) helpers.
 *
 * Tests import and call these types/functions. The architect implements helpers
 * that satisfy this contract. URL config comes from getKeriaUrlsForTestRunner() in ssi-agent-urls.helper.ts.
 */

/** KERIA connection config (from getKeriaUrlsForTestRunner()). */
export interface KeriaConfig {
  bootUrl: string;
  connectUrl: string;
}

// ---------------------------------------------------------------------------
// 1. KERIA bootstrap (shared)
// ---------------------------------------------------------------------------

/**
 * Ensure KERIA is reachable (e.g. GET boot URL).
 * Throw with a clear message if not (e.g. "Start KERIA on host").
 */
export type InitKeria = () => Promise<void>;

// ---------------------------------------------------------------------------
// 2. Backend user (Bob-style) – "OOBI provider"
// Used when the app user is the initiator (e.g. Alice) and the backend is a member
// that only provides an OOBI with optional groupId/groupName. No group creation.
// ---------------------------------------------------------------------------

export interface GetOobiOptions {
  alias?: string;
  groupId?: string;
  groupName?: string;
}

/**
 * Backend user that can provide an OOBI for the app to paste.
 * Example: Bob in "Alice creates group, Bob joins via OOBI" scenario.
 */
export interface IBackendUser {
  /** Return OOBI URL; query params groupId and groupName added when provided. */
  getOobi(options?: GetOobiOptions): Promise<string>;

  /** Return this user's AID (prefix). */
  getAid(): Promise<string>;

  /** Optional: clear singleton/state so next scenario gets a clean slate. */
  reset?(): void;

  /** Optional: wait for a KERIA operation to complete (e.g. role add). */
  waitOperation?(operationId: string, timeoutMs?: number): Promise<void>;
}

/**
 * Create or reuse a KERIA identifier for the given alias.
 * Returns an IBackendUser instance (e.g. Bob).
 */
export type SetupBackendUser = (alias: string) => Promise<IBackendUser>;

// ---------------------------------------------------------------------------
// 3. Remote initiator (group proposer / joiner flow)
// Used when the backend is the initiator and the app is the joiner.
// ---------------------------------------------------------------------------

export interface EnsureJoinerOptions {
  /** If provided, pre-seed using this mnemonic so app can "import wallet" with same seed. */
  seedMnemonic?: string;
}

export interface CreateGroupOptions {
  joinerAid?: string;
}

/**
 * Remote initiator that can pre-seed joiner AID, create a group, and propose it to the joiner.
 * Example: "Wallet joins a group proposed by remote initiator" scenario.
 */
export interface IRemoteInitiator {
  /** Pre-seed or ensure the joiner AID exists in KERIA (and optionally witnesses). */
  ensureJoinerInKeria(joinerAid: string, options?: EnsureJoinerOptions): Promise<void>;

  /** Create the group; optionally link to joiner. Returns at least groupId. */
  createGroup(groupName: string, options?: CreateGroupOptions): Promise<{ groupId: string }>;

  /** Propose the group to the joiner so the app can see and accept the invitation. */
  proposeGroupToJoiner(groupId: string, joinerAid: string): Promise<void>;

  /** Wait until the given operation completes. */
  waitForOperation(operationId: string, timeoutMs?: number): Promise<void>;
}

/**
 * One-time setup: boot/connect to KERIA, create initiator identifier if needed.
 * Returns an IRemoteInitiator instance.
 */
export type SetupRemoteInitiator = () => Promise<IRemoteInitiator>;
