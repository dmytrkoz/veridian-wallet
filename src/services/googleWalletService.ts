import { SignJWT, importPKCS8 } from "jose";
import { v4 as uuidv4 } from "uuid";
import { GoogleWalletConfig } from "../config/googleWalletConfig";
import { ACDCDetails } from "../core/agent/services/credentialService.types";

export const GoogleWalletService = {
  createSignedJwt: async (credential: ACDCDetails) => {
    const { ISSUER_ID, SERVICE_ACCOUNT_KEY_JSON } = GoogleWalletConfig;

    if (!ISSUER_ID || !SERVICE_ACCOUNT_KEY_JSON) {
      throw new Error(
        "Missing Google Wallet Configuration (Issuer ID or JSON Key)"
      );
    }

    const serviceAccount = JSON.parse(SERVICE_ACCOUNT_KEY_JSON);
    const privateKeyString = serviceAccount.private_key;
    const clientEmail = serviceAccount.client_email;

    // Import the private key
    const privateKey = await importPKCS8(privateKeyString, "RS256");

    // Google Wallet Generic Class and Object IDs must be prefixed with the Issuer ID
    // Using a timestamp to ensure we create a unique class for this test run to avoid conflicts
    const classId = `${ISSUER_ID}.veridian-generic-class-${Date.now()}`;
    const objectId = `${ISSUER_ID}.${uuidv4()}`;

    // Define the Official Generic Object payload
    // Reference: https://developers.google.com/wallet/generic/web
    const payload = {
      iss: clientEmail,
      aud: "google",
      typ: "savetowallet",
      origins: [],
      payload: {
        // Define the Class inside the JWT so it's created automatically
        genericClasses: [
          {
            id: classId,
            classTemplateInfo: {
              cardTemplateOverride: {
                cardRowTemplateInfos: [
                  {
                    twoItems: {
                      startItem: {
                        firstValue: {
                          fields: [
                            {
                              fieldPath: "object.textModulesData['issuer']",
                            },
                          ],
                        },
                      },
                      endItem: {
                        firstValue: {
                          fields: [
                            {
                              fieldPath:
                                "object.textModulesData['issued_date']",
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
        genericObjects: [
          {
            id: objectId,
            classId: classId,
            // The Logo of the pass (displayed in the list view)
            logo: {
              sourceUri: {
                // MUST be a publicly accessible URL. Using a Google test image for safety.
                uri: "https://developers.google.com/static/wallet/images/branding/google-wallet-test-icon.png",
              },
            },
            // The background color of the card
            hexBackgroundColor: "#4285f4",
            // The Title of the card (e.g., "Veridian ID")
            cardTitle: {
              defaultValue: {
                language: "en-US",
                value: "Veridian Credential",
              },
            },
            // The Header (Top right usually)
            header: {
              defaultValue: {
                language: "en-US",
                value: credential.s.title || "Unknown Type",
              },
            },
            // The Subheader (Label for the header)
            subheader: {
              defaultValue: {
                language: "en-US",
                value: "Credential Type",
              },
            },
            // Detailed rows of information
            textModulesData: [
              {
                header: "Issuer",
                body: credential.i || "Unknown Issuer", // Usage of 'i' (Issuer AID)
                id: "issuer",
              },
              {
                header: "Issued Date",
                body: credential.a.dt || "Unknown Date",
                id: "issued_date",
              },
              {
                header: "Status",
                body: "Active", // Hardcoded for this PoC, ideally dynamic
                id: "status",
              },
            ],
            // Barcode is critical for "Pass" functionality
            barcode: {
              type: "QR_CODE",
              value: credential.a.d || credential.i || "unknown", // Use the credential digest or ID as the payload
              alternateText: "Scan to Verify",
            },
            // Hero Image (Optional but looks good)
            heroImage: {
              sourceUri: {
                uri: "https://developers.google.com/static/wallet/images/branding/google-wallet-test-icon.png",
              },
              contentDescription: {
                defaultValue: {
                  language: "en-US",
                  value: "Veridian Wallet Hero Image",
                },
              },
            },
          },
        ],
      },
    };

    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    return jwt;
  },
};
