import { After, Given, When, Then } from "@wdio/cucumber-framework";
import type { DataTable } from "@cucumber/cucumber";
import { expect } from "expect-webdriverio";
import { browser, driver } from "@wdio/globals";
import ProfileSetupScreen from "../../screen-objects/onboarding/profile-setup.screen.js";
import PasscodeScreen from "../../screen-objects/onboarding/passcode.screen.js";
import { RemoteJoiner } from "../../helpers/backend-api.contract.js";
import { resetBackendUsers, setupBackendUser } from "../../helpers/backend-helpers.js";
import {
  CF_CREDENTIAL_ISSUANCE_ALIAS,
  issueRareEvoCredential,
  getIssuerConnectionOobiForApp,
  listIssuerContacts,
  RARE_EVO_SCHEMA_NAME,
  requestRareEvoPresentation,
  resolveWalletOobiForIssuer,
  waitForNewIssuerContact,
} from "../../helpers/credential-server.helper.js";
import { getKeriaUrlsForTestRunner } from "../../helpers/ssi-agent-urls.helper.js";

const GROUP_ID_MISMATCH_MSG = "Connection not part of this group";
const ISSUE_NOTIFICATION_TEXT = "wants to issue you a credential";
const PRESENTATION_NOTIFICATION_TEXT = "has requested a credential from you";

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

async function pageBodyContains(text: string): Promise<boolean> {
  return (await browser.execute((value: string) => {
    const bodyText = document.body?.innerText ?? "";
    return bodyText.includes(value);
  }, text)) as boolean;
}

async function installShareCapture(): Promise<void> {
  await browser.execute(`
    (function() {
      window.__lastSharedOobi = undefined;
      var cap = window.Capacitor;
      if (!cap || typeof cap.nativePromise !== 'function') return;
      var original = cap.nativePromise.bind(cap);
      cap.nativePromise = function(pluginName, methodName, options) {
        if (pluginName === 'Share' && methodName === 'share' && options && options.text) {
          window.__lastSharedOobi = options.text;
        }
        return original(pluginName, methodName, options);
      };
    })();
  `);
}

async function captureCurrentProfileOobi(): Promise<string> {
  await installShareCapture();

  const shareButton = $(".share-profile-oobi .secondary-button");
  await shareButton.waitForDisplayed({ timeout: 10000 });
  await shareButton.click();

  const sharedOobi = (await browser.execute(
      () => (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi
  )) as string | undefined;

  if (!sharedOobi) {
    throw new Error("Could not capture the current profile OOBI.");
  }

  await driver.pressKeyCode(4);
  await browser.pause(500);

  return sharedOobi;
}

async function openAddConnectionFlow(): Promise<void> {
  const connectionsTab = $("[data-testid='tab-button-connections']");
  await connectionsTab.waitForDisplayed({ timeout: 10000 });
  await connectionsTab.click();
  await browser.pause(500);

  const placeholderAddConnectionButton = $("[data-testid='primary-button-connections-tab']");
  const headerAddConnectionButton = $("[data-testid='add-connection-button']");
  const addConnectionButton = (await placeholderAddConnectionButton.isDisplayed().catch(() => false))
      ? placeholderAddConnectionButton
      : headerAddConnectionButton;

  await addConnectionButton.waitForDisplayed({ timeout: 10000 });
  await addConnectionButton.click();
  await browser.pause(500);

  const shareProfileModal = $("[data-testid='share-profile']");
  await shareProfileModal.waitForDisplayed({ timeout: 10000 });
}

/**
 * Navigate by tapping a tab bar button.
 * This is more reliable than browser.url() in Appium/Capacitor webview contexts.
 */
async function navigateToTab(tabName: string): Promise<void> {
  const tab = $(`[data-testid='tab-button-${tabName}']`);
  await tab.waitForDisplayed({ timeout: 10000 });
  await tab.click();
  await browser.pause(500);
}

async function openNotificationByText(labelText: string): Promise<void> {
  await browser.waitUntil(
      async () => {
        const items = await $$("[data-testid^='notifications-tab-item-']");
        for (const item of items) {
          const label = await item.$("[data-testid='notifications-tab-item-label']").getText().catch(() => "");
          if (label.includes(labelText)) {
            return true;
          }
        }
        return false;
      },
      {
        timeout: 60000,
        timeoutMsg: `Did not find notification containing "${labelText}"`,
      }
  );

  const items = await $$("[data-testid^='notifications-tab-item-']");
  for (const item of items) {
    const label = await item.$("[data-testid='notifications-tab-item-label']").getText().catch(() => "");
    if (label.includes(labelText)) {
      await item.click();
      return;
    }
  }

  throw new Error(`Notification containing "${labelText}" disappeared before it could be opened.`);
}

async function confirmNotificationWithPasscode(passcode?: number[]): Promise<void> {
  const primaryButton = $("[data-testid='primary-button-notification-details']");
  await primaryButton.waitForDisplayed({ timeout: 20000 });
  await primaryButton.click();
  await browser.pause(500);

  const chooseCredentialVisible = await $("[data-testid='choose-credential-segment']").isDisplayed().catch(() => false);
  if (chooseCredentialVisible) {
    const credentialChoices = await $$("[data-testid^='cred-select-']");
    if (!credentialChoices.length) {
      throw new Error("No credential options were available to present.");
    }

    await credentialChoices[0].click();
    await browser.pause(300);
    await primaryButton.click();
    await browser.pause(500);
  }

  const passcodeVisible = await PasscodeScreen.screenTitle.isDisplayed().catch(() => false);
  if (passcodeVisible) {
    if (!passcode) {
      throw new Error("Missing stored passcode for verification.");
    }
    await PasscodeScreen.enterPasscode(passcode);
  }
}

async function assertGroupProfileActiveInProfilesList(displayName: string): Promise<void> {
  const avatarBtn = $("[data-testid='avatar-button']");
  await avatarBtn.waitForDisplayed({ timeout: 10000 });
  await avatarBtn.click();
  await browser.pause(500);

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
  aliceInitiatorGroupName?: string;
  aliceInitiatorGroupId?: string | null;
  credentialIssuerContactId?: string;
  credentialIssuerNotificationName?: string;
  passcode?: number[];
  virtualMembers?: Record<
      string,
      {
        instance: RemoteJoiner;
        oobi: string;
      }
  >;
  aliceSharedOobi?: string;
};

Given(/^IPEX Alice creates a group profile as initiator$/, async function () {
  const world = this as AliceInitiatorWorld;
  const groupName = "MultisigGroup";
  world.aliceInitiatorGroupName = groupName;

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

  // Capture Alice's OOBI for members
  const provideTab = $("[data-testid='share-oobi-segment-button']");
  await provideTab.waitForDisplayed({ timeout: 10000 });
  await provideTab.click();
  const installShareCaptureScript = `
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
  await browser.execute(installShareCaptureScript);

  const shareButton = $(".share-profile-oobi .share-button");
  await shareButton.waitForDisplayed({ timeout: 8000 });
  await shareButton.scrollIntoView?.().catch(() => { });
  await shareButton.click();
  const aliceOobiUrl = (await browser.execute(() => (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi)) as string | undefined;
  if (!aliceOobiUrl) throw new Error("Could not capture Alice's OOBI");
  world.aliceSharedOobi = aliceOobiUrl;

  const aliceGroupId = new URL(aliceOobiUrl).searchParams.get("groupId");
  world.aliceInitiatorGroupId = aliceGroupId;
  await driver.pressKeyCode(4);
  await browser.pause(500);
});

Given(
    /^IPEX the following members resolve each others' OOBIs and create member ids:$/,
    async function (dataTable: DataTable) {
      const world = this as AliceInitiatorWorld;
      if (!world.aliceSharedOobi || !world.aliceInitiatorGroupId) {
        throw new Error("Alice OOBI must be captured first.");
      }

      const members = dataTable.hashes().flatMap(r => r.name.split(',').map(name => name.trim()));
      console.log(members)
      const hostUrls = getKeriaUrlsForTestRunner();
      world.virtualMembers = {};

      // Step 1: Create all virtual wallets
      for (const name of members) {
        const wallet = await setupBackendUser(name);
        await wallet.generateOobi();
        world.virtualMembers[name] = { instance: wallet, oobi: "" };
      }

      // Step 2: Resolve Alice for all members and generate their OOBIs
      for (const [name, { instance }] of Object.entries(world.virtualMembers)) {
        if (!instance.oobi) throw new Error("Could not generate OOBI for member");
        await instance.resolveOobi(world.aliceSharedOobi!, "Alice");
        const url = new URL(instance.oobi);
        url.hostname = new URL(hostUrls.connectUrl).hostname;
        world.virtualMembers[name].oobi = url.toString();
      }

      // Step 3: Resolve each others' OOBIs
      const memberEntries = Object.entries(world.virtualMembers);
      for (let i = 0; i < memberEntries.length; i++) {
        for (let j = 0; j < memberEntries.length; j++) {
          if (i === j) continue;
          await memberEntries[i][1].instance.resolveOobi(memberEntries[j][1].oobi, memberEntries[j][0]);
        }
      }
    }
);

When(/^IPEX Alice pastes all member OOBIs on the Scan tab$/, async function () {
  const world = this as AliceInitiatorWorld;
  if (!world.virtualMembers) throw new Error("No virtual members found");

  const scanTab = $("[data-testid='scan-profile-segment-button']");

  for (const [name, member] of Object.entries(world.virtualMembers)) {
    await scanTab.waitForDisplayed({ timeout: 10000 });
    await scanTab.click();
    await browser.pause(200);

    if (!member.oobi) throw new Error(`OOBI missing for member ${name}`);

    const url = new URL(member.oobi);

    // Add required query params
    url.searchParams.set("groupId", world.aliceInitiatorGroupId!);
    url.searchParams.set("groupName", world.aliceInitiatorGroupName ?? "MultisigGroup");
    url.searchParams.set("name", name);

    const oobiForApp = url.toString();

    await pasteOobiAndConfirm(oobiForApp);
    await browser.pause(200);
  }

});

When(/^IPEX Alice initiates the group identifier$/, async function () {
  const provideTab = $("[data-testid='share-oobi-segment-button']");
  await provideTab.waitForDisplayed({ timeout: 10000 });
  await provideTab.click();
  await browser.pause(500);
  const initiateBtn = $("[data-testid='primary-button-setup-group-profile']");
  await initiateBtn.waitForDisplayed({ timeout: 10000 });
  await initiateBtn.click();
  await browser.pause(500);
  const alertConfirmBtn = $("[data-testid='alert-confirm-init-group-confirm-button']");
  await alertConfirmBtn.waitForDisplayed({ timeout: 5000 });
  await alertConfirmBtn.click();
  await browser.pause(500);

  await browser.waitUntil(
      async () => (await $("[data-testid='init-group-footer']").isDisplayed().catch(() => false)) || (await $("[data-testid='signer-alert-card-block']").isDisplayed().catch(() => false)),
      { timeout: 15000, timeoutMsg: "Confirm (InitializeGroup) screen did not load" }
  );
  await browser.pause(500);
});

When(/^IPEX Alice sets required and recovery signers to (\d+) and (\d+)$/, async function (requiredStr: string, recoveryStr: string) {
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

When(/^IPEX Alice sends the group requests$/, async function () {
  const sendRequestBtn = $("[data-testid='primary-button-init-group']");
  await sendRequestBtn.waitForDisplayed({ timeout: 10000 });
  await browser.pause(500);
  await sendRequestBtn.click();
  await browser.pause(3000);
});

When(/^IPEX all members accept the group invitation$/, async function () {
  const world = this as AliceInitiatorWorld;
  if (!world.virtualMembers) throw new Error("No virtual members to accept invitations");

  for (const member of Object.values(world.virtualMembers)) {
    await member.instance.acceptGroupInvitation(60000);
  }
  for (const member of Object.values(world.virtualMembers)) {
    await member.instance.waitPendingOperations();
  }
  // propose their endorsement before processing incoming ones.
  for (const member of Object.values(world.virtualMembers)) {
    await member.instance.authorizeGroupAgents("MultisigGroup");
  }
  // every member processes all incoming endorsements and anchors them locally.
  for (const member of Object.values(world.virtualMembers)) {
    await member.instance.processIncomingGroupAgentsEndorcements("MultisigGroup");
  }
  for (const member of Object.values(world.virtualMembers)) {
    await member.instance.waitPendingOperations();
  }
});

Then(/^IPEX the group status becomes "Active" when the group is ready$/, async function () {
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

When(/^IPEX Alice connects the active group to the credential issuer$/, async function () {
  const world = this as AliceInitiatorWorld;
  const previousIssuerContacts = await listIssuerContacts();
  const issuerOobiForApp = await getIssuerConnectionOobiForApp();

  // Navigate back from the profile management screen to the main app
  const backButton = $("[data-testid='back-button']");
  await backButton.waitForDisplayed({ timeout: 10000 });
  await backButton.click();
  await browser.pause(500);

  const cancelProfilesButton = $("[data-testid='close-button-label']");
  await cancelProfilesButton.waitForDisplayed({ timeout: 10000 });
  await cancelProfilesButton.click();
  await browser.pause(500);

  const homeTab = $("[data-testid='tab-button-home']");
  await homeTab.waitForDisplayed({ timeout: 10000 });
  await homeTab.click();
  await browser.pause(500);

  // Open the Connections tab and the share-profile modal
  await openAddConnectionFlow();

  // Capture the group's active multisig OOBI from the share-profile modal.
  // This is the OOBI the credential server needs to resolve so it knows
  // about the group's multisig AID (not Alice's individual AID).
  await installShareCapture();
  const groupShareButton = $(".share-profile-oobi .secondary-button");
  await groupShareButton.waitForDisplayed({ timeout: 10000 });
  await groupShareButton.click();
  await browser.pause(500);

  const groupOobi = (await browser.execute(
      () => (window as unknown as { __lastSharedOobi?: string }).__lastSharedOobi
  )) as string | undefined;

  if (!groupOobi) {
    throw new Error("Could not capture the group's OOBI from the share-profile modal.");
  }

  // Dismiss the native share dialog
  await driver.pressKeyCode(4);
  await browser.pause(500);

  // Paste the issuer OOBI on the Scan tab to create the connection
  const scanTab = $("[data-testid='scan-profile-segment-button']");
  await scanTab.waitForDisplayed({ timeout: 10000 });
  await scanTab.click();
  await browser.pause(300);
  await pasteOobiAndConfirm(issuerOobiForApp);
  await browser.pause(2000);

  // Wait for the issuer connection to appear on the Connections page
  await browser.waitUntil(
      async () => await pageBodyContains(CF_CREDENTIAL_ISSUANCE_ALIAS),
      {
        timeout: 30000,
        timeoutMsg: `"${CF_CREDENTIAL_ISSUANCE_ALIAS}" not visible on Connections page.`,
      }
  );

  // Wait for the connection to become Confirmed (the "Pending" chip disappears).
  // The app resolves the issuer's OOBI asynchronously via KERIA. While that
  // resolution is in progress the connection shows a "Pending" chip. Once KERIA
  // finishes, the app transitions the connection to Confirmed and shares its
  // identifier with the issuer via an /introduce reply. Credential notifications
  // will only arrive after this transition completes.
  //
  // IMPORTANT: We wait for this to complete BEFORE asking the credential server
  // to resolve the group OOBI. Both the wallet and credential server share
  // the same KERIA instance. Running two OOBI resolutions concurrently
  // overwhelms KERIA ("skipped stale keystate sig datetime" loops), which
  // can cause the wallet's notification polling to timeout and the app to
  // show "You're offline".
  await browser.waitUntil(
      async () => {
        const hasIssuer = await pageBodyContains(CF_CREDENTIAL_ISSUANCE_ALIAS);
        const hasPending = await pageBodyContains("Pending");
        return hasIssuer && !hasPending;
      },
      {
        timeout: 90000,
        timeoutMsg: `Connection "${CF_CREDENTIAL_ISSUANCE_ALIAS}" did not transition from Pending to Confirmed within 90s.`,
      }
  );

  // Now that the wallet-side resolution is done, tell the credential server
  // to resolve the group's multisig OOBI. This is the server-side
  // "acceptance" — the credential server's KERIA agent fetches the group's
  // key state so it can later issue credentials to this AID.
  // Doing this sequentially (after Confirmed) avoids the concurrent-resolution
  // overload that causes stale-keystate storms on the shared KERIA instance.
  await resolveWalletOobiForIssuer(groupOobi);

  // Give KERIA time to finish processing the group's key state and any
  // stale-keystate replies before we start issuing credentials.
  await browser.pause(15000);

  // If KERIA was briefly overwhelmed during the OOBI resolution, the app
  // might have gone offline. Wait for it to come back.
  await browser.waitUntil(
      async () => !(await pageBodyContains("You're offline")),
      {
        timeout: 60000,
        interval: 2000,
        timeoutMsg: "App did not recover from offline state after OOBI resolution within 60s.",
      }
  );

  // Poll the credential server for the new contact (the group's multisig AID).
  const issuerContact = await waitForNewIssuerContact(
      previousIssuerContacts.map((contact) => contact.id),
      60000
  );
  world.credentialIssuerContactId = issuerContact.id;
  world.credentialIssuerNotificationName = CF_CREDENTIAL_ISSUANCE_ALIAS;
});

When(
    /^IPEX the credential issuer offers a "([^"]*)" credential to Alice's group$/,
    async function (credentialName: string) {
      const world = this as AliceInitiatorWorld;
      if (!world.credentialIssuerContactId) {
        throw new Error("Credential issuer connection must be created before issuing a credential.");
      }
      if (credentialName !== RARE_EVO_SCHEMA_NAME) {
        throw new Error(`Only "${RARE_EVO_SCHEMA_NAME}" is currently supported by this test flow.`);
      }

      // Ensure the app is online before issuing — if KERIA just finished
      // heavy OOBI processing it may still be recovering.
      await browser.waitUntil(
          async () => !(await pageBodyContains("You're offline")),
          {
            timeout: 30000,
            interval: 2000,
            timeoutMsg: "App is offline before credential issuance.",
          }
      );

      await issueRareEvoCredential(world.credentialIssuerContactId, "Alice Initiator");

      // Allow KERIA to begin processing the exchange before the wallet
      // tries to interact with the grant notification.
      await browser.pause(5000);
    }
);

Then(/^IPEX Alice receives the offered credential as the initiator$/, async function () {
  const world = this as AliceInitiatorWorld;
  const notificationText = `${world.credentialIssuerNotificationName ?? CF_CREDENTIAL_ISSUANCE_ALIAS} ${ISSUE_NOTIFICATION_TEXT}`;

  // If the app has transiently gone offline (e.g. KERIA was briefly
  // overwhelmed during the multisig exchange), wait for it to reconnect
  // before trying to interact with the notification.
  await browser.waitUntil(
      async () => !(await pageBodyContains("You're offline")),
      {
        timeout: 90000,
        interval: 2000,
        timeoutMsg: "App did not recover from offline state within 90s.",
      }
  );

  await navigateToTab("notifications");
  await openNotificationByText(notificationText);
  await confirmNotificationWithPasscode(world.passcode);

  await navigateToTab("credentials");
  await browser.waitUntil(
      async () => pageBodyContains(RARE_EVO_SCHEMA_NAME),
      {
        timeout: 60000,
        timeoutMsg: `Credential "${RARE_EVO_SCHEMA_NAME}" was not visible in the credentials tab.`,
      }
  );
});

When(
    /^IPEX the credential issuer requests presentation of the "([^"]*)" credential from Alice's group$/,
    async function (credentialName: string) {
      const world = this as AliceInitiatorWorld;
      if (!world.credentialIssuerContactId) {
        throw new Error("Credential issuer connection must be created before requesting a presentation.");
      }
      if (credentialName !== RARE_EVO_SCHEMA_NAME) {
        throw new Error(`Only "${RARE_EVO_SCHEMA_NAME}" is currently supported by this test flow.`);
      }

      await requestRareEvoPresentation(world.credentialIssuerContactId);
    }
);

Then(/^IPEX Alice presents the requested credential as the initiator$/, async function () {
  const world = this as AliceInitiatorWorld;
  const notificationText = `${world.credentialIssuerNotificationName ?? CF_CREDENTIAL_ISSUANCE_ALIAS} ${PRESENTATION_NOTIFICATION_TEXT}`;

  await navigateToTab("notifications");
  await openNotificationByText(notificationText);
  await confirmNotificationWithPasscode(world.passcode);

  await browser.waitUntil(
      async () => {
        const url = await browser.getUrl();
        return url.includes("/tabs/notifications") || url.includes("/tabs/credentials");
      },
      {
        timeout: 30000,
        timeoutMsg: "The app did not leave the presentation request flow after presenting the credential.",
      }
  );
});

After(function () {
  resetBackendUsers();
});
