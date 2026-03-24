/**
 * Contract for E2E tests and backend (KERIA/Signify) helpers.
 * Tests use these types; the implementation lives in the helper you wire from backend-helpers.ts.
 * URLs come from getKeriaUrlsForTestRunner() in ssi-agent-urls.helper.ts.
 */

import {
  Algos,
  b,
  d,
  messagize,
  randomPasscode,
  Saider,
  Serder,
  Siger,
  SignifyClient,
  Tier,
  Operation,
  serializeACDCAttachment,
  serializeIssExnAttachment,
} from "signify-ts";

export interface KeriaConfig {
  bootUrl: string;
  connectUrl: string;
}

interface WitnessConfig {
  eid: string;
  oobi: string;
}

export interface WitnessesConfig {
  toad: number;
  witnesses: WitnessConfig[];
}

export interface GetOobiOptions {
  role?: string;
  alias?: string;
  groupId?: string;
  groupName?: string;
}

interface CreateGroupOptions {
  isith: number;
  nsith: number;
  toad?: number;
  wits?: string[];
}

const DEFAULT_WITNESSES_CONFIG = { toad: 0, witnesses: [] };

// --- Virtual Wallet ---

export class VirtualWallet {
  public client: SignifyClient;
  public aidName: string;
  public prefix: string | undefined;
  public oobi?: string;
  private pendingOperations: Operation[] = [];

  constructor(
      public alias: string,
      protected config: KeriaConfig,
      protected passcode: string = randomPasscode()
  ) {
    this.client = new SignifyClient(config.connectUrl, this.passcode, Tier.low, config.bootUrl);
    this.aidName = `${alias}_AID`;
  }

  async init(witnesses: WitnessesConfig = DEFAULT_WITNESSES_CONFIG): Promise<void> {
    await this.client.boot();
    await this.client.connect();

    const result = await this.client.identifiers().create(this.aidName, witnesses);
    await this.waitOperation(await result.op());
    const aid = await this.client.identifiers().get(this.aidName);
    this.prefix = aid.prefix;

    const agentPre = (this.client as SignifyClient & { agent?: { pre: string } }).agent?.pre;
    if (agentPre) {
      try {
        const roleResult = await this.client.identifiers().addEndRole(this.aidName, "agent", agentPre);
        await this.waitOperation(await roleResult.op());
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/400/gi.test(msg) || !/already/gi.test(msg)) throw err;
      }
    }
  }

  async getAid(): Promise<string> {
    if (!this.prefix) throw new Error("User not initialized");
    return this.prefix;
  }

  async resolveOobi(oobi: string, alias: string): Promise<void> {
    console.log(`[${this.alias}] Resolving OOBI for ${alias}...`);
    const op = await this.client.oobis().resolve(oobi, alias);
    await this.waitOperation(op);
  }

  async getOobi(options?: GetOobiOptions): Promise<string> {
    if (!this.oobi) {
      const role = options?.role ?? "agent";
      const result = await this.client.oobis().get(this.aidName, role);
      this.oobi = result.oobis[0];
    }

    let url = this.oobi!;
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      const base = this.config.connectUrl.replace(/\/$/, "");
      url = url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
    }

    const u = new URL(url);
    const { alias, groupId, groupName } = options ?? {};
    if (alias) u.searchParams.set("name", alias);
    if (groupId) u.searchParams.set("groupId", groupId);
    if (groupName) u.searchParams.set("groupName", groupName);

    return u.toString();
  }

  async waitOperation(operation: any, timeoutMs = 30000) {
    return this.client.operations().wait(
        operation,
        { signal: AbortSignal.timeout(timeoutMs) }
    );
  }

  async waitForNotification(route: string, timeoutMs: number, interval = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const { notes } = await this.client.notifications().list();
        const filtered = notes.filter((n: any) => n.a.r === route && n.r === false);
        if (filtered.length > 0) return filtered;
      } catch {
        // ignore fetch errors and retry
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Timeout waiting for notification on route ${route}`);
  }

  public pushOperation(operation: Operation): void {
    this.pendingOperations.push(operation);
  }

  public pullByType(type?: string): Operation[] {
    const matches: Operation[] = [];

    this.pendingOperations = this.pendingOperations.filter(op => {
      const isMatch = !type || op.name.startsWith(`${type}.`);
      if (isMatch) matches.push(op);
      return !isMatch;
    });

    return matches;
  }

  public async waitPendingOperations(type?: string, timeoutMs = 30000) {
    console.log(`[${this.alias}] Waiting for pending operations...`);
    const ops = this.pullByType(type);

    for (const op of ops) {
      await this.waitOperation(op, timeoutMs);
    }
  }

  async acceptGroupInvitation(timeoutMs: number = 30000, groupName: string = "MultisigGroup") {
    console.log(`[${this.alias}] Waiting for group invitation (multisig/icp)...`);

    const notifications = await this.waitForNotification("/multisig/icp", timeoutMs);
    const icpMsg = await this.client
        .groups()
        .getRequest(notifications[0].a.d)
        .catch((error) => {
          const status = error.message.split(" - ")[1];
          if (/404/gi.test(status)) {
            throw new Error(
                `There's no exchange message for the given SAID ${notifications[0].a.i}`
            );
          } else {
            throw error;
          }
        });

    const exn = icpMsg[0].exn;
    const icpParams = exn.e.icp;
    const smids = exn.a.smids;
    const rmids = exn.a.rmids || smids;

    const states = await Promise.all(
        smids.map((id: string) => this.client.keyStates().get(id).then((s: any) => s[0]))
    );
    const rstates = await Promise.all(
        rmids.map((id: string) => this.client.keyStates().get(id).then((s: any) => s[0]))
    );

    const group = new Group(this.client, this.aidName, groupName, states);

    console.log(`[${this.alias}] Mirroring group creation...`);

    await group.create({
      isith: icpParams.kt,
      nsith: icpParams.nt,
      toad: parseInt(icpParams.bt),
      wits: icpParams.b,
      rstates: rstates,
      delpre: icpParams.di
    });

    const myPrefix = await this.getAid();
    const recipients = smids.filter((id: string) => id !== myPrefix);

    console.log(`[${this.alias}] Joining group. Acknowledging to: ${recipients.join(', ')}`);
    await group.send(recipients);

    this.pushOperation(group.operation)
  }

  async authorizeGroupAgents(groupName: string): Promise<void> {
    console.log(`[${this.alias}] Fetching member details for group ${groupName}...`);

    const membersResult = await this.client.identifiers().members(groupName);
    const signingMembers = membersResult.signing;

    if (!signingMembers || signingMembers.length === 0) {
      throw new Error(`No signing members found for group ${groupName}`);
    }

    const myPrefix = await this.getAid();

    const recipients = signingMembers
        .map((m: any) => m.aid)
        .filter((aid: string) => aid !== myPrefix);

    console.log(`[${this.alias}] Found ${signingMembers.length} members. Starting authorization.`);

    for (const member of signingMembers) {
      let agentEid: string | undefined;

      if (member.ends && member.ends.agent) {
        const agentKeys = Object.keys(member.ends.agent);
        if (agentKeys.length > 0) {
          agentEid = agentKeys[0];
        }
      }

      if (!agentEid && member.aid === myPrefix) {
        agentEid = this.client.agent?.pre;
      }

      if (!agentEid) {
        console.warn(`[${this.alias}] Skipping member ${member.aid}: No Agent Endpoint found.`);
        continue;
      }

      console.log(`[${this.alias}] Authorizing Agent ${agentEid} for Member ${member.aid}`);

      const roleHelper = new Role(this, groupName, true);

      await roleHelper.add("agent", agentEid);
      if (recipients.length > 0) {
        await roleHelper.send(recipients);
        console.log(`[${this.alias}] Sent authorization endorsement to ${recipients.length} recipients.`);
      }
    }

    console.log(`[${this.alias}] Finished Agent Authorization Loop.`);
  }

  async processIncomingGroupAgentsEndorcements(groupName: string) {
    const membersResult = await this.client.identifiers().members(groupName);
    const signingMembers = membersResult.signing;
    const myPrefix = await this.getAid();
    const recipients = signingMembers
        .map((m: any) => m.aid)
        .filter((aid: string) => aid !== myPrefix);

    const notifications = await this.waitForNotification("/multisig/rpy", 60000);
    for (const notification of notifications) {
      const request = await this.client.groups().getRequest(notification.a.d);
      const bankGroupB_Role = new Role(this, groupName, true);
      await bankGroupB_Role.acknowledge(request[0].exn);
      await bankGroupB_Role.send(recipients);
    }
  }

  /**
   * Joins a multisig IPEX admit initiated by another group member.
   *
   * Prerequisites: the grant must already exist in this agent's exchange DB
   * (call Issuer.redeliverGrant first) and issuer + schema OOBIs must be
   * resolved.
   *
   * Flow:
   * 1. Wait for Alice's /multisig/exn notification wrapping /ipex/admit
   *    to extract the datetime and grant SAID.
   * 2. Create the admit with ipex().admit() using the same datetime so
   *    all members produce an admit with the same SAID.
   * 3. Call submitAdmit — KERIA validates the grant exists in this
   *    agent's exchange DB (ipexing.py:175).
   * 4. Send /multisig/exn to notify other members.
   */
  async joinMultisigAdmit(groupName: string, timeoutMs = 60000): Promise<void> {
    // 1. Wait for Alice's /multisig/exn notification wrapping /ipex/admit.
    console.log(`[${this.alias}] Waiting for /multisig/exn notification...`);
    const notifications = await this.waitForNotification("/multisig/exn", timeoutMs);

    let admitNotification: any;
    let admitExnData: any;
    for (const notification of notifications) {
      const requests = await this.client.groups().getRequest(notification.a.d);
      if (requests.length > 0 && requests[0].exn?.e?.exn?.r === "/ipex/admit") {
        admitNotification = notification;
        admitExnData = requests[0].exn.e.exn;
        break;
      }
    }

    if (!admitNotification || !admitExnData) {
      throw new Error(`[${this.alias}] No /ipex/admit found in /multisig/exn notifications`);
    }

    const grantSaid = admitExnData.p;          // parent = the grant
    const admitDatetime = admitExnData.dt;     // datetime to match

    // Get issuer prefix from the grant exchange which is now in this agent's
    // DB (via Issuer.redeliverGrant).  This is more reliable than parsing the
    // nested admit embed where field layout may vary.
    const grantExn = await this.client.exchanges().get(grantSaid);
    const issuerPrefix = grantExn.exn.i;       // sender of the grant = issuer
    console.log(`[${this.alias}] Found admit — grant=${grantSaid}, issuer=${issuerPrefix}, dt=${admitDatetime}`);

    // 2. Create the admit using ipex().admit() with the same datetime.
    const [admit, sigs, end] = await this.client.ipex().admit({
      senderName: groupName,
      message: "",
      grantSaid: grantSaid,
      recipient: issuerPrefix,
      datetime: admitDatetime,
    });

    // 3. Submit the admit — KERIA validates the grant in this agent's DB.
    const gHab = await this.client.identifiers().get(groupName);
    const mHab = await this.client.identifiers().get(this.aidName);
    const members = await this.client.identifiers().members(groupName);
    const myPrefix = await this.getAid();
    const recp = members.signing
        .map((m: any) => m.aid)
        .filter((aid: string) => aid !== myPrefix);

    const op = await this.client
        .ipex()
        .submitAdmit(groupName, admit, sigs, end, [issuerPrefix]);

    // 4. Send /multisig/exn to other members.
    const mstate = gHab["state"];
    const seal = [
      "SealEvent",
      { i: gHab["prefix"], s: mstate["ee"]["s"], d: mstate["ee"]["d"] },
    ];
    const sigers = sigs.map((sig: string) => new Siger({ qb64: sig }));
    const ims = d(messagize(admit, sigers, seal));
    let atc = ims.substring(admit.size);
    atc += end;
    const gembeds = {
      exn: [admit, atc],
    };

    await this.client
        .exchanges()
        .send(
            this.aidName,
            "multisig",
            mHab,
            "/multisig/exn",
            { gid: gHab["prefix"] },
            gembeds,
            recp
        );

    this.pushOperation(op);
    await this.client.notifications().mark(admitNotification.i);

    console.log(`[${this.alias}] Submitted multisig admit for group ${groupName}`);
  }

  /**
   * Joins a multisig IPEX grant (presentation) initiated by another group member.
   *
   * Prerequisites: the /ipex/apply must already exist in this agent's exchange DB
   * (call Verifier.redeliverApply first) and verifier + schema OOBIs must be
   * resolved. The credential must also be available to this agent.
   *
   * Flow:
   * 1. Wait for Alice's /multisig/exn notification wrapping /ipex/grant
   *    to extract the datetime, apply SAID, and credential embeds.
   * 2. Recreate the grant with ipex().grant() using the same datetime so
   *    all members produce a grant with the same SAID.
   * 3. Call submitGrant — KERIA validates the apply exists in this
   *    agent's exchange DB.
   * 4. Send /multisig/exn to notify other members.
   */
  async joinMultisigGrant(groupName: string, timeoutMs = 60000): Promise<void> {
    // 1. Wait for /multisig/exn notification wrapping /ipex/grant.
    console.log(`[${this.alias}] Waiting for /multisig/exn (grant) notification...`);
    const notifications = await this.waitForNotification("/multisig/exn", timeoutMs);

    let grantNotification: any;
    let grantExnData: any;
    for (const notification of notifications) {
      const requests = await this.client.groups().getRequest(notification.a.d);
      if (requests.length > 0 && requests[0].exn?.e?.exn?.r === "/ipex/grant") {
        grantNotification = notification;
        grantExnData = requests[0].exn.e.exn;
        break;
      }
    }

    if (!grantNotification || !grantExnData) {
      throw new Error(`[${this.alias}] No /ipex/grant found in /multisig/exn notifications`);
    }

    const applySaid = grantExnData.p;            // parent = the apply
    const grantDatetime = grantExnData.dt;       // datetime to match
    const verifierPrefix = grantExnData.a.i;     // recipient of the grant = verifier

    // Extract credential embeds from the initiator's grant
    const acdcSerder = new Serder(grantExnData.e.acdc);
    const issSerder = new Serder(grantExnData.e.iss);
    const ancSerder = new Serder(grantExnData.e.anc);

    console.log(`[${this.alias}] Found grant — apply=${applySaid}, verifier=${verifierPrefix}, dt=${grantDatetime}`);

    // 2. Recreate the grant using the same datetime and embeds.
    const [grant, gsigs, gend] = await this.client.ipex().grant({
      senderName: groupName,
      acdc: acdcSerder,
      iss: issSerder,
      anc: ancSerder,
      recipient: verifierPrefix,
      datetime: grantDatetime,
      agreeSaid: applySaid,
    });

    // 3. Build /multisig/exn wrapping the grant — matching the wallet app's
    //    submitMultisigGrant pattern exactly.
    const gHab = await this.client.identifiers().get(groupName);
    const mHab = await this.client.identifiers().get(this.aidName);
    const members = await this.client.identifiers().members(groupName);
    const myPrefix = await this.getAid();
    const recp = members.signing
        .map((m: any) => m.aid)
        .filter((aid: string) => aid !== myPrefix);

    const mstate = gHab["state"];
    const seal = [
      "SealEvent",
      { i: gHab["prefix"], s: mstate["ee"]["s"], d: mstate["ee"]["d"] },
    ];
    const sigers = gsigs.map((sig: string) => new Siger({ qb64: sig }));
    const ims = d(messagize(grant, sigers, seal));
    let atc = ims.substring(grant.size);
    atc += gend;
    const gembeds = {
      exn: [grant, atc],
    };

    // 4. Create the /multisig/exn exchange message and submit via submitGrant.
    //    This matches the wallet app pattern: submitGrant receives the multisig
    //    exchange (not the raw grant) with member AIDs (not the verifier).
    const [exn, exnSigs, exnEnd] = await this.client
        .exchanges()
        .createExchangeMessage(
            mHab,
            "/multisig/exn",
            { gid: gHab["prefix"] },
            gembeds,
            recp[0]
        );

    const op = await this.client
        .ipex()
        .submitGrant(groupName, exn, exnSigs, exnEnd, recp);

    this.pushOperation(op);
    await this.client.notifications().mark(grantNotification.i);

    console.log(`[${this.alias}] Submitted multisig grant for group ${groupName}`);
  }

  /**
   * Initiates a multisig IPEX grant (presentation) in response to an /ipex/apply.
   *
   * This is the INITIATOR counterpart to joinMultisigGrant — the first member
   * to create and submit the grant. Other members then join via joinMultisigGrant.
   *
   * Prerequisites: the /ipex/apply must already exist in this agent's exchange DB
   * (call Verifier.redeliverApply first), verifier + schema OOBIs must be resolved,
   * and the credential must be available in this agent's credential store.
   *
   * @param groupName  - Alias of the multisig group identifier
   * @param schemaSaid - SAID of the ACDC schema to present
   * @param applySaid  - SAID of the /ipex/apply exchange (from Verifier.getApplySaid())
   */
  async initiateMultisigGrant(
      groupName: string,
      schemaSaid: string,
      applySaid: string,
  ): Promise<void> {
    // 1. Poll for the apply exchange — KERIA may not have indexed it yet.
    console.log(`[${this.alias}] Polling for apply exchange ${applySaid}...`);
    let applyExn: any;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 30000) {
      try {
        applyExn = await this.client.exchanges().get(applySaid);
        break;
      } catch (err: any) {
        if (err?.message?.includes("404") || err?.status === 404) {
          console.log(`[${this.alias}] Apply exchange not yet verified, retrying...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }
    if (!applyExn) {
      throw new Error(`[${this.alias}] Timed out waiting for apply exchange ${applySaid}`);
    }

    const verifierAid = applyExn.exn.i; // sender of the apply = verifier
    console.log(`[${this.alias}] Received apply from verifier ${verifierAid}, schema=${schemaSaid}`);

    // 3. Find the credential matching the schema in this agent's credential store.
    const creds = await this.client.credentials().list();
    const cred = creds.find((c: any) => c.sad.s === schemaSaid);
    if (!cred) {
      throw new Error(
          `[${this.alias}] No credential found for schema ${schemaSaid}`
      );
    }

    const acdcSerder = new Serder(cred.sad);
    const issSerder = new Serder(cred.iss);
    const ancSerder = new Serder(cred.anc);
    const datetime = new Date().toISOString().replace("Z", "000+00:00");

    console.log(`[${this.alias}] Initiating grant for credential ${cred.sad.d} to verifier ${verifierAid}`);

    // 3. Create /ipex/grant with the credential.
    const [grant, gsigs, gend] = await this.client.ipex().grant({
      senderName: groupName,
      acdc: acdcSerder,
      iss: issSerder,
      anc: ancSerder,
      recipient: verifierAid,
      datetime,
      agreeSaid: applySaid,
    });

    // 4. Build /multisig/exn wrapping the grant — matching the wallet app's
    //    submitMultisigGrant pattern exactly.
    const gHab = await this.client.identifiers().get(groupName);
    const mHab = await this.client.identifiers().get(this.aidName);
    const members = await this.client.identifiers().members(groupName);
    const myPrefix = await this.getAid();
    const recp = members.signing
        .map((m: any) => m.aid)
        .filter((aid: string) => aid !== myPrefix);

    const mstate = gHab["state"];
    const seal = [
      "SealEvent",
      { i: gHab["prefix"], s: mstate["ee"]["s"], d: mstate["ee"]["d"] },
    ];
    const sigers = gsigs.map((sig: string) => new Siger({ qb64: sig }));
    const ims = d(messagize(grant, sigers, seal));
    let atc = ims.substring(grant.size);
    atc += gend;
    const gembeds = {
      exn: [grant, atc],
    };

    // 5. Create the /multisig/exn exchange message and submit via submitGrant.
    //    This matches the wallet app pattern: submitGrant receives the multisig
    //    exchange (not the raw grant) with member AIDs (not the verifier).
    const [exn, exnSigs, exnEnd] = await this.client
        .exchanges()
        .createExchangeMessage(
            mHab,
            "/multisig/exn",
            { gid: gHab["prefix"] },
            gembeds,
            recp[0]
        );

    const op = await this.client
        .ipex()
        .submitGrant(groupName, exn, exnSigs, exnEnd, recp);

    this.pushOperation(op);

    console.log(`[${this.alias}] Initiated multisig grant for group ${groupName}`);
  }
}

export class RemoteJoiner extends VirtualWallet { }

export class RemoteInitiator extends VirtualWallet {

  /**
   * Creates a multisig group with all provided member AIDs (joiner AIDs, excluding initiator)
   * and proposes it to all members via /multisig/icp exchange.
   *
   * @param groupName  - Alias for the new group identifier
   * @param joinerAids - AIDs of all non-initiator members (app joiner + extra virtual members)
   * @param options    - isith (signing threshold), nsith (next key threshold), toad, wits
   * @returns groupId  - The prefix of the newly created multisig identifier
   */
  async createAndProposeGroup(
      groupName: string,
      joinerAids: string[],
      options: CreateGroupOptions = { isith: 1, nsith: 1, toad: 0, wits: [] }
  ): Promise<{ groupId: string }> {
    if (!joinerAids.length) {
      console.warn(`[${this.alias}] No joiner AIDs provided. Creating group with only the initiator as member.`);
      throw new Error("At least one joiner AID must be provided to create a group");
    }

    const myAid = await this.getAid();
    const allMemberIds = [myAid, ...joinerAids];

    console.log(`[${this.alias}] Fetching key states for all members: ${allMemberIds.join(", ")}`);
    const memberStates = await Promise.all(
        allMemberIds.map((id) => this.client.keyStates().get(id).then((s: any) => s[0]))
    );

    const group = new Group(this.client, this.aidName, groupName, memberStates);

    await group.create({
      isith: options.isith,
      nsith: options.nsith,
      toad: options.toad ?? 0,
      wits: options.wits ?? [],
      rstates: memberStates,
    });

    const groupId = await group.getPrefix();
    console.log(`[${this.alias}] Created group ${groupName} with id ${groupId}. Proposing to: ${joinerAids.join(", ")}`);
    await group.send(joinerAids);

    this.pushOperation(group.operation);

    return { groupId };
  }
}

export class Verifier extends VirtualWallet {
  private lastApply?: { serder: Serder; sigs: string[] };

  /**
   * Sends an IPEX /ipex/apply to request a credential presentation from a holder.
   *
   * @param holderAid  - AID of the holder (group or individual)
   * @param schemaSaid - SAID of the ACDC schema being requested
   * @param attributes - Optional selective-disclosure attribute filters
   */
  async requestPresentation(params: {
    holderAid: string;
    schemaSaid: string;
    attributes?: Record<string, unknown>;
  }): Promise<void> {
    console.log(
        `[${this.aidName}] Requesting presentation of schema ${params.schemaSaid} from ${params.holderAid}`
    );

    const [apply, sigs] = await this.client.ipex().apply({
      senderName: this.aidName,
      recipient: params.holderAid,
      message: "",
      schemaSaid: params.schemaSaid,
      attributes: params.attributes ?? {},
    });

    await this.client
        .ipex()
        .submitApply(this.aidName, apply, sigs, [params.holderAid]);

    // Store apply artifacts so we can re-deliver to individual members later
    this.lastApply = { serder: apply, sigs };

    console.log(
        `[${this.aidName}] Presentation request sent to ${params.holderAid}`
    );
  }

  /**
   * Returns the SAID of the last /ipex/apply sent by this verifier.
   */
  getApplySaid(): string {
    if (!this.lastApply) {
      throw new Error(`[${this.aidName}] No apply sent yet — call requestPresentation first`);
    }
    return this.lastApply.serder.ked.d;
  }

  /**
   * Re-delivers the last /ipex/apply to additional recipients so their KERIA
   * agents have the apply exchange in their own DB.
   *
   * Same pattern as Issuer.redeliverGrant — each virtual wallet's KERIA agent
   * has an isolated DB, so the apply must be delivered individually.
   */
  async redeliverApply(recipientAids: string[]): Promise<void> {
    if (!this.lastApply) {
      throw new Error(`[${this.aidName}] No apply to redeliver — call requestPresentation first`);
    }
    for (const aid of recipientAids) {
      console.log(`[${this.aidName}] Re-delivering apply to ${aid}`);
      await this.client
          .ipex()
          .submitApply(this.aidName, this.lastApply.serder, this.lastApply.sigs, [aid]);
    }
  }

  /**
   * Waits for the holder's /ipex/grant (credential presentation) and admits it.
   *
   * @param timeoutMs - Max wait time for the grant notification (default 60s)
   * @returns The credential SAID of the presented credential
   */
  async waitForPresentationAndAdmit(timeoutMs = 60000): Promise<string> {
    console.log(`[${this.aidName}] Waiting for credential presentation (/ipex/grant)...`);

    const notifications = await this.waitForNotification("/ipex/grant", timeoutMs);
    const grantNotification = notifications[0];

    // Poll for the grant exchange — KERIA may not have verified/indexed it yet
    let grantExn: any;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 30000) {
      try {
        grantExn = await this.client.exchanges().get(grantNotification.a.d);
        break;
      } catch (err: any) {
        if (err?.message?.includes("404") || err?.status === 404) {
          console.log(`[${this.aidName}] Grant exchange not yet verified, retrying...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }

    if (!grantExn) {
      throw new Error(
          `[${this.aidName}] Timed out waiting for grant exchange ${grantNotification.a.d} to be verified`
      );
    }

    const holderAid = grantExn.exn.i;
    const credentialSaid = grantExn.exn.e?.acdc?.d;

    if (!credentialSaid) {
      throw new Error(`[${this.aidName}] Grant did not contain a valid credential`);
    }

    console.log(
        `[${this.aidName}] Received presentation — credential SAID: ${credentialSaid}, from: ${holderAid}`
    );

    // Acknowledge the presentation
    const [admit, sigs, aend] = await this.client.ipex().admit({
      senderName: this.aidName,
      message: "",
      grantSaid: grantNotification.a.d,
      recipient: holderAid,
      datetime: new Date().toISOString().replace("Z", "000+00:00"),
    });

    const admitOp = await this.client
        .ipex()
        .submitAdmit(this.aidName, admit, sigs, aend, [holderAid]);

    await this.waitOperation(admitOp);
    await this.client.notifications().mark(grantNotification.i);

    console.log(`[${this.aidName}] Presentation admitted and acknowledged.`);
    return credentialSaid;
  }
}

export class Issuer extends VirtualWallet {
  private lastGrant?: { serder: Serder; sigs: string[]; end: string };

  async createRegistry(registryAlias: string) {
    console.log(`[${this.aidName}] Creating registry: ${registryAlias}`);

    const result = await this.client.registries().create({
      name: this.aidName,
      registryName: registryAlias
    });

    const op = await result.op();
    await this.waitOperation(op);
    await this.client.operations().delete(op.name);

    const registries = await this.client.registries().list(this.aidName);
    const registry = registries.find((r: any) => r.name === registryAlias);

    console.log(`[${this.aidName}] Registry ${registryAlias} created with Regk: ${registry.regk}`);
    return registry;
  }

  async issueCredential(params: {
    registry: string,
    schemaSaid: string,
    recipientId: string,
    claims: any
  }): Promise<string> {
    console.log(`[${this.aidName}] Issuing credential to ${params.recipientId}`);

    const result = await this.client.credentials().issue(
        this.aidName,
        {
          ri: params.registry,
          s: params.schemaSaid,
          a: {
            i: params.recipientId,
            ...params.claims
          }
        }
    );

    const op = await result.op;
    const operationResponse = await this.waitOperation(op);

    const credentialSaid = (operationResponse.response as any).ced.d;
    console.log(`[${this.aidName}] Credential issued. SAID: ${credentialSaid}`);
    return credentialSaid;
  }

  async grantCredential(credentialSaid: string, recipientId: string, oobiUrl?: string) {
    console.log(`[${this.aidName}] Granting credential ${credentialSaid} to ${recipientId}`);

    const acdc = await this.client.credentials().get(credentialSaid);
    const acdcSerder = new Serder(acdc.sad);
    const issSerder = new Serder(acdc.iss);
    const ancSerder = new Serder(acdc.anc);
    const datetime = new Date().toISOString().replace("Z", "000+00:00");

    let grant: Serder;
    let gsigs: string[];
    let gend: string;

    if (oobiUrl) {
      // Build grant exchange directly so we can include oobiUrl in exn.a.
      // The wallet's getInlineSchemaOobiBase() reads exn.a.oobiUrl and uses
      // it to resolve the schema, bypassing the indexer/ESSR path entirely.
      const hab = await this.client.identifiers().get(this.aidName);
      const data: Record<string, string> = { m: "", oobiUrl };

      let atc: string;
      if (acdc.ancatc) {
        atc = acdc.ancatc;
      } else {
        const keeper = (this.client as any).manager.get(hab);
        const sigs = await keeper.sign(b(ancSerder.raw));
        const sigers = sigs.map((sig: string) => new Siger({ qb64: sig }));
        const ims = d(messagize(ancSerder, sigers));
        atc = ims.substring(ancSerder.size);
      }

      const acdcAtc = d(serializeACDCAttachment(issSerder));
      const issAtc = d(serializeIssExnAttachment(ancSerder));
      const embeds = {
        acdc: [acdcSerder, acdcAtc],
        iss: [issSerder, issAtc],
        anc: [ancSerder, atc],
      };

      [grant, gsigs, gend] = await this.client.exchanges().createExchangeMessage(
          hab,
          "/ipex/grant",
          data,
          embeds,
          recipientId,
          datetime,
      );
    } else {
      [grant, gsigs, gend] = await this.client.ipex().grant({
        senderName: this.aidName,
        acdc: acdcSerder,
        iss: issSerder,
        anc: ancSerder,
        ancAttachment: acdc.ancatc,
        recipient: recipientId,
        datetime,
      });
    }

    const grantOperation = await this.client.ipex().submitGrant(
        this.aidName,
        grant,
        gsigs,
        gend,
        [recipientId]
    );

    await this.waitOperation(grantOperation);
    console.log(`[${this.aidName}] Grant completed for ${recipientId}`);

    // Store grant artifacts so we can re-deliver to additional recipients later
    this.lastGrant = { serder: grant, sigs: gsigs, end: gend };
  }

  /**
   * Re-delivers the last grant to additional recipients so their KERIA agents
   * have the grant exchange in their own habery (hby.db.exns).
   *
   * This is needed because each virtual wallet boots a separate KERIA agent
   * with its own isolated database. The original grant is only delivered to
   * the group AID endpoint (processed by Alice's app agent). Without
   * re-delivery, Bob's agent can't pass KERIA's grant validation in
   * sendMultisigExn (ipexing.py:175).
   */
  async redeliverGrant(recipientAids: string[]): Promise<void> {
    if (!this.lastGrant) {
      throw new Error(`[${this.aidName}] No grant to redeliver — call grantCredential first`);
    }
    for (const aid of recipientAids) {
      console.log(`[${this.aidName}] Re-delivering grant to ${aid}`);
      const op = await this.client.ipex().submitGrant(
          this.aidName,
          this.lastGrant.serder,
          this.lastGrant.sigs,
          this.lastGrant.end,
          [aid]
      );
      await this.waitOperation(op);
    }
  }

  async admitCredential(grantNotification: any, recipientId: string) {
    const [admit, sigs, aend] = await this.client.ipex().admit({
      senderName: this.aidName,
      message: '',
      grantSaid: grantNotification.a.d,
      recipient: recipientId,
      datetime: new Date().toISOString().replace("Z", "000+00:00"),
    });

    const admitOperation = await this.client.ipex().submitAdmit(
        this.aidName,
        admit,
        sigs,
        aend,
        [recipientId]
    );

    await this.waitOperation(admitOperation);
    await this.client.notifications().mark(grantNotification.i);
    console.log(`[${this.aidName}] Credential admitted.`);
  }
}

class Group {
  creationResult: any;
  operation: any;

  constructor(
      public client: SignifyClient,
      public userAidName: string,
      public groupAlias: string,
      public memberStates: any[]
  ) { }

  async create(params: {
    isith: number | string,
    nsith: number | string,
    toad: number,
    wits: string[],
    rstates?: any[],
    delpre?: string
  }) {
    const mhab = await this.client.identifiers().get(this.userAidName);

    const result = await this.client.identifiers().create(this.groupAlias, {
      algo: Algos.group,
      mhab,
      isith: params.isith,
      nsith: params.nsith,
      toad: params.toad,
      wits: params.wits,
      states: this.memberStates,
      rstates: params.rstates || this.memberStates,
      ...(params.delpre && { delpre: params.delpre }),
    });

    this.creationResult = result;
    this.operation = await result.op();
    return this;
  }

  async send(recipients: string[]) {
    if (!this.creationResult) throw new Error("Group not created yet");

    const serder = this.creationResult.serder;
    const sigers = this.creationResult.sigs.map((sig: string) => new Siger({ qb64: sig }));

    const ims = d(messagize(serder, sigers));
    const atc = ims.substring(serder.size);
    const embeds = { icp: [serder, atc] };

    const mhab = await this.client.identifiers().get(this.userAidName);
    const smids = this.memberStates.map((s: any) => s.i);

    return this.client.exchanges().send(
        this.userAidName,
        this.groupAlias,
        mhab,
        "/multisig/icp",
        { gid: serder.pre, smids, rmids: smids },
        embeds,
        recipients
    );
  }

  async getPrefix(): Promise<string> {
    if (this.creationResult?.serder?.pre) return this.creationResult.serder.pre;
    const id = await this.client.identifiers().get(this.groupAlias);
    return id.prefix;
  }
}

export class Role {
  user: VirtualWallet;
  alias: string;
  addResult?: any;
  addOperation?: any;
  isMultisig: boolean;
  dt: string;

  constructor(user: VirtualWallet, alias: string = user.aidName, isMultisig: boolean = false) {
    this.user = user;
    this.alias = alias;
    this.isMultisig = isMultisig;
    this.dt = new Date().toISOString().replace("Z", "000+00:00");
  }

  async add(role: string = "agent", eventIdentifier?: string) {
    let eid;
    if (eventIdentifier) {
      eid = eventIdentifier;
    } else if (this.isMultisig) {
      const ghab = await this.user.client.identifiers().get(this.alias);
      eid = ghab.prefix;
    }
    else {
      if (!this.user.client.agent?.pre) return;
      eid = this.user.client.agent.pre;
    }

    const result = await this.user.client.identifiers().addEndRole(
        this.alias,
        role,
        eid,
        this.dt
    );

    const op = await result.op();
    this.addResult = result;
    this.addOperation = op;

    return this;
  }

  async send(recipients: string[]) {
    console.log(`${this.user.aidName} sending endRole to ${recipients.join(', ')}`)
    const ghab = await this.user.client.identifiers().get(this.alias);
    const seal = [
      'SealEvent',
      {
        i: ghab['prefix'],
        s: ghab['state']['ee']['s'],
        d: ghab['state']['ee']['d'],
      }
    ]

    const rpy = this.addResult.serder;
    const sigers = this.addResult.sigs.map((sig: string) => new Siger({ qb64: sig }));

    const roleims = d(
        messagize(rpy, sigers, seal, undefined, undefined, false)
    );
    const atc = roleims.substring(rpy.size);
    const embeds = { rpy: [rpy, atc] };

    const aid = await this.user.client.identifiers().get(this.user.aidName);
    return this.user.client.exchanges().send(
        this.user.aidName,
        "multisig",
        aid,
        "/multisig/rpy",
        { gid: ghab.prefix },
        embeds,
        recipients
    );
  }

  async acknowledge(notification: any) {
    console.log(`${this.user.aidName} akcnoledge endRole`)
    this.dt = notification.e.rpy.dt;

    const result = await this.user.client.identifiers().addEndRole(
        this.alias,
        notification.e.rpy.a.role,
        notification.e.rpy.a.eid,
        notification.e.rpy.dt
    );
    const op = await result.op();
    this.addResult = result;
    this.addOperation = op;

    return this;
  }
}
