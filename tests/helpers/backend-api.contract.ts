/**
 * Contract for E2E tests and backend (KERIA/Signify) helpers.
 * Tests use these types; the implementation lives in the helper you wire from backend-helpers.ts.
 * URLs come from getKeriaUrlsForTestRunner() in ssi-agent-urls.helper.ts.
 */

import {
  Algos,
  d,
  messagize,
  randomPasscode,
  ready,
  Siger,
  SignifyClient,
  Tier,
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

// --- KERIA bootstrap ---

/** Check KERIA is up (e.g. GET boot). Throw with a clear message if not. */
export type InitKeria = () => Promise<void>;

// --- Backend user (OOBI provider: app is initiator, backend is member) ---

export interface GetOobiOptions {
  role?: string;
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
  wits?: string[];
  isith?: number;
  nsith?: number;
  toad?: number;
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

/** Factory to create a standard Joiner (VirtualWallet) */
export const createBackendUser = async (
  alias: string,
  config: KeriaConfig,
  witnessesConfig: WitnessesConfig
): Promise<VirtualWallet> => {
  await ready();
  const user = new VirtualWallet(alias, config);
  await user.init(witnessesConfig);
  return user;
};

/** Factory to create an Initiator (RemoteInitiator) */
export const createRemoteInitiator = async (
  alias: string,
  config: KeriaConfig,
  witnessesConfig: WitnessesConfig
): Promise<RemoteInitiator> => {
  await ready();
  const user = new RemoteInitiator(alias, config);
  await user.init(witnessesConfig);
  return user;
};

const TEST_WITNESSES: string[] = []; //TODO: @ash figure out how to get them

export class VirtualWallet {
  public client: SignifyClient;
  public aidName: string;
  public prefix: string | undefined;
  public oobi?: string;

  constructor(
    public alias: string,
    protected config: KeriaConfig,
    protected passcode: string = randomPasscode()
  ) {
    this.client = new SignifyClient(config.connectUrl, this.passcode, Tier.low, config.bootUrl);
    this.aidName = `${alias}_AID`;
  }

  async init(witnesses: WitnessesConfig): Promise<void> {
    await this.client.boot();
    await this.client.connect();

    try {
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
    } catch (e) {
      if (e instanceof Error) console.error(`[${this.alias}] Failed init: ${e.message}`);
    }
  }

  async getAid(): Promise<string> {
    if (!this.prefix) throw new Error("User not initialized");
    return this.prefix;
  }

  async resolveOobi(oobi: string, alias: string): Promise<void> {
    console.log(`[${this.alias}] Resolving OOBI for ${alias}...`);
    try {
      const op = await this.client.oobis().resolve(oobi, alias);
      await this.waitOperation(op);
    } catch (e) {
      console.warn(`[${this.alias}] OOBI resolution warning (might be resolved). ${e}`);
    }
  }

  async generateOobi(role: string = "agent") {
    console.log(`[${this.alias}] Generating OOBI`);
    const result = await this.client.oobis().get(this.aidName, role);
    this.oobi = result.oobis[0];
  }


  async getOobi(options?: GetOobiOptions): Promise<string> {
    const role = options?.role || "agent";
    const result = await this.client.oobis().get(this.aidName, role);
    let url = result.oobis[0];
    if (!url || typeof url !== "string") {
      throw new Error("KERIA oobis.get returned no OOBI URL");
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      const base = this.config.connectUrl.replace(/\/$/, "");
      url = url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
    }
    if (options?.alias != null || options?.groupId != null || options?.groupName != null) {
      const u = new URL(url);
      if (options.alias != null) u.searchParams.set("name", options.alias);
      if (options.groupId != null) u.searchParams.set("groupId", options.groupId);
      if (options.groupName != null) u.searchParams.set("groupName", options.groupName);
      url = u.toString();
    }
    return url;
  }

  async acceptGroupInvitation(timeoutMs: number = 30000, groupName: string = "MultisigGroup"): Promise<void> {
    console.log(`[${this.alias}] Waiting for group invitation (multisig/icp)...`);

    const notifications = await this.waitForNotification("/multisig/icp", timeoutMs);
    console.log(notifications)
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

    await this.waitOperation(group.operation);
    console.log(`[${this.alias}] Successfully joined group.`);
  }

  async waitOperation(operation: any, timeoutMs = 30000) {
    return this.client.operations().wait(
      operation,
      { signal: AbortSignal.timeout(timeoutMs) }
    );
  }

  protected async waitForNotification(route: string, timeoutMs: number, interval = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const { notes } = await this.client.notifications().list();
        const filtered = notes.filter((n: any) => n.a.r === route && n.r === false);
        if (filtered.length > 0) return filtered;
      } catch (e) {
        // ignore fetch errors and retry
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Timeout waiting for notification on route ${route}`);
  }
}

export class RemoteInitiator extends VirtualWallet {

  // async createAndProposeGroup(groupName: string, options: CreateGroupOptions): Promise<string> {
  //   const myAid = await this.getAid();

  //   const allMemberIds = [myAid, ...options.members];
  //   const uniqueIds = Array.from(new Set(allMemberIds));

  //   const memberStates = [];
  //   for (const memberId of uniqueIds) {
  //     const state = await this.client.keyStates().get(memberId);
  //     if (!state || state.length === 0) {
  //       throw new Error(`State not found for member ${memberId}. Call resolveOobi first.`);
  //     }
  //     memberStates.push(state[0]);
  //   }

  //   const group = new Group(this.client, this.aidName, groupName, memberStates);

  //   await group.create({
  //     isith: options.isith || 2,
  //     nsith: options.nsith || 2,
  //     toad: options.toad || 2,
  //     wits: options.wits || TEST_WITNESSES
  //   });

  //   const recipients = options.members;
  //   console.log(`[${this.alias}] Proposing group ${groupName} to ${recipients.join(', ')}`);
  //   await group.send(recipients);

  //   await this.waitOperation(group.operation);

  //   return group.getPrefix();
  // }
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
    isith?: number | string,
    nsith?: number | string,
    toad?: number,
    wits?: string[],
    rstates?: any[],
    delpre?: string
  }) {
    const mhab = await this.client.identifiers().get(this.userAidName);

    const result = await this.client.identifiers().create(this.groupAlias, {
      algo: Algos.group,
      mhab,
      isith: params.isith || 2,
      nsith: params.nsith || 2,
      toad: params.toad || 2,
      wits: params.wits || TEST_WITNESSES,
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
