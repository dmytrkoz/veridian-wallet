import { Given, When, Then } from "@wdio/cucumber-framework";
import { expect } from "expect-webdriverio";
import { browser, driver } from "@wdio/globals";
import PasscodeScreen from "../../screen-objects/onboarding/passcode.screen.js";
import { RemoteJoiner } from "../../helpers/virtual-wallet.js";
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
import { installShareCapture, pasteOobiAndConfirm, pageContainsText } from "./group-profile.helpers.js";

const GROUP_ID_MISMATCH_MSG = "Connection not part of this group";
const ISSUE_NOTIFICATION_TEXT = "wants to issue you a credential";
const PRESENTATION_NOTIFICATION_TEXT = "has requested a credential from you";

async function openAddConnectionFlow(): Promise<void> {
  await navigateToTab("connections");

  const addConnectionButton = $("[data-testid='primary-button-connections-tab']");
  await addConnectionButton.waitForDisplayed();
  await addConnectionButton.click();

  // const headerAddConnectionButton = $("[data-testid='add-connection-button']");
  // const addConnectionButton = (await placeholderAddConnectionButton.isDisplayed().catch(() => false))
  //   ? placeholderAddConnectionButton
  //   : headerAddConnectionButton;

  // await addConnectionButton.waitForDisplayed();
  // await addConnectionButton.click();

  const shareProfileModal = $("[data-testid='share-profile']");
  await shareProfileModal.waitForDisplayed();
}

/**
 * Navigate by tapping a tab bar button.
 * This is more reliable than browser.url() in Appium/Capacitor webview contexts.
 */
async function navigateToTab(tabName: string): Promise<void> {
  const tab = $(`[data-testid='tab-button-${tabName}']`);
  await tab.waitForDisplayed();
  await tab.click();
}

async function openNotificationByText(labelText: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const items = $$("[data-testid^='notifications-tab-item-']");
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

  const items = $$("[data-testid^='notifications-tab-item-']");
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
    const credentialChoices = $$("[data-testid^='cred-select-']");
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

When(/^IPEX Alice connects the active group to the credential issuer$/, async function () {
  const world = this as AliceInitiatorWorld;
  const previousIssuerContacts = await listIssuerContacts();
  const issuerOobiForApp = await getIssuerConnectionOobiForApp();
  
  // Navigate back from the profile management screen to the main app
  const backButton = $("[data-testid='back-button']");
  await backButton.waitForDisplayed();
  await backButton.click();
  
  const cancelProfilesButton = $("[data-testid='close-button-label']");
  await cancelProfilesButton.waitForDisplayed();
  await cancelProfilesButton.click();

  // Open the Connections tab and the share-profile modal
  await openAddConnectionFlow();

  await installShareCapture();

  const groupShareButton = $(".share-profile-oobi .secondary-button");
  await groupShareButton.waitForDisplayed();
  await groupShareButton.click();

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
    async () => await pageContainsText(CF_CREDENTIAL_ISSUANCE_ALIAS),
    {
      timeout: 30000,
      timeoutMsg: `"${CF_CREDENTIAL_ISSUANCE_ALIAS}" not visible on Connections page.`,
    }
  );

  // Tell the credential server to resolve the group's multisig OOBI.
  // This is the server-side "acceptance" of the connection — the credential
  // server's KERIA agent fetches the group's key state so it can later
  // issue credentials to / request presentations from this AID.
  await resolveWalletOobiForIssuer(groupOobi);

  // Wait for the connection to become Confirmed (the "Pending" chip disappears).
  // The app resolves the issuer's OOBI asynchronously via KERIA. While that
  // resolution is in progress the connection shows a "Pending" chip. Once KERIA
  // finishes, the app transitions the connection to Confirmed and shares its
  // identifier with the issuer via an /introduce reply. Credential notifications
  // will only arrive after this transition completes.
  await browser.waitUntil(
    async () => {
      const hasIssuer = await pageContainsText(CF_CREDENTIAL_ISSUANCE_ALIAS);
      const hasPending = await pageContainsText("Pending");
      return hasIssuer && !hasPending;
    },
    {
      timeout: 90000,
      timeoutMsg: `Connection "${CF_CREDENTIAL_ISSUANCE_ALIAS}" did not transition from Pending to Confirmed within 90s.`,
    }
  );

  // Now that both sides have resolved each other, poll the credential server
  // for the new contact (the group's multisig AID).
  const issuerContact = await waitForNewIssuerContact(
    previousIssuerContacts.map((contact) => contact.id),
    30000
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

    await issueRareEvoCredential(world.credentialIssuerContactId, "Alice Initiator");
  }
);

Then(/^IPEX Alice receives the offered credential as the initiator$/, async function () {
  const world = this as AliceInitiatorWorld;
  const notificationText = `${world.credentialIssuerNotificationName ?? CF_CREDENTIAL_ISSUANCE_ALIAS} ${ISSUE_NOTIFICATION_TEXT}`;

  await navigateToTab("notifications");
  await openNotificationByText(notificationText);
  await confirmNotificationWithPasscode(world.passcode);

  await navigateToTab("credentials");
  await browser.waitUntil(
    async () => pageContainsText(RARE_EVO_SCHEMA_NAME),
    {
      timeout: 30000,
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
