import { After, When, Then } from "@wdio/cucumber-framework";
import { $ } from "@wdio/globals";
import { t } from "../../config/timeouts.js";
import { stopKeria, startKeria } from "../../helpers/keria-network.js";

// The full-screen offline overlay is AppOffline, rendered through
// ResponsivePageLayout with pageId="offline" -> data-testid="offline-page".
const OFFLINE_PAGE = '[data-testid="offline-page"]';
const HOME_TAB = '[data-testid="tab-button-home"]';

When(/^the KERIA backend goes offline$/, async function () {
  // Stop the keria container on the host; the emulator's webview fetch to keria
  // (10.0.2.2:3901 -> host) now fails with "Failed to fetch".
  await stopKeria();
});

Then(/^the app shows the offline screen$/, async function () {
  // The poller (~2s cadence) hits the stopped keria, the failed fetch is
  // recognised as a network error, the agent flips offline and AppOffline mounts.
  await $(OFFLINE_PAGE).waitForDisplayed({ timeout: t(30000) });
});

When(/^the KERIA backend comes back online$/, async function () {
  // Bring keria back; agent state persisted on the keria-data volume.
  await startKeria();
});

// Failure-safe: if a step between stopKeria and the recovery step throws (e.g.
// the offline overlay never mounts), the scenario would otherwise leave keria
// stopped and poison every later scenario's onboarding. startKeria is idempotent.
After({ tags: "@offline" }, async () => {
  await startKeria();
});

Then(/^the app leaves the offline screen$/, async function () {
  // The agent's connect() retry loop (~1s) reconnects once keria is ready;
  // generous timeout covers the container's cold start. The overlay unmounts and
  // the Home dashboard is interactive again.
  await $(OFFLINE_PAGE).waitForDisplayed({ reverse: true, timeout: t(90000) });
  await $(HOME_TAB).waitForDisplayed({ timeout: t(30000) });
});
