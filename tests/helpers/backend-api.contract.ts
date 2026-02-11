/**
 * Contract for E2E tests and backend (KERIA/Signify) helpers.
 * Tests use these types; the implementation lives in the helper you wire from backend-helpers.ts.
 * URLs come from getKeriaUrlsForTestRunner() in ssi-agent-urls.helper.ts.
 */

export interface KeriaConfig {
  bootUrl: string;
  connectUrl: string;
}

// --- KERIA bootstrap ---

/** Check KERIA is up (e.g. GET boot). Throw with a clear message if not. */
export type InitKeria = () => Promise<void>;

// --- Backend user (OOBI provider: app is initiator, backend is member) ---

export interface GetOobiOptions {
  alias?: string;
  groupId?: string;
  groupName?: string;
}

/** Backend user that gives an OOBI for the app to paste (e.g. Bob in Alice-creates-group flow). */
export interface IBackendUser {
  getOobi(options?: GetOobiOptions): Promise<string>;
  getAid(): Promise<string>;
  /** After Alice sends the request: wait for multisig ICP and accept/join so the group becomes active. */
  acceptGroupInvitation(timeoutMs?: number): Promise<void>;
  reset?(): void;
  waitOperation?(operationId: string, timeoutMs?: number): Promise<void>;
}

/** Create or get a backend user by alias (e.g. "Bob", "Charlie"). */
export type SetupBackendUser = (alias: string) => Promise<IBackendUser>;

// --- Remote initiator (backend proposes group, app joins) ---

export interface EnsureJoinerOptions {
  seedMnemonic?: string;
}

export interface CreateGroupOptions {
  joinerAid?: string;
}

/** Backend that can set up joiner, create a group, and propose it to the app. */
export interface IRemoteInitiator {
  ensureJoinerInKeria(joinerAid: string, options?: EnsureJoinerOptions): Promise<void>;
  createGroup(groupName: string, options?: CreateGroupOptions): Promise<{ groupId: string }>;
  proposeGroupToJoiner(groupId: string, joinerAid: string): Promise<void>;
  waitForOperation(operationId: string, timeoutMs?: number): Promise<void>;
}

/** One-time setup: connect to KERIA and create the initiator identifier. */
export type SetupRemoteInitiator = () => Promise<IRemoteInitiator>;
