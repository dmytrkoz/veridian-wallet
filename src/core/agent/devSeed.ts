import { Agent } from "./agent";
import { MiscRecordId } from "./agent.types";
import { BasicRecord } from "./records";

/**
 * DEV/E2E ONLY. Programmatically reproduces a post-onboarding state so e2e
 * tests can skip the ~50s UI onboarding precondition. Reuses the existing
 * onboarding primitives:
 *   devPreload (passcode/bran/init/password-skipped/seed-verified)
 *   + bootAndConnect (keria connect URLs, critical-action state, isOnline)
 *   + optional createIdentifier.
 * Routing gate (nextRoute.ts:36-39): ssiAgentIsSet (KERIA_CONNECT_URL written
 * by bootAndConnect) && isSetupProfile -> PROFILE_SETUP, else -> HOME.
 * Flexible by design:
 *   - `atProfileSetup` true  -> set IS_SETUP_PROFILE so the app lands on the
 *     first-run Profile Setup screen with NO profile yet (for flows that
 *     create a group/individual profile there, e.g. multisig). `displayName`
 *     is ignored in this mode.
 *   - otherwise              -> delete IS_SETUP_PROFILE so the app lands on
 *     Home; with `displayName` it also seeds one identifier (populated Home),
 *     without it an empty Home.
 * Returns the created identifier id, or undefined when none was created.
 * Only reachable via a window hook that is stripped from prod builds
 * (see AppWrapper).
 */
export async function devSeedOnboarded({
  agentInstance,
  bootUrl,
  connectUrl,
  displayName,
  atProfileSetup,
}: {
  agentInstance: Agent;
  bootUrl: string;
  connectUrl: string;
  displayName?: string;
  atProfileSetup?: boolean;
}): Promise<string | undefined> {
  await agentInstance.devPreload();
  if (!Agent.isOnline) {
    // Pass both URLs explicitly (the AgentUrls overload), exactly as the SSI
    // agent UI does, to skip the /connect discovery fetch.
    await agentInstance.bootAndConnect({ bootUrl, url: connectUrl });
  }

  if (atProfileSetup) {
    // Mirror CreateSSIAgent.tsx:162-169 — set IS_SETUP_PROFILE=true so the
    // routing gate sends the app to the first-run Profile Setup screen.
    await agentInstance.basicStorage.createOrUpdateBasicRecord(
      new BasicRecord({
        id: MiscRecordId.IS_SETUP_PROFILE,
        content: { value: true },
      })
    );
    return undefined;
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
