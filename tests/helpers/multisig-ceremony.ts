import type { VirtualWallet } from "./virtual-wallet";

/**
 * Virtual members complete their side of the group ceremony: accept the
 * invitation, authorize their group agents, then process every incoming
 * endorsement, settling all pending operations between phases.
 *
 * Shared by the headless integration ceremony (tests/integration/multisig) and
 * the e2e UI steps (tests/steps-definitions/group-profiles) so the member-side
 * convergence flow is identical by construction and cannot silently diverge -
 * the whole point of the integration test is that it runs the same flow as e2e.
 */
export async function completeGroupAsMembers(
  members: VirtualWallet[],
  groupName: string,
  acceptTimeoutMs = 60000
): Promise<void> {
  for (const m of members) {
    await m.acceptGroupInvitation(acceptTimeoutMs, groupName);
  }
  for (const m of members) {
    await m.waitPendingOperations();
  }
  // Each member proposes its own endorsement before processing incoming ones.
  for (const m of members) {
    await m.authorizeGroupAgents(groupName);
  }
  // Every member processes all incoming endorsements and anchors them locally.
  for (const m of members) {
    await m.processIncomingGroupAgentsEndorcements(groupName);
  }
  for (const m of members) {
    await m.waitPendingOperations();
  }
}
