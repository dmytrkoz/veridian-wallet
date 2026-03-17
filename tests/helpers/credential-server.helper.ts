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
  // Return the raw OOBI without rewriting. The OOBI URL (e.g. http://keria:3902/...)
  // is resolved by KERIA inside Docker, not by the app itself. The app merely
  // passes the URL to KERIA's admin API via signify-ts. Rewriting to 10.0.2.2:3901
  // breaks resolution because (a) 10.0.2.2 is unreachable from Docker and
  // (b) KERIA serves OOBIs on port 3902 (agent), not 3901 (admin).
  return requestCredentialServer<string>("/keriOobi");
}

export async function listIssuerContacts(): Promise<CredentialIssuerContact[]> {
  return requestCredentialServer<CredentialIssuerContact[]>("/contacts");
}

export async function resolveWalletOobiForIssuer(walletOobi: string): Promise<void> {
  // Don't rewrite the OOBI — the credential server runs in Docker alongside
  // KERIA, so the original keria:3902 hostname works directly.
  // Rewriting to 127.0.0.1:3901 breaks resolution because KERIA serves
  // OOBIs on port 3902 (agent), not 3901 (admin). From inside the Docker
  // network, keria:3902 is the correct resolvable address.
  await requestCredentialServer<string>("/resolveOobi", {
    method: "POST",
    body: JSON.stringify({ oobi: walletOobi }),
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
