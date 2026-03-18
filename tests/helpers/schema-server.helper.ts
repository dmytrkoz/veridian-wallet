/**
 * Local schema server — replaces the cred-issuance container.
 *
 * Serves ACDC schema JSON files from services/credential-server/src/schemas/
 * so KERIA (in Docker) can resolve schema OOBIs without running the
 * cred-issuance container.
 *
 * Also configures the Issuer's AID with an `indexer` end role and `locScheme`,
 * mirroring what cred-issuance does in server.ts:ensureEndRoles().
 * This is required for the wallet app to discover where to fetch schemas
 * when processing a granted credential (via ipexCommunicationService.getSchemaUrl).
 */

import http from "http";
import fs from "fs";
import path from "path";
import { Issuer } from "./virtual-wallet.js";

const SCHEMA_SERVER_PORT = 3001;
let schemaServer: http.Server | undefined;
let schemaBaseUrl: string | undefined;

/**
 * Starts a minimal HTTP server that serves ACDC schema files.
 * Binds to 0.0.0.0 so KERIA (in Docker) can reach it via the host gateway IP.
 *
 * @returns The base URL for schema OOBIs (e.g. http://172.17.0.1:3001)
 */
export async function startSchemaServer(): Promise<string> {
  if (schemaBaseUrl) return schemaBaseUrl;

  const schemasDir = path.resolve(
    process.cwd(),
    "services/credential-server/src/schemas"
  );

  return new Promise((resolve, reject) => {
    schemaServer = http.createServer((req, res) => {
      const match = req.url?.match(/^\/oobi\/(.+)$/);
      if (!match) {
        res.writeHead(404);
        res.end();
        return;
      }

      const filePath = path.join(schemasDir, match[1]);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/schema+json" });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });

    schemaServer.listen(SCHEMA_SERVER_PORT, "0.0.0.0", () => {
      const dockerHostIp = process.env.DOCKER_HOST_IP || "172.17.0.1";
      schemaBaseUrl = `http://${dockerHostIp}:${SCHEMA_SERVER_PORT}`;
      console.log(`[SchemaServer] Started at ${schemaBaseUrl}`);
      resolve(schemaBaseUrl);
    });

    schemaServer.on("error", reject);
  });
}

/**
 * Returns the schema OOBI URL for a given schema SAID.
 * Must call startSchemaServer() first.
 */
export function getSchemaOobi(schemaSaid: string): string {
  if (!schemaBaseUrl) {
    throw new Error("Schema server not started. Call startSchemaServer() first.");
  }
  return `${schemaBaseUrl}/oobi/${schemaSaid}`;
}

/**
 * Configures the Issuer's AID with an `indexer` end role and `locScheme`
 * pointing to the local schema server.
 *
 * This mirrors cred-issuance's ensureEndRoles() in server.ts:78-93.
 * Without this, the wallet app cannot discover the schema URL when
 * processing a granted credential.
 */
export async function setupIssuerSchemaEndpoint(issuer: Issuer): Promise<void> {
  if (!schemaBaseUrl) {
    throw new Error("Schema server not started. Call startSchemaServer() first.");
  }

  const prefix = await issuer.getAid();

  // Add indexer end role pointing to the Issuer's own AID prefix
  try {
    const endResult = await issuer.client
      .identifiers()
      .addEndRole(issuer.aidName, "indexer", prefix);
    await issuer.waitOperation(await endResult.op());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/400/gi.test(msg) || !/already/gi.test(msg)) throw err;
  }

  // Set locScheme to point to the local schema server
  const locRes = await issuer.client
    .identifiers()
    .addLocScheme(issuer.aidName, {
      url: schemaBaseUrl,
      scheme: "http",
    });
  await issuer.waitOperation(await locRes.op());

  console.log(
    `[${issuer.aidName}] Configured as schema endpoint at ${schemaBaseUrl}`
  );
}

/**
 * Stops the schema server if running. Call during test teardown.
 */
export async function stopSchemaServer(): Promise<void> {
  if (schemaServer) {
    return new Promise((resolve) => {
      schemaServer!.close(() => {
        schemaServer = undefined;
        schemaBaseUrl = undefined;
        resolve();
      });
    });
  }
}
