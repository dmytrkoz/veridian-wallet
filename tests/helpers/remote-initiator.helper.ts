/**
 * Remote Initiator Helper for 2-of-2 Multi-sig Group Profile E2E tests.
 * Roles: Remote Initiator (host, signify-ts) proposes the group; Joiner (app, Appium) joins.
 * Uses the same SignifyClient / createInceptionData / submitInceptionData and operations polling
 * as the repo's multi-sig services. Host-side calls use getKeriaUrlsForTestRunner() for KERIA
 * ports 3901/3903 on the host (127.0.0.1 or KERIA_IP).
 */
import {
  Algos,
  b,
  CreateIdentifierBody,
  d,
  HabState,
  messagize,
  ready,
  Serder,
  Siger,
  SignifyClient,
  State,
  Tier,
} from "signify-ts";
import { getKeriaUrlsForTestRunner } from "./ssi-agent-urls.helper.js";

const MULTISIG_ICP_ROUTE = "/multisig/icp";

/** Poll interval for long-running operation (ms). */
const OP_POLL_INTERVAL_MS = 2000;
/** Max wait for group inception to complete on backend (ms). */
const GROUP_OP_TIMEOUT_MS = 60000;

/** 21-char bran for the Initiator (SignifyClient requires at least 21 chars). */
const INITIATOR_BRAN =
  process.env.REMOTE_INITIATOR_BRAN ?? "0AAAAAAAAAAAAAAAAAAAA";

/** Initiator's member AID alias. */
const INITIATOR_MEMBER_ALIAS = "Initiator-member";

export class RemoteInitiator {
  private static instance: RemoteInitiator | null = null;

  private client: SignifyClient | null = null;
  private initiatorMemberId: string | null = null;

  private constructor() {}

  static getInstance(): RemoteInitiator {
    if (RemoteInitiator.instance == null) {
      RemoteInitiator.instance = new RemoteInitiator();
    }
    return RemoteInitiator.instance;
  }

  /** Check that KERIA is reachable from the host before booting. */
  private async ensureKeriaReachable(bootUrl: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(bootUrl + "/boot", {
        method: "GET",
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `RemoteInitiator: KERIA is not reachable at ${bootUrl} (${msg}). ` +
          "Start KERIA on the host (e.g. docker-compose up -d keria) and ensure ports 3901 and 3903 are exposed."
      );
    }
    clearTimeout(timeout);
  }

  /**
   * Boot and connect the Initiator's agent to KERIA, then create the Initiator's member AID.
   * Host-side: uses getKeriaUrlsForTestRunner() so KERIA ports 3901/3903 are used on the host.
   */
  async setup(): Promise<void> {
    await ready();
    const { bootUrl, connectUrl } = getKeriaUrlsForTestRunner();

    await this.ensureKeriaReachable(bootUrl);

    this.client = new SignifyClient(
      connectUrl,
      INITIATOR_BRAN,
      Tier.low,
      bootUrl
    );

    try {
      const bootResult = await this.client.boot();
      if (!bootResult.ok && bootResult.status !== 409) {
        throw new Error(
          `RemoteInitiator: KERIA boot failed with status ${bootResult.status}`
        );
      }

      await this.client.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
        throw new Error(
          `RemoteInitiator: cannot reach KERIA at ${bootUrl}. ` +
            "Ensure KERIA is running on the host (e.g. docker-compose up -d keria) and that nothing is blocking ports 3901/3903."
        );
      }
      throw err;
    }

    // Create Initiator's member AID (mhab) so we can propose groups (same pattern as multi-sig services)
    try {
      const createResult = await this.client.identifiers().create(INITIATOR_MEMBER_ALIAS, {
        algo: Algos.salty,
      });
      this.initiatorMemberId = createResult.serder.pre;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/400/gi.test(msg) && /already incepted/gi.test(msg)) {
        const hab = await this.client.identifiers().get(INITIATOR_MEMBER_ALIAS);
        this.initiatorMemberId = hab.prefix;
      } else {
        throw err;
      }
    }

    // Authorize the agent role so OOBIs are available (same as identifierService.addEndRole)
    const agentPre = (this.client as SignifyClient & { agent: { pre: string } }).agent?.pre;
    if (agentPre) {
      try {
        const addRoleOp = await this.client.identifiers().addEndRole(
          this.initiatorMemberId,
          "agent",
          agentPre
        );
        await addRoleOp.op();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/400/gi.test(msg) && /already/gi.test(msg)) {
          // Role already added
        } else {
          throw err;
        }
      }
    }
    console.log("[RemoteInitiator] setup() complete; Initiator member AID:", this.initiatorMemberId);
  }

  getClient(): SignifyClient {
    if (this.client == null) {
      throw new Error("RemoteInitiator: call setup() first");
    }
    return this.client;
  }

  getInitiatorMemberId(): string {
    if (this.initiatorMemberId == null) {
      throw new Error("RemoteInitiator: call setup() first");
    }
    return this.initiatorMemberId;
  }

  /**
   * Returns the OOBI URL for the Initiator's member AID so the Joiner (app) can resolve it.
   * Pass groupId and groupName for group connection so the app's resolveGroupConnection accepts it.
   */
  async getOobi(options?: {
    alias?: string;
    groupId?: string;
    groupName?: string;
  }): Promise<string> {
    const client = this.getClient();
    const id = this.getInitiatorMemberId();
    const result = await client.oobis().get(id);
    if (!result.oobis?.[0]) {
      throw new Error("RemoteInitiator: no OOBI for Initiator member AID");
    }
    const oobi = new URL(result.oobis[0]);
    if (options?.alias !== undefined) {
      oobi.searchParams.set("name", options.alias);
    }
    if (options?.groupId !== undefined) {
      oobi.searchParams.set("groupId", options.groupId);
    }
    if (options?.groupName !== undefined) {
      oobi.searchParams.set("groupName", options.groupName);
    }
    const oobiStr = oobi.toString();
    console.log("[RemoteInitiator] getOobi:", oobiStr.slice(0, 90) + (oobiStr.length > 90 ? "…" : ""));
    return oobiStr;
  }

  /**
   * Propose a 2-of-2 group: Initiator (this client) + Joiner (app).
   * Uses createInceptionData and submitInceptionData (same as repo multi-sig services), then
   * sends the /multisig/icp exchange to the Joiner. Does not wait for op.done; the test's
   * And step should call waitForGroupOperationComplete(groupId) after the Joiner signs.
   *
   * @param joinerMemberPrefix - Joiner's member AID prefix (must already exist on KERIA)
   * @param groupName - Group name/alias (e.g. "TestGroup")
   * @returns The new group AID (serder.pre) for use with waitForGroupOperationComplete.
   */
  async propose2of2Group(
    joinerMemberPrefix: string,
    groupName: string
  ): Promise<string> {
    console.log("[RemoteInitiator] propose2of2Group(joinerMemberPrefix=%s, groupName=%s)", joinerMemberPrefix, groupName);
    const client = this.getClient();
    const id = this.getInitiatorMemberId();
    const mHab: HabState = await client.identifiers().get(id);

    const [joinerState] = await client.keyStates().get(joinerMemberPrefix);
    if (!joinerState) {
      throw new Error(
        `RemoteInitiator: no key state for Joiner member AID ${joinerMemberPrefix}`
      );
    }

    const states: State[] = [mHab.state, joinerState];
    const toad = Number(mHab.state.bt ?? 0);
    const wits = (mHab.state.b as string[]) ?? [];

    // Reuse same createInceptionData / submitInceptionData pattern as multiSigService
    const inceptionData: CreateIdentifierBody = await client
      .identifiers()
      .createInceptionData(groupName, {
        algo: Algos.group,
        mhab: mHab,
        isith: 2,
        nsith: 2,
        toad,
        wits,
        states,
        rstates: states,
      });

    try {
      await client.identifiers().submitInceptionData(inceptionData);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      const [, status, reason] = error.message.split(" - ");
      if (!(/400/gi.test(status) && /already incepted/gi.test(reason))) {
        throw error;
      }
    }

    const serder = new Serder(inceptionData.icp);
    const sigers = inceptionData.sigs.map((sig: string) => new Siger({ qb64: sig }));
    const ims = d(messagize(serder, sigers));
    const atc = ims.substring(serder.size);
    const embeds = { icp: [serder, atc] };
    const smids = states.map((s) => s.i);
    const recp = smids.filter((prefix) => prefix !== mHab.prefix);

    await client.exchanges().send(
      mHab.prefix,
      "multisig",
      mHab,
      MULTISIG_ICP_ROUTE,
      {
        gid: serder.pre,
        smids,
        rmids: smids,
      },
      embeds,
      recp
    );

    console.log("[RemoteInitiator] propose2of2Group sent; groupId (serder.pre):", serder.pre);
    return serder.pre;
  }

  /**
   * Poll KERIA operations until group inception is done (op.done === true).
   * Uses client.operations().get("group.<groupId>") so the test proceeds only when
   * the backend is fully notarized—no guesswork on wait time.
   */
  async waitForGroupOperationComplete(
    groupId: string,
    timeoutMs = GROUP_OP_TIMEOUT_MS,
    intervalMs = OP_POLL_INTERVAL_MS
  ): Promise<void> {
    const client = this.getClient();
    const opName = `group.${groupId}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const op = await client.operations().get(opName);
        if (op?.done === true) {
          if (op.error) {
            throw new Error(
              `RemoteInitiator: group inception operation failed: ${String(op.error)}`
            );
          }
          return;
        }
      } catch (e) {
        if (Date.now() >= deadline) throw e;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `RemoteInitiator: group inception did not complete within ${timeoutMs}ms (op: ${opName})`
    );
  }

  /**
   * After the Joiner has resolved the Initiator's OOBI, the Initiator's contacts include the Joiner.
   * Returns the contact id (Joiner's member AID) for the other contact.
   */
  async getJoinerMemberPrefixFromContacts(): Promise<string | null> {
    const client = this.getClient();
    const list = await client.contacts().list();
    const contacts = Array.isArray(list) ? list : (list as { contacts?: unknown[] }).contacts ?? [];
    const initiatorId = this.getInitiatorMemberId();
    const other = contacts.find((c: unknown) => {
      const contact = c as { id?: string };
      return contact.id && contact.id !== initiatorId;
    }) as { id: string } | undefined;
    return other?.id ?? null;
  }

  /** For debugging: return contact count and ids so step can throw a clearer error. */
  async getContactsDebug(): Promise<{ count: number; ids: string[]; initiatorId: string }> {
    const client = this.getClient();
    const list = await client.contacts().list();
    const contacts = Array.isArray(list) ? list : (list as { contacts?: unknown[] }).contacts ?? [];
    const initiatorId = this.getInitiatorMemberId();
    const ids = (contacts as { id?: string }[]).map((c) => c.id ?? "").filter(Boolean);
    return { count: ids.length, ids, initiatorId };
  }

  /** Reset the singleton (e.g. between test runs). */
  static reset(): void {
    RemoteInitiator.instance = null;
  }
}

export async function setupRemoteInitiator(): Promise<RemoteInitiator> {
  const initiator = RemoteInitiator.getInstance();
  await initiator.setup();
  return initiator;
}
