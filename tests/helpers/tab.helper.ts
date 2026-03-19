/**
 * Navigate by tapping a tab bar button.
 * This is more reliable than browser.url() in Appium/Capacitor webview contexts.
 */
export async function navigateToTab(tabName: string): Promise<void> {
    const tab = $(`[data-testid='tab-button-${tabName}']`);
    await tab.waitForDisplayed();
    await tab.click();
}

export async function navigateToTabUsingJsClick(tabName: string): Promise<void> {
    // Wait until at least one ion-tab-bar is present and get the last (active) one
    await browser.waitUntil(
        async () => {
            return await browser.execute(() => {
                const tabBars = document.querySelectorAll("ion-tab-bar");
                if (tabBars.length === 0) return false;
                const last = tabBars[tabBars.length - 1];
                return last.offsetParent !== null || last.getBoundingClientRect().height > 0;
            });
        },
        { timeout: 10000, timeoutMsg: "No visible tab bar found" }
    );

    // Remove stale/cached tab bars, keep only the last (active) one, then click
    await browser.execute((name) => {
        const tabBars = document.querySelectorAll("ion-tab-bar");
        if (tabBars.length > 1) {
            for (let i = 0; i < tabBars.length - 1; i++) {
                tabBars[i].remove();
            }
        }
        const btn = document.querySelector(
            `[data-testid='tab-button-${name}']`
        ) as HTMLElement;
        if (btn) btn.click();
    }, tabName);

    await browser.pause(500);
}
