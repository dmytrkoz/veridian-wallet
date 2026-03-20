import { When, Then } from "@wdio/cucumber-framework";
import { browser, driver } from "@wdio/globals";
import {
  CF_CREDENTIAL_ISSUANCE_ALIAS,
  ACDC_SCHEMAS,
} from "../../helpers/credential-server.helper.js";
import {
  installShareCapture,
  pasteOobiAndConfirm,
  pageContainsText,
  waitUpTo,
  toastContainsText, openAddConnectionFlow, openNotificationByText, confirmNotificationWithPasscode
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
import { AliceInitiatorWorld } from "./group-profile.types.js";
import {navigateToTab, navigateToTabUsingJsClick} from "../../helpers/tab.helper";

const CREDENTIAL_PENDING_TEXT = "Credential request pending";
const NEW_CREDENTIAL_ADDED_TEXT = "New credential added";


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
      world.acdcSchemaSaid = acdcSchemaSaid;
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

When(/^all members join the multisig admit$/, async function () {
  const world = this as AliceInitiatorWorld;
  if (!world.requiredSigners || world.requiredSigners <= 1) {
    console.log("Single signer threshold — skipping multisig admit join");
    return;
  }

  if (!world.virtualMembers || !world.aliceInitiatorGroupName) {
    throw new Error("No virtual members or group name found");
  }

  // Resolve the issuer's OOBI and schema OOBI for all virtual members so their
  // KERIA agents can validate the credential grant.
  const issuerOobi = await world.issuer!.getOobi({ alias: CF_CREDENTIAL_ISSUANCE_ALIAS });
  const schemaOobi = getSchemaOobi(world.acdcSchemaSaid!);
  for (const [, member] of Object.entries(world.virtualMembers)) {
    await member.instance.resolveOobi(issuerOobi, CF_CREDENTIAL_ISSUANCE_ALIAS);
    await member.instance.resolveOobi(schemaOobi, "schema");
  }

  const memberAids: string[] = [];
  for (const [, member] of Object.entries(world.virtualMembers)) {
    const memberOobi = await member.instance.getOobi({ alias: member.instance.aidName });
    await world.issuer!.resolveOobi(memberOobi, member.instance.aidName);
    memberAids.push(await member.instance.getAid());
  }
  await world.issuer!.redeliverGrant(memberAids);

  // All virtual members submit their co-signatures
  for (const [, member] of Object.entries(world.virtualMembers)) {
    await member.instance.joinMultisigAdmit(world.aliceInitiatorGroupName);
  }

  // Wait for all pending operations (admit) to complete on KERIA
  for (const [, member] of Object.entries(world.virtualMembers)) {
    await member.instance.waitPendingOperations();
  }
});

Then(/^IPEX Alice presents the "([^"]*)" credential as the initiator$/, async function (credentialName: string) {
  await toastContainsText(CREDENTIAL_PENDING_TEXT)
  await toastContainsText(NEW_CREDENTIAL_ADDED_TEXT)
  await navigateToTabUsingJsClick("connections");
  await ConnectionsScreen.checkListConnection(CF_CREDENTIAL_ISSUANCE_ALIAS)
  await ConnectionsScreen.connectionTitle.click();
  await ConnectionsDetailsScreen.verifyCredentialReceivedInHistory(credentialName);
});

