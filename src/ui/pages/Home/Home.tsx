import { Browser } from "@capacitor/browser";
import { personAdd, refresh, wallet } from "ionicons/icons";
import { useCallback, useState } from "react";
import { Agent } from "../../../core/agent/agent";
import { CreationStatus } from "../../../core/agent/agent.types";
import { IdentifierDetails } from "../../../core/agent/services/identifier.types";
import { i18n } from "../../../i18n";
import { useAppSelector } from "../../../store/hooks";
import { getCurrentProfile } from "../../../store/reducers/profileCache";
import CardanoLogo from "../../assets/images/cardano-logo.svg";
import ScanIcon from "../../assets/images/scan-icon.svg";
import { Avatar } from "../../components/Avatar";
import { ConnectdApp } from "../../components/ConnectdApp";
import { ShareProfile } from "../../components/ShareProfile";
import { Tile } from "../../components/Tile";
import { TabLayout } from "../../components/layout/TabLayout";
import { useOnlineStatusEffect } from "../../hooks";
import { showError } from "../../utils/error";
import { Profiles } from "../Profiles";
import "./Home.scss";
import { RotateKeyModal } from "./components/RotateKeyModal";
import { ScanToLogin } from "./components/ScanToLogin";
import { VerifySeedPhraseCard } from "./components/VerifySeedPhrase";

const Home = () => {
  const pageId = "home-tab";
  const currentProfile = useAppSelector(getCurrentProfile);
  const [profile, setProfile] = useState<IdentifierDetails | undefined>();
  const [openProfiles, setOpenProfiles] = useState(false);
  const [openScanToLogin, setOpenScanToLogin] = useState(false);
  const [connectdApp, setConnectdApp] = useState(false);
  const [openShareCurrentProfile, setOpenShareCurrentProfile] = useState(false);
  const [openRotateKeyModal, setOpenRotateKeyModal] = useState(false);

  const handleAvatarClick = () => {
    setOpenProfiles(true);
  };

  const handleScanToLoginClick = () => {
    setOpenScanToLogin(true);
  };

  const handleShowDappClick = () => {
    setConnectdApp(true);
  };

  const handleShareCurrentProfileClick = () => {
    setOpenShareCurrentProfile(true);
  };

  const handleRotateKeyClick = () => {
    setOpenRotateKeyModal(true);
  };

  const handleGoogleWalletClick = async () => {
    // Sample JWT link (replace with a valid one for real testing)
    // This is a generic link format; without a valid signed JWT, it will likely error on the Google end,
    // but it proves the app can hand off to the wallet flow.
    // Documentation: https://developers.google.com/wallet/generic/web
    const sampleJwt =
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJleGFtcGxlLWlzc3VlckBleGFtcGxlLmNvbSIsImF1ZCI6Imdvb2dsZSIsImlhdCI6MTYyMDQ1NjQwMCwidHlwIjoic2F2ZXRvd2FsbGV0IiwicGF5bG9hZCI6eyJvcmlnaW5zIjpbXSwiZ2VuZXJpY09iamVjdHMiOlt7ImlkIjoiaXNzdWVyLXdhbGxldC1pZC5vYmplY3QtaWQiLCJjbGFzc0lkIjoiaXNzdWVyLXdhbGxldC1pZC5jbGFzcy1pZCIsImxvZ28iOnsic291cmNlVXJpIjp7InVyaSI6Imh0dHBzOi8vd3d3Lmdvb2dsZS5jb20vaW1hZ2VzL2JyYW5kaW5nL3Byb2R1Y3QvMXgvZ29vZ2xlX3dhbGxldF80ThcDpwbmcifX0sImNhcmRUaXRsZSI6eyJkZWZhdWx0VmFsdWUiOnsiYm9keSI6Ikdvb2dsZSBXYWxsZXQifX0sImhlYWRlciI6eyJkZWZhdWx0VmFsdWUiOnsiYm9keSI6IkV4YW1wbGUgUGFzcyJ9fX1dfX0.sw";
    // Note: The above JWT is clearly fake/invalid base64url data for the sake of the example placeholder.
    // A real test requires a valid signed JWT from the issuer service.
    // We will use a link that is known to trigger the intent, even if the payload is invalid.

    // For now, let's just use the generic save URL structure.
    const url = `https://pay.google.com/gp/v/save/${sampleJwt}`;

    await Browser.open({ url });
  };

  const AdditionalButtons = () => {
    return (
      <Avatar
        id={currentProfile?.identity.id || ""}
        handleAvatarClick={handleAvatarClick}
      />
    );
  };

  const getDetails = useCallback(async () => {
    if (
      !currentProfile ||
      [CreationStatus.PENDING, CreationStatus.FAILED].includes(
        currentProfile.identity.creationStatus
      )
    ) {
      return;
    }

    try {
      const cardDetailsResult = await Agent.agent.identifiers.getIdentifier(
        currentProfile.identity.id
      );
      setProfile(cardDetailsResult);
    } catch (error) {
      showError("Unable to get identifier details", error);
    }
  }, [currentProfile]);

  useOnlineStatusEffect(getDetails);

  return (
    <>
      <TabLayout
        pageId={pageId}
        header={true}
        title={`${i18n.t("tabs.home.tab.title", {
          name: currentProfile?.identity.displayName || "",
        })}`}
        additionalButtons={<AdditionalButtons />}
      >
        <div className="home-tab-content">
          <VerifySeedPhraseCard />
          <Tile
            icon={ScanIcon}
            badge={`${i18n.t("tabs.home.tab.tiles.scan.badge")}`}
            title={i18n.t("tabs.home.tab.tiles.scan.title")}
            text={i18n.t("tabs.home.tab.tiles.scan.text")}
            className="home-tab-scan-tile"
            handleTileClick={handleScanToLoginClick}
          />
          {currentProfile?.identity.groupMemberPre ? (
            <Tile
              icon={personAdd}
              chevron={true}
              title={i18n.t("tabs.home.tab.tiles.connections.title")}
              text={i18n.t("tabs.home.tab.tiles.connections.text")}
              handleTileClick={handleShareCurrentProfileClick}
            />
          ) : (
            <>
              <Tile
                icon={CardanoLogo}
                chevron={true}
                title={i18n.t("tabs.home.tab.tiles.dapps.title")}
                text={i18n.t("tabs.home.tab.tiles.dapps.text")}
                handleTileClick={handleShowDappClick}
              />
              <div className="home-tab-split-section">
                <Tile
                  icon={personAdd}
                  chevron={true}
                  title={i18n.t("tabs.home.tab.tiles.connections.title")}
                  text={i18n.t("tabs.home.tab.tiles.connections.text")}
                  handleTileClick={handleShareCurrentProfileClick}
                />
                <Tile
                  icon={refresh}
                  chevron={true}
                  title={i18n.t("tabs.home.tab.tiles.rotate.title")}
                  text={i18n.t("tabs.home.tab.tiles.rotate.text")}
                  handleTileClick={handleRotateKeyClick}
                />
              </div>
              <Tile
                icon={wallet}
                chevron={true}
                title="Google Wallet PoC"
                text="Test Add to Google Wallet"
                handleTileClick={handleGoogleWalletClick}
              />
            </>
          )}
        </div>
      </TabLayout>
      <Profiles
        isOpen={openProfiles}
        setIsOpen={setOpenProfiles}
      />
      <ScanToLogin
        isOpen={openScanToLogin}
        setIsOpen={setOpenScanToLogin}
      />
      <ConnectdApp
        isOpen={connectdApp}
        setIsOpen={setConnectdApp}
      />
      <ShareProfile
        isOpen={openShareCurrentProfile}
        setIsOpen={setOpenShareCurrentProfile}
      />
      <RotateKeyModal
        identifierId={currentProfile?.identity.id || ""}
        onReloadData={getDetails}
        signingKey={profile?.k[0] || ""}
        isOpen={openRotateKeyModal}
        onClose={() => setOpenRotateKeyModal(false)}
      />
    </>
  );
};
export { Home };
