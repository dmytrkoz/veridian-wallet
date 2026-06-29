import { After, When, Then } from "@wdio/cucumber-framework";
import { $ } from "@wdio/globals";
import { t } from "../../config/timeouts.js";
import { cutConnection, restore, flap } from "../../helpers/faults.js";

// The full-screen offline overlay is AppOffline, rendered through
// ResponsivePageLayout with pageId="offline" -> data-testid="offline-page".
const OFFLINE_PAGE = '[data-testid="offline-page"]';
const HOME_TAB = '[data-testid="tab-button-home"]';

When(/^the KERIA backend goes offline$/, async function () {
  // Cut the app<->keria path at the Toxiproxy layer (disable the connect proxy).
  // keria itself stays UP — only the connection is severed, so the emulator's
  // webview fetch to keria fails with "Failed to fetch". Cleaner + faster than
  // stopping the container (no cold-start on recovery) and the app config is
  // unchanged (it already routes through toxiproxy on 3901).
  await cutConnection("keria_connect");
});

Then(/^the app shows the offline screen$/, async function () {
  // The poller (~2s cadence) hits the cut connection, the failed fetch is
  // recognised as a network error, the agent flips offline and AppOffline mounts.
  await $(OFFLINE_PAGE).waitForDisplayed({ timeout: t(30000) });
});

When(/^the KERIA backend comes back online$/, async function () {
  // Re-enable the proxy + clear toxics. keria never went down, so reconnection is
  // immediate (no container cold-start).
  await restore("keria_connect");
});

// Failure-safe: if a step between cutConnection and recovery throws (e.g. the
// offline overlay never mounts), the scenario would otherwise leave the proxy
// disabled and poison later scenarios. restore re-enables + clears toxics.
After({ tags: "@offline" }, async () => {
  await restore("keria_connect");
});

Then(/^the app leaves the offline screen$/, async function () {
  // The agent's connect() retry loop (~1s) reconnects as soon as the proxy is back.
  // The overlay unmounts and the Home dashboard is interactive again.
  await $(OFFLINE_PAGE).waitForDisplayed({ reverse: true, timeout: t(90000) });
  await $(HOME_TAB).waitForDisplayed({ timeout: t(30000) });
});

When(/^the KERIA connection flaps$/, async function () {
  // Cut/restore the connect path 5x at ~1s spacing, leaving it restored. Stresses
  // the reconnect handling (the poller and @OnlineOnly each spawn a connect() loop).
  await flap("keria_connect", 5, 1000);
});

Then(/^the app settles back online$/, async function () {
  // After the storm the overlay must clear and Home must be interactive again.
  await $(OFFLINE_PAGE).waitForDisplayed({ reverse: true, timeout: t(90000) });
  await $(HOME_TAB).waitForDisplayed({ timeout: t(30000) });
});
