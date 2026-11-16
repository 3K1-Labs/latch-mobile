# Latch Privacy Policy

**Last updated:** [DATE]

Latch is a self-custody wallet for the Stellar network, published by Latch Mobile Ltd ("Latch", "we", "us"). This policy explains what information the Latch mobile app and its supporting services handle, why, and the choices you have.

The short version: we never have access to your private keys, recovery phrase, or funds. We collect only what is needed to run the app, we do not use advertising or analytics trackers, and we never sell your data.

## 1. What stays on your device

The following are created and stored only on your device, in the iOS Keychain / Secure Enclave or the Android Keystore. They are never sent to us or anyone else:

- Your recovery phrase and private keys
- Your passkey private keys (managed by your device's operating system)
- Your PIN
- Biometric data. Face ID and Touch ID are handled entirely by your device; we never see them.
- Your address book

If you delete the app without a backup, this data is gone and we cannot recover it for you.

## 2. Information we collect

**Email address (optional).** If you choose to add an email, we use it to sign you in with a one-time code, to link your encrypted backup, and to coordinate shared wallets you belong to. We do not send marketing email without your consent.

**Encrypted backup (optional).** If you turn on backup, your recovery data is encrypted on your device with a password only you know (Argon2id and AES-256-GCM) before it is uploaded. We store only the encrypted data and cannot decrypt it.

**Wallet and transaction data.** To create your smart account and submit transactions, our servers receive your public wallet addresses, public keys, and the transactions you choose to sign. This information is also public on the Stellar blockchain.

**Shared wallet data.** If you use a shared (multisig) wallet, we relay the transactions awaiting approval and the public keys of the wallet's members so that other members can review and co-sign them.

**Push notification token.** If you allow notifications, we store your device's push token so we can tell you when a transaction needs your approval. You can turn this off in your device settings at any time.

**Crash reports.** When the app crashes or hits an error, we receive a diagnostic report through our crash-reporting provider (Sentry). It includes the error and stack trace, device model, operating system version, and app version. We do not attach your name, email, or IP address to these reports. An error message can occasionally include a public wallet address or transaction ID.

## 3. What we do not collect

- We do not use advertising SDKs or analytics trackers, and we do not track you across other apps or websites.
- We do not collect your name, phone number, contacts, photos, location, or government ID.
- We do not sell or rent your personal information.

## 4. Blockchain transactions are public

Transactions you make are broadcast to the Stellar network and recorded permanently on a public ledger. Anyone who knows your wallet address can see its balances and transaction history. We cannot change or delete data on the blockchain.

## 5. Third-party services

Latch connects to these services to work. Each has its own privacy policy:

- **Stellar network infrastructure** (Horizon and Soroban RPC providers): reading balances and submitting transactions.
- **Swap providers** (such as Soroswap and Aquarius): fetching quotes and routing swaps you request.
- **MoonPay**: if you choose to buy crypto, you deal with MoonPay directly, and MoonPay collects any identity and payment information it needs under its own policy. We do not receive your card details or identity documents.
- **WalletConnect**: relaying connection requests between Latch and apps you choose to connect to.
- **Sentry**: crash and error reporting.
- **Apple Push Notification service / Firebase Cloud Messaging**: delivering notifications.
- **Expo**: delivering app updates.

## 6. How long we keep data

We keep your email address, encrypted backup, and push token while your account is active and delete them when you ask us to. Crash reports are kept for up to 90 days. [Confirm against your Sentry retention setting.]

## 7. Security

Sensitive credentials never leave your device. Data we hold is encrypted in transit (TLS), and backups are end-to-end encrypted. No system is perfectly secure, so keep your recovery phrase and devices safe.

## 8. Your rights

Depending on where you live (for example under the GDPR, UK GDPR, or CCPA), you may have the right to access, correct, delete, or export the personal data we hold about you, and to object to or restrict how we process it. To make a request, email us at the address below. We will respond within 30 days.

Our legal bases for processing (where GDPR applies) are performing our contract with you (running the app), our legitimate interest (keeping the app secure and fixing crashes), and your consent (optional email and notifications).

## 9. Children

Latch is not intended for anyone under 18. We do not knowingly collect information from minors. If you believe a minor has given us personal information, contact us and we will delete it.

## 10. International transfers

Our service providers may process data in the United States, the European Union, or other countries. Where required, we rely on appropriate safeguards such as Standard Contractual Clauses.

## 11. Changes to this policy

We may update this policy. When we do, we will change the "Last updated" date and, for significant changes, notify you in the app.

## 12. Contact

Latch Mobile Ltd
[Registered address]
Email: [support@uselatch.app]
