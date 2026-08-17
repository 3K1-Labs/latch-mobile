/**
 * recovery-repro.ts — deploy a throwaway smart account so recovery-testbed.ts
 * has something to drive.
 *
 * The testbed predicts the account address but never creates one; the app
 * normally does that through latch-api. `create_account` on the factory is
 * permissionless, so a plain funded G-account can call it directly, which is
 * all it takes to reproduce a device failure on a clean account.
 *
 *   export TESTNET_TEST_MNEMONIC="…"
 *   bun run scripts/recovery-repro.ts create
 *
 * TESTNET ONLY. Delete once the bug it was written for is understood.
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
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const FACTORY = process.env.EXPO_PUBLIC_FACTORY_ADDRESS ?? '';
const OWNER_INDEX = 0;

const server = new rpc.Server(RPC_URL);

function mnemonic(): string {
  const m = process.env.TESTNET_TEST_MNEMONIC;
  if (!m) throw new Error('set TESTNET_TEST_MNEMONIC (throwaway testnet only)');
  return m;
}

function masterKey(seed: Uint8Array) {
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function childKey(parent: { key: Uint8Array; chainCode: Uint8Array }, index: number) {
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, index + 0x80000000, false);
  const I = hmac(sha512, parent.chainCode, new Uint8Array([0x00, ...parent.key, ...indexBytes]));
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function keypairAt(index: number): Keypair {
  let node = masterKey(mnemonicToSeedSync(mnemonic()));
  node = childKey(node, 44);
  node = childKey(node, 148);
  node = childKey(node, index);
  return Keypair.fromRawEd25519Seed(Buffer.from(node.key));
}

/** Same salt the app derives, so the address matches what the client predicts. */
function accountInitParams(publicKeyHex: string): xdr.ScVal {
  const signer = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('key_data'),
        val: xdr.ScVal.scvBytes(Buffer.from(publicKeyHex, 'hex')),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signer_kind'),
        val: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Ed25519')]),
      }),
    ]),
  ]);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('account_salt'),
      val: xdr.ScVal.scvBytes(
        Buffer.from(sha256(new TextEncoder().encode(publicKeyHex + 'factory-v2'))),
      ),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: xdr.ScVal.scvVec([signer]) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('threshold'), val: xdr.ScVal.scvVoid() }),
  ]);
}

async function submit(op: xdr.Operation, source: Keypair): Promise<string> {
  const seq = (await server.getAccount(source.publicKey())).sequenceNumber();
  const tx = new TransactionBuilder(new Account(source.publicKey(), seq), {
    fee: '5000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`submit rejected: ${JSON.stringify(sent.errorResult?.result())}`);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return sent.hash;
    throw new Error(`transaction failed: ${JSON.stringify(res.status)}`);
  }
  throw new Error('timed out waiting for confirmation');
}

async function create(): Promise<void> {
  if (!FACTORY) throw new Error('EXPO_PUBLIC_FACTORY_ADDRESS is not set — load the repo .env');
  const owner = keypairAt(OWNER_INDEX);
  const publicKeyHex = Buffer.from(owner.rawPublicKey()).toString('hex');
  const params = accountInitParams(publicKeyHex);

  const predictTx = new TransactionBuilder(new Account(owner.publicKey(), '0'), {
    fee: '100',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(FACTORY).call('get_account_address', params))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(predictTx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`predict failed: ${sim.error}`);
  const predicted = scValToNative(sim.result!.retval) as string;

  console.log(`owner    : ${owner.publicKey()}`);
  console.log(`predicted: ${predicted}`);

  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(predicted).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  if ((await server.getLedgerEntries(key)).entries.length) {
    console.log('already deployed — nothing to do');
    return;
  }

  const hash = await submit(new Contract(FACTORY).call('create_account', params), owner);
  console.log(`created  : ${predicted}  (${hash})`);
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'create') {
    console.log('usage: bun run scripts/recovery-repro.ts create');
    process.exit(1);
  }
  await create();
}

void main().catch((e) => {
  console.error(`failed: ${(e as Error).message}`);
  process.exit(1);
});
