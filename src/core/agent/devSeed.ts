import { Agent } from "./agent";
import { MiscRecordId } from "./agent.types";

/**
 * DEV/E2E ONLY. Programmatically reproduces the onboarded state so e2e tests
 * can skip the ~50s UI onboarding precondition. Reuses the existing onboarding
 * primitives:
 *   devPreload (passcode/bran/init/password-skipped/seed-verified)
 *   + bootAndConnect (keria connect URLs, critical-action state, isOnline)
 *   + optional createIdentifier.
 * Flexible by design:
 *   - no `displayName` -> lands on an EMPTY Identifiers home screen (a true
 *     drop-in for scenarios that add the first identifier).
 *   - `displayName` set -> seeds one identifier so the app lands on a
 *     populated Home (for scenarios that need an existing identifier).
 * Routing: ssiAgentIsSet (KERIA_CONNECT_URL written by bootAndConnect) &&
 * !isSetupProfile -> TabsRoutePath.HOME (see nextRoute.ts). IS_SETUP_PROFILE
 * is removed defensively so the gate routes to HOME, not PROFILE_SETUP.
 * Returns the created identifier id, or undefined when none was created.
 * Only reachable via a window hook that is stripped from prod builds
 * (see AppWrapper).
 */
export async function devSeedOnboarded({
  agentInstance,
  bootUrl,
  connectUrl,
  displayName,
}: {
  agentInstance: Agent;
  bootUrl: string;
  connectUrl: string;
  displayName?: string;
}): Promise<string | undefined> {
  await agentInstance.devPreload();
  if (!Agent.isOnline) {
    // Pass both URLs explicitly (the AgentUrls overload), exactly as the SSI
    // agent UI does, to skip the /connect discovery fetch.
    await agentInstance.bootAndConnect({ bootUrl, url: connectUrl });
  }
  await agentInstance.basicStorage
    .deleteById(MiscRecordId.IS_SETUP_PROFILE)
    .catch(() => undefined);

  if (!displayName) {
    return undefined;
  }
  const { identifier } = await agentInstance.identifiers.createIdentifier({
    displayName,
    theme: 0,
  });
  return identifier;
}
