import { expect } from "expect-webdriverio";

export class ConnectionsScreen {

    get connectionTitle() {
        return $("[data-testid='connections-title']");
    }

    get listConnection(): string[] {
        return ["[data-testid*='connection-group'] ion-item"];
    }

    get pendingIcon() {
        return $("[data-testid*='connection-group'] .md.ion-activatable");
    }

    async checkListConnection(length: number) {
        await expect(this.connectionTitle).toHaveText("Connections");
        await expect(this.listConnection).toHaveLength(length);
        await expect(this.pendingIcon).not.toBeDisplayed();
    }
}

export default new ConnectionsScreen();
