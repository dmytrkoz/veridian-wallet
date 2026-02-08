/**
 * E2E helper for 2-of-2 multisig group:
 *   User("Initiator") in this file = Bob on host
 *   app (Alice) — resolves our OOBI via Scan; we resolve Joiner's OOBI from app Provide tab
 *
 * BE_HELP: Comments marked "BE_HELP" are places where we need your input (API shape, errors, timing).
 */
import {
  Algos,
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

const OP_POLL_INTERVAL_MS = 2000;
const GROUP_OP_TIMEOUT_MS = 60000;
const INITIATOR_BRAN = process.env.REMOTE_INITIATOR_BRAN ?? "0AAAAAAAAAAAAAAAAAAAA";

/** BE_HELP:
 *  If group creation should use different witness config, please confirm. */
function getWitnessConfigFromHab(mHab: HabState): { toad: number; wits: string[] } {
  const toad = Number(mHab.state?.bt ?? 0);
  const wits = (mHab.state?.b as string[]) ?? [];
  return { toad, wits };
}

export async function init(): Promise<void> {
  await ready();
  const { bootUrl } = getKeriaUrlsForTestRunner();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(bootUrl + "/boot", { method: "GET", signal: controller.signal });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `KERIA not reachable at ${bootUrl} (${msg}). Start KERIA on host (e.g. docker-compose up -d keria).`
    );
  }
  clearTimeout(t);
}

export class User {
  private static instance: User | null = null;

  public client!: SignifyClient;
  public prefix!: string;
  public aidAlias: string;

  constructor(prefixArg: string) {
    this.aidAlias = `${prefixArg}_AID`;
  }

  static getInstance(prefixArg = "Initiator"): User {
    if (User.instance == null) {
      User.instance = new User(prefixArg);
    }
    return User.instance;
  }

  static reset(): void {
    User.instance = null;
  }

  async setup(): Promise<void> {
    await init();
    const { bootUrl, connectUrl } = getKeriaUrlsForTestRunner();

    this.client = new SignifyClient(connectUrl, INITIATOR_BRAN, Tier.low, bootUrl);

    try {
      const bootResult = await this.client.boot();
      if (!bootResult.ok && bootResult.status !== 409) {
        throw new Error(`KERIA boot failed with status ${bootResult.status}`);
      }
      await this.client.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
        throw new Error(`Cannot reach KERIA at ${bootUrl}. Ensure KERIA is running.`);
      }
      throw err;
    }

    try {
      const createResult = await this.client.identifiers().create(this.aidAlias, { algo: Algos.salty });
      this.prefix = createResult.serder.pre;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/400/gi.test(msg) && /already incepted/gi.test(msg)) {
        const hab = await this.client.identifiers().get(this.aidAlias);
        this.prefix = hab.prefix;
      } else {
        throw err;
      }
    }

    const role = new Role(this);
    await role.add("agent");
    if (role.addOperation) await this.waitOperation(role.addOperation);
  }

  AID = {
    get: async (alias = this.aidAlias) => this.client.identifiers().get(alias),
  };

  oobi = {
    /** Same as backend oobi.resolve(oobiUrl, contactAlias). */
    resolve: async (oobiUrl: string, contactAlias: string): Promise<void> => {
      const op = await this.client.oobis().resolve(oobiUrl, contactAlias);
      const completed = await this.waitOperation(op);
      await this.client.operations().delete(completed.name);
    },
    get: async () => {
      const result = await this.client.oobis().get(this.aidAlias);
      if (!result.oobis?.[0]) throw new Error("No OOBI for Initiator member AID");
      return result.oobis[0];
    },
  };

  async getState(aid: string): Promise<State> {
    const states = await this.client.keyStates().get(aid);
    if (!states?.[0]) throw new Error(`No key state for AID ${aid}`);
    return states[0];
  }

  /** BE_HELP: 
   *  We poll operations().get() until op.done. If signify-ts has wait(), we can align. */
  async waitOperation(operation: { name: string }, timeoutMs = 30000): Promise<{ name: string; done?: boolean; error?: unknown }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const op = await this.client.operations().get(operation.name);
        if (op?.done === true) return op as { name: string; done: boolean; error?: unknown };
      } catch (_) {}
      await new Promise((r) => setTimeout(r, OP_POLL_INTERVAL_MS));
    }
    throw new Error(`Operation ${operation.name} did not complete within ${timeoutMs}ms`);
  }

  // ---------- E2E-specific: OOBI for app (with groupId/groupName so resolveGroupConnection accepts) ----------
  /** Returns OOBI URL; options.groupId/groupName are for app's group connection flow. */
  async getOobi(options?: { alias?: string; groupId?: string; groupName?: string }): Promise<string> {
    const base = await this.oobi.get();
    const oobi = new URL(base);
    if (options?.alias != null) oobi.searchParams.set("name", options.alias);
    if (options?.groupId != null) oobi.searchParams.set("groupId", options.groupId);
    if (options?.groupName != null) oobi.searchParams.set("groupName", options.groupName);
    return oobi.toString();
  }

  /** After Joiner (app) has resolved our OOBI, we resolve Joiner's OOBI from app Provide tab; then contacts list has Joiner.
   *  BE_HELP: contacts().list() shape — we handle both array and { contacts: [] }. Confirm which KERIA returns. */
  async getJoinerMemberPrefixFromContacts(): Promise<string | null> {
    const list = await this.client.contacts().list();
    const contacts = Array.isArray(list) ? list : (list as { contacts?: { id?: string }[] }).contacts ?? [];
    const other = contacts.find((c: { id?: string }) => c.id && c.id !== this.prefix);
    return (other as { id: string } | undefined)?.id ?? null;
  }

  /** For debugging when getJoinerMemberPrefixFromContacts() returns null. */
  async getContactsDebug(): Promise<{ count: number; ids: string[]; initiatorId: string }> {
    const list = await this.client.contacts().list();
    const contacts = Array.isArray(list) ? list : (list as { contacts?: { id?: string }[] }).contacts ?? [];
    const ids = (contacts as { id?: string }[]).map((c) => c.id ?? "").filter(Boolean);
    return { count: ids.length, ids, initiatorId: this.prefix };
  }

  /** create group (create + submit inception), then send /multisig/icp to Joiner. Returns groupId. */
  async propose2of2Group(joinerMemberPrefix: string, groupName: string): Promise<string> {
    const joinerState = await this.getState(joinerMemberPrefix);
    const mHab = await this.AID.get() as HabState;
    const myState = await this.getState(this.prefix);
    const memberStates = [myState, joinerState];
    const group = new Group(this, groupName, memberStates);
    await group.create();
    await group.send([joinerMemberPrefix]);
    return group.creationResult!.serder.pre;
  }

  /**submit group inception first (anchor on witnesses), then app scans our OOBI; then we send exchange. Returns groupId. */
  async anchorGroup(joinerMemberPrefix: string, groupName: string): Promise<string> {
    const joinerState = await this.getState(joinerMemberPrefix);
    const myState = await this.getState(this.prefix);
    const memberStates = [myState, joinerState];
    const group = new Group(this, groupName, memberStates);
    await group.create();
    return group.creationResult!.serder.pre;
  }

  /** BE_HELP: Poll until group op is done;  Confirm op name shape "group.<groupId>". */
  async waitForGroupOperationComplete(groupId: string, timeoutMs = GROUP_OP_TIMEOUT_MS): Promise<void> {
    const opName = `group.${groupId}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const op = await this.client.operations().get(opName) as { done?: boolean; error?: unknown };
        if (op?.done === true) {
          if (op.error) throw new Error(`Group inception failed: ${String(op.error)}`);
          return;
        }
      } catch (e) {
        if (Date.now() >= deadline) throw e;
      }
      await new Promise((r) => setTimeout(r, OP_POLL_INTERVAL_MS));
    }
    throw new Error(`Group inception did not complete within ${timeoutMs}ms (op: ${opName})`);
  }

  getClient(): SignifyClient {
    return this.client;
  }
}

export class Role {
  user: User;
  alias: string;
  addOperation?: { name: string };

  constructor(user: User, alias: string = user.aidAlias) {
    this.user = user;
    this.alias = alias;
  }

  async add(role: string = "agent"): Promise<this> {
    const agentPre = (this.user.client as SignifyClient & { agent?: { pre: string } }).agent?.pre;
    if (!agentPre) return this;
    try {
      const result = await this.user.client.identifiers().addEndRole(this.alias, role, agentPre);
      const op = await result.op();
      this.addOperation = op;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/400/gi.test(msg) && /already/gi.test(msg)) {
        // Role already added
      } else {
        throw err;
      }
    }
    return this;
  }
}

export class Group {
  user: User;
  name: string;
  memberStates: State[];
  creationResult!: { serder: Serder; sigs: string[]; icp: unknown };

  constructor(user: User, name: string, memberStates: State[]) {
    this.user = user;
    this.name = name;
    this.memberStates = memberStates;
  }

  async create(): Promise<this> {
    const client = this.user.client;
    const mHab = (await this.user.AID.get()) as HabState;
    const { toad, wits } = getWitnessConfigFromHab(mHab);

    const inceptionData: CreateIdentifierBody = await client.identifiers().createInceptionData(this.name, {
      algo: Algos.group,
      mhab: mHab,
      isith: 2,
      nsith: 2,
      toad,
      wits,
      states: this.memberStates,
      rstates: this.memberStates,
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
    this.creationResult = {
      serder,
      sigs: inceptionData.sigs,
      icp: inceptionData.icp,
    };
    return this;
  }

  async send(recipients: string[]): Promise<void> {
    const serder = this.creationResult.serder;
    const sigers = this.creationResult.sigs.map((sig: string) => new Siger({ qb64: sig }));
    const ims = d(messagize(serder, sigers));
    const atc = ims.substring(serder.size);
    const embeds = { icp: [serder, atc] };
    const mHab = (await this.user.AID.get()) as HabState;
    const smids = this.memberStates.map((s) => s.i);

    await this.user.client.exchanges().send(
      this.user.prefix,
      "multisig",
      mHab,
      MULTISIG_ICP_ROUTE,
      { gid: serder.pre, smids, rmids: smids },
      embeds,
      recipients
    );
  }
}

export { User as RemoteInitiator };

export async function setupRemoteInitiator(): Promise<User> {
  const user = User.getInstance("Initiator");
  await user.setup();
  return user;
}
