import { getKeriaUrlsForTestRunner, getSSIAgentUrls } from "./ssi-agent-urls.helper.js";

export const CF_CREDENTIAL_ISSUANCE_ALIAS = "CF Credential Issuance";
export const RARE_EVO_SCHEMA_SAID = "EJxnJdxkHbRw2wVFNe4IUOPLt8fEtg9Sr3WyTjlgKoIb";
export const RARE_EVO_SCHEMA_NAME = "Rare EVO 2024 Attendee";

type CredentialServerResponse<T> = {
  success: boolean;
  data: T;
};

export type CredentialIssuerContact = {
  alias: string;
  challenges: string[];
  createdAt: string;
  id: string;
  oobi: string;
  wellKnowns: string[];
};

const DEFAULT_CREDENTIAL_SERVER_URL = process.env.CREDENTIAL_SERVER_URL || "http://127.0.0.1:3001";

function rewriteOobiBase(oobi: string, targetBaseUrl: string): string {
  const source = new URL(oobi);
  const target = new URL(targetBaseUrl);

  source.protocol = target.protocol;
  source.hostname = target.hostname;
  source.port = target.port;

  return source.toString();
}

function getCredentialServerUrl(): string {
  return DEFAULT_CREDENTIAL_SERVER_URL.replace(/\/$/, "");
}

async function requestCredentialServer<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getCredentialServerUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as CredentialServerResponse<T>) : undefined;

  if (!response.ok || !payload?.success) {
    throw new Error(
      `Credential server request failed for ${path}: ${response.status} ${response.statusText} ${text}`
    );
  }

  return payload.data;
}

export async function getIssuerConnectionOobiForApp(): Promise<string> {
  const appConnectUrl = getSSIAgentUrls().connectUrl;
  const rawOobi = await requestCredentialServer<string>("/keriOobi");
  return rewriteOobiBase(rawOobi, appConnectUrl);
}

export async function listIssuerContacts(): Promise<CredentialIssuerContact[]> {
  return requestCredentialServer<CredentialIssuerContact[]>("/contacts");
}

export async function resolveWalletOobiForIssuer(walletOobi: string): Promise<void> {
  const hostConnectUrl = getKeriaUrlsForTestRunner().connectUrl;
  const rewrittenOobi = rewriteOobiBase(walletOobi, hostConnectUrl);

  await requestCredentialServer<string>("/resolveOobi", {
    method: "POST",
    body: JSON.stringify({ oobi: rewrittenOobi }),
  });
}

export async function waitForNewIssuerContact(
  previousContactIds: string[],
  timeoutMs = 20000
): Promise<CredentialIssuerContact> {
  const deadline = Date.now() + timeoutMs;
  const previousIds = new Set(previousContactIds);

  while (Date.now() < deadline) {
    const contacts = await listIssuerContacts();
    const newContact = contacts.find((contact) => !previousIds.has(contact.id));

    if (newContact) {
      return newContact;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for credential issuer contact to be created.");
}

export async function issueRareEvoCredential(aid: string, attendeeName: string): Promise<void> {
  await requestCredentialServer<string>("/issueAcdcCredential", {
    method: "POST",
    body: JSON.stringify({
      schemaSaid: RARE_EVO_SCHEMA_SAID,
      aid,
      attribute: {
        attendeeName,
      },
    }),
  });
}

export async function requestRareEvoPresentation(aid: string): Promise<void> {
  await requestCredentialServer<string>("/requestDisclosure", {
    method: "POST",
    body: JSON.stringify({
      schemaSaid: RARE_EVO_SCHEMA_SAID,
      aid,
      attributes: {},
    }),
  });
}
