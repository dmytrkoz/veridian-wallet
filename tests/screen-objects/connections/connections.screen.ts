import { expect } from "expect-webdriverio";

export class ConnectionsScreen {

    get connectionTitle() {
        return $("[data-testid^='card-title-']");
    }

    async checkListConnection(connectionInformation:string) {
        await expect(this.connectionTitle).toHaveText(connectionInformation);
    }
}

export default new ConnectionsScreen();
