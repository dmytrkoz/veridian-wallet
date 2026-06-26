import { Given, Then, When } from "@wdio/cucumber-framework";
import { browser, driver } from "@wdio/globals";
import { t } from "../config/timeouts.js";
import { switchToAppWebview } from "../helpers/webview.helper.js";
import { getSSIAgentUrls } from "../helpers/ssi-agent-urls.helper.js";
import PasscodeScreen from "../screen-objects/onboarding/passcode.screen.js";

const APP_ID = "org.cardanofoundation.idw";
const DEV_PASSCODE = [1, 1, 1, 1, 1, 1]; // devPreload writes "111111"

/**
 * Dismiss the post-relaunch notification-permission dialog IF it appears. With
 * autoGrantPermissions it usually does not, so we check the foreground package
 * cheaply first and only search for the deny button when the permission UI is
 * actually up — avoiding a ~3s full-UI-tree scan for an absent element. The wdio
 * config's beforeScenario also handles it at scenario start. Best-effort — never throws.
 */
async function dismissNotificationPermission(): Promise<void> {
  // Android-only: the deny button is an android.widget.Button and the
  // foreground-package check is a UiAutomator2 command — neither applies on iOS
  // (the original android-class selector never matched iOS either). If iOS e2e is
  // revived, its permission alerts need the autoAcceptAlerts cap / driver.acceptAlert.
  if (!driver.isAndroid) return;
  try {
    await driver.switchContext("NATIVE_APP");
    // Searching for an ABSENT element forces a full UI-tree scan (~3s on the app's
    // large tree). A permission dialog runs in its own package, so check the
    // foreground package first (cheap) and only search the small, fast dialog tree
    // when it's actually up. autoGrantPermissions usually suppresses the dialog, so
    // the common path is ~instant instead of ~3s. Still dismisses a real dialog.
    const pkg = (await driver.getCurrentPackage()) || "";
    if (!/permissioncontroller|packageinstaller/.test(pkg)) return;
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

interface SeedOpts {
  displayName?: string;
  atProfileSetup?: boolean;
}

/**
 * Fast-onboard fixture. Reproduces a post-onboarding state via the dev-only
 * in-app `window.__seedOnboarded` hook (core/agent/devSeed), then relaunches so
 * the genuine init path hydrates state and routes. Deterministic ~19s drop-in
 * for the ~50s UI onboarding precondition.
 *
 * @param opts         forwarded to the seed hook:
 *                       - `atProfileSetup` -> lands on the first-run Profile
 *                         Setup screen (no profile yet);
 *                       - `displayName`    -> seeds one identifier (Home);
 *                       - neither          -> empty Home.
 * @param targetTestId the data-testid that proves the app reached the expected
 *                     screen (e.g. "tab-button-home" or "profile-setup-page").
 * @returns the seeded identifier id, or undefined when none was created.
 */
async function seedThenLand(
  opts: SeedOpts,
  targetTestId: string
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
    { timeout: t(30000), timeoutMsg: "__seedOnboarded hook never appeared" }
  );

  // Seed (boot+connect [+ create identifier]) is async/network-bound; retry once.
  let seeded = false;
  let seededAid: string | undefined;
  for (let attempt = 0; attempt < 2 && !seeded; attempt++) {
    const result = (await browser.executeAsync(
      (
        bUrl: string,
        cUrl: string,
        seedOpts: SeedOpts,
        done: (r: { ok?: boolean; aid?: string; error?: string }) => void
      ) => {
        const w = window as unknown as {
          __seedOnboarded: (o: {
            bootUrl: string;
            connectUrl: string;
            displayName?: string;
            atProfileSetup?: boolean;
          }) => Promise<string | undefined>;
        };
        w.__seedOnboarded({ bootUrl: bUrl, connectUrl: cUrl, ...seedOpts })
          .then((aid) => done({ ok: true, aid }))
          .catch((e) => done({ error: String(e && e.message ? e.message : e) }));
      },
      bootUrl,
      connectUrl,
      opts
    )) as { ok?: boolean; aid?: string; error?: string };

    if (result.ok) {
      seeded = true;
      seededAid = result.aid;
    } else if (attempt === 1) {
      throw new Error(`Seed onboarding failed: ${result.error}`);
    }
  }

  // Relaunch so the genuine AppWrapper init hydrates state and routes.
  await driver.switchContext("NATIVE_APP");
  await driver.terminateApp(APP_ID);
  await driver.activateApp(APP_ID);

  // On launch the app requests notification permission — a native dialog that
  // sits on top of the webview and blocks the screen. Dismiss it if present.
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
      timeout: t(60000),
      interval: 500,
      timeoutMsg: "Webview did not re-attach after relaunch",
    }
  );

  // Init runs a cloud migration + agent reconnect, so the target can take a
  // while. Wait for either the lock screen or the target, whichever is first.
  const passcodePad = () => $('[data-testid="passcode-button-1"]');
  const target = () => $(`[data-testid="${targetTestId}"]`);
  await browser.waitUntil(
    async () =>
      (await passcodePad().isExisting()) || (await target().isExisting()),
    {
      timeout: t(90000),
      interval: 1500,
      timeoutMsg: `Neither lock screen nor ${targetTestId} appeared after relaunch`,
    }
  );

  // If locked, enter the dev passcode (devPreload wrote "111111").
  if (await passcodePad().isExisting()) {
    await PasscodeScreen.enterPasscode(DEV_PASSCODE);
  }

  // Confirm we landed on the expected screen.
  await target().waitForDisplayed({ timeout: t(60000) });

  return seededAid;
}

// Empty Home (no identifier) — drop-in for scenarios that add the first one.
Given(/^user is onboarded \(seed\)$/, async function () {
  this.seededAid = await seedThenLand({}, "tab-button-home");
});

// Populated Home — seeds one identifier for scenarios that need an existing one.
Given(
  /^user is onboarded \(seed\) with an identifier(?: "([^"]*)")?$/,
  async function (name?: string) {
    this.seededAid = await seedThenLand(
      { displayName: name || "Test Identifier" },
      "tab-button-home"
    );
  }
);

// First-run Profile Setup, no profile yet — for flows that create a group or
// individual profile on that screen (e.g. multisig group-profiles).
Given(/^user is onboarded \(seed\) at profile setup$/, async function () {
  this.seededAid = await seedThenLand({ atProfileSetup: true }, "profile-setup-page");
});

Then(/^user can see the Home screen$/, async function () {
  await $('[data-testid="tab-button-home"]').waitForDisplayed({
    timeout: t(30000),
  });
});

// Current-UX navigation: the Connections tab + screen still exist in the
// restructured app (src/ui/pages/Connections), unlike the obsolete Identifiers
// screen. Demonstrates the fixture enabling a real post-onboarding test.
When(/^user taps the Connections tab$/, async function () {
  const tab = $('[data-testid="tab-button-connections"]');
  await tab.waitForDisplayed({ timeout: t(30000) });
  await tab.click();
});

Then(/^user can see the Connections screen$/, async function () {
  await $('[data-testid="add-connection-button"]').waitForDisplayed({
    timeout: t(30000),
  });
});
