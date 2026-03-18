import {waitUpTo} from "../../steps-definitions/group-profiles/group-profile.helpers";

export class ConnectionsDetailsScreen {


    async verifyCredentialReceivedInHistory(credentialName: string): Promise<void> {
        await waitUpTo(
            async () => {
                const events = await $$("[data-testid^='connection-history-event-']");
                const matching = [];
                for (const event of events) {
                    const text = await event.$(".connection-details-history-text").getText().catch(() => "");
                    if (text.includes(credentialName)) {
                        matching.push(event);
                    }
                }
                if (matching.length !== 1) return false;
                return true;
            },
            3000,
        );
    }
}


export default new ConnectionsDetailsScreen();
