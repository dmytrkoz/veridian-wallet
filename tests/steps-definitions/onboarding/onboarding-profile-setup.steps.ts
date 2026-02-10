import { After, Given, Then, When } from "@wdio/cucumber-framework";
import { expect } from "expect-webdriverio";
import { browser, driver } from "@wdio/globals";
import ProfileSetupScreen from "../../screen-objects/onboarding/profile-setup.screen.js";
import {
  RemoteBob,
  setupRemoteBob,
} from "../../helpers/remote-bob.helper.js";
import {
  getKeriaUrlsForTestRunner,
  getSSIAgentUrls,
} from "../../helpers/ssi-agent-urls.helper.js";

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

async function getJoinerGroupIdFromApp(): Promise<string | null> {
  const script = `
    (function() {
      try {
        var state = (typeof window !== 'undefined' && window.store && typeof window.store.getState === 'function')
          ? window.store.getState() : null;
        if (!state || !state.profilesCache || !state.profilesCache.profiles) return null;
        var profiles = state.profilesCache.profiles;
        var profileId = state.profilesCache.defaultProfile;
        if (profileId) {
          var p = profiles[profileId];
          var gid = p && p.identity && p.identity.groupMetadata && p.identity.groupMetadata.groupId;
          if (gid) return gid;
        }
        var hash = typeof window !== 'undefined' && window.location && window.location.hash ? window.location.hash : '';
        var m = hash.match(/group-profile-setup\\/([^/?]+)/);
        if (m && m[1]) {
          var p2 = profiles[m[1]];
          var gid2 = p2 && p2.identity && p2.identity.groupMetadata && p2.identity.groupMetadata.groupId;
          if (gid2) return gid2;
        }
        for (var id in profiles) {
          if (profiles.hasOwnProperty(id)) {
            var g = profiles[id].identity && profiles[id].identity.groupMetadata && profiles[id].identity.groupMetadata.groupId;
            if (g) return g;
          }
        }
        return null;
      } catch (e) { return null; }
    })();
  `;
  const result = (await browser.execute(script)) as string | null;
  return result ?? null;
}

Then(/^user can see "Individual profile" option$/, async function () {
  await expect(ProfileSetupScreen.individualProfileOption).toBeDisplayed();
});

Then(/^user can see "Group profile" option$/, async function () {
  await expect(ProfileSetupScreen.groupProfileOption).toBeDisplayed();
});

Then(/^user can see "Choose your profile type" description$/, async function () {
  await expect(ProfileSetupScreen.description).toBeDisplayed();
  const descriptionText = await ProfileSetupScreen.description.getText();
  expect(descriptionText).toContain("Which type of profile");
});

Then(/^user can see Confirm button$/, async function () {
  await expect(ProfileSetupScreen.confirmButton).toBeDisplayed();
});

When(/^user selects Individual profile option$/, async function () {
  await ProfileSetupScreen.selectIndividualProfile();
});

When(/^user selects Group profile option$/, async function () {
  await ProfileSetupScreen.selectGroupProfile();
});

When(/^user taps Confirm button on Profile type screen$/, async function () {
  await expect(ProfileSetupScreen.confirmButton).toBeDisplayed();
  await ProfileSetupScreen.confirmButton.click();
  await browser.waitUntil(
    async () => {
      const groupNameInput = await ProfileSetupScreen.groupNameInput.isExisting().catch(() => false);
      const usernameInput = await ProfileSetupScreen.usernameInput.isExisting().catch(() => false);
      return groupNameInput || usernameInput;
    },
    {
      timeout: 15000,
      timeoutMsg: "Did not navigate to setup screen after confirming profile type",
    }
  );
  const isGroupSetup = await ProfileSetupScreen.groupNameInput.isExisting().catch(() => false);
  if (isGroupSetup) {
    await ProfileSetupScreen.waitForGroupSetupScreen();
  } else {
    await ProfileSetupScreen.waitForProfileSetupScreen();
  }
});

Then(/^user can see Profile setup screen$/, async function () {
  await ProfileSetupScreen.waitForProfileSetupScreen();
});

Then(/^user can see Group setup screen$/, async function () {
  await ProfileSetupScreen.waitForGroupSetupScreen();
});

Then(/^user can see "Set up your individual profile" description$/, async function () {
  await expect(ProfileSetupScreen.profileSetupDescription).toBeDisplayed();
  const descriptionText = await ProfileSetupScreen.profileSetupDescription.getText();
  expect(descriptionText).toContain("Add information about you");
});

Then(/^user can see Username input field$/, async function () {
  await expect(ProfileSetupScreen.usernameInput).toBeDisplayed();
});

Given(/^user is on Profile setup screen with Individual profile selected$/, async function () {
  if (!(await ProfileSetupScreen.usernameInput.isExisting().catch(() => false))) {
    await ProfileSetupScreen.selectIndividualProfile();
    await ProfileSetupScreen.confirmButton.click();
    await ProfileSetupScreen.waitForProfileSetupScreen();
  }
});

Given(/^user is on Group setup screen with Group profile selected$/, async function () {
  if (!(await ProfileSetupScreen.groupNameInput.isExisting().catch(() => false))) {
    await ProfileSetupScreen.selectGroupProfile();
    await ProfileSetupScreen.confirmButton.click();
    await ProfileSetupScreen.waitForGroupSetupScreen();
  }
});

When(/^user enters username "(.*)"$/, async function (username: string) {
  await ProfileSetupScreen.enterUsername(username);
  await browser.pause(1000);
});

When(/^user enters group name "(.*)"$/, async function (groupName: string) {
  await ProfileSetupScreen.enterGroupName(groupName);
  await browser.pause(1000);
});

Then(/^Confirm button is disabled$/, async function () {
  const isEnabled = await ProfileSetupScreen.isConfirmButtonEnabled();
  expect(isEnabled).toBe(false);
});

Then(/^Confirm button is enabled$/, async function () {
  await browser.pause(500);
  await browser.waitUntil(
    async () => {
      const isEnabled = await ProfileSetupScreen.isConfirmButtonEnabled();
      return isEnabled === true;
    },
    {
      timeout: 10000,
      timeoutMsg: "Confirm button did not become enabled",
    }
  );
});

When(/^user taps Confirm button on Profile setup screen$/, async function () {
  await expect(ProfileSetupScreen.confirmButton).toBeDisplayed();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForWelcomeScreen();
});

When(/^user taps Confirm button on Group setup screen$/, async function () {
  await expect(ProfileSetupScreen.confirmButton).toBeDisplayed();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForProfileSetupScreen();
});

Then(/^user can see Welcome screen with username "(.*)"$/, async function (username: string) {
  await ProfileSetupScreen.waitForWelcomeScreen();
  await expect(ProfileSetupScreen.welcomeTitle).toBeDisplayed();
  const welcomeText = await ProfileSetupScreen.welcomeTitle.getText();
  expect(welcomeText).toContain(username);
});

Then(/^user can see "Your individual profile has been created" description$/, async function () {
  await expect(ProfileSetupScreen.welcomeDescription).toBeDisplayed();
  const descriptionText = await ProfileSetupScreen.welcomeDescription.getText();
  expect(descriptionText).toContain("profile");
});

Then(/^user can see Continue button$/, async function () {
  await expect(ProfileSetupScreen.continueButton).toBeDisplayed();
});

Given(/^user has created individual profile with username "(.*)"$/, async function (username: string) {
  await ProfileSetupScreen.selectIndividualProfile();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForProfileSetupScreen();
  await ProfileSetupScreen.enterUsername(username);
  await browser.pause(500);
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForWelcomeScreen();
});

Given(/^user has created group profile with group name "(.*)" and username "(.*)"$/, async function (groupName: string, username: string) {
  await ProfileSetupScreen.selectGroupProfile();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForGroupSetupScreen();
  await ProfileSetupScreen.enterGroupName(groupName);
  await browser.pause(500);
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForProfileSetupScreen();
  await ProfileSetupScreen.enterUsername(username);
  await browser.pause(500);
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForWelcomeScreen();
});

When(/^user taps Continue button on Welcome screen$/, async function () {
  await expect(ProfileSetupScreen.continueButton).toBeDisplayed();
  await ProfileSetupScreen.continueButton.click();
  await browser.waitUntil(
    async () => {
      const url = await browser.getUrl();
      return url.includes("tabs") || url.includes("home") || url.includes("group-profile-setup") || !url.includes("profile-setup");
    },
    {
      timeout: 15000,
      timeoutMsg: "Did not navigate away from Welcome screen",
    }
  );
});

Then(/^user can see Homepage$/, async function () {
  await browser.waitUntil(
    async () => {
      const url = await browser.getUrl();
      return url.includes("tabs") || url.includes("home");
    },
    {
      timeout: 15000,
      timeoutMsg: "Did not navigate to Homepage",
    }
  );
  const homeTab = await $("[data-testid='tab-button-home']").isExisting().catch(() => false);
  expect(homeTab).toBe(true);
});

Then(/^user can see Group profile setup screen$/, async function () {
  await browser.waitUntil(
    async () => {
      const url = await browser.getUrl();
      return url.includes("group-profile-setup");
    },
    {
      timeout: 15000,
      timeoutMsg: "Did not navigate to Group profile setup screen",
    }
  );
});

type AliceInitiatorWorld = {
  aliceInitiatorBob?: Awaited<ReturnType<typeof setupRemoteBob>>;
  aliceInitiatorBobOobi?: string;
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
  await ProfileSetupScreen.enterUsername("GroupUser123");
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
  const bob = await setupRemoteBob();
  (this as AliceInitiatorWorld).aliceInitiatorBob = bob;
  const provideTab = $("[data-testid='share-oobi-segment-button']");
  await provideTab.waitForDisplayed({ timeout: 10000 });
  await provideTab.click();
  await browser.pause(2000);
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
  await shareButton.scrollIntoView?.().catch(() => {});
  await shareButton.click();
  await browser.pause(2500);
  const aliceOobiUrl = (await browser.execute(() => (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi)) as string | undefined;
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
  let bobOobiForApp = await bob.getOobi({ alias: "Bob", groupId: aliceGroupId, groupName: "Alice" });
  const hostUrls = getKeriaUrlsForTestRunner();
  const bobOobiUrl = new URL(bobOobiForApp);
  bobOobiUrl.hostname = new URL(hostUrls.connectUrl).hostname;
  bobOobiForApp = bobOobiUrl.toString();
  (this as AliceInitiatorWorld).aliceInitiatorBobOobi = bobOobiForApp;
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

When(/^Alice sets required and recovery signers to 1 and 1$/, async function () {
  const signerAlertBtn = $("[data-testid='signer-alert-card-block'] .secondary-button");
  const signerAlertVisible = await signerAlertBtn.isDisplayed().catch(() => false);
  if (signerAlertVisible) {
    await signerAlertBtn.scrollIntoView?.().catch(() => {});
    await browser.pause(300);
    await signerAlertBtn.click();
  } else {
    const setSignersFallback = $("[data-testid='signer-alert-card-block'] button");
    if (await setSignersFallback.isDisplayed().catch(() => false)) {
      await setSignersFallback.scrollIntoView?.().catch(() => {});
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
  await requiredIncrease.click();
  await browser.pause(200);
  await recoveryIncrease.click();
  await browser.pause(200);
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
  // Allow time for the app to show "Group request sent" and navigate (e.g. to home). We do not wait for Bob here; the next step checks the profile screen for Active.
  await browser.pause(5000);
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

After(function () {
  RemoteBob.reset();
});

