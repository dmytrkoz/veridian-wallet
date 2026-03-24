/**
 * Entry point for E2E backend helpers. Step definitions import from here and from backend-api.contract.
 * Wired to dev's createVirtualWallet (backend-api.contract.ts). To use stub, point to remote-bob.helper.js.
 */

import { ready } from "signify-ts";
import { VirtualWallet, RemoteInitiator, Issuer, Verifier } from "./virtual-wallet";
import { getKeriaUrlsForTestRunner } from "./ssi-agent-urls.helper.js";

/** Factory to create a standard Joiner (VirtualWallet) */
export const createVirtualWallet = async (
    alias: string,
): Promise<VirtualWallet> => {
  await ready();
  const config = getKeriaUrlsForTestRunner();
  const user = new VirtualWallet(alias, config);
  await user.init();
  return user;
};

/** Factory to create an Initiator (RemoteInitiator) */
export const createRemoteInitiator = async (
    alias: string,
): Promise<RemoteInitiator> => {
  await ready();
  const config = getKeriaUrlsForTestRunner();
  const user = new RemoteInitiator(alias, config);
  await user.init();
  return user;
};

/** Factory to create an Issuer (Issuer) */
export const createIssuer = async (
    alias: string,
): Promise<Issuer> => {
  await ready();
  const config = getKeriaUrlsForTestRunner();
  const user = new Issuer(alias, config);
  await user.init();
  return user;
};

/** Factory to create a Verifier (Verifier) */
export const createVerifier = async (
    alias: string,
): Promise<Verifier> => {
  await ready();
  const config = getKeriaUrlsForTestRunner();
  const user = new Verifier(alias, config);
  await user.init();
  return user;
};
