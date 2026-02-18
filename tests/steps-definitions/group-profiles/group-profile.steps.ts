import { After, Given, When, Then } from "@wdio/cucumber-framework";
import { expect } from "expect-webdriverio";
import { browser, driver } from "@wdio/globals";
import ProfileSetupScreen from "../../screen-objects/onboarding/profile-setup.screen.js";
import { VirtualWallet } from "../../helpers/backend-api.contract.js";
import { resetBackendUsers, setupBackendUser } from "../../helpers/backend-helpers.js";
import { getKeriaUrlsForTestRunner } from "../../helpers/ssi-agent-urls.helper.js";

const GROUP_ID_MISMATCH_MSG = "Connection not part of this group";

function getProfileIdFromSidebar(targetName: string | undefined): { profileId: string; found: boolean } {
  const want = (targetName ?? "").trim().toLowerCase();
  const root = document.querySelector("[data-testid='profiles']");
  if (!root) return { profileId: "", found: false };
  const items = root.querySelectorAll("[data-testid^='profiles-list-item-']");
  for (const item of items) {
    const nameEl = item.querySelector(".profiles-list-item-name") || item;
    const currentName = (nameEl?.textContent?.trim() ?? "").toLowerCase();
    const testId = (item.getAttribute("data-testid") ?? "").trim();
    const pid = testId.startsWith("profiles-list-item-") ? testId.slice("profiles-list-item-".length) : "";
    if (currentName !== want) continue;
    return { profileId: pid, found: true };
  }
  return { profileId: "", found: false };
}

async function pageShowsMessage(msg: string): Promise<boolean> {
  return (await browser.execute((m: string) => {
    const bodyText = document.body?.innerText ?? "";
    if (bodyText.includes(m)) return true;
    const toasts = document.querySelectorAll("ion-toast");
    for (const toast of Array.from(toasts)) {
      const root = (toast as HTMLElement).shadowRoot;
      if (!root) continue;
      const messageEl = root.querySelector(".toast-message") ?? root.querySelector("[part='message']");
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
        const el = document.querySelector("[data-testid='scan-input']") as HTMLInputElement & { shadowRoot?: ShadowRoot };
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
  const confirmBtn = $("[data-testid='scan-input-modal'] [data-testid='action-button']");
  await confirmBtn.waitForDisplayed({ timeout: 5000 });
  await confirmBtn.click();
}

async function assertGroupProfileActiveInProfilesList(displayName: string): Promise<void> {
  const avatarBtn = $("[data-testid='avatar-button']");
  await avatarBtn.waitForDisplayed({ timeout: 10000 });
  await avatarBtn.click();
  await browser.pause(1500);

  const result = await browser.execute(
    (name: string) => {
      const want = (name || "").trim().toLowerCase();
      const root = document.querySelector("[data-testid='profiles']");
      if (!root) return { active: false, reason: "profiles panel not found", profileId: null as string | null };
      const items = root.querySelectorAll("[data-testid^='profiles-list-item-']");
      for (const item of items) {
        const nameEl = item.querySelector(".profiles-list-item-name");
        const currentName = (nameEl?.textContent?.trim() ?? "").toLowerCase();
        if (currentName !== want) continue;
        const testId = item.getAttribute("data-testid") ?? "";
        const id = testId.replace(/^profiles-list-item-/, "");
        const hasPending = !!item.querySelector("[data-testid='profiles-list-item-pending-" + id + "-status']");
        const hasAction = !!item.querySelector("[data-testid='profiles-list-item-action-" + id + "-status']");
        return {
          active: !hasPending && !hasAction,
          reason: hasPending ? "pending" : hasAction ? "action_required" : "ok",
          profileId: id || null,
        };
      }
      return { active: false, reason: "profile not found", profileId: null as string | null };
    },
    displayName
  );

  if (!result?.active) {
    throw new Error(
      `Group profile "${displayName}" is not active in Profiles list (reason: ${result?.reason ?? "unknown"}). Expected: no pending/action chip so "Manage profile" is available.`
    );
  }

  if (result?.profileId) {
    const profileListItem = $(`[data-testid='profiles-list-item-${result.profileId}']`);
    await profileListItem.waitForDisplayed({ timeout: 5000 });
    await profileListItem.click();
    await browser.pause(500);
  }

  const manageProfileBtn = $("[data-testid='profiles-option-button-manage profile']");
  await manageProfileBtn.waitForDisplayed({ timeout: 5000 });
  await manageProfileBtn.click();
  await browser.pause(500);
}

type AliceInitiatorWorld = {
  aliceInitiatorBob?: VirtualWallet;
  aliceInitiatorBobOobi?: string;
  aliceInitiatorCharlie?: VirtualWallet;
  aliceInitiatorCharlieOobi?: string;
  aliceInitiatorGroupId?: string | null;
  aliceInitiatorGroupName?: string;
};

Given(/^Alice creates a group profile as initiator for "(.*)" with single-sig member id and groupId from Salter in her OOBI$/, async function (groupName: string) {
  (this as AliceInitiatorWorld).aliceInitiatorGroupName = groupName;
  await ProfileSetupScreen.selectGroupProfile();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForGroupSetupScreen();
  await ProfileSetupScreen.enterGroupName(groupName);
  await browser.pause(500);
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForProfileSetupScreen();
  await ProfileSetupScreen.enterUsername("Alice");
  await browser.pause(500);
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForWelcomeScreen();
  await expect(ProfileSetupScreen.continueButton).toBeDisplayed();
  await ProfileSetupScreen.continueButton.click();
  await browser.waitUntil(
    async () => {
      const url = await browser.getUrl();
      return url.includes("group-profile-setup") || url.includes("/tabs/home") || url.includes("/home");
    },
    { timeout: 15000, timeoutMsg: "Did not navigate to group-profile-setup or Homepage after Welcome" }
  );
  await browser.pause(2000);
  let currentUrl = await browser.getUrl();
  if (!currentUrl.includes("group-profile-setup")) {
    const avatarButton = $("[data-testid='avatar-button']");
    await avatarButton.waitForDisplayed({ timeout: 10000 });
    await avatarButton.click();
    await browser.pause(1000);
    const profilesModal = $("[data-testid='profiles']");
    await profilesModal.waitForDisplayed({ timeout: 10000 });
    await browser.pause(1500);
    const sidebarResult = (await browser.execute(getProfileIdFromSidebar, groupName)) as { profileId: string; found: boolean };
    if (!sidebarResult.found || !sidebarResult.profileId) {
      throw new Error(`Could not find group "${groupName}" in Sidebar`);
    }
    const closeBtn = $("[data-testid='profiles'] [data-testid='close-button']");
    if (await closeBtn.isDisplayed().catch(() => false)) await closeBtn.click();
    await browser.pause(500);
    const baseWithoutHash = (await browser.getUrl()).replace(/#.*$/, "");
    await browser.url(`${baseWithoutHash}#/group-profile-setup/${sidebarResult.profileId}`);
    await browser.pause(2000);
  }
});

Given(/^Bob has resolved Alice's OOBI and created his member id with the same groupId copy-pasted into his OOBI$/, async function () {
  const bob = await setupBackendUser("Bob");
  bob.generateOobi();
  (this as AliceInitiatorWorld).aliceInitiatorBob = bob;
  const provideTab = $("[data-testid='share-oobi-segment-button']");
  await provideTab.waitForDisplayed({ timeout: 10000 });
  await provideTab.click();
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
  const shareButton = $(".share-profile-oobi .share-button");
  await shareButton.waitForDisplayed({ timeout: 8000 });
  await shareButton.scrollIntoView?.().catch(() => { });
  await shareButton.click();
  const aliceOobiUrl = (await browser.execute(() => (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi)) as string | undefined;
  if (!aliceOobiUrl) throw new Error("Could not Share the OOBI");
  const groupId = new URL(aliceOobiUrl).searchParams.get("groupId");
  const groupName = new URL(aliceOobiUrl).searchParams.get("groupName");
  await bob.resolveOobi(aliceOobiUrl, "Alice");
  await driver.pressKeyCode(4);
  await browser.pause(500);
  if (!aliceOobiUrl?.startsWith("http") || !aliceOobiUrl.includes("/oobi/")) {
    throw new Error(
      "Could not get Alice's OOBI from Share (Provide) tab. Share button was used; captured URL missing or invalid. The OOBI URL contains the groupId we need for Bob's OOBI."
    );
  }
  const aliceOobi = new URL(aliceOobiUrl);
  const aliceGroupId = aliceOobi.searchParams.get("groupId");
  if (!aliceGroupId) {
    throw new Error(
      "Alice's OOBI URL from Share tab did not contain a groupId query param. App should add groupId (Salter) to the OOBI URL/QR."
    );
  }
  (this as AliceInitiatorWorld).aliceInitiatorGroupId = aliceGroupId;
  const hostUrls = getKeriaUrlsForTestRunner();
  if (!bob.oobi) throw new Error("Bob has no OOBI generated yet.")
  const bobOobiUrl = new URL(bob.oobi);
  bobOobiUrl.hostname = new URL(hostUrls.connectUrl).hostname;
  bobOobiUrl.searchParams.set("name", "Bob");
  if (groupId) bobOobiUrl.searchParams.set("groupId", groupId);
  if (groupName) bobOobiUrl.searchParams.set("groupName", groupName);
  let bobOobiForApp = bobOobiUrl.toString();
  (this as AliceInitiatorWorld).aliceInitiatorBobOobi = bobOobiForApp;
});

Given(/^Charlie has resolved Alice's OOBI and created his member id with the same groupId copy-pasted into his OOBI$/, async function () {
  const world = this as AliceInitiatorWorld;
  const aliceGroupId = world.aliceInitiatorGroupId;
  if (!aliceGroupId) {
    throw new Error("Run Bob's step first so aliceInitiatorGroupId is set from Alice's OOBI.");
  }
  const charlie = await setupBackendUser("Charlie");
  world.aliceInitiatorCharlie = charlie;
  const groupName = world.aliceInitiatorGroupName ?? "Alice";
  let charlieOobiForApp = await charlie.getOobi({ alias: "Charlie", groupId: aliceGroupId, groupName });
  const hostUrls = getKeriaUrlsForTestRunner();
  const charlieOobiUrl = new URL(charlieOobiForApp);
  charlieOobiUrl.hostname = new URL(hostUrls.connectUrl).hostname;
  charlieOobiForApp = charlieOobiUrl.toString();
  world.aliceInitiatorCharlieOobi = charlieOobiForApp;
});

When(/^Alice pastes Charlie's OOBI on the Scan tab$/, async function () {
  const world = this as AliceInitiatorWorld;
  const charlieOobiForApp = world.aliceInitiatorCharlieOobi;
  if (!charlieOobiForApp) {
    throw new Error("Run the previous step first: Charlie has resolved Alice's OOBI and created his member id.");
  }
  const scanTab = $("[data-testid='scan-profile-segment-button']");
  await scanTab.waitForDisplayed({ timeout: 10000 });
  await scanTab.click();
  await browser.pause(1500);
  await pasteOobiAndConfirm(charlieOobiForApp);
  await browser.pause(2000);
});

When(/^Alice pastes Bob's OOBI on the Scan tab$/, async function () {
  const world = this as AliceInitiatorWorld;
  const bobOobiForApp = world.aliceInitiatorBobOobi;
  if (!bobOobiForApp) throw new Error("Run the previous step first: Bob has resolved Alice's OOBI and created his member id.");
  const scanTab = $("[data-testid='scan-profile-segment-button']");
  await scanTab.waitForDisplayed({ timeout: 10000 });
  await scanTab.click();
  await browser.pause(1500);
  await pasteOobiAndConfirm(bobOobiForApp);
  await browser.pause(2000);
});

When(/^Alice initiates the group identifier$/, async function () {
  const provideTab = $("[data-testid='share-oobi-segment-button']");
  await provideTab.waitForDisplayed({ timeout: 10000 });
  await provideTab.click();
  await browser.pause(1500);
  const initiateBtn = $("[data-testid='primary-button-setup-group-profile']");
  await initiateBtn.waitForDisplayed({ timeout: 10000 });
  await initiateBtn.click();
  await browser.pause(500);
  const alertConfirmBtn = $("[data-testid='alert-confirm-init-group-confirm-button']");
  await alertConfirmBtn.waitForDisplayed({ timeout: 5000 });
  await alertConfirmBtn.click();
  await browser.pause(2000);

  await browser.waitUntil(
    async () => (await $("[data-testid='init-group-footer']").isDisplayed().catch(() => false)) || (await $("[data-testid='signer-alert-card-block']").isDisplayed().catch(() => false)),
    { timeout: 15000, timeoutMsg: "Confirm (InitializeGroup) screen did not load" }
  );
  await browser.pause(1000);
});

When(/^Alice sets required and recovery signers to (\d+) and (\d+)$/, async function (requiredStr: string, recoveryStr: string) {
  const required = parseInt(requiredStr, 10);
  const recovery = parseInt(recoveryStr, 10);
  if (required < 1 || recovery < 1) {
    throw new Error("Required and recovery signers must be at least 1");
  }
  const signerAlertBtn = $("[data-testid='signer-alert-card-block'] .secondary-button");
  const signerAlertVisible = await signerAlertBtn.isDisplayed().catch(() => false);
  if (signerAlertVisible) {
    await signerAlertBtn.scrollIntoView?.().catch(() => { });
    await browser.pause(300);
    await signerAlertBtn.click();
  } else {
    const setSignersFallback = $("[data-testid='signer-alert-card-block'] button");
    if (await setSignersFallback.isDisplayed().catch(() => false)) {
      await setSignersFallback.scrollIntoView?.().catch(() => { });
      await browser.pause(300);
      await setSignersFallback.click();
    } else {
      throw new Error("Set signers control not found on Confirm screen");
    }
  }
  await browser.pause(500);
  const requiredIncrease = $("[data-testid='requiredSigners-increase-threshold-button']");
  const recoveryIncrease = $("[data-testid='recoverySigners-increase-threshold-button']");
  await requiredIncrease.waitForDisplayed({ timeout: 5000 });
  for (let i = 0; i < required; i++) {
    await requiredIncrease.click();
    await browser.pause(200);
  }
  for (let i = 0; i < recovery; i++) {
    await recoveryIncrease.click();
    await browser.pause(200);
  }
  const signerModalConfirm = $("[data-testid='primary-button-setup-signer-modal']");
  await signerModalConfirm.waitForDisplayed({ timeout: 5000 });
  await signerModalConfirm.click();
  await browser.pause(1000);
});

When(/^Alice sends the group requests$/, async function () {
  const sendRequestBtn = $("[data-testid='primary-button-init-group']");
  await sendRequestBtn.waitForDisplayed({ timeout: 10000 });
  await browser.pause(500);
  await sendRequestBtn.click();
  await browser.pause(3000);
});

When(/^Bob accepts the group invitation$/, async function () {
  const world = this as AliceInitiatorWorld;
  const bob = world.aliceInitiatorBob;
  if (!bob) {
    throw new Error("Missing aliceInitiatorBob. Run the Given step: Bob has resolved Alice's OOBI and created his member id.");
  }
  await bob.acceptGroupInvitation(60000);
});

When(/^Charlie accepts the group invitation$/, async function () {
  const world = this as AliceInitiatorWorld;
  const charlie = world.aliceInitiatorCharlie;
  if (!charlie) {
    throw new Error("Missing aliceInitiatorCharlie. Run the Given step: Charlie has resolved Alice's OOBI and created his member id.");
  }
  await charlie.acceptGroupInvitation(60000);
});

Then(/^the group status becomes "Active" when the group is ready$/, async function () {
  const aliceInitiatorGroupName = (this as { aliceInitiatorGroupName?: string }).aliceInitiatorGroupName;
  if (!aliceInitiatorGroupName) {
    throw new Error("Missing aliceInitiatorGroupName from Given step.");
  }

  if (await pageShowsMessage(GROUP_ID_MISMATCH_MSG)) {
    throw new Error("Connection not part of this group — scan rejected.");
  }

  try {
    await ProfileSetupScreen.waitForGroupActive(60000);
    await assertGroupProfileActiveInProfilesList(aliceInitiatorGroupName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }
  const url = await browser.getUrl();
  const onHome = url.includes("/tabs/home") || url.includes("/home");
  if (onHome) {
    const homeTab = await $("[data-testid='tab-button-home']").isExisting().catch(() => false);
    expect(homeTab).toBe(true);
  }
});

After(function () {
  resetBackendUsers();
});
