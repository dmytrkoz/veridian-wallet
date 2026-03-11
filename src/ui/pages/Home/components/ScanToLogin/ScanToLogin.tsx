import { IonModal } from "@ionic/react";
import { informationCircleOutline } from "ionicons/icons";
import { ScrollablePageLayout } from "../../../../components/layout/ScrollablePageLayout";
import { PageHeader } from "../../../../components/PageHeader";
import { i18n } from "../../../../../i18n";
import { ScanToLoginContent, ScanToLoginProps } from "./ScanToLogin.types";
import { InfoCard } from "../../../../components/InfoCard";
import "./ScanToLogin.scss";

const getParagraphs = (text: string) =>
  text
    .split(/\r?\n\r?\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

const ScanToLogin = ({ isOpen, setIsOpen }: ScanToLoginProps) => {
  const componentId = "scan-to-login";
  const content = i18n.t("tabs.home.tab.modals.scan.content", {
    returnObjects: true,
  }) as ScanToLoginContent[];

  const handleClose = () => {
    setIsOpen(false);
  };
  return (
    <IonModal
      className={`${componentId}-modal`}
      data-testid={componentId}
      isOpen={isOpen}
      onDidDismiss={handleClose}
    >
      <ScrollablePageLayout
        pageId={componentId}
        activeStatus={isOpen}
        header={
          <PageHeader
            closeButton={true}
            closeButtonAction={handleClose}
            closeButtonLabel={`${i18n.t("tabs.home.tab.modals.scan.close")}`}
            title={`${i18n.t("tabs.home.tab.modals.scan.title")}`}
          />
        }
      >
        <InfoCard
          content={i18n.t("tabs.home.tab.modals.scan.warning")}
          icon={informationCircleOutline}
        />
        {content.map((section, index) => (
          <div
            key={`scan-section-${index}`}
            className="scan-section"
          >
            <h2>{section.subtitle}</h2>
            {getParagraphs(section.text).map((paragraph, paragraphIndex) => (
              <p key={`scan-desc-${index}-${paragraphIndex}`}>{paragraph}</p>
            ))}
          </div>
        ))}
      </ScrollablePageLayout>
    </IonModal>
  );
};
export { ScanToLogin };
