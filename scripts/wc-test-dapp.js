/**
 * wc-test-dapp.js — a throwaway dApp that drives Latch's WalletConnect signing
 * flow on testnet, so the sign sheet can be triggered without a third-party dApp.
 *
 *   node scripts/wc-test-dapp.js                       # stellar_signXDR
 *   node scripts/wc-test-dapp.js --submit              # stellar_signAndSubmitXDR
 *   node scripts/wc-test-dapp.js --to G...             # payment destination
 *   node scripts/wc-test-dapp.js --big                 # full-size QR for a phone camera
 *   node scripts/wc-test-dapp.js --scenario merge      # see SCENARIOS below
 *
 * --scenario drives one case of the review sheet each (warnings, decoded
 * operations, reject states). Run with an unknown name to list them.
 *
 * Flow:
 *   1. SignClient.connect() requesting the stellar:testnet namespace.
 *   2. Prints the wc: URI as a terminal QR — scan it in Latch (Explore ▸ scan).
 *   3. On approval, reads the approved G-address out of the session namespace
 *      and friendbots it if Horizon doesn't know it yet.
 *   4. Builds a 1 XLM payment and sends it as a session_request — this is what
 *      pushes /wc-session-request in the app.
 *   5. Prints the wallet's response (signedXDR, or the submit status).
 *
 * The wallet checks chainId against getWcChain() (src/lib/walletconnect.ts), so
 * Latch must be on testnet (Profile ▸ Network) before pairing — a mismatch is
 * answered with UNSUPPORTED_CHAINS and no sheet is ever shown. The active
 * account must be a mnemonic account; passkey accounts have no G-address.
 */
const fs = require('fs');
const path = require('path');

const QRCode = require('qrcode');
const { SignClient } = require('@walletconnect/sign-client');
const {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} = require('@stellar/stellar-sdk');

const CHAIN = 'stellar:testnet';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';
const METHODS = ['stellar_signXDR', 'stellar_signAndSubmitXDR'];

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  return fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .reduce((acc, line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match) acc[match[1]] = match[2].replace(/^["']|["']$/g, '');
      return acc;
    }, {});
}

function parseArgs(argv) {
  const toIndex = argv.indexOf('--to');
  const scenarioIndex = argv.indexOf('--scenario');
  return {
    submit: argv.includes('--submit'),
    to: toIndex === -1 ? null : argv[toIndex + 1],
    scenario: scenarioIndex === -1 ? 'payment' : argv[scenarioIndex + 1],
    // A half-height QR is fine on a simulator screenshot but a phone camera
    // often can't lock onto it across a desk — --big renders it full size.
    big: argv.includes('--big'),
  };
}

const tx = (source, ops, { timeout = 300, memo } = {}) => {
  const builder = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  });
  ops.forEach((op) => builder.addOperation(op));
  if (memo) builder.addMemo(memo);
  return builder.setTimeout(timeout).build();
};

const selfPayment = (address, amount = '1') =>
  Operation.payment({ destination: address, asset: Asset.native(), amount });

/**
 * One entry per thing the review sheet is supposed to show.
 *
 * `safeToSubmit` is the guard that matters: several scenarios build genuinely
 * destructive transactions (adding a signer, merging the account away) purely so
 * the warning copy can be read. Those are signed and thrown away, never
 * broadcast, and --submit is refused for them.
 */
const SCENARIOS = {
  payment: {
    describe: 'plain 1 XLM self-payment',
    expect: 'one "Send payment" row, no warnings',
    safeToSubmit: true,
    build: async ({ source, address, to }) => ({
      xdr: tx(source, [selfPayment(to ?? address)]).toXDR(),
    }),
  },

  multi: {
    describe: 'two payments plus a text memo',
    expect: 'two operation rows and a "text · wc-test" memo line',
    safeToSubmit: true,
    build: async ({ source, address, to }) => ({
      xdr: tx(source, [selfPayment(to ?? address), selfPayment(to ?? address, '2')], {
        memo: Memo.text('wc-test'),
      }).toXDR(),
    }),
  },

  'no-expiry': {
    describe: 'payment with no upper timebound',
    expect: '"No expiry" warning, Expires row reads Never',
    safeToSubmit: true,
    build: async ({ source, address, to }) => ({
      xdr: tx(source, [selfPayment(to ?? address)], { timeout: 0 }).toXDR(),
    }),
  },

  'set-options': {
    describe: 'adds a signer to YOUR account (never submitted)',
    expect: '"Changes account settings" warning',
    safeToSubmit: false,
    build: async ({ source }) => ({
      xdr: tx(source, [
        Operation.setOptions({
          signer: { ed25519PublicKey: Keypair.random().publicKey(), weight: 1 },
        }),
      ]).toXDR(),
    }),
  },

  merge: {
    describe: 'merges YOUR account away (never submitted)',
    expect: '"Closes an account" warning',
    safeToSubmit: false,
    build: async ({ source }) => ({
      xdr: tx(source, [
        Operation.accountMerge({ destination: Keypair.random().publicKey() }),
      ]).toXDR(),
    }),
  },

  'op-source': {
    describe: 'operation overriding the transaction source',
    expect: '"Acts on another account" warning and an "on behalf of" line',
    safeToSubmit: false,
    build: async ({ source, address }) => ({
      xdr: tx(source, [
        Operation.payment({
          destination: address,
          asset: Asset.native(),
          amount: '1',
          source: Keypair.random().publicKey(),
        }),
      ]).toXDR(),
    }),
  },

  foreign: {
    describe: 'transaction sourced from a different account',
    expect: '"Not your account" warning, From row without "(you)"',
    safeToSubmit: false,
    build: async ({ server }) => {
      const stranger = Keypair.random();
      console.log(`  funding a second account (${stranger.publicKey().slice(0, 8)}…)…`);
      const strangerAccount = await ensureFunded(server, stranger.publicKey());
      return {
        xdr: tx(strangerAccount, [selfPayment(stranger.publicKey())]).toXDR(),
      };
    },
  },

  'fee-bump': {
    describe: 'fee bump wrapping a payment',
    expect: '"Fee-bump transaction" warning, inner payment still decoded',
    safeToSubmit: false,
    build: async ({ server, source, address }) => {
      const payer = Keypair.random();
      console.log(`  funding a fee-payer account (${payer.publicKey().slice(0, 8)}…)…`);
      await ensureFunded(server, payer.publicKey());
      const inner = tx(source, [selfPayment(address)]);
      return {
        xdr: TransactionBuilder.buildFeeBumpTransaction(
          payer,
          '2000',
          inner,
          Networks.TESTNET,
        ).toXDR(),
      };
    },
  },

  'bad-xdr': {
    describe: 'malformed XDR',
    expect: '"This request can\'t be signed", Approve disabled',
    safeToSubmit: false,
    build: async () => ({ xdr: 'definitely-not-xdr' }),
  },

  'no-xdr': {
    describe: 'request with no xdr parameter',
    expect: '"This request can\'t be signed", Approve disabled',
    safeToSubmit: false,
    build: async () => ({}),
  },
};

async function ensureFunded(server, address) {
  try {
    return await server.loadAccount(address);
  } catch (err) {
    if (err?.response?.status !== 404) throw err;
  }

  console.log(`\n${address} not on testnet yet — funding via friendbot…`);
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status}`);
  return server.loadAccount(address);
}

async function main() {
  const { submit, to, big, scenario } = parseArgs(process.argv.slice(2));

  // Checked before the relay connect so a typo costs a rerun, not a QR scan.
  const definition = SCENARIOS[scenario];
  if (!definition) {
    console.error(`Unknown scenario "${scenario}". Available:\n`);
    for (const [name, s] of Object.entries(SCENARIOS)) {
      console.error(`  ${name.padEnd(12)} ${s.describe}`);
    }
    process.exit(1);
  }

  if (submit && !definition.safeToSubmit) {
    console.error(
      `Refusing --submit with scenario "${scenario}": ${definition.describe}\n` +
        'Broadcasting it would change the account for real. Run it sign-only.',
    );
    process.exit(1);
  }

  const env = { ...loadEnv(), ...process.env };
  const projectId =
    env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '5f9dfc3d26a8876949217421446ed931';

  const signClient = await SignClient.init({
    projectId,
    // A stable url — approveProposal() dedupes live sessions by peer url, so
    // re-running this script replaces its old session instead of stacking rows
    // in Connected Apps.
    metadata: {
      name: 'Latch WC Test dApp',
      description: 'Local harness for Latch WalletConnect signing',
      url: 'https://localhost.latch.test',
      icons: ['https://getlatch.co/icon.png'],
    },
  });

  const { uri, approval } = await signClient.connect({
    // optionalNamespaces, not requiredNamespaces — the latter is deprecated in
    // sign-client v2.23 and is silently remapped to this anyway.
    optionalNamespaces: {
      stellar: { chains: [CHAIN], methods: METHODS, events: ['accountsChanged'] },
    },
  });

  console.log(await QRCode.toString(uri, { type: 'terminal', small: !big }));
  console.log('Scan the QR in Latch (or paste the URI below), then approve:\n');
  console.log(uri, '\n');
  console.log('Waiting for approval…');

  const session = await approval();
  const account = session.namespaces.stellar.accounts[0];
  const address = account.split(':')[2];
  console.log(`\nConnected: ${address}`);

  const server = new Horizon.Server(HORIZON_URL);
  const source = await ensureFunded(server, address);

  console.log(`\nScenario: ${scenario} — ${definition.describe}`);
  console.log(`Expect in the sheet: ${definition.expect}`);

  const params = await definition.build({ server, source, address, to });

  const method = submit ? 'stellar_signAndSubmitXDR' : 'stellar_signXDR';
  console.log(`\nSending ${method} — check the sheet in Latch…`);

  let result;
  try {
    result = await signClient.request({
      topic: session.topic,
      chainId: CHAIN,
      request: { method, params },
    });
  } catch (err) {
    // The reject scenarios end here: the wallet answers with a JSON-RPC error
    // instead of a signature, which is the pass condition for those runs.
    console.log('\nWallet rejected the request (expected for reject scenarios):');
    console.log(`  ${err?.message ?? err}`);
    process.exit(0);
  }

  console.log('\nWallet response:', JSON.stringify(result, null, 2));

  if (!submit && result?.signedXDR) {
    const signed = TransactionBuilder.fromXDR(result.signedXDR, Networks.TESTNET);
    console.log(`Signatures on the returned XDR: ${signed.signatures.length}`);

    if (definition.safeToSubmit) {
      console.log('Submitting it here to prove the signature is valid…');
      const submitted = await server.submitTransaction(signed);
      console.log(`Submitted: ${submitted.hash}`);
    } else {
      console.log('Not submitting — this scenario is for display only.');
    }
  }

  process.exit(0);
}

// Guarded so the scenario table can be required and exercised without pairing.
if (require.main === module) {
  main().catch((err) => {
    console.error('\nFAILED:', err?.message ?? err);
    if (err?.response?.data?.extras?.result_codes) {
      console.error('result_codes:', err.response.data.extras.result_codes);
    }
    process.exit(1);
  });
}

module.exports = { SCENARIOS };
