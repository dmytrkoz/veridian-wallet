import { When, Then } from "@wdio/cucumber-framework";
import { browser } from "@wdio/globals";
import { t } from "../../config/timeouts.js";
import { cutConnection, restore } from "../../helpers/faults.js";
import ProfileSetupScreen from "../../screen-objects/onboarding/profile-setup.screen.js";

const HOME_TAB = '[data-testid="tab-button-home"]';
const AVATAR = '[data-testid="avatar-button"]';
const PROFILES = '[data-testid="profiles"]';
const OFFLINE_PAGE = '[data-testid="offline-page"]';

// Drive the real ProfileSetup individual-create flow up to (and including) the
// final confirm that fires createIdentifier.
async function driveIndividualCreate(name: string): Promise<void> {
  await ProfileSetupScreen.selectIndividualProfile();
  await ProfileSetupScreen.confirmButton.click();
  await ProfileSetupScreen.waitForProfileSetupScreen();
  await ProfileSetupScreen.enterUsername(name);
  await ProfileSetupScreen.confirmButton.click();
}

// After a (recovered) create, reach Home: wait out any offline overlay, click
// Continue on the FinishSetup/Welcome screen if it shows, land on the Home tab.
async function landOnHome(): Promise<void> {
  await $(OFFLINE_PAGE)
    .waitForDisplayed({ reverse: true, timeout: t(90000) })
    .catch(() => {});
  if (await ProfileSetupScreen.welcomeTitle.isDisplayed().catch(() => false)) {
    await ProfileSetupScreen.continueButton.click();
  }
  await $(HOME_TAB).waitForDisplayed({ timeout: t(90000) });
}

// Open the profiles list via the avatar.
async function openProfiles(): Promise<void> {
  const avatar = $(AVATAR);
  await avatar.waitForDisplayed({ timeout: t(30000) });
  await avatar.click();
  await $(PROFILES).waitForDisplayed({ timeout: t(30000) });
}

// Read the named profile's id + whether it shows the PENDING chip, from the
// already-open profiles list (the same DOM the user sees).
async function profileInfo(
  name: string
): Promise<{ exists: boolean; pending: boolean; id: string | null }> {
  return (await browser.execute((n: string) => {
    const root = document.querySelector('[data-testid="profiles"]');
    if (!root) return { exists: false, pending: false, id: null };
    let item: Element | null = null;
    root.querySelectorAll(".profiles-list-item-name").forEach((nm) => {
      if ((nm.textContent || "").trim().toLowerCase() === n.toLowerCase()) {
        item = nm.closest('[data-testid^="profiles-list-item-"]');
      }
    });
    if (!item) return { exists: false, pending: false, id: null };
    const id = (
      (item as Element).getAttribute("data-testid") || ""
    ).replace("profiles-list-item-", "");
    const pending = !!root.querySelector(
      `[data-testid="profiles-list-item-pending-${id}-status"]`
    );
    return { exists: true, pending, id };
  }, name)) as { exists: boolean; pending: boolean; id: string | null };
}

When(
  /^Alice creates an individual profile "([^"]+)" with a mid-creation KERIA outage$/,
  async function (name: string) {
    await driveIndividualCreate(name);
    // The final confirm fired createIdentifier (not awaited here). Let it pass the
    // pre-enqueue config fetch + the durable queue write, THEN cut so the outage
    // lands on the remote create / witness op - which the reconnect scan retries.
    await browser.pause(t(2500));
    await cutConnection("keria_connect");
    await browser.pause(t(4000));
    await restore("keria_connect");
  }
);

Then(
  /^the individual profile "([^"]+)" eventually shows as complete$/,
  async function (name: string) {
    await landOnHome();
    await openProfiles();
    // Wait for the profile to render before reading (avoids a snapshot race).
    await browser.waitUntil(async () => (await profileInfo(name)).exists, {
      timeout: t(30000),
      interval: 1000,
      timeoutMsg: `Profile "${name}" was not created after reconnect`,
    });
    const info = await profileInfo(name);
    if (!info.pending) return;
    // Oracle limitation: an individual profile renders the PENDING chip only -
    // COMPLETE and FAILED both render no chip (ProfileItem.tsx) and creationStatus
    // is not exposed to the DOM. Under a transient cut+restore the witness op
    // resumes to COMPLETE; a FAILED terminal state needs a persistent error and is
    // not expected here, whereas failed recovery instead leaves it PENDING and
    // times out below. So "the PENDING chip clears" is the available signal.
    await $(`[data-testid="profiles-list-item-pending-${info.id}-status"]`)
      .waitForDisplayed({ reverse: true, timeout: t(90000) });
  }
);
