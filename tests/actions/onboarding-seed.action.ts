import { Given, Then, When } from "@wdio/cucumber-framework";
import { browser, driver } from "@wdio/globals";
import { switchToAppWebview } from "../helpers/webview.helper.js";
import { getSSIAgentUrls } from "../helpers/ssi-agent-urls.helper.js";
import PasscodeScreen from "../screen-objects/onboarding/passcode.screen.js";

const APP_ID = "org.cardanofoundation.idw";
const DEV_PASSCODE = [1, 1, 1, 1, 1, 1]; // devPreload writes "111111"

/**
 * The app re-requests notification permission after the relaunch — a native
 * dialog that sits on top of the webview and blocks Home. The wdio config's
 * beforeScenario already dismisses this at scenario start; we reuse the same
 * "Don't allow" selector convention here because the mid-Given relaunch
 * re-triggers it. Best-effort — never throws.
 */
async function dismissNotificationPermission(): Promise<void> {
  try {
    await driver.switchContext("NATIVE_APP");
    const denyButton = await driver.$(
      '//android.widget.Button[@text="Don\'t allow" or @text="DON\'T ALLOW" or @text="Not now" or @text="Deny" or @text="DENY"]'
    );
    if (await denyButton.isExisting()) {
      await denyButton.click();
    }
  } catch {
    // no dialog present — fine
  }
}

/**
 * Fast-onboard fixture. Reproduces the onboarded state via the dev-only in-app
 * `window.__seedOnboarded` hook (Agent.devSeedOnboarded), then relaunches so the
 * real init path routes to Home. Deterministic ~19s drop-in for the ~50s UI
 * onboarding precondition.
 *
 * @param displayName when set, seeds one identifier so the app lands on a
 *                     populated Home; when omitted, lands on an empty Home.
 * @returns the seeded identifier id, or undefined when none was created.
 */
async function seedAndLand(
  displayName?: string
): Promise<string | undefined> {
  // boot 10.0.2.2:3903, connect 10.0.2.2:3901 on the Android emulator
  const { bootUrl, connectUrl } = getSSIAgentUrls();

  await switchToAppWebview();

  // The hook is attached during AppWrapper init; wait for it before calling.
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () =>
          typeof (window as unknown as { __seedOnboarded?: unknown })
            .__seedOnboarded === "function"
      )) === true,
    { timeout: 30000, timeoutMsg: "__seedOnboarded hook never appeared" }
  );

  // Seed (boot+connect [+ create identifier]) is async/network-bound; retry once.
  let seeded = false;
  let seededAid: string | undefined;
  for (let attempt = 0; attempt < 2 && !seeded; attempt++) {
    const result = (await browser.executeAsync(
      (
        bUrl: string,
        cUrl: string,
        name: string,
        done: (r: { ok?: boolean; aid?: string; error?: string }) => void
      ) => {
        const w = window as unknown as {
          __seedOnboarded: (o: {
            bootUrl: string;
            connectUrl: string;
            displayName?: string;
          }) => Promise<string | undefined>;
        };
        const opts: { bootUrl: string; connectUrl: string; displayName?: string } =
          { bootUrl: bUrl, connectUrl: cUrl };
        if (name) opts.displayName = name;
        w.__seedOnboarded(opts)
          .then((aid) => done({ ok: true, aid }))
          .catch((e) => done({ error: String(e && e.message ? e.message : e) }));
      },
      bootUrl,
      connectUrl,
      displayName ?? ""
    )) as { ok?: boolean; aid?: string; error?: string };

    if (result.ok) {
      seeded = true;
      seededAid = result.aid;
    } else if (attempt === 1) {
      throw new Error(`Seed onboarding failed: ${result.error}`);
    }
  }

  // Relaunch so the genuine AppWrapper init hydrates state and routes to Home.
  await driver.switchContext("NATIVE_APP");
  await driver.terminateApp(APP_ID);
  await driver.activateApp(APP_ID);

  // On launch the app requests notification permission — a native dialog that
  // sits on top of the webview and blocks Home. Pre-grant it and dismiss the
  // dialog if it already appeared.
  await dismissNotificationPermission();

  // Re-attach to the webview — it re-registers a few seconds after relaunch,
  // so a direct switch-by-name races and throws "No such context found".
  await browser.waitUntil(
    async () => {
      try {
        const contexts = (await driver.getContexts()) as Array<
          string | { id: string }
        >;
        const wv = contexts
          .map((c) => (typeof c === "string" ? c : c.id))
          .find((c) => String(c).includes("WEBVIEW"));
        if (!wv) return false;
        await driver.switchContext(String(wv));
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: 60000,
      interval: 2000,
      timeoutMsg: "Webview did not re-attach after relaunch",
    }
  );

  // Init runs a cloud migration + agent reconnect, so Home can take a while.
  // Wait for either the lock screen or the Home tab, whichever appears first.
  const passcodePad = () => $('[data-testid="passcode-button-1"]');
  const homeTab = () => $('[data-testid="tab-button-home"]');
  await browser.waitUntil(
    async () =>
      (await passcodePad().isExisting()) || (await homeTab().isExisting()),
    {
      timeout: 90000,
      interval: 1500,
      timeoutMsg: "Neither lock screen nor Home appeared after relaunch",
    }
  );

  // If locked, enter the dev passcode (devPreload wrote "111111").
  if (await passcodePad().isExisting()) {
    await PasscodeScreen.enterPasscode(DEV_PASSCODE);
  }

  // Confirm we landed on the Home dashboard tab (not Profile Setup).
  await homeTab().waitForDisplayed({ timeout: 60000 });

  return seededAid;
}

// Empty Home (no identifier) — drop-in for scenarios that add the first one.
Given(/^user is onboarded \(seed\)$/, async function () {
  this.seededAid = await seedAndLand();
});

// Populated Home — seeds one identifier for scenarios that need an existing one.
Given(
  /^user is onboarded \(seed\) with an identifier(?: "([^"]*)")?$/,
  async function (name?: string) {
    this.seededAid = await seedAndLand(name || "Test Identifier");
  }
);

Then(/^user can see the Home screen$/, async function () {
  await $('[data-testid="tab-button-home"]').waitForDisplayed({
    timeout: 30000,
  });
});

// Current-UX navigation: the Connections tab + screen still exist in the
// restructured app (src/ui/pages/Connections), unlike the obsolete Identifiers
// screen. Demonstrates the fixture enabling a real post-onboarding test.
When(/^user taps the Connections tab$/, async function () {
  const tab = $('[data-testid="tab-button-connections"]');
  await tab.waitForDisplayed({ timeout: 30000 });
  await tab.click();
});

Then(/^user can see the Connections screen$/, async function () {
  await $('[data-testid="add-connection-button"]').waitForDisplayed({
    timeout: 30000,
  });
});
