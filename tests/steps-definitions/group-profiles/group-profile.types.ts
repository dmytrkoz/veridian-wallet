import {RemoteJoiner, Issuer, RemoteInitiator, Verifier} from "../../helpers/virtual-wallet.js";

export type AliceInitiatorWorld = {
    aliceInitiatorGroupName?: string;
    aliceInitiatorGroupId?: string | null;
    groupAid?: string;
    credentialIssuerNotificationName?: string;
    passcode?: number[];
    requiredSigners?: number;
    acdcSchemaSaid?: string;
    virtualMembers?: Record<
        string,
        {
            instance: RemoteJoiner;
            oobi: string;
        }
    >;
    aliceSharedOobi?: string;
    groupOobi?: string;
    issuer?: Issuer;
    verifier?: Verifier;
};

export type BobJoinerWorld = {
    bobGroupName?: string;
    /** Alice's OOBI with pendingGroupId, ready for Bob to paste in the Join-Group scan screen */
    aliceOobiForJoin?: string;
    /** Bob's raw OOBI captured from the app's Share tab */
    bobSharedOobi?: string;
    remoteInitiator?: RemoteInitiator;
    extraVirtualMembers?: Record<string, RemoteJoiner>;
    /** KERI prefix of the created multisig group */
    groupId?: string;
    /** Alice's personal AID — used as pendingGroupId in extra-member OOBIs so the
     *  app can match them to the correct pending group invitation */
    aliceAid?: string;
};
