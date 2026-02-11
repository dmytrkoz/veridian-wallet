/**
 * Entry point for E2E backend helpers. Step definitions import from here and from backend-api.contract.
 *
 * How it works:
 * - Contract types (IBackendUser, SetupBackendUser, etc.) are always re-exported from backend-api.contract.
 * - The actual implementation (setupBackendUser, resetBackendUsers) is wired below. Step definitions
 *   never import from the implementation file directly.
 *
 * When the dev gives you their helper:
 * 1. Add their file under tests/helpers/ (e.g. backend-user.helper.ts) and ensure it exports
 *    setupBackendUser(alias) and resetBackendUsers() that satisfy the contract (see backend-api.contract.ts).
 * 2. Change the export below to point to their module instead of "./remote-bob.helper.js".
 * 3. No changes needed in step definitions or feature files.
 */
export type { IBackendUser, GetOobiOptions, SetupBackendUser } from "./backend-api.contract.js";
export { setupBackendUser, resetBackendUsers } from "./remote-bob.helper.js";
