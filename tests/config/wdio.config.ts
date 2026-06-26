import type { Options } from "@wdio/types";
import "dotenv/config";
import allureReporter from "@wdio/allure-reporter";
import * as fs from "fs";
import * as path from "path";
import { returnBoolean } from "../helpers/parse.js";
import { t } from "./timeouts.js";

// Hosted-CI emulators flake on Appium session creation (UiAutomator2 cold-start,
// software-GPU ColorBuffer errors) and run slower than a local machine. On CI we
// retry the whole spec (specFileRetries) and scale every e2e timeout via t() /
// CI_TIMEOUT_FACTOR; local runs keep the tight defaults. Retries tunable via
// WDIO_SPEC_RETRIES.
const isCI = !!process.env.CI;

export const config: Options.Testrunner = {
  runner: "local",
  tsConfigPath: 'tsconfig.json',
  specs: ["../features/**/*.feature"],
  specFileRetries: Number(process.env.WDIO_SPEC_RETRIES ?? (isCI ? 1 : 0)),
  specFileRetriesDelay: 3,
  specFileRetriesDeferred: false,
  maxInstances: 1,
  logLevel: "info",
  bail: 0,
  baseUrl: "LACK_OF_BASE_URL",
  waitforTimeout: t(1500),
  connectionRetryTimeout: t(45000),
  connectionRetryCount: 3,
  services: [],
  framework: "cucumber",
  reporters: [
    "spec",
    [
      "allure",
      {
        outputDir: "./tests/.reports/allure-results",
        addConsoleLogs: true,
        disableWebdriverStepsReporting: true,
        disableWebdriverScreenshotsReporting: true,
        useCucumberStepReporter: true,
      },
    ],
  ],
  cucumberOpts: {
    backtrace: false,
    requireModule: [],
    failAmbiguousDefinitions: true,
    failFast: false,
    format: ["pretty"],
    colors: true,
    ignoreUndefinedDefinitions: false,
    names: [],
    snippets: true,
    source: true,
    profile: [],
    require: [
      "./tests/steps-definitions/**/*.ts",
      "./tests/actions/**/*.ts",
    ],
    tags: "",
    // Per-step cap must scale with the inner e2e waits (some reach t(90000)=180s
    // on CI); an unscaled 100s cap would kill a step before its scaled wait ends.
    timeout: t(100 * 1000),
  },
  onPrepare: function (config, capabilities) {
    const screenshotsDir = path.join(process.cwd(), "tests", "screenshots");
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
      console.log(`[WDIO] Created screenshots directory: ${screenshotsDir}`);
    }
    
    // Pre-test "Hitman" strategy: Force-stop problematic background apps
    console.log("[Setup] Suppressing background webview processes...");
    try {
      const { execSync } = require('child_process');
      // Kill the specific apps that keep hanging the CDP bridge
      execSync('adb shell am force-stop com.google.android.apps.messaging', { stdio: 'ignore' });
      execSync('adb shell am force-stop com.android.chrome', { stdio: 'ignore' });
      // Clear stale devtools sockets that trigger the 2000ms timeout
      execSync('adb shell "rm /data/local/tmp/webview-devtools-remote*" 2>/dev/null || true', { stdio: 'ignore' });
    } catch (e) {
      console.warn("[Setup] Process suppression failed, but proceeding...");
    }
  },
  beforeScenario: async function (scenario) {
    try {
      const { driver, browser } = await import("@wdio/globals");
      const { execSync } = require('child_process');
      
      // Aggressive process suppression before each scenario
      try {
        execSync('adb shell am force-stop com.google.android.apps.messaging', { stdio: 'ignore', timeout: 5000 });
        execSync('adb shell am force-stop com.android.chrome', { stdio: 'ignore', timeout: 5000 });
      } catch (e) {
        // Ignore suppression failures
      }
      
      await browser.pause(1000);
      
      // Try direct switch to NATIVE_APP first (avoid getContexts() greedy scan)
      try {
        await driver.switchContext('NATIVE_APP');
      } catch (e) {
        // Fallback: use getContexts() with timeout protection
        try {
          const contextsPromise = driver.getContexts();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('getContexts timeout')), 5000)
          );
          const contexts = await Promise.race([contextsPromise, timeoutPromise]) as any[];
          
          const nativeContext = contexts.find((ctx) => {
            const ctxStr = typeof ctx === 'string' ? ctx : ctx.id || String(ctx);
            return !ctxStr.includes('WEBVIEW');
          });
          
          if (nativeContext) {
            const nativeCtxStr = typeof nativeContext === 'string' ? nativeContext : nativeContext.id || String(nativeContext);
            await driver.switchContext(nativeCtxStr);
          }
        } catch (e) {
          // If all else fails, try direct switch anyway
          try {
            await driver.switchContext('NATIVE_APP');
          } catch (e) {}
        }
      }
      
      // Handle permission dialogs
      try {
        const dontAllowButton = await driver.$('//android.widget.Button[@text="Don\'t allow" or @text="DON\'T ALLOW" or @text="Not now" or @text="Deny" or @text="DENY"]');
        if (await dontAllowButton.isExisting().catch(() => false) && await dontAllowButton.isDisplayed().catch(() => false)) {
          await dontAllowButton.click();
        } else {
          await driver.pressKeyCode(4);
        }
        await browser.pause(500);
      } catch (e) {}
      
      // Switch to webview if needed (use direct switch first)
      try {
        await driver.switchContext('WEBVIEW_org.cardanofoundation.idw');
      } catch (e) {
        // Fallback only if direct switch fails
        try {
          const contextsPromise = driver.getContexts();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('getContexts timeout')), 5000)
          );
          const contexts = await Promise.race([contextsPromise, timeoutPromise]) as any[];
          
          const webviewContext = contexts.find((ctx) => {
            const ctxStr = typeof ctx === 'string' ? ctx : ctx.id || String(ctx);
            return ctxStr.includes('WEBVIEW') && ctxStr.includes('org.cardanofoundation.idw');
          });
          if (webviewContext) {
            const webviewCtxStr = typeof webviewContext === 'string' ? webviewContext : webviewContext.id || String(webviewContext);
            await driver.switchContext(webviewCtxStr);
          }
        } catch (e) {
          // Ignore webview switch failures in beforeScenario
        }
      }
    } catch (e) {
      // Silently continue if beforeScenario fails
    }
  },
  afterScenario: async function (world, result, context) {
    const { driver } = await import("@wdio/globals");
    const appPackage = "org.cardanofoundation.idw";

    // On failure, capture the webview DOM first — it shows which testids are
    // actually rendered, the most useful clue for an "element not found" (and
    // the only window into a CI-only failure that can't be reproduced locally).
    // The native screenshot is taken later, after switching out of the webview
    // context (a screenshot in webview context comes back blank).
    if (!result.passed) {
      try {
        const src = await driver.getPageSource();
        allureReporter.addAttachment("Page source on failure", src, "text/xml");
      } catch (e) {
        console.warn("[WDIO] failure page-source capture failed:", e);
      }
    }

    try {
      // Try direct switch to NATIVE_APP first (avoid getContexts() greedy scan)
      try {
        await driver.switchContext('NATIVE_APP');
      } catch (e) {
        // Fallback: use getContexts() with timeout protection
        try {
          const contextsPromise = driver.getContexts();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('getContexts timeout')), 5000)
          );
          const contexts = await Promise.race([contextsPromise, timeoutPromise]) as any[];
          
          const nativeContext = contexts.find((ctx) => {
            const ctxStr = typeof ctx === 'string' ? ctx : ctx.id || String(ctx);
            return !ctxStr.includes('WEBVIEW');
          });
          if (nativeContext) {
            const nativeCtxStr = typeof nativeContext === 'string' ? nativeContext : nativeContext.id || String(nativeContext);
            await driver.switchContext(nativeCtxStr);
          }
        } catch (e) {
          // If all else fails, try direct switch anyway
          try {
            await driver.switchContext('NATIVE_APP');
          } catch (e) {}
        }
      }
      // Now in native context: a screenshot captures the full device screen
      // (what the app actually shows at the point of failure).
      if (!result.passed) {
        try {
          const png = await driver.takeScreenshot();
          allureReporter.addAttachment(
            "Screenshot on failure",
            Buffer.from(png, "base64"),
            "image/png"
          );
        } catch (e) {
          console.warn("[WDIO] failure screenshot capture failed:", e);
        }
      }
      await driver.terminateApp(appPackage);
    } catch (e) {
      // Ignore cleanup errors
    }
    
    if (returnBoolean(process.env.RELOAD_SESSION as string)) {
      await driver.reloadSession();
    }
  },
};
