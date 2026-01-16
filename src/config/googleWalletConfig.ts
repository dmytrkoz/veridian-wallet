export const GoogleWalletConfig = {
  // REPLACE WITH YOUR ISSUER ID
  // Google Wallet Issuer ID
  ISSUER_ID: "3388000000023064026",

  // WARNING: DO NOT COMMIT SENSITIVE KEYS TO GIT
  // For local development, you can load this from a file or environment variable.
  // Ideally, use a secure vault or environment variables in production.
  SERVICE_ACCOUNT_KEY_JSON:
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_KEY || "{}",
};
