/**
 * recovery-app-path.ts — run the APP's cancel construction outside React Native.
 *
 * recovery-testbed.ts proves the *shape* of the cancel call is right: it builds
 * the op with the SDK's own helpers and lands on chain. This script instead
 * mirrors src/services/social-recovery.ts#submitAsAccount as closely as it can
 * without Metro — the same hand-rolled JSON-RPC parse (imported from
 * src/api/soroban-rpc.ts, which is deliberately native-free), the same
 * bundler-as-source pattern, the same two-pass simulate/sign/simulate — and
 * stops before submitting.
 *
 * If the second simulation fails here and succeeds in the testbed, the fault is
 * in the app's plumbing rather than in the contracts or the call shape.
 *
 *   export TESTNET_TEST_MNEMONIC="…"   # owner + guardians
 *   export REPRO_BUNDLER_SECRET="S…"   # funded G-account standing in for the bundler
 *   bun run scripts/recovery-app-path.ts <smart-account C…> <ruleId>
 *
 * TESTNET ONLY. Read-only: it never calls sendTransaction.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  rpc,
  scValToNative,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { parseSimResult, txToBase64 } from '@/src/api/soroban-rpc';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FACTORY = process.env.EXPO_PUBLIC_FACTORY_ADDRESS ?? '';
const RECOVERY_POLICY = process.env.EXPO_PUBLIC_RECOVERY_POLICY ?? '';
const STELLAR_AUTH_PREFIX = 'Stellar Smart Account Auth:\n';

const server = new rpc.Server(RPC_URL);

/** fetch-based stand-in for the app's XHR transport; same request, same result shape. */
async function sorobanCall(method: string, params: object): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

// ─── key derivation (SEP-0005), as in recovery-testbed.ts ─────────────────────

function keypairAt(index: number): Keypair {
  const m = process.env.TESTNET_TEST_MNEMONIC;
  if (!m) throw new Error('set TESTNET_TEST_MNEMONIC');
  const master = (() => {
    const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), mnemonicToSeedSync(m));
    return { key: I.slice(0, 32), chainCode: I.slice(32) };
  })();
  const child = (parent: { key: Uint8Array; chainCode: Uint8Array }, i: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, i + 0x80000000, false);
    const I = hmac(sha512, parent.chainCode, new Uint8Array([0x00, ...parent.key, ...b]));
    return { key: I.slice(0, 32), chainCode: I.slice(32) };
  };
  let node = child(child(child(master, 44), 148), index);
  return Keypair.fromRawEd25519Seed(Buffer.from(node.key));
}

// ─── the app's signing, copied from src/services/send-token.ts ────────────────

function hashAuthPayload(entry: xdr.SorobanAuthorizationEntry): Buffer {
  const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const addrAuth = clone.credentials().address();
  const networkId = Buffer.from(sha256(new TextEncoder().encode(NETWORK_PASSPHRASE)));
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId,
      nonce: addrAuth.nonce(),
      invocation: clone.rootInvocation(),
      signatureExpirationLedger: addrAuth.signatureExpirationLedger(),
    }),
  );
  return Buffer.from(sha256(Uint8Array.from(preimage.toXDR())));
}

function countAuthContexts(inv: xdr.SorobanAuthorizedInvocation): number {
  let n = 1;
  for (const sub of inv.subInvocations()) n += countAuthContexts(sub);
  return n;
}

function signSmartAccountAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  keypair: Keypair,
  validUntilLedger: number,
  verifierAddress: string,
  contextRuleId = 0,
): void {
  const creds = entry.credentials();
  if (creds.switch().name !== 'sorobanCredentialsAddress') return;

  const addrCreds = creds.address();
  addrCreds.signatureExpirationLedger(validUntilLedger);

  const payloadHash = hashAuthPayload(entry);
  const ruleIdsScVal = xdr.ScVal.scvVec(
    Array.from({ length: countAuthContexts(entry.rootInvocation()) }, () =>
      xdr.ScVal.scvU32(contextRuleId),
    ),
  );
  const ruleIdsXdr = new Uint8Array(ruleIdsScVal.toXDR());
  const combined = new Uint8Array(payloadHash.length + ruleIdsXdr.length);
  combined.set(payloadHash);
  combined.set(ruleIdsXdr, payloadHash.length);
  const authDigest = Buffer.from(sha256(combined));

  const message = STELLAR_AUTH_PREFIX + authDigest.toString('hex').toLowerCase();
  const sigBytes = keypair.sign(Buffer.from(message, 'utf8'));
  const pkBytes = StrKey.decodeEd25519PublicKey(keypair.publicKey());

  addrCreds.signature(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: ruleIdsScVal }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signers'),
        val: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvVec([
              xdr.ScVal.scvSymbol('External'),
              new Address(verifierAddress).toScVal(),
              xdr.ScVal.scvBytes(Buffer.from(Uint8Array.from(pkBytes))),
            ]),
            val: xdr.ScVal.scvBytes(Buffer.from(Uint8Array.from(sigBytes))),
          }),
        ]),
      }),
    ]),
  );
}

async function ed25519Verifier(): Promise<string> {
  const tx = new TransactionBuilder(new Account(keypairAt(0).publicKey(), '0'), {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(FACTORY).call(
        'get_verifier',
        xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Ed25519')]),
      ),
    )
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval) as string;
}

async function main(): Promise<void> {
  const account = process.argv[2];
  const ruleId = Number(process.argv[3] ?? 1);
  if (!account) throw new Error('usage: recovery-app-path.ts <account C…> <ruleId>');

  const bundlerSecret = process.env.REPRO_BUNDLER_SECRET;
  if (!bundlerSecret) throw new Error('set REPRO_BUNDLER_SECRET to a funded testnet G-account');
  const bundler = Keypair.fromSecret(bundlerSecret);
  const owner = keypairAt(0);

  // ── exactly what cancelRecovery builds ──
  const op = new Contract(RECOVERY_POLICY).call(
    'cancel',
    new Address(account).toScVal(),
    xdr.ScVal.scvU32(ruleId),
  );

  // ── submitAsAccount, minus the submit ──
  const sequence = (await server.getAccount(bundler.publicKey())).sequenceNumber();
  const build = () => {
    const builder = new TransactionBuilder(new Account(bundler.publicKey(), sequence), {
      fee: '2000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    }).setTimeout(300);
    builder.addOperation(op);
    return builder.build();
  };

  const raw = await sorobanCall('simulateTransaction', { transaction: txToBase64(build()) });
  if (raw.error) throw new Error(`simulation failed: ${raw.error}`);
  const sim = parseSimResult(raw);
  console.log(`first simulation: ${sim.result?.auth?.length ?? 0} auth entr(ies)`);

  const validUntil = (raw.latestLedger ?? 0) + 100;
  const verifier = await ed25519Verifier();
  console.log(`verifier: ${verifier}`);

  let signedCount = 0;
  for (const entry of sim.result?.auth ?? []) {
    const creds = entry.credentials();
    if (creds.switch().name !== 'sorobanCredentialsAddress') continue;
    const who = Address.fromScAddress(creds.address().address()).toString();
    console.log(`  entry authorised by ${who}  (target account: ${account})`);
    if (who !== account) {
      console.log('  -> SKIPPED by the app filter');
      continue;
    }
    signSmartAccountAuthEntry(entry, owner, validUntil, verifier, 0);
    signedCount++;
  }
  console.log(`signed ${signedCount} entr(ies) under rule 0`);

  const signed = rpc.assembleTransaction(build(), sim).build();
  const opAuth = (signed.operations[0] as any).auth ?? [];
  console.log(`assembled tx carries ${opAuth.length} auth entr(ies)`);

  const raw2 = await sorobanCall('simulateTransaction', { transaction: txToBase64(signed) });
  if (raw2.error) {
    console.log(`\nSECOND SIMULATION FAILED:\n${raw2.error}`);
    if (raw2.events?.length) {
      console.log('\ndiagnostic events:');
      for (const e of raw2.events.slice(0, 8)) console.log(`  ${e}`);
    }
    process.exit(2);
  }
  console.log('\nsecond simulation PASSED — the app construction is authorised on chain.');
  console.log('nothing submitted.');
}

void main().catch((e) => {
  console.error(`failed: ${(e as Error).message}`);
  process.exit(1);
});
