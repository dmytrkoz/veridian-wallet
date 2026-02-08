import { After, Given, Then, When } from "@wdio/cucumber-framework";
import { expect } from "expect-webdriverio";
import { browser, driver } from "@wdio/globals";
import ProfileSetupScreen from "../../screen-objects/onboarding/profile-setup.screen.js";
import {
  RemoteInitiator,
  setupRemoteInitiator,
} from "../../helpers/remote-initiator.helper.js";
import {
  getKeriaUrlsForTestRunner,
  getSSIAgentUrls,
} from "../../helpers/ssi-agent-urls.helper.js";

const GROUP_ID_MISMATCH_MSG = "Connection not part of this group";

/** Returns true if the page (body or toast) shows the group-id mismatch error. */
async function pageShowsGroupIdMismatch(): Promise<boolean> {
  return (await browser.execute((msg: string) => {
    const bodyText = document.body?.innerText ?? "";
    if (bodyText.includes(msg)) return true;
    const toasts = document.querySelectorAll("ion-toast");
    for (const toast of Array.from(toasts)) {
      const root = (toast as HTMLElement).shadowRoot;
      if (!root) continue;
      const messageEl = root.querySelector(".toast-message") ?? root.querySelector("[part='message']");
      if ((messageEl?.textContent?.trim() ?? "").includes(msg)) return true;
    }
    return false;
  }, GROUP_ID_MISMATCH_MSG)) as boolean;
}

/** Try to read joiner (Alice) profile groupId from app Redux store; returns null if store not exposed. */
async function getJoinerGroupIdFromApp(): Promise<string | null> {
  const script = `
    (function() {
      try {
        var state = (typeof window !== 'undefined' && window.store && typeof window.store.getState === 'function')
          ? window.store.getState() : null;
        if (!state || !state.profilesCache) return null;
        var defaultId = state.profilesCache.defaultProfile;
        if (!defaultId) return null;
        var profile = state.profilesCache.profiles && state.profilesCache.profiles[defaultId];
        var gid = profile && profile.identity && profile.identity.groupMetadata && profile.identity.groupMetadata.groupId;
        return gid || null;
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
  // Wait for either group setup or individual profile setup screen based on selection
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
  // If group setup screen, wait for it; otherwise wait for profile setup screen
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
    // Navigate to profile setup if not already there
    await ProfileSetupScreen.selectIndividualProfile();
    await ProfileSetupScreen.confirmButton.click();
    await ProfileSetupScreen.waitForProfileSetupScreen();
  }
});

Given(/^user is on Group setup screen with Group profile selected$/, async function () {
  if (!(await ProfileSetupScreen.groupNameInput.isExisting().catch(() => false))) {
    // Navigate to group setup if not already there
    await ProfileSetupScreen.selectGroupProfile();
    await ProfileSetupScreen.confirmButton.click();
    await ProfileSetupScreen.waitForGroupSetupScreen();
  }
});

When(/^user enters username "(.*)"$/, async function (username: string) {
  await ProfileSetupScreen.enterUsername(username);
  // Wait for React state to update and validation to trigger
  await browser.pause(1000);
});

When(/^user enters group name "(.*)"$/, async function (groupName: string) {
  await ProfileSetupScreen.enterGroupName(groupName);
  // Wait for React state to update and validation to trigger
  await browser.pause(1000);
});

Then(/^Confirm button is disabled$/, async function () {
  const isEnabled = await ProfileSetupScreen.isConfirmButtonEnabled();
  expect(isEnabled).toBe(false);
});

Then(/^Confirm button is enabled$/, async function () {
  // Wait a bit more for React state to fully update
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
  // After confirming group name, navigate to profile setup screen (username entry)
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
  // Navigate through the flow
  await ProfileSetupScreen.selectIndividualProfile();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForProfileSetupScreen();
  await ProfileSetupScreen.enterUsername(username);
  await browser.pause(500);
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForWelcomeScreen();
});

Given(/^user has created group profile with group name "(.*)" and username "(.*)"$/, async function (groupName: string, username: string) {
  // Navigate through the flow
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
  // Wait for navigation - could be homepage (individual) or group-profile-setup (group)
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
  // Check for common homepage elements
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

// --- Remote initiator (2-of-2 group) E2E: Given + Then + After ---
Given(/^a remote initiator is ready and has invited the joiner to "(.*)"$/, async function (groupName: string) {
  const username = "GroupUser123";
  const remoteInitiator = await setupRemoteInitiator();
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
    const getProfileIdFromSidebar = (targetName: string) => {
      const want = (targetName || "").trim().toLowerCase();
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
    };
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

  const provideTab = $("[data-testid='share-oobi-segment-button']");
  await provideTab.waitForDisplayed({ timeout: 10000 });
  await provideTab.click();
  await browser.pause(2000);

  // Capture Alice's member OOBI from the Provide tab. Prefer data-oobi on the QR container; if not set,
  // capture via Share button: stub Capacitor Share so when the app calls Share.share({ text: oobi }) we store
  // the URL, then click Share and read it (same as when the user manually clicks Share and sees the URL).
  const extractMemberOobi = (): { oobi: string; ok: boolean } => {
    const el = document.querySelector("[data-testid='share-profile-qr-code']");
    const raw = (el?.getAttribute("data-oobi") ?? "").trim();
    const ok = raw.startsWith("http") && raw.length >= 50 && raw.includes("/oobi/");
    return { oobi: raw, ok };
  };

  let aliceMemberOobi = "";
  let fromDataOobi = false;
  fromDataOobi = await browser.waitUntil(
    async () => {
      const r = (await browser.execute(extractMemberOobi)) as { oobi: string; ok: boolean };
      if (r.ok) aliceMemberOobi = r.oobi;
      return r.ok;
    },
    { timeout: 5000, interval: 500 }
  ).catch(() => false);

  if (!fromDataOobi) {
    // Capture via Share button: when the app calls Share.share({ text: oobi }), Capacitor invokes
    // nativePromise('Share', 'share', options). Intercept that to store options.text so we can read it after click.
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
    const shareDisplayed = await browser.waitUntil(
      async () => shareButton.isDisplayed().catch(() => false),
      { timeout: 15000, interval: 1000 }
    ).catch(() => false);

    if (shareDisplayed) {
      await shareButton.scrollIntoView?.().catch(() => {});
      await browser.pause(500);
      try {
        await shareButton.click();
      } catch {
        const clickShareViaJs = `
          var el = document.querySelector(".share-profile-oobi .share-button");
          if (el) el.click();
        `;
        await browser.execute(clickShareViaJs);
      }
      await browser.pause(2500);
      for (let attempt = 0; attempt < 3 && !aliceMemberOobi; attempt++) {
        const captured = (await browser.execute(() => (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi)) as string | undefined;
        if (captured && captured.startsWith("http") && captured.includes("/oobi/")) {
          aliceMemberOobi = captured;
          break;
        }
        await browser.pause(1000);
      }
    }
  }

  if (!aliceMemberOobi.startsWith("http") || !aliceMemberOobi.includes("/oobi/")) {
    throw new Error(
      "Alice Member OOBI did not appear on Provide tab. Tried: (1) data-oobi on [data-testid='share-profile-qr-code'], (2) clicking Share and reading shared URL. " +
        "Ensure the app loads member OOBI for the Joiner (e.g. allow fetchOobi when profile.creationStatus === PENDING) so the Share button is enabled and the URL can be captured."
    );
  }

  if (!fromDataOobi) {
    await driver.pressKeyCode(4);
    await browser.pause(500);
  }

  const hostUrls = getKeriaUrlsForTestRunner();
  const aliceOobiUrl = new URL(aliceMemberOobi);
  aliceOobiUrl.hostname = new URL(hostUrls.connectUrl).hostname;
  aliceMemberOobi = aliceOobiUrl.toString();

  (this as { joinerGroupIdFromOobi?: string | null }).joinerGroupIdFromOobi =
    aliceOobiUrl.searchParams.get("groupId") ?? null;

  await remoteInitiator.getClient().oobis().resolve(aliceMemberOobi, "Joiner");

  let aliceMemberPrefix: string | null = null;
  for (let i = 0; i < 25; i++) {
    await browser.pause(1500);
    aliceMemberPrefix = await remoteInitiator.getJoinerMemberPrefixFromContacts();
    if (aliceMemberPrefix) break;
  }
  if (!aliceMemberPrefix) {
    const debug = await remoteInitiator.getContactsDebug();
    throw new Error(
      `RemoteInitiator: Bob did not see Alice in contacts. Contacts: count=${debug.count}, ids=[${debug.ids.join(", ")}]`
    );
  }

  const groupId = await remoteInitiator.anchorGroup(aliceMemberPrefix, groupName);
  await browser.pause(10000);

  const bobOobi = await remoteInitiator.getOobi({ alias: "Initiator", groupId, groupName });
  const appUrls = getSSIAgentUrls();
  const bobOobiUrl = new URL(bobOobi);
  bobOobiUrl.hostname = new URL(appUrls.connectUrl).hostname;
  const bobOobiForApp = bobOobiUrl.toString();

  // App check (useScanHandle.resolveGroupConnection): urlGroupId (Bob's groupId) must equal
  // profile.groupMetadata.groupId (Alice's). Alice's groupId is set at profile creation:
  // ProfileSetup.tsx uses pendingJoinGroupMetadata?.groupId || new Salter({}).qb64 — so when
  // the joiner creates the profile first (no pending join), her groupId is a random qb64 and
  // will never match Bob's anchored groupId → "Connection not part of this group". App fix:
  // either set joiner's groupId from the first scanned group OOBI, or allow scan when current
  // profile groupId is unset/placeholder.

  const scanTab = $("[data-testid='scan-profile-segment-button']");
  await scanTab.waitForDisplayed({ timeout: 10000 });
  await scanTab.click();
  await browser.pause(1500);

  const pasteButton = $("[data-testid='paste-content-button']");
  await pasteButton.waitForDisplayed({ timeout: 10000 });
  await pasteButton.click();
  await browser.pause(800);
  const scanInput = $("[data-testid='scan-input']");
  await scanInput.waitForDisplayed({ timeout: 5000 });
  await scanInput.click();
  await browser.pause(300);
  try {
    await scanInput.addValue(bobOobiForApp);
  } catch {
    await browser.execute(
      (oobi: string) => {
        const el = document.querySelector("[data-testid='scan-input']") as HTMLInputElement & { shadowRoot?: ShadowRoot };
        if (!el) return;
        const input = el.shadowRoot?.querySelector("input") ?? el;
        if (input) {
          (input as HTMLInputElement).value = oobi;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("ionInput", { bubbles: true }));
        }
      },
      bobOobiForApp
    );
  }
  await browser.pause(300);
  const confirmButton = $("[data-testid='scan-input-modal'] [data-testid='action-button']");
  await confirmButton.waitForDisplayed({ timeout: 5000 });
  await confirmButton.click();

  const hasGroupIdMismatch = await browser
    .waitUntil(async () => pageShowsGroupIdMismatch(), { timeout: 4000, interval: 300 })
    .catch(() => false);

  if (hasGroupIdMismatch) {
    const joinerFromOobi = (this as { joinerGroupIdFromOobi?: string | null }).joinerGroupIdFromOobi ?? null;
    const initiatorStr = groupId;
    const joinerStr = joinerFromOobi ?? "(not in OOBI URL)";
    throw new Error(
      `Connection not part of this group — scan rejected. Initiator (Bob) groupId: ${initiatorStr}; Joiner (Alice) groupId: ${joinerStr}. Stopping.`
    );
  }

  const remoteInitiatorGroupId = await remoteInitiator.propose2of2Group(aliceMemberPrefix, groupName);
  (this as { remoteInitiatorGroupId?: string }).remoteInitiatorGroupId = remoteInitiatorGroupId;
});

Then(/^the group status becomes "Active" after cloud finalization$/, async function () {
  const initiatorGroupId = (this as { remoteInitiatorGroupId?: string }).remoteInitiatorGroupId;
  const joinerFromOobi = (this as { joinerGroupIdFromOobi?: string | null }).joinerGroupIdFromOobi ?? null;

  if (await pageShowsGroupIdMismatch()) {
    throw new Error(
      `Connection not part of this group — scan rejected. Initiator (Bob) groupId: ${initiatorGroupId ?? "(none)"}; Joiner (Alice) groupId: ${joinerFromOobi ?? "(not in OOBI URL)"}. Stopping.`
    );
  }

  const pendingFooter = $("[data-testid='pending-group-footer']");
  const acceptButton = $("[data-testid='primary-button-pending-group']");
  try {
    await pendingFooter.waitForDisplayed({ timeout: 30000 }).catch(() => {});
    await acceptButton.waitForDisplayed({ timeout: 15000 });
    await acceptButton.scrollIntoView?.().catch(() => {});
    await browser.pause(500);
    await acceptButton.click();
    await browser.pause(2000);
  } catch {
    const byClass = $(".pending-group .primary-button");
    if (await byClass.isDisplayed().catch(() => false)) {
      await byClass.scrollIntoView?.().catch(() => {});
      await byClass.click();
      await browser.pause(2000);
    }
  }
  let joinerGroupId: string | null = null;
  try {
    if (initiatorGroupId) {
      const remoteInitiator = RemoteInitiator.getInstance("Initiator");
      await remoteInitiator.waitForGroupOperationComplete(initiatorGroupId);
    }
    await ProfileSetupScreen.waitForGroupActive(60000);
  } catch (err) {
    joinerGroupId = joinerFromOobi ?? (await getJoinerGroupIdFromApp().catch(() => null));
    const initiatorStr = initiatorGroupId ?? "(none)";
    const joinerStr = joinerGroupId ?? "(not in OOBI URL and app store not exposed)";
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg} — Initiator (Bob) groupId: ${initiatorStr}; Joiner (Alice) groupId: ${joinerStr}`
    );
  }
  const url = await browser.getUrl();
  const onHome = url.includes("/tabs/home") || url.includes("/home");
  if (onHome) {
    const homeTab = await $("[data-testid='tab-button-home']").isExisting().catch(() => false);
    expect(homeTab).toBe(true);
  }
});

After(function () {
  RemoteInitiator.reset();
});

