import { When, Then } from "@wdio/cucumber-framework";
import { browser, driver } from "@wdio/globals";
import PasscodeScreen from "../../screen-objects/onboarding/passcode.screen.js";
import
  IdentifiersCredentialPasscodeScreen
 from "../../screen-objects/identifiers/identifiers-credential-passcode.screen.js";
import { Issuer, RemoteJoiner } from "../../helpers/virtual-wallet.js";
import {
  CF_CREDENTIAL_ISSUANCE_ALIAS,
  ACDC_SCHEMAS,
} from "../../helpers/credential-server.helper.js";
import {
  installShareCapture,
  pasteOobiAndConfirm,
  pageContainsText,
  waitUpTo,
  toastContainsText
} from "./group-profile.helpers.js";
import { createIssuer } from "../../helpers/virtual-wallet.factory.js";
import {
  startSchemaServer,
  getSchemaOobi,
  getSchemaServerOobiBase,
  setupIssuerSchemaEndpoint,
} from "../../helpers/schema-server.helper.js";
import ConnectionsScreen from "../../screen-objects/connections/connections.screen.js";
import ConnectionsDetailsScreen from "../../screen-objects/connections/connections-details.screen.js";

const CREDENTIAL_PENDING_TEXT = "Credential request pending";
const NEW_CREDENTIAL_ADDED_TEXT = "New credential added";

async function openAddConnectionFlow(): Promise<void> {
  await navigateToTab("connections");

  const addConnectionButton = $("[data-testid='primary-button-connections-tab']");
  await addConnectionButton.waitForDisplayed();
  await addConnectionButton.click();

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

async function navigateToTabUsingJSClick(tabName: string): Promise<void> {
  await browser.execute((name) => {
    const buttons = document.querySelectorAll(`[data-testid='tab-button-${name}']`);
    // Disable all instances first
    buttons.forEach((btn) => {
      btn.removeAttribute('href');
    });
    // Click the last one (most recent/active view)
    if (buttons.length) {
      (buttons[buttons.length - 1] as HTMLElement).click();
    }
  }, tabName);

  await browser.pause(500);

  // Verify we actually navigated
  const url = await browser.getUrl();
  if (!url.includes(tabName)) {
    // Force navigate via URL as fallback
    await browser.execute((name) => {
      window.location.hash = '';
      const ionRouter = document.querySelector('ion-router');
      if (ionRouter) {
        (ionRouter as any).push(`/tabs/${name}`);
      }
    }, tabName);
    await browser.pause(500);
  }
}

async function openNotificationByText(labelText: string): Promise<void> {
  await waitUpTo(
      async () => {
        const items = await $$("[data-testid^='notifications-tab-item-']");
        for (const item of items) {
          const label = await item.getText().catch(() => "");
          if (label.includes(labelText)) {
            await item.click();
            return true;
          }
        }
        return false;
      },
      3000,
  );
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

  const passcodeVisible = await IdentifiersCredentialPasscodeScreen.verifyPasscodeTitle.isDisplayed().catch(() => false);
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
  groupAid?: string;
  credentialIssuerNotificationName?: string; // This may be not needed
  passcode?: number[];
  virtualMembers?: Record<
      string,
      {
        instance: RemoteJoiner;
        oobi: string;
      }
  >;
  aliceSharedOobi?: string;
  issuer?: Issuer;
};

When(/^IPEX Alice connects the credential issuer$/, async function () {
  const world = this as AliceInitiatorWorld;
  if (!world.issuer) {
    world.issuer = await createIssuer("Issuer");

    // Start the local schema server and configure the Issuer's indexer endpoint.
    // This replaces the cred-issuance container entirely.
    await startSchemaServer();
    await setupIssuerSchemaEndpoint(world.issuer);
  }
  const issuerOobi = await world.issuer.getOobi({ alias: CF_CREDENTIAL_ISSUANCE_ALIAS });

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
  await browser.pause(200);

  // Paste the issuer OOBI on the Scan tab to create the connection
  const scanTab = $("[data-testid='scan-profile-segment-button']");
  await scanTab.waitForDisplayed();
  await scanTab.click();
  await pasteOobiAndConfirm(issuerOobi);

  // Wait for the issuer connection to appear on the Connections page
  await waitUpTo(
      async () => await pageContainsText(CF_CREDENTIAL_ISSUANCE_ALIAS)
  );

  await world.issuer.resolveOobi(groupOobi, "MultisigGroup");
  console.log(`Resolved group OOBI for issuer: ${groupOobi}`);
  world.groupAid = groupOobi.split("/oobi/")[1].split("/")[0];

  await waitUpTo(
      async () => {
        const hasPending = await pageContainsText("Pending");
        return !hasPending;
      }
  );
});

When(/^IPEX the credential issuer offers a "([^"]*)" credential to Alice's group$/,
    async function (credentialName: string) {
      const world = this as AliceInitiatorWorld;
      const registry = await world.issuer!.createRegistry("issuer-registry");
      const acdcSchemaSaid = ACDC_SCHEMAS[credentialName];
      // Resolve schema from the local server instead of cred-issuance container
      const schemaOobi = getSchemaOobi(acdcSchemaSaid);
      await world.issuer!.resolveOobi(schemaOobi, credentialName);
      const credentialSaid = await world.issuer!.issueCredential({
        registry: registry.regk,
        schemaSaid: acdcSchemaSaid,
        recipientId: world.groupAid!,
        claims: {
          attendeeName: "Alice",
        },
      });
      // Embed the schema server URL in the grant so the wallet resolves
      // schemas via getInlineSchemaOobiBase(), bypassing the indexer/ESSR
      // path that fails from the Android emulator.
      await world.issuer!.grantCredential(
          credentialSaid,
          world.groupAid!,
          getSchemaServerOobiBase(),
      );
    }
);

Then(/^IPEX Alice receives the offered credential as the initiator$/, async function () {
  const world = this as AliceInitiatorWorld;

  await navigateToTab("notifications");
  await openNotificationByText(CF_CREDENTIAL_ISSUANCE_ALIAS);
  await confirmNotificationWithPasscode(world.passcode);

  await waitUpTo(
      async () => pageContainsText(CF_CREDENTIAL_ISSUANCE_ALIAS),
      3000
  );
});

Then(/^IPEX Alice presents the "([^"]*)" credential as the initiator$/, async function (credentialName: string) {
  await toastContainsText(CREDENTIAL_PENDING_TEXT)
  await toastContainsText(NEW_CREDENTIAL_ADDED_TEXT)
  await navigateToTabUsingJSClick("connections");
  await browser.pause(50000);
  await ConnectionsDetailsScreen.verifyCredentialReceivedInHistory(credentialName);
});

