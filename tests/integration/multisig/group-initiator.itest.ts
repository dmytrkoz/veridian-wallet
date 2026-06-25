import { Salter } from "signify-ts";
import { bootAppAgent, teardownAppAgent } from "../setup";
import { Agent } from "../../../src/core/agent/agent";
import { CreationStatus } from "../../../src/core/agent/agent.types";
import { CASE_TIMEOUT_MS } from "../constants";
import {
  createAppMember,
  addVirtualMembers,
  proposeGroup,
  virtualMembersComplete,
  awaitGroupActive,
} from "./ceremony";

// Integration test for the multisig initiator flow: the app's real services +
// real signify drive a group ceremony to "Active" against real keria, headless
// (no emulator). One representative 2-of-3 case on purpose — the threshold
// matrix is owned by the mocked unit tests (multiSigService.test.ts), since the
// app only forwards the thresholds to signify.
describe("multisig group (initiator) — app core vs real keria", () => {
  let agent: Agent;

  beforeAll(async () => {
    agent = await bootAppAgent();
  });

  afterAll(() => {
    teardownAppAgent(agent);
  });

  test("smoke: app agent reached keria", async () => {
    // Boot-specific: a real round-trip to keria, not just the global flag.
    const identifiers = await agent.identifiers.getIdentifiers();
    expect(Array.isArray(identifiers)).toBe(true);
  });

  test(
    "2-of-3: app initiator + Bob,Charlie reach an Active group",
    async () => {
      const required = 2;
      const recovery = 3;
      const members = ["Bob", "Charlie"];
      const groupName = "MultisigGroup";
      const groupId = new Salter({}).qb64;

      // --- Arrange: app member + group-scoped OOBI, then the virtual members ---
      // No per-op online-retry: the boot-time stable-online gate (bootAppAgent)
      // is the only stability measure. If keria flips offline mid-arrange under
      // load this will fail loudly — which is the point of this spike.
      const { memberAid, oobi } = await createAppMember(agent, {
        groupId,
        groupName,
        displayName: "Alice",
      });

      const virtualMembers = await addVirtualMembers(agent, {
        appAid: memberAid,
        appOobi: oobi,
        appName: "Alice",
        groupId,
        groupName,
        aliases: members,
      });

      // --- Act: app proposes the group; virtual members complete their side ---
      const multisigId = await proposeGroup(agent, {
        appAid: memberAid,
        groupId,
        signingThreshold: required,
        rotationThreshold: recovery,
        expectedMemberCount: members.length,
      });
      expect(typeof multisigId).toBe("string");

      await virtualMembersComplete(virtualMembers, groupName);

      // --- Assert: the app's reactive poller drives the group to "Active" ---
      await awaitGroupActive(agent, multisigId);
      const group = await agent.identifiers.getIdentifier(multisigId);
      expect(group.creationStatus).toBe(CreationStatus.COMPLETE);
    },
    CASE_TIMEOUT_MS
  );
});
