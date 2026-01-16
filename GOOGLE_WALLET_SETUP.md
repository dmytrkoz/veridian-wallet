# How to Get Google Wallet Credentials

To make the "Add to Google Wallet" button work with real passes, you need two things:
1.  **Issuer ID**: Identifies you as the pass creator.
2.  **Service Account Private Key**: Used to securely sign the passes.

Follow these steps to generate them.

## Step 1: Create a Google Cloud Project & Service Account

1.  Go to the [Google Cloud Console](https://console.cloud.google.com/).
2.  Create a **New Project** (e.g., "Veridian Wallet PoC").
3.  **Enable the Google Wallet API**:
    *   In the sidebar, go to **APIs & Services > Library**.
    *   Search for **Google Wallet API**.
    *   Click **Enable**.
4.  **Create a Service Account**:
    *   Go to **APIs & Services > Credentials**.
    *   Click **+ CREATE CREDENTIALS** -> **Service Account**.
    *   Name it (e.g., "wallet-signer").
    *   Click **Done**.
5.  **Get the Key**:
    *   Click on the newly created Service Account email (e.g., `wallet-signer@...`).
    *   Go to the **Keys** tab.
    *   Click **ADD KEY > Create new key**.
    *   Select **JSON** and click **Create**.
    *   A `.json` file will download. **Open this file**.
    *   Copy the `private_key` (looks like `-----BEGIN PRIVATE KEY...`) and `client_email`.

## Step 2: Create a Google Wallet Issuer Account

1.  Go to the [Google Pay & Wallet Console](https://pay.google.com/business/console).
2.  Create a **Business Profile** if you don't have one.
3.  Click on **Google Wallet API** in the sidebar.
4.  There will be a prominent box showing your **Issuer ID** (a long number like `3388000000022230000`).
5.  **Authorize your Service Account**:
    *   In the Google Wallet Console, click **Users**.
    *   Click **Invite User**.
    *   Paste the **`client_email`** from your JSON file (Step 1).
    *   Set their role to **Developer**.
    *   Click **Invite**.

## Step 3: Configure Veridian Wallet

1.  Open `src/config/googleWalletConfig.ts` in your code editor.
2.  Paste the **Issuer ID** into the `ISSUER_ID` field.
3.  Paste the **Private Key** (from the JSON file) into the `SERVICE_ACCOUNT_PRIVATE_KEY` field.

> [!IMPORTANT]
> The private key string must include the `\n` newlines exactly as they appear in the JSON, or be a valid PEM formatted string.

Your app is now ready to issue real passes!
