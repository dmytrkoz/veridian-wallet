import { After, Given, When, Then } from "@wdio/cucumber-framework";
import type { DataTable } from "@cucumber/cucumber";
import { browser, driver } from "@wdio/globals";
import ProfileSetupScreen from "../../screen-objects/onboarding/profile-setup.screen.js";
import {
  RemoteInitiator,
  RemoteJoiner,
  createRemoteInitiator,
  createRemoteJoiner,
} from "../../helpers/backend-api.contract.js";
import { getKeriaUrlsForTestRunner } from "../../helpers/ssi-agent-urls.helper.js";

const GROUP_ID_MISMATCH_MSG = "Connection not part of this group";
const DEFAULT_WITNESSES_CONFIG = { toad: 0, witnesses: [] };

// ---------------------------------------------------------------------------
// World context shared across steps in one scenario
// ---------------------------------------------------------------------------

type BobJoinerWorld = {
  bobGroupName?: string;
  /** Alice's OOBI with pendingGroupId, ready for Bob to paste in the Join-Group scan screen */
  aliceOobiForJoin?: string;
  /** Bob's raw OOBI captured from the app's Share tab */
  bobSharedOobi?: string;
  remoteInitiator?: RemoteInitiator;
  extraVirtualMembers?: Record<string, RemoteJoiner>;
  /** KERI prefix of the created multisig group */
  groupId?: string;
};

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

async function pageShowsMessage(msg: string): Promise<boolean> {
  return (await browser.execute((m: string) => {
    const bodyText = document.body?.innerText ?? "";
    if (bodyText.includes(m)) return true;
    const toasts = document.querySelectorAll("ion-toast");
    for (const toast of Array.from(toasts)) {
      const root = (toast as HTMLElement).shadowRoot;
      if (!root) continue;
      const messageEl =
        root.querySelector(".toast-message") ??
        root.querySelector("[part='message']");
      if ((messageEl?.textContent?.trim() ?? "").includes(m)) return true;
    }
    return false;
  }, msg)) as boolean;
}

async function pasteOobiAndConfirm(oobi: string): Promise<void> {
  const pasteButton = $("[data-testid='paste-content-button']");
  await pasteButton.waitForDisplayed({ timeout: 10000 });
  await pasteButton.click();
  await browser.pause(800);

  const scanInput = $("[data-testid='scan-input']");
  await scanInput.waitForDisplayed({ timeout: 5000 });
  try {
    await scanInput.setValue(oobi);
  } catch {
    await browser.execute(
      (o: string) => {
        const el = document.querySelector(
          "[data-testid='scan-input']"
        ) as HTMLInputElement & { shadowRoot?: ShadowRoot };
        if (!el) return;
        const input = el.shadowRoot?.querySelector("input") ?? el;
        if (input) {
          (input as HTMLInputElement).value = o;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("ionInput", { bubbles: true }));
        }
      },
      oobi
    );
  }
  await browser.pause(300);
  const confirmBtn = $(
    "[data-testid='scan-input-modal'] [data-testid='action-button']"
  );
  await confirmBtn.waitForDisplayed({ timeout: 5000 });
  await confirmBtn.click();
}

async function assertGroupProfileActiveInProfilesList(
  displayName: string
): Promise<void> {
  const avatarBtn = $("[data-testid='avatar-button']");
  await avatarBtn.waitForDisplayed({ timeout: 10000 });
  await avatarBtn.click();
  await browser.pause(500);

  const result = await browser.execute(
    (name: string) => {
      const want = (name || "").trim().toLowerCase();
      const root = document.querySelector("[data-testid='profiles']");
      if (!root)
        return {
          active: false,
          reason: "profiles panel not found",
          profileId: null as string | null,
        };
      const items = root.querySelectorAll(
        "[data-testid^='profiles-list-item-']"
      );
      for (const item of items) {
        const nameEl = item.querySelector(".profiles-list-item-name");
        const currentName = (nameEl?.textContent?.trim() ?? "").toLowerCase();
        if (currentName !== want) continue;
        const testId = item.getAttribute("data-testid") ?? "";
        const id = testId.replace(/^profiles-list-item-/, "");
        const hasPending = !!item.querySelector(
          `[data-testid='profiles-list-item-pending-${id}-status']`
        );
        const hasAction = !!item.querySelector(
          `[data-testid='profiles-list-item-action-${id}-status']`
        );
        return {
          active: !hasPending && !hasAction,
          reason: hasPending ? "pending" : hasAction ? "action_required" : "ok",
          profileId: id || null,
        };
      }
      return {
        active: false,
        reason: "profile not found",
        profileId: null as string | null,
      };
    },
    displayName
  );

  if (!result?.active) {
    throw new Error(
      `Group profile "${displayName}" is not active in Profiles list (reason: ${result?.reason ?? "unknown"}).`
    );
  }
  if (result?.profileId) {
    const profileListItem = $(
      `[data-testid='profiles-list-item-${result.profileId}']`
    );
    await profileListItem.waitForDisplayed({ timeout: 5000 });
    await profileListItem.click();
    await browser.pause(500);
  }
  const manageProfileBtn = $(
    "[data-testid='profiles-option-button-manage profile']"
  );
  await manageProfileBtn.waitForDisplayed({ timeout: 5000 });
  await manageProfileBtn.click();
  await browser.pause(500);
}

/**
 * Extracts the AID (prefix) from a standard KERIA OOBI URL.
 * Format: http://<host>:<port>/oobi/<aid>/agent/<eid>
 */
function extractAidFromOobi(oobiUrl: string): string {
  const url = new URL(oobiUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const oobiIdx = pathParts.indexOf("oobi");
  if (oobiIdx === -1 || oobiIdx >= pathParts.length - 1) {
    throw new Error(`Cannot extract AID from OOBI URL: ${oobiUrl}`);
  }
  return pathParts[oobiIdx + 1];
}

/**
 * Replace only the hostname in a KERIA OOBI URL so the receiving party
 * can reach KERIA. The port is intentionally preserved from the original URL
 * because KERIA may serve OOBIs on a different port (e.g. 3902) than the
 * connect API (3901).
 *
 * Never use appUrls.connectUrl (10.0.2.2) here: that IP is only meaningful
 * inside the Android emulator and is NOT reachable from Docker containers.
 */
function normalizeOobiHostname(oobiUrl: string, targetConnectUrl: string): string {
  const u = new URL(oobiUrl);
  u.hostname = new URL(targetConnectUrl).hostname;
  return u.toString();
}

// ---------------------------------------------------------------------------
// Step 1 (BACKEND) – Alice creates a pending group so Bob can join
// ---------------------------------------------------------------------------

Given(
  /^the remote initiator Alice creates a pending group "([^"]+)"$/,
  async function (groupName: string) {
    const world = this as BobJoinerWorld;
    world.bobGroupName = groupName;

    const testRunnerUrls = getKeriaUrlsForTestRunner();

    const initiator = await createRemoteInitiator(
      "Alice",
      testRunnerUrls,
      DEFAULT_WITNESSES_CONFIG
    );
    world.remoteInitiator = initiator;
    await initiator.generateOobi();

    const aliceAid = await initiator.getAid();

    const rawOobi = await initiator.getOobi({
      alias: "Alice",
      groupId: aliceAid,
      groupName,
    });

    world.aliceOobiForJoin = normalizeOobiHostname(
      rawOobi,
      testRunnerUrls.connectUrl
    );

    console.log(`[Alice] raw OOBI: ${rawOobi}`);
    console.log(
      `[Alice] Pending group "${groupName}" ready. OOBI for app: ${world.aliceOobiForJoin}`
    );
  }
);

// ---------------------------------------------------------------------------
// Step 2 (UI) – Bob clicks "Join Group", pastes Alice's OOBI, creates member AID
// ---------------------------------------------------------------------------

Given(/^Bob scans Alice's group OOBI to join as a member$/, async function () {
  const world = this as BobJoinerWorld;
  if (!world.aliceOobiForJoin) {
    throw new Error(
      "Alice's OOBI is not ready. Run the 'remote initiator creates a pending group' step first."
    );
  }

  // ── Profile type selection ────────────────────────────────────────────────
  await ProfileSetupScreen.selectGroupProfile();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForGroupSetupScreen();

  // ── Click "Join Group" → QR scan screen opens ────────────────────────────
  await ProfileSetupScreen.joinGroupButton.waitForDisplayed({ timeout: 10000 });
  await ProfileSetupScreen.joinGroupButton.click();
  await browser.pause(1000);

  // ── Paste Alice's OOBI (with groupId) on the scan screen ─────────────────
  await pasteOobiAndConfirm(world.aliceOobiForJoin);
  await browser.pause(1500);

  // ── Step A: GroupSetupConfirm ─────────────────────────────────────────────
  await browser.waitUntil(
    async () => {
      const confirmScreenExists = await $(".join-group-details")
        .isExisting()
        .catch(() => false);
      return confirmScreenExists;
    },
    {
      timeout: 20000,
      timeoutMsg:
        'App did not show "Joined group" confirmation screen after pasting Alice\'s OOBI',
    }
  );
  console.log("[Bob] GroupSetupConfirm screen detected – clicking Next: setup profile");
  await $("[data-testid='primary-button-profile-setup']").click();
  await browser.pause(800);

  // ── Step B: SetupProfile (username input) ────────────────────────────────
  await ProfileSetupScreen.waitForProfileSetupScreen();
  await ProfileSetupScreen.enterUsername("Bob");
  await browser.pause(500);
  await $("[data-testid='primary-button-profile-setup']").click();
  console.log("[Bob] Submitted username – waiting for Welcome screen");
  await browser.pause(1000);

  // ── Step C: FinishSetup (Welcome / Get started) ───────────────────────────
  await browser.waitUntil(
    async () => {
      const welcomeExists = await ProfileSetupScreen.welcomeTitle
        .isExisting()
        .catch(() => false);
      const url = await browser.getUrl().catch(() => "");
      return welcomeExists || url.includes("group-profile-setup");
    },
    {
      timeout: 20000,
      timeoutMsg: "App did not show Welcome screen or group-profile-setup after creating Bob's AID",
    }
  );
  const urlAfterCreate = await browser.getUrl().catch(() => "");
  if (!urlAfterCreate.includes("group-profile-setup")) {
    console.log("[Bob] Welcome screen detected – clicking Get started");
    await $("[data-testid='primary-button-profile-setup']").click();
    await browser.pause(1000);
  }

  // ── Step D: Wait for group-profile-setup page ────────────────────────────
  await browser.waitUntil(
    async () => {
      const url = await browser.getUrl();
      return url.includes("group-profile-setup");
    },
    {
      timeout: 20000,
      timeoutMsg: "Did not reach group-profile-setup after Bob created his member AID",
    }
  );
  console.log("[Bob] Reached group-profile-setup page");
  await browser.pause(2000);

  // ── Capture Bob's OOBI from the Share (Provide) tab ──────────────────────
  await browser.waitUntil(
    async () => {
      const provideTab = $("[data-testid='share-oobi-segment-button']");
      const isVisible = await provideTab.isDisplayed().catch(() => false);
      if (!isVisible) return false;
      await provideTab.click();
      await browser.pause(500);
      return $(".share-profile-oobi").isExisting().catch(() => false);
    },
    {
      timeout: 15000,
      interval: 1000,
      timeoutMsg: "Could not activate the Provide tab on group-profile-setup",
    }
  );
  console.log("[Bob] Provide tab activated – waiting for OOBI to load");

  const installShareCapture = `
    (function() {
      window.__lastSharedOobi = undefined;
      var cap = window.Capacitor;
      if (!cap || typeof cap.nativePromise !== 'function') return;
      var orig = cap.nativePromise.bind(cap);
      cap.nativePromise = function(pluginName, methodName, options) {
        if (pluginName === 'Share' && methodName === 'share' && options && options.text)
          window.__lastSharedOobi = options.text;
        return orig(pluginName, methodName, options);
      };
    })();
  `;
  await browser.execute(installShareCapture);

  await browser.waitUntil(
    async () => {
      const revealed = await $(".share-profile-body-component.share-qr.reveal")
        .isExisting()
        .catch(() => false);
      return revealed;
    },
    {
      timeout: 30000,
      interval: 1000,
      timeoutMsg: "Bob's OOBI QR code did not reveal within 30 s (OOBI still loading)",
    }
  );
  console.log("[Bob] OOBI QR code revealed – clicking share button");

  const shareButton = $(".share-profile-oobi .share-button");
  await shareButton.waitForDisplayed({ timeout: 5000 });
  await shareButton.scrollIntoView?.().catch(() => {});

  let bobOobiUrl: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await shareButton.click();
    await browser.pause(1000);
    bobOobiUrl = (await browser.execute(
      () =>
        (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi
    )) as string | undefined;
    if (bobOobiUrl) break;
    console.log(`[Bob] Share attempt ${attempt}: OOBI not captured yet, retrying…`);
    await browser.pause(500);
  }

  if (!bobOobiUrl) {
    throw new Error("Could not capture Bob's OOBI from the Share button after 3 attempts");
  }
  world.bobSharedOobi = bobOobiUrl;
  console.log(`[Bob] OOBI captured: ${bobOobiUrl}`);

  await driver.pressKeyCode(4);
  await browser.pause(500);
});

// ---------------------------------------------------------------------------
// Step 3 (BACKEND) – Alice + extra virtual members resolve Bob's OOBI
// ---------------------------------------------------------------------------

Given(
  /^Alice and the following extra virtual members resolve Bob's OOBI:$/,
  async function (dataTable: DataTable) {
    const world = this as BobJoinerWorld;
    if (!world.bobSharedOobi) {
      throw new Error(
        "Bob's OOBI must be captured first (run the 'Bob scans Alice's OOBI' step)."
      );
    }
    if (!world.remoteInitiator) {
      throw new Error(
        "Remote initiator (Alice) is not set up. Run the 'remote initiator creates a pending group' step first."
      );
    }

    const testRunnerUrls = getKeriaUrlsForTestRunner();

    const extraNames = dataTable
      .hashes()
      .flatMap((r) => r.name.split(",").map((n: string) => n.trim()))
      .filter((n) => n.length > 0);

    world.extraVirtualMembers = {};

    for (const name of extraNames) {
      const joiner = await createRemoteJoiner(
        name,
        testRunnerUrls,
        DEFAULT_WITNESSES_CONFIG
      );
      world.extraVirtualMembers[name] = joiner;
      await joiner.generateOobi();
      console.log(`[${name}] Virtual member created`);
    }

    const bobOobiForBackend = normalizeOobiHostname(
      world.bobSharedOobi!,
      testRunnerUrls.connectUrl
    );

    const aliceOobiForBackend = normalizeOobiHostname(
      world.remoteInitiator.oobi!,
      testRunnerUrls.connectUrl
    );

    await world.remoteInitiator.resolveOobi(bobOobiForBackend, "Bob");
    console.log("[Alice] Resolved Bob's OOBI");

    for (const [name, joiner] of Object.entries(world.extraVirtualMembers)) {
      await joiner.resolveOobi(bobOobiForBackend, "Bob");
      await joiner.resolveOobi(aliceOobiForBackend, "Alice");

      const joinerOobiForBackend = normalizeOobiHostname(
        joiner.oobi!,
        testRunnerUrls.connectUrl
      );
      await world.remoteInitiator.resolveOobi(joinerOobiForBackend, name);
      console.log(`[Alice] Resolved ${name}'s OOBI`);
      console.log(`[${name}] Resolved Alice's and Bob's OOBIs`);
    }

    const extraEntries = Object.entries(world.extraVirtualMembers);
    for (let i = 0; i < extraEntries.length; i++) {
      for (let j = 0; j < extraEntries.length; j++) {
        if (i === j) continue;
        const [jName, jJoiner] = extraEntries[j];
        const jOobiNorm = normalizeOobiHostname(
          jJoiner.oobi!,
          testRunnerUrls.connectUrl
        );
        await extraEntries[i][1].resolveOobi(jOobiNorm, jName);
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Step 4 (BACKEND) – Alice creates the actual KERI group and proposes it
// ---------------------------------------------------------------------------

When(
  /^Alice creates a (\d+)-of-(\d+) multisig group "([^"]+)" and proposes it to all members$/,
  async function (requiredStr: string, recoveryStr: string, groupName: string) {
    const world = this as BobJoinerWorld;
    if (!world.remoteInitiator) {
      throw new Error("Remote initiator (Alice) is not set up.");
    }
    if (!world.bobSharedOobi) {
      throw new Error("Bob's OOBI has not been captured.");
    }

    const required = parseInt(requiredStr, 10);
    const recovery = parseInt(recoveryStr, 10);

    const bobAid = extractAidFromOobi(world.bobSharedOobi);

    const extraAids: string[] = await Promise.all(
      Object.values(world.extraVirtualMembers ?? {}).map((m) => m.getAid())
    );

    const joinerAids = [bobAid, ...extraAids];

    const { groupId } = await world.remoteInitiator.createAndProposeGroup(
      groupName,
      joinerAids,
      { isith: required, nsith: recovery }
    );
    world.groupId = groupId;

    console.log(
      `[Alice] Group "${groupName}" (id: ${groupId}) created and proposed to: ${joinerAids.join(", ")}`
    );
  }
);

// ---------------------------------------------------------------------------
// Step 5 (UI) – Bob accepts the group invitation in the app
// ---------------------------------------------------------------------------

When(/^Bob accepts the group invitation in the app$/, async function () {
  await browser.waitUntil(
    async () =>
      $("[data-testid='primary-button-pending-group']")
        .isDisplayed()
        .catch(() => false),
    {
      timeout: 60000,
      timeoutMsg:
        "PendingGroup Accept button (primary-button-pending-group) did not appear for Bob within 60 s",
    }
  );

  await browser.waitUntil(
    async () => {
      const spinner = await $(".spinner-overlay").isDisplayed().catch(() => false);
      return !spinner;
    },
    { timeout: 15000, interval: 500, timeoutMsg: "Spinner did not disappear" }
  );
  await browser.pause(500);

  console.log("[Bob] Clicking Accept on PendingGroup screen");
  await $("[data-testid='primary-button-pending-group']").click();
  await browser.pause(1000);

  await browser.pause(2000);
});

// ---------------------------------------------------------------------------
// Step 6 (BACKEND) – All remote members complete the joining ceremony
// ---------------------------------------------------------------------------

When(/^all remote members complete the group joining process$/, async function () {
  const world = this as BobJoinerWorld;
  if (!world.remoteInitiator) {
    throw new Error("Remote initiator (Alice) is not set up.");
  }

  const groupName = world.bobGroupName ?? "MultisigGroup";

  for (const member of Object.values(world.extraVirtualMembers ?? {})) {
    await member.acceptGroupInvitation(60000, groupName);
  }

  await world.remoteInitiator.waitPendingOperations();
  for (const member of Object.values(world.extraVirtualMembers ?? {})) {
    await member.waitPendingOperations();
  }

  await world.remoteInitiator.authorizeGroupAgents(groupName);
  for (const member of Object.values(world.extraVirtualMembers ?? {})) {
    await member.authorizeGroupAgents(groupName);
  }

  await world.remoteInitiator.processIncomingGroupAgentsEndorcements(groupName);
  for (const member of Object.values(world.extraVirtualMembers ?? {})) {
    await member.processIncomingGroupAgentsEndorcements(groupName);
  }

  await world.remoteInitiator.waitPendingOperations();
  for (const member of Object.values(world.extraVirtualMembers ?? {})) {
    await member.waitPendingOperations();
  }
});

// ---------------------------------------------------------------------------
// Step 7 (ASSERT) – Group is Active for the joiner
// ---------------------------------------------------------------------------

Then(/^the group becomes "Active" for the joiner$/, async function () {
  const world = this as BobJoinerWorld;
  const groupName = world.bobGroupName ?? "MultisigGroup";

  if (await pageShowsMessage(GROUP_ID_MISMATCH_MSG)) {
    throw new Error("Connection not part of this group — scan rejected.");
  }

  try {
    await ProfileSetupScreen.waitForGroupActive(60000);
    await assertGroupProfileActiveInProfilesList(groupName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }

  const url = await browser.getUrl();
  if (url.includes("/tabs/home") || url.includes("/home")) {
    const homeTab = await $("[data-testid='tab-button-home']")
      .isExisting()
      .catch(() => false);
    if (!homeTab) {
      throw new Error("Home tab not found after group became active");
    }
  }
});

After(function () {
  // Each scenario uses fresh RemoteInitiator / RemoteJoiner instances — nothing to reset
});
