/**
 * recovery-testbed.ts — drive the Recovery Policy lifecycle on testnet.
 *
 * Standalone on purpose. The app's modules pull in React Native, which cannot
 * be loaded outside Metro, so the small amount of derivation and encoding this
 * needs is reproduced here against the same specs the app follows (SEP-0005
 * derivation, `sha256(publicKeyHex + "factory-v2")` salt, and the
 * AccountInitParams encoding pinned by the XDR-parity tests in latch-api).
 *
 * Fees come from the owner's own funded G-account rather than the bundler, so
 * this needs neither latch-api nor a bundler secret.
 *
 *   export TESTNET_TEST_MNEMONIC="..."
 *   bun run scripts/recovery-testbed.ts addresses
 *   bun run scripts/recovery-testbed.ts status
 *
 * TESTNET ONLY. It refuses to run against any other passphrase.
 */

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  Account,
  Address,
  Asset,
  Contract,
  hash,
  Keypair,
  nativeToScVal,
  authorizeEntry,
  Networks,
  Operation,
  rpc,
  scValToNative,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

const FACTORY = requireEnv('EXPO_PUBLIC_FACTORY_ADDRESS');
const RECOVERY_POLICY = requireEnv('EXPO_PUBLIC_RECOVERY_POLICY');

/** Owner is index 0; guardians are 1 and 2. */
const OWNER_INDEX = 0;
/** Every key on rule 0. A rule with no policy is N-of-N, so all must sign. */
const RULE0_INDICES = (process.env.RULE0_INDICES ?? '0').split(',').map(Number);
const GUARDIAN_INDICES = [1, 2];
/** Stands in for a replacement device in a recovery. */
const NEW_DEVICE_INDEX = Number(process.env.NEW_DEVICE_INDEX ?? 9);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing ${name} — run with the repo's .env loaded`);
    process.exit(1);
  }
  return v;
}

function mnemonic(): string {
  const m = process.env.TESTNET_TEST_MNEMONIC;
  if (!m) {
    console.error('set TESTNET_TEST_MNEMONIC (testnet throwaway only)');
    process.exit(1);
  }
  return m;
}

// ─── SEP-0005 derivation (m/44'/148'/index') ──────────────────────────────────
// Reproduced from src/lib/seed-wallet.ts, which is covered by the published
// SEP-0005 test vectors in src/lib/__tests__/seed-wallet.test.ts.

function masterKey(seed: Uint8Array) {
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function childKey(parent: { key: Uint8Array; chainCode: Uint8Array }, index: number) {
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, index + 0x80000000, false);
  const data = new Uint8Array([0x00, ...parent.key, ...indexBytes]);
  const I = hmac(sha512, parent.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function keypairAt(index: number): Keypair {
  const seed = mnemonicToSeedSync(mnemonic());
  let node = masterKey(seed);
  node = childKey(node, 44);
  node = childKey(node, 148);
  node = childKey(node, index);
  return Keypair.fromRawEd25519Seed(Buffer.from(node.key));
}

function publicKeyHexAt(index: number): string {
  return Buffer.from(keypairAt(index).rawPublicKey()).toString('hex');
}

// ─── AccountInitParams (single ed25519 signer) ────────────────────────────────

function deriveSalt(publicKeyHex: string): Buffer {
  return Buffer.from(sha256(new TextEncoder().encode(publicKeyHex + 'factory-v2')));
}

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
      val: xdr.ScVal.scvBytes(deriveSalt(publicKeyHex)),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: xdr.ScVal.scvVec([signer]) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('threshold'), val: xdr.ScVal.scvVoid() }),
  ]);
}

// ─── chain helpers ────────────────────────────────────────────────────────────

const server = new rpc.Server(RPC_URL);

/** Simulate a read-only call and return its native result. */
async function simulateRead(contractId: string, fn: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const source = keypairAt(OWNER_INDEX);
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn} simulation failed: ${sim.error}`);
  if (!sim.result?.retval) throw new Error(`${fn} returned nothing`);
  return scValToNative(sim.result.retval);
}

/**
 * The ed25519 verifier, read from the factory rather than the environment.
 *
 * EXPO_PUBLIC_VERIFIER_ADDRESS cannot be trusted for this: it currently names
 * an address that is none of the factory's three verifiers, so a signer key
 * built from it fails to match any rule signer and __check_auth rejects the
 * call with UnvalidatedContext (3002). The account stores whichever verifier
 * the factory used at deploy time, so the factory is the authority.
 */
let cachedVerifier: string | null = null;
async function ed25519Verifier(): Promise<string> {
  if (!cachedVerifier) {
    cachedVerifier = (await simulateRead(
      FACTORY,
      'get_verifier',
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Ed25519')]),
    )) as string;
  }
  return cachedVerifier;
}

async function predictedAccount(): Promise<string> {
  return (await simulateRead(
    FACTORY,
    'get_account_address',
    accountInitParams(publicKeyHexAt(OWNER_INDEX)),
  )) as string;
}

async function isDeployed(contractId: string): Promise<boolean> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const res = await server.getLedgerEntries(key);
  return res.entries.length > 0;
}

// ─── smart-account auth signing ───────────────────────────────────────────────
// Reproduces signSmartAccountAuthEntry from src/services/send-token.ts. The
// digest and the AuthPayload's context_rule_ids must agree, and both must name
// the rule the call is actually authorised under — signing under rule 0 while
// invoking through rule N fails on chain with an opaque auth error.

const STELLAR_AUTH_PREFIX = 'Stellar Smart Account Auth:\n';

function hashAuthPayload(entry: xdr.SorobanAuthorizationEntry): Buffer {
  const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const addrAuth = clone.credentials().address();
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
      nonce: addrAuth.nonce(),
      invocation: clone.rootInvocation(),
      signatureExpirationLedger: addrAuth.signatureExpirationLedger(),
    }),
  );
  return hash(preimage.toXDR());
}

function countAuthContexts(inv: xdr.SorobanAuthorizedInvocation): number {
  let n = 1;
  for (const sub of inv.subInvocations()) n += countAuthContexts(sub);
  return n;
}

/** Sign an auth entry for the smart account, under a specific context rule. */
function signAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  signers: Keypair[],
  ruleId: number,
  validUntilLedger: number,
  verifier: string,
): void {
  const creds = entry.credentials();
  if (creds.switch().name !== 'sorobanCredentialsAddress') return;

  const addrCreds = creds.address();
  addrCreds.signatureExpirationLedger(validUntilLedger);

  const ruleIdsScVal = xdr.ScVal.scvVec(
    Array.from({ length: countAuthContexts(entry.rootInvocation()) }, () =>
      xdr.ScVal.scvU32(ruleId),
    ),
  );

  const payloadHash = hashAuthPayload(entry);
  const ruleIdsXdr = new Uint8Array(ruleIdsScVal.toXDR());
  const combined = new Uint8Array(payloadHash.length + ruleIdsXdr.length);
  combined.set(payloadHash);
  combined.set(ruleIdsXdr, payloadHash.length);
  const authDigest = Buffer.from(sha256(combined));
  const message = STELLAR_AUTH_PREFIX + authDigest.toString('hex').toLowerCase();

  // Soroban maps are canonically ordered; an unsorted map is rejected as
  // Object/InvalidInput before any signature is even looked at. The app sorts
  // the same way in soroban-auth-payload.ts when merging multisig entries.
  const signerEntries = signers.map((kp) => {
    const sig = kp.sign(Buffer.from(message, 'utf8'));
    const pk = StrKey.decodeEd25519PublicKey(kp.publicKey());
    return new xdr.ScMapEntry({
      key: xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('External'),
        new Address(verifier).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(Uint8Array.from(pk))),
      ]),
      val: xdr.ScVal.scvBytes(Buffer.from(Uint8Array.from(sig))),
    });
  });

  signerEntries.sort((a, b) => Buffer.compare(a.key().toXDR(), b.key().toXDR()));

  addrCreds.signature(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: ruleIdsScVal }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signers'), val: xdr.ScVal.scvMap(signerEntries) }),
    ]),
  );
}

/** Signer::External(verifier, key_data) — the runtime form the account stores. */
function encodeRuntimeSigner(s: { verifierAddress: string; keyDataHex: string }): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(s.verifierAddress).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(s.keyDataHex, 'hex')),
  ]);
}

// ─── write path ───────────────────────────────────────────────────────────────

/**
 * Simulate → sign the account's auth entries → simulate again → submit.
 *
 * The second simulation is not redundant. With signed auth entries present the
 * host runs `__check_auth` for real, so a bad signature or a wrong
 * context_rule_id fails here, before any fee is spent — and the assembled
 * footprint then accounts for the signatures' size.
 */
async function submitAsAccount(
  op: xdr.Operation,
  signers: Keypair[],
  ruleId: number,
  label: string,
): Promise<void> {
  const source = keypairAt(OWNER_INDEX);
  const sequence = (await server.getAccount(source.publicKey())).sequenceNumber();

  // A fresh Account each time: TransactionBuilder increments the sequence on
  // every build(), and this builds the same transaction twice — once to learn
  // the auth it needs, once carrying the signatures. Sharing one Account makes
  // the second attempt land a sequence too high (txBadSeq).
  const build = () =>
    new TransactionBuilder(new Account(source.publicKey(), sequence), {
      fee: '2000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(180)
      .build();

  console.log(`\n${label}`);

  const sim = await server.simulateTransaction(build());
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);

  const validUntil = Number(sim.latestLedger ?? 0) + 100;
  const verifier = await ed25519Verifier();
  for (const entry of sim.result?.auth ?? []) {
    if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') continue;
    signAuthEntry(entry, signers, ruleId, validUntil, verifier);
  }
  console.log(`  signed ${sim.result?.auth?.length ?? 0} auth entr(ies) under rule ${ruleId}`);

  const signedTx = rpc.assembleTransaction(build(), sim).build();

  // Enforcing pass — this is where a wrong signature surfaces.
  const sim2 = await server.simulateTransaction(signedTx);
  if (rpc.Api.isSimulationError(sim2)) throw new Error(`auth check failed: ${sim2.error}`);

  const prepared = rpc.assembleTransaction(signedTx, sim2).build();
  console.log(`  fee: ${(Number(prepared.fee) / 1e7).toFixed(4)} XLM`);
  prepared.sign(source);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`submit rejected: ${JSON.stringify(sent.errorResult?.result())}`);
  }
  console.log(`  submitted ${sent.hash}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log('  SUCCESS\n');
      return;
    }
    throw new Error(`transaction failed: ${JSON.stringify(res)}`);
  }
  throw new Error('timed out waiting for confirmation');
}

// ─── commands ─────────────────────────────────────────────────────────────────

async function addresses(): Promise<void> {
  console.log('\nderived from TESTNET_TEST_MNEMONIC (testnet):\n');
  console.log(`  owner       ${keypairAt(OWNER_INDEX).publicKey()}`);
  for (const i of GUARDIAN_INDICES) {
    console.log(`  guardian ${i}  ${keypairAt(i).publicKey()}`);
  }
  const predicted = await predictedAccount();
  console.log(`\n  smart account (predicted)  ${predicted}`);
  console.log(`  deployed                   ${await isDeployed(predicted)}\n`);
}

async function status(): Promise<void> {
  const account = await predictedAccount();
  if (!(await isDeployed(account))) {
    console.log(`\nsmart account ${account} is not deployed yet.\n`);
    return;
  }

  const count = Number(await simulateRead(account, 'get_context_rules_count'));
  console.log(`\nsmart account ${account}`);
  console.log(`context rules: ${count}\n`);

  for (let id = 0; id < count; id++) {
    const rule = (await simulateRead(account, 'get_context_rule', xdr.ScVal.scvU32(id))) as any;
    console.log(`  [${id}] ${rule.name}  type=${JSON.stringify(rule.context_type)}`);
    console.log(`       signers=${rule.signers?.length ?? 0} policies=${JSON.stringify(rule.policies ?? [])}`);
  }

  console.log('\nrecovery config:');
  let found = false;
  for (let id = 0; id < count; id++) {
    try {
      const data = (await simulateRead(
        RECOVERY_POLICY,
        'get_recovery_data',
        xdr.ScVal.scvU32(id),
        new Address(account).toScVal(),
      )) as any;
      if (!data) continue;
      found = true;
      console.log(
        `  rule ${id} -> target ${data.target_rule_id}, delay ${data.delay_ledgers} ledgers, window ${data.window_ledgers}`,
      );
    } catch {
      // no recovery policy on this rule
    }
  }
  if (!found) console.log('  none installed');
  console.log();
}


/**
 * The guardian rule's shape is dictated by the policy, not chosen:
 * `recovery.rs::install` rejects any rule whose type is not
 * `CallContract(<the account itself>)`, and rejects a `target_rule_id` equal to
 * the guardian rule (which would let the quorum rewrite its own membership).
 *
 * Creating this rule does NOT take admin control away from the owner. Rule
 * selection is made by the *signer*, per auth context, via the AuthPayload's
 * context_rule_ids, and a Default rule matches any context
 * (`get_validated_context_by_id`). So rule 0 still authorises everything it did
 * before; the guardian rule is an additional, narrower path, not a redirect.
 *
 * The threshold policy goes on at creation time because
 * `recovery.rs::install` verifies the declared `quorum_policy` is already
 * present on the rule. Order matters for a second reason: a rule that carries
 * any policy defers signer counting to its policies, so a guardian rule without
 * a quorum policy is 1-of-N regardless of how many guardians it names.
 */
async function addRecoveryRule(): Promise<void> {
  const account = await predictedAccount();
  const thresholdPolicy = (await simulateRead(FACTORY, 'get_threshold_policy')) as string;
  const verifier = await ed25519Verifier();
  const guardians = GUARDIAN_INDICES.map((i) => ({
    verifierAddress: verifier,
    keyDataHex: publicKeyHexAt(i),
  }));

  console.log(`\nthreshold policy: ${thresholdPolicy}`);

  const op = new Contract(account).call(
    'add_context_rule',
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CallContract'), new Address(account).toScVal()]),
    xdr.ScVal.scvString('recovery'),
    xdr.ScVal.scvVoid(),
    xdr.ScVal.scvVec(guardians.map(encodeRuntimeSigner)),
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: new Address(thresholdPolicy).toScVal(),
        val: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('threshold'),
            val: xdr.ScVal.scvU32(GUARDIAN_INDICES.length),
          }),
        ]),
      }),
    ]),
  );

  // Signed under rule 0: creating a rule is a call on the account, and the
  // Default rule matches it. The guardians cannot create their own rule.
  await submitAsAccount(op, RULE0_INDICES.map(keypairAt), 0, 'add_context_rule("recovery")');
}

/**
 * Install the Recovery Policy on the guardian rule.
 *
 * `delay_ledgers` is floored at MIN_DELAY_LEDGERS = 720 (~1 hour at a 5-second
 * close) by the contract — anything shorter is rejected as InvalidParams, on
 * the reasoning that a shorter veto window gives the owner no realistic chance
 * to notice a hostile proposal. 720 is therefore the fastest a test can run;
 * production should be days.
 *
 * `target_rule_id: 0` means a matured recovery may only mutate signers on the
 * default (spending) rule, which is the point of recovery.
 */
async function installRecovery(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const thresholdPolicy = (await simulateRead(FACTORY, 'get_threshold_policy')) as string;

  const params = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('delay_ledgers'), val: xdr.ScVal.scvU32(720) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('quorum_policy'),
      val: new Address(thresholdPolicy).toScVal(),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('target_rule_id'), val: xdr.ScVal.scvU32(0) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('window_ledgers'),
      val: xdr.ScVal.scvU32(17280),
    }),
  ]);

  const op = new Contract(account).call(
    'add_policy',
    xdr.ScVal.scvU32(ruleId),
    new Address(RECOVERY_POLICY).toScVal(),
    params,
  );

  await submitAsAccount(op, RULE0_INDICES.map(keypairAt), 0, `add_policy(recovery -> rule ${ruleId})`);
}

/** The recovery this testbed proposes: add a fresh device key to rule 0. */
async function recoveryArgs(): Promise<xdr.ScVal[]> {
  const newDevice = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(await ed25519Verifier()).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(publicKeyHexAt(NEW_DEVICE_INDEX), 'hex')),
  ]);
  return [xdr.ScVal.scvU32(0), newDevice];
}

/**
 * Propose a recovery, as the guardian quorum.
 *
 * It goes through the account's own `execute`, not a direct call on the policy.
 * That is forced by the policy: `enforce` only admits an `execute` whose target
 * is this policy's `propose`, and the guardian rule is scoped to
 * `CallContract(<account>)` so a direct call on the policy would not match it
 * at all. The nested `smart_account.require_auth()` inside `propose` needs no
 * second signature — the account is the immediate invoker, so Soroban treats it
 * as authorised, leaving exactly one auth context to sign.
 */
async function propose(ruleId: number): Promise<void> {
  const account = await predictedAccount();

  const op = new Contract(account).call(
    'execute',
    new Address(RECOVERY_POLICY).toScVal(),
    xdr.ScVal.scvSymbol('propose'),
    xdr.ScVal.scvVec([
      new Address(account).toScVal(),
      xdr.ScVal.scvU32(ruleId),
      xdr.ScVal.scvSymbol('add_signer'),
      xdr.ScVal.scvVec(await recoveryArgs()),
    ]),
  );

  console.log(`\nproposing: add_signer(rule 0, ${keypairAt(NEW_DEVICE_INDEX).publicKey()})`);
  await submitAsAccount(
    op,
    GUARDIAN_INDICES.map(keypairAt),
    ruleId,
    `execute(recovery.propose) as the guardian quorum`,
  );
}

/** The owner's veto, through the default rule. Guardians cannot reach this. */
async function cancel(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const op = new Contract(RECOVERY_POLICY).call(
    'cancel',
    new Address(account).toScVal(),
    xdr.ScVal.scvU32(ruleId),
  );
  await submitAsAccount(op, RULE0_INDICES.map(keypairAt), 0, `cancel pending recovery on rule ${ruleId}`);
}

/** Finalize a matured proposal: the quorum makes the call it pre-declared. */
async function finalize(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const op = new Contract(account).call('add_signer', ...(await recoveryArgs()));
  await submitAsAccount(
    op,
    GUARDIAN_INDICES.map(keypairAt),
    ruleId,
    `add_signer as the guardian quorum (consumes the proposal)`,
  );
}

/**
 * The negative cases — the claims the design rests on, tested rather than
 * assumed. Each must fail, and the error code says why:
 *
 *   #6  NotAllowed          the policy rejected the call shape
 *   #7  NoPendingProposal   reached the function but found nothing pending
 *
 * A guardian attempt that fails with #7 rather than #6 would mean the guardians
 * *can* reach that function and only luck stopped them.
 */
async function probe(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const guardians = GUARDIAN_INDICES.map(keypairAt);

  const cases: { label: string; op: xdr.Operation; expect: string }[] = [
    {
      label: 'guardians try to cancel the proposal (the owner-only veto)',
      expect: '#6 NotAllowed — cancel is unreachable from the guardian rule',
      op: new Contract(RECOVERY_POLICY).call(
        'cancel',
        new Address(account).toScVal(),
        xdr.ScVal.scvU32(ruleId),
      ),
    },
    {
      // Aimed at a real contract, so this tests enforce_proposal_call rather
      // than dying earlier on a non-contract target: same shape as the proposal
      // path, only the target function differs.
      label: 'guardians try execute aimed at something other than propose',
      expect: '#6 NotAllowed — execute is admitted only when aimed at propose',
      op: new Contract(account).call(
        'execute',
        new Address(RECOVERY_POLICY).toScVal(),
        xdr.ScVal.scvSymbol('cancel'),
        xdr.ScVal.scvVec([new Address(account).toScVal(), xdr.ScVal.scvU32(ruleId)]),
      ),
    },
    {
      label: 'guardians try to spend the proposal before it matures',
      expect: '#9 NotMatured — the veto window has to elapse first',
      op: new Contract(account).call('add_signer', ...(await recoveryArgs())),
    },
  ];

  for (const c of cases) {
    console.log(`\n${c.label}`);
    console.log(`  expect: ${c.expect}`);
    try {
      await submitAsAccount(c.op, guardians, ruleId, '  attempting...');
      console.log('  !!! SUCCEEDED — this should not have been possible');
    } catch (e) {
      const m = (e as Error).message;
      const code = m.match(/Error\(Contract, #(\d+)\)/)?.[1];
      console.log(`  rejected${code ? ` with contract error #${code}` : ''} — as intended`);
    }
  }
  console.log();
}

/**
 * Move XLM out of the smart account — the ordinary spending path, not recovery.
 *
 * Here to verify the signing construction the app uses in
 * signSmartAccountAuthEntry: same auth digest, same External(verifier, key_data)
 * signer key, same AuthPayload shape, signed under the default rule. If this
 * lands, a send fails only in the UI wiring above it.
 */
async function send(amount: string): Promise<void> {
  const account = await predictedAccount();
  const destination = keypairAt(GUARDIAN_INDICES[0]).publicKey();
  const sac = Asset.native().contractId(NETWORK_PASSPHRASE);

  const stroops = BigInt(Math.round(Number(amount) * 1e7));
  const op = new Contract(sac).call(
    'transfer',
    new Address(account).toScVal(),
    new Address(destination).toScVal(),
    nativeToScVal(stroops, { type: 'i128' }),
  );

  console.log(`\nsending ${amount} XLM`);
  console.log(`  from ${account}`);
  console.log(`  to   ${destination}`);
  await submitAsAccount(op, RULE0_INDICES.map(keypairAt), 0, 'transfer via the default rule');
}

/**
 * Put XLM into the smart account, from the owner's own G-account.
 *
 * A contract address cannot receive a classic payment, so this goes through the
 * native SAC. The owner authorises as an ordinary Stellar account here — no
 * smart-account auth is involved, because the funds are leaving a G-address.
 */
async function fund(amount: string): Promise<void> {
  const account = await predictedAccount();
  const source = keypairAt(OWNER_INDEX);
  const sac = Asset.native().contractId(NETWORK_PASSPHRASE);

  const op = new Contract(sac).call(
    'transfer',
    new Address(source.publicKey()).toScVal(),
    new Address(account).toScVal(),
    nativeToScVal(BigInt(Math.round(Number(amount) * 1e7)), { type: 'i128' }),
  );

  const seq = (await server.getAccount(source.publicKey())).sequenceNumber();
  const tx = new TransactionBuilder(new Account(source.publicKey(), seq), {
    fee: '2000000',
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
  console.log(`\nfunding ${account} with ${amount} XLM — ${sent.hash}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log('  SUCCESS\n');
      return;
    }
    throw new Error(`funding failed: ${JSON.stringify(res)}`);
  }
  throw new Error('timed out waiting for confirmation');
}

/**
 * Simulate creating a guardian rule whose guardians are C-addresses
 * (`Signer::Delegated`) rather than raw ed25519 keys.
 *
 * Simulate only — this answers "does the account accept this signer shape at
 * all" without adding a rule to the test account. A successful simulation means
 * the encoding validates and the owner's auth is the only thing required, which
 * is the question the mobile client needs answered before offering C-address
 * guardians in its UI.
 */
/**
 * Sign the account's entry naming a Delegated signer, then run the ENFORCING
 * simulation. The signature bytes are ignored for a delegated signer — the host
 * calls `addr.require_auth_for_args((auth_digest,))` instead — so this exists to
 * find out what that nested requirement looks like in practice.
 */
async function proposeDelegated(ruleId: number, guardian: string): Promise<void> {
  const account = await predictedAccount();
  const op = new Contract(account).call(
    'execute',
    new Address(RECOVERY_POLICY).toScVal(),
    xdr.ScVal.scvSymbol('propose'),
    xdr.ScVal.scvVec([
      new Address(account).toScVal(),
      xdr.ScVal.scvU32(ruleId),
      xdr.ScVal.scvSymbol('add_signer'),
      xdr.ScVal.scvVec(await recoveryArgs()),
    ]),
  );

  // SOURCE_INDEX lets the control run: with a source that is NOT the guardian,
  // any success must come from the guardian's own auth entry.
  const source = keypairAt(Number(process.env.SOURCE_INDEX ?? GUARDIAN_INDICES[0]));
  const seq = (await server.getAccount(source.publicKey())).sequenceNumber();
  const build = () =>
    new TransactionBuilder(new Account(source.publicKey(), seq), {
      fee: '2000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(180)
      .build();

  const sim = await server.simulateTransaction(build());
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error.split('\n')[0]);

  const validUntil = Number(sim.latestLedger ?? 0) + 100;
  const entry = sim.result!.auth![0];
  const addrCreds = entry.credentials().address();
  addrCreds.signatureExpirationLedger(validUntil);

  const count = countAuthContexts(entry.rootInvocation());
  const ruleIds = xdr.ScVal.scvVec(
    Array.from({ length: count }, () => xdr.ScVal.scvU32(ruleId)),
  );
  addrCreds.signature(
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('context_rule_ids'), val: ruleIds }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signers'),
        val: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvVec([
              xdr.ScVal.scvSymbol('Delegated'),
              new Address(guardian).toScVal(),
            ]),
            val: xdr.ScVal.scvBytes(Buffer.alloc(0)),
          }),
        ]),
      }),
    ]),
  );

  // The nested require_auth_for_args needs its own entry: the host authorises
  // `account.__check_auth(auth_digest)` on the guardian's behalf. auth_digest is
  // computable here because the nonce and expiration are already pinned.
  const payloadHash = hashAuthPayload(entry);
  const ruleIdsXdr = new Uint8Array(ruleIds.toXDR());
  const combined = new Uint8Array(payloadHash.length + ruleIdsXdr.length);
  combined.set(payloadHash);
  combined.set(ruleIdsXdr, payloadHash.length);
  const authDigest = Buffer.from(sha256(combined));

  const guardianEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(guardian).toScAddress(),
        nonce: new xdr.Int64(BigInt(Date.now())),
        signatureExpirationLedger: validUntil,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(account).toScAddress(),
          functionName: '__check_auth',
          args: [xdr.ScVal.scvBytes(authDigest)],
        }),
      ),
      subInvocations: [],
    }),
  });

  const signedGuardian = await authorizeEntry(
    process.env.NO_GUARDIAN_ENTRY ? guardianEntry : guardianEntry,
    keypairAt(GUARDIAN_INDICES[0]),
    validUntil,
    NETWORK_PASSPHRASE,
  );

  console.log(`\nenforcing pass with Delegated(${guardian.slice(0, 8)}…) + its own auth entry`);

  const base = build();
  const hostFn = (base.operations[0] as any).func;
  const withAuth = new TransactionBuilder(new Account(source.publicKey(), seq), {
    fee: '4000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: hostFn,
        auth: process.env.NO_GUARDIAN_ENTRY ? [entry] : [entry, signedGuardian],
      }),
    )
    .setTimeout(180)
    .build();

  const sim2 = await server.simulateTransaction(withAuth);
  if (rpc.Api.isSimulationError(sim2)) {
    console.log(`  REJECTED — ${sim2.error.split('\n')[0]}`);
    const line = sim2.error.split('\n').find((l) => l.includes('Unauthorized') || l.includes('#'));
    if (line) console.log(`    ${line.trim().slice(0, 180)}`);
    return;
  }

  console.log('  ACCEPTED by __check_auth');
  const prepared = rpc.assembleTransaction(withAuth, sim2).build();
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    console.log(`  submit rejected: ${JSON.stringify(sent.errorResult?.result())}`);
    return;
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log(`  SUCCESS ${sent.hash}\n`);
      return;
    }
    console.log(`  failed: ${res.status}\n`);
    return;
  }
}

/** What auth does a propose under a DELEGATED guardian rule actually require? */
async function inspectDelegated(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const op = new Contract(account).call(
    'execute',
    new Address(RECOVERY_POLICY).toScVal(),
    xdr.ScVal.scvSymbol('propose'),
    xdr.ScVal.scvVec([
      new Address(account).toScVal(),
      xdr.ScVal.scvU32(ruleId),
      xdr.ScVal.scvSymbol('add_signer'),
      xdr.ScVal.scvVec(await recoveryArgs()),
    ]),
  );

  const source = keypairAt(OWNER_INDEX);
  const seq = (await server.getAccount(source.publicKey())).sequenceNumber();
  const tx = new TransactionBuilder(new Account(source.publicKey(), seq), {
    fee: '2000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    console.log(`\nrecording sim failed: ${sim.error.split('\n')[0]}\n`);
    return;
  }
  console.log(`\nrecording pass: ${sim.result?.auth?.length ?? 0} auth entr(ies)`);
  for (const e of sim.result?.auth ?? []) {
    const c = e.credentials();
    const who =
      c.switch().name === 'sorobanCredentialsAddress'
        ? Address.fromScAddress(c.address().address()).toString()
        : '(source account)';
    console.log(`  ${c.switch().name} — ${who}`);
  }
  console.log();
}

async function simDelegated(guardianAddress: string): Promise<void> {
  const account = await predictedAccount();
  const target = guardianAddress || account;
  const thresholdPolicy = (await simulateRead(FACTORY, 'get_threshold_policy')) as string;

  const op = new Contract(account).call(
    'add_context_rule',
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CallContract'), new Address(account).toScVal()]),
    xdr.ScVal.scvString('recovery-delegated'),
    xdr.ScVal.scvVoid(),
    xdr.ScVal.scvVec([
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Delegated'), new Address(target).toScVal()]),
    ]),
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: new Address(thresholdPolicy).toScVal(),
        val: xdr.ScVal.scvMap([
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('threshold'), val: xdr.ScVal.scvU32(1) }),
        ]),
      }),
    ]),
  );

  const source = keypairAt(OWNER_INDEX);
  const seq = (await server.getAccount(source.publicKey())).sequenceNumber();
  const tx = new TransactionBuilder(new Account(source.publicKey(), seq), {
    fee: '2000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();

  console.log(`\nsimulating a rule with a Delegated guardian: ${target}`);
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    console.log(`  REJECTED — ${sim.error.split('\n')[0]}\n`);
    return;
  }
  console.log(`  ACCEPTED — ${sim.result?.auth?.length ?? 0} auth entr(ies) required`);
  for (const e of sim.result?.auth ?? []) {
    const c = e.credentials();
    const who =
      c.switch().name === 'sorobanCredentialsAddress'
        ? Address.fromScAddress(c.address().address()).toString()
        : '(source account)';
    console.log(`    authorised by ${who}`);
  }
  console.log('  nothing submitted\n');
}

/**
 * Create a guardian rule carrying BOTH the quorum policy and the recovery
 * policy, in a single `add_context_rule` — the shape the mobile client uses.
 *
 * Soroban allows only one InvokeHostFunction per transaction, so this is the
 * only way to get the rule and its time-lock installed atomically. This proves
 * the contract accepts both policies in one call, and that the recovery
 * policy's `install` finds the quorum policy it requires.
 */
async function addRuleAtomic(guardianAddress: string): Promise<void> {
  const account = await predictedAccount();
  const verifier = await ed25519Verifier();
  const thresholdPolicy = (await simulateRead(FACTORY, 'get_threshold_policy')) as string;

  const signers = guardianAddress
    ? [xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Delegated'), new Address(guardianAddress).toScVal()])]
    : GUARDIAN_INDICES.map((i) =>
        encodeRuntimeSigner({ verifierAddress: verifier, keyDataHex: publicKeyHexAt(i) }),
      );

  const recoveryParams = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('delay_ledgers'), val: xdr.ScVal.scvU32(720) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('quorum_policy'),
      val: new Address(thresholdPolicy).toScVal(),
    }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('target_rule_id'), val: xdr.ScVal.scvU32(0) }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('window_ledgers'),
      val: xdr.ScVal.scvU32(17280),
    }),
  ]);

  // Canonical map ordering, or the host rejects it as Object/InvalidInput.
  const policyEntries = [
    new xdr.ScMapEntry({
      key: new Address(thresholdPolicy).toScVal(),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('threshold'),
          val: xdr.ScVal.scvU32(signers.length),
        }),
      ]),
    }),
    new xdr.ScMapEntry({
      key: new Address(RECOVERY_POLICY).toScVal(),
      val: recoveryParams,
    }),
  ].sort((a, b) => Buffer.compare(a.key().toXDR(), b.key().toXDR()));

  const op = new Contract(account).call(
    'add_context_rule',
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('CallContract'), new Address(account).toScVal()]),
    xdr.ScVal.scvString('recovery-atomic'),
    xdr.ScVal.scvVoid(),
    xdr.ScVal.scvVec(signers),
    xdr.ScVal.scvMap(policyEntries),
  );

  await submitAsAccount(
    op,
    RULE0_INDICES.map(keypairAt),
    0,
    'add_context_rule with quorum + recovery policies in one op',
  );
}

/**
 * Prove that guardians can sign SEPARATELY and have their signatures merged.
 *
 * This is the mechanism the mobile packet flow depends on: the transaction is
 * frozen once (pinning nonce and expiration), each guardian signs that same
 * entry in isolation, and the resulting AuthPayload signer maps are merged into
 * one entry before broadcast. If this works, a quorum never needs the guardians
 * in the same place at the same time.
 */
async function coSign(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const verifier = await ed25519Verifier();
  const source = keypairAt(OWNER_INDEX);

  const op = new Contract(account).call(
    'execute',
    new Address(RECOVERY_POLICY).toScVal(),
    xdr.ScVal.scvSymbol('propose'),
    xdr.ScVal.scvVec([
      new Address(account).toScVal(),
      xdr.ScVal.scvU32(ruleId),
      xdr.ScVal.scvSymbol('add_signer'),
      xdr.ScVal.scvVec(await recoveryArgs()),
    ]),
  );

  const seq = (await server.getAccount(source.publicKey())).sequenceNumber();
  const build = () =>
    new TransactionBuilder(new Account(source.publicKey(), seq), {
      fee: '2000000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(300)
      .build();

  console.log(`\nfreezing a propose on rule ${ruleId}`);
  const sim = await server.simulateTransaction(build());
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);

  // Pin expiration once, as the packet flow does. Every guardian signs this
  // exact entry; re-simulating would mint a new nonce and void earlier work.
  const validUntil = Number(sim.latestLedger ?? 0) + 1000;
  const frozen = sim.result!.auth![0];
  frozen.credentials().address().signatureExpirationLedger(validUntil);
  const frozenXdr = frozen.toXDR();

  // Each guardian signs independently, from their own copy.
  const signed = GUARDIAN_INDICES.map((i) => {
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(frozenXdr);
    signAuthEntry(entry, [keypairAt(i)], ruleId, validUntil, verifier);
    console.log(`  guardian ${i} signed independently`);
    return entry;
  });

  // Merge the signer maps into one entry.
  const merged = xdr.SorobanAuthorizationEntry.fromXDR(signed[0].toXDR());
  const entries = merged.credentials().address().signature().map()!;
  const signersEntry = entries.find((e) => e.key().sym().toString() === 'signers')!;
  const allSigners = signed.flatMap((e) => {
    const m = e.credentials().address().signature().map()!;
    return m.find((x) => x.key().sym().toString() === 'signers')!.val().map()!;
  });
  allSigners.sort((a, b) => Buffer.compare(a.key().toXDR(), b.key().toXDR()));
  signersEntry.val(xdr.ScVal.scvMap(allSigners));
  console.log(`  merged ${allSigners.length} signatures into one entry`);

  const tx = build();
  const inv = (tx.operations[0] as any).func;
  const rebuilt = new TransactionBuilder(new Account(source.publicKey(), seq), {
    fee: '2000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func: inv, auth: [merged] }))
    .setTimeout(300)
    .build();

  const sim2 = await server.simulateTransaction(rebuilt);
  if (rpc.Api.isSimulationError(sim2)) {
    console.log(`  QUORUM REJECTED — ${sim2.error.split('\n')[0]}\n`);
    return;
  }
  console.log('  __check_auth accepted the merged 2-of-2 signatures');

  const prepared = rpc.assembleTransaction(rebuilt, sim2).build();
  prepared.sign(source);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(JSON.stringify(sent.errorResult?.result()));
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await server.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) continue;
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      console.log(`  SUCCESS ${sent.hash}\n`);
      return;
    }
    throw new Error(`failed: ${JSON.stringify(res)}`);
  }
}

/** Where a pending proposal stands, in ledgers and in real time. */
async function pending(ruleId: number): Promise<void> {
  const account = await predictedAccount();
  const p = (await simulateRead(
    RECOVERY_POLICY,
    'get_pending',
    xdr.ScVal.scvU32(ruleId),
    new Address(account).toScVal(),
  )) as any;

  if (!p) {
    console.log(`\nno pending recovery on rule ${ruleId}\n`);
    return;
  }

  const { sequence: now } = await server.getLatestLedger();
  const mins = (n: number) => `${Math.round((n * 5) / 60)} min`;
  console.log(`\npending recovery on rule ${ruleId}`);
  console.log(`  call     : ${p.fn_name}`);
  console.log(`  ready_at : ${p.ready_at}   expires_at: ${p.expires_at}   now: ${now}`);
  if (now < p.ready_at) console.log(`\n  IN VETO WINDOW — ~${mins(p.ready_at - now)} until enforceable.\n`);
  else if (now <= p.expires_at) console.log(`\n  ENFORCEABLE NOW — lapses in ~${mins(p.expires_at - now)}.\n`);
  else console.log('\n  EXPIRED — must be proposed again.\n');
}

async function main() {
  if (NETWORK_PASSPHRASE !== Networks.TESTNET) {
    console.error('refusing to run against a non-testnet passphrase');
    process.exit(1);
  }

  const cmd = process.argv[2];
  if (cmd === 'addresses') await addresses();
  else if (cmd === 'status') await status();
  else if (cmd === 'add-rule') await addRecoveryRule();
  else if (cmd === 'install') await installRecovery(Number(process.argv[3] ?? 1));
  else if (cmd === 'propose') await propose(Number(process.argv[3] ?? 1));
  else if (cmd === 'pending') await pending(Number(process.argv[3] ?? 1));
  else if (cmd === 'cancel') await cancel(Number(process.argv[3] ?? 1));
  else if (cmd === 'finalize') await finalize(Number(process.argv[3] ?? 1));
  else if (cmd === 'probe') await probe(Number(process.argv[3] ?? 1));
  else if (cmd === 'send') await send(process.argv[3] ?? '1');
  else if (cmd === 'fund') await fund(process.argv[3] ?? '100');
  else if (cmd === 'sim-delegated') await simDelegated(process.argv[3] ?? '');
  else if (cmd === 'cosign') await coSign(Number(process.argv[3] ?? 2));
  else if (cmd === 'inspect-delegated') await inspectDelegated(Number(process.argv[3] ?? 5));
  else if (cmd === 'propose-delegated')
    await proposeDelegated(Number(process.argv[3] ?? 5), process.argv[4] ?? '');
  else if (cmd === 'add-rule-atomic') await addRuleAtomic(process.argv[3] ?? '');
  else {
    console.log(`
usage (testnet only):
  bun run scripts/recovery-testbed.ts addresses   derive keys, predict the account
  bun run scripts/recovery-testbed.ts status          read rules and recovery config
  bun run scripts/recovery-testbed.ts add-rule        create the "recovery" rule with the guardians
  bun run scripts/recovery-testbed.ts install [rule]  install the Recovery Policy (default rule 1)
  bun run scripts/recovery-testbed.ts propose [rule]  guardian quorum proposes add_signer
  bun run scripts/recovery-testbed.ts pending [rule]  where the proposal stands
  bun run scripts/recovery-testbed.ts cancel [rule]   the owner's veto
  bun run scripts/recovery-testbed.ts finalize [rule] spend a matured proposal
  bun run scripts/recovery-testbed.ts probe [rule]    negative tests: what guardians must not do
  bun run scripts/recovery-testbed.ts fund [amount]   move XLM into the smart account
  bun run scripts/recovery-testbed.ts send [amount]   plain XLM transfer out of the smart account
`);
    process.exit(1);
  }
}

void main();
