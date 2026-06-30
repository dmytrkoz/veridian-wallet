/**
 * Reusable ceremony steps driven through the app's real services (no UI).
 * The virtual-member (Node) side reuses the e2e harness (virtual-wallet.ts).
 */
import type { Agent } from "../../../src/core/agent/agent";
import type { VirtualWallet } from "../../helpers/virtual-wallet";
import { createVirtualWallet } from "../../helpers/virtual-wallet.factory";
import { getKeriaUrlsForTestRunner } from "../../helpers/ssi-agent-urls.helper";
import {
  CreationStatus,
  isMultisigConnectionDetails,
  type MultisigConnectionDetails,
} from "../../../src/core/agent/agent.types";
import { pollUntil } from "../../helpers/poll";
import { completeGroupAsMembers } from "../../helpers/multisig-ceremony";
import {
  DEFAULT_THEME,
  GROUP_ACTIVE_TIMEOUT_MS,
  INVITATION_ACCEPT_TIMEOUT_MS,
  POLL_INTERVAL_MS,
} from "../constants";

/** App creates its member identifier + pending group, returns AID and shareable OOBI. */
export async function createAppMember(
  agent: Agent,
  opts: { groupId: string; groupName: string; displayName: string }
): Promise<{ memberAid: string; oobi: string }> {
  const { groupId, groupName, displayName } = opts;
  const { identifier: memberAid } = await agent.identifiers.createIdentifier({
    displayName,
    theme: DEFAULT_THEME,
    groupMetadata: {
      groupId,
      groupInitiator: true,
      groupCreated: false,
      proposedUsername: displayName,
    },
  });
  const oobi = await agent.connections.getOobi(memberAid, {
    alias: displayName,
    groupId,
    groupName,
  });
  return { memberAid, oobi };
}

/**
 * Create the virtual members and wire the full OOBI mesh (app<->member and
 * member<->member). Every member needs every other's key state to build the
 * group inception, so the member<->member resolution is required.
 */
export async function addVirtualMembers(
  agent: Agent,
  opts: {
    appAid: string;
    appOobi: string;
    appName: string;
    groupId: string;
    groupName: string;
    aliases: readonly string[];
  }
): Promise<VirtualWallet[]> {
  const { appAid, appOobi, appName, groupId, groupName, aliases } = opts;
  const host = new URL(getKeriaUrlsForTestRunner().connectUrl).hostname;
  const onHost = (raw: string): string => {
    const u = new URL(raw);
    u.hostname = host;
    return u.toString();
  };

  const members: { alias: string; wallet: VirtualWallet }[] = [];
  for (const alias of aliases) {
    const wallet = await createVirtualWallet(alias);
    await wallet.resolveOobi(appOobi, appName);
    const memberOobi = await wallet.getOobi({ groupId, groupName, alias });
    await agent.connections.connectByOobiUrl(onHost(memberOobi), appAid);
    members.push({ alias, wallet });
  }

  // member <-> member mesh
  for (const a of members) {
    for (const b of members) {
      if (a === b) continue;
      const bOobi = await b.wallet.getOobi({ alias: b.alias });
      await a.wallet.resolveOobi(onHost(bOobi), b.alias);
    }
  }

  return members.map((m) => m.wallet);
}

/**
 * App proposes the group. getMultisigConnections() returns all groupId-bearing
 * contacts, so filter to this group — a foreign one throws ONLY_ALLOW_LINKED_CONTACTS.
 */
export async function proposeGroup(
  agent: Agent,
  opts: {
    appAid: string;
    groupId: string;
    signingThreshold: number;
    rotationThreshold: number;
    expectedMemberCount: number;
  }
): Promise<string> {
  const { appAid, groupId, signingThreshold, rotationThreshold } = opts;
  const memberConnections = (
    await agent.connections.getMultisigConnections()
  ).filter(
    (c): c is MultisigConnectionDetails =>
      isMultisigConnectionDetails(c) && c.groupId === groupId
  );
  if (memberConnections.length !== opts.expectedMemberCount) {
    throw new Error(
      `expected ${opts.expectedMemberCount} scanned member(s) for group ${groupId}, ` +
        `got ${memberConnections.length}`
    );
  }
  return agent.multiSigs.createGroup(appAid, memberConnections, {
    signingThreshold,
    rotationThreshold,
  });
}

/**
 * Virtual members complete their side: accept the invitation, authorize their
 * group agents, then process every incoming endorsement.
 */
export async function virtualMembersComplete(
  members: VirtualWallet[],
  groupName: string
): Promise<void> {
  await completeGroupAsMembers(members, groupName, INVITATION_ACCEPT_TIMEOUT_MS);
}

/**
 * Poll until the group reaches creationStatus COMPLETE ("Active"), driven by
 * the app's poller. getIdentifiers(false) lists pending records too, avoiding
 * getIdentifier()'s throw on a not-yet-complete group.
 */
export async function awaitGroupActive(
  agent: Agent,
  multisigId: string,
  timeoutMs = GROUP_ACTIVE_TIMEOUT_MS
): Promise<void> {
  let last: CreationStatus | false | undefined;
  await pollUntil(
    async () => {
      const all = await agent.identifiers.getIdentifiers(false);
      last = all.find((i) => i.id === multisigId)?.creationStatus;
      return last === CreationStatus.COMPLETE;
    },
    {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      onTimeout: () =>
        `group ${multisigId} never reached COMPLETE; last creationStatus: ${String(
          last
        )}`,
    }
  );
}
