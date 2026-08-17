/**
 * recovery-diagnose.ts — read-only diagnosis of a failing recovery cancel.
 *
 * Signs nothing and submits nothing. It reproduces the *reads* and the
 * *simulation* that src/services/social-recovery.ts#cancelRecovery performs, so
 * an `Error(Auth, InvalidAction)` on a device can be attributed to something
 * visible on chain instead of guessed at.
 *
 *   bun run scripts/recovery-diagnose.ts <smart-account C…> [owner G…]
 *
 * Pass the owner's G-address (the device key that signs) to have it checked
 * against the signers on every rule — that is the check that says whether the
 * key is even allowed to authorise under the rule the app names.
 *
 * Delete it once the bug is understood; it is a debugging aid, not a feature.
 */

import {
  Account,
  Address,
  Contract,
  Networks,
  rpc,
  scValToNative,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.EXPO_PUBLIC_SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.EXPO_PUBLIC_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const FACTORY = process.env.EXPO_PUBLIC_FACTORY_ADDRESS ?? '';
const RECOVERY_POLICY = process.env.EXPO_PUBLIC_RECOVERY_POLICY ?? '';

const server = new rpc.Server(RPC_URL);

/** A simulation is never signed, so any valid address works as the source. */
const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function buildTx(op: xdr.Operation) {
  return new TransactionBuilder(new Account(SIM_SOURCE, '0'), {
    fee: '2000000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(60)
    .build();
}

async function simulateRead(contractId: string, fn: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const sim = await server.simulateTransaction(buildTx(new Contract(contractId).call(fn, ...args)));
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${fn}: ${sim.error.split('\n')[0]}`);
  if (!sim.result?.retval) return null;
  return scValToNative(sim.result.retval);
}

/** NextId — the id space to scan. get_context_rules_count() undercounts after a removal. */
async function ruleIdBound(account: string): Promise<number> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(account).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const res = await server.getLedgerEntries(key);
  if (!res.entries.length) throw new Error(`${account} is not deployed on this network`);

  const storage = (res.entries[0].val as xdr.LedgerEntryData)
    .contractData()
    .val()
    .instance()
    .storage() ?? [];
  for (const pair of storage) {
    const k = scValToNative(pair.key());
    if ((Array.isArray(k) && k[0] === 'NextId') || k === 'NextId') return Number(scValToNative(pair.val()));
  }
  return Number(await simulateRead(account, 'get_context_rules_count'));
}

function describeSigner(s: any): string {
  if (!Array.isArray(s)) return JSON.stringify(s);
  if (s[0] === 'Delegated') return `Delegated(${s[1]})`;
  if (s[0] === 'External') {
    const key = Buffer.from(s[2] as Uint8Array);
    const kind =
      key.length === 32
        ? `ed25519 ${StrKey.encodeEd25519PublicKey(key)}`
        : `webauthn ${key.toString('hex').slice(0, 24)}… (${key.length} bytes)`;
    return `External(verifier=${s[1]}, ${kind})`;
  }
  return JSON.stringify(s);
}

/** Raw key_data hex for an External signer, for comparison against the device key. */
function signerKeyHex(s: any): string | null {
  if (Array.isArray(s) && s[0] === 'External') return Buffer.from(s[2] as Uint8Array).toString('hex');
  return null;
}

function describeContextType(t: any): string {
  if (Array.isArray(t)) return t.length > 1 ? `${t[0]}(${t[1]})` : String(t[0]);
  return JSON.stringify(t);
}

async function main(): Promise<void> {
  const account = process.argv[2];
  const ownerG = process.argv[3];
  if (!account || !StrKey.isValidContract(account)) {
    console.error('usage: bun run scripts/recovery-diagnose.ts <smart-account C…> [owner G…]');
    process.exit(1);
  }
  if (!RECOVERY_POLICY) {
    console.error('EXPO_PUBLIC_RECOVERY_POLICY is not set — load the repo .env');
    process.exit(1);
  }

  console.log(`\nrpc      : ${RPC_URL}`);
  console.log(`factory  : ${FACTORY}`);
  console.log(`policy   : ${RECOVERY_POLICY}`);
  console.log(`account  : ${account}`);
  if (ownerG) console.log(`owner key: ${ownerG}`);

  const ownerKeyHex = ownerG ? Buffer.from(StrKey.decodeEd25519PublicKey(ownerG)).toString('hex') : null;

  // ─── rules ──────────────────────────────────────────────────────────────────
  const bound = await ruleIdBound(account);
  console.log(`\ncontext rules (scanning ids 0..${bound - 1}):`);

  let defaultRuleId: number | null = null;
  const ownerOn: number[] = [];

  for (let id = 0; id < bound; id++) {
    let rule: any;
    try {
      rule = await simulateRead(account, 'get_context_rule', xdr.ScVal.scvU32(id));
    } catch {
      console.log(`  [${id}] — no such rule (removed)`);
      continue;
    }
    if (!rule) continue;

    const type = describeContextType(rule.context_type);
    if (type === 'Default' && defaultRuleId === null) defaultRuleId = id;

    console.log(`\n  [${id}] name="${rule.name}"  type=${type}`);
    console.log(`       valid_until: ${rule.valid_until ?? 'none'}`);
    console.log(`       policies   : ${JSON.stringify(rule.policies ?? [])}`);
    for (const s of rule.signers ?? []) {
      const hex = signerKeyHex(s);
      const isOwner = ownerKeyHex && hex && hex.toLowerCase() === ownerKeyHex.toLowerCase();
      if (isOwner) ownerOn.push(id);
      console.log(`       signer     : ${describeSigner(s)}${isOwner ? '   <-- the owner key' : ''}`);
    }

    // Recovery configuration and any live proposal, per rule.
    try {
      const data: any = await simulateRead(
        RECOVERY_POLICY,
        'get_recovery_data',
        xdr.ScVal.scvU32(id),
        new Address(account).toScVal(),
      );
      if (data) {
        console.log(
          `       recovery   : delay=${data.delay_ledgers} window=${data.window_ledgers} target_rule=${data.target_rule_id}`,
        );
      }
    } catch {
      /* no recovery policy on this rule */
    }
    try {
      const p: any = await simulateRead(
        RECOVERY_POLICY,
        'get_pending',
        xdr.ScVal.scvU32(id),
        new Address(account).toScVal(),
      );
      if (p) {
        const { sequence } = await server.getLatestLedger();
        console.log(
          `       PENDING    : ${p.fn_name}  ready_at=${p.ready_at} expires_at=${p.expires_at} now=${sequence}`,
        );
      }
    } catch {
      /* none */
    }
  }

  console.log(`\ndefault rule id: ${defaultRuleId ?? 'NONE FOUND'}`);
  if (ownerKeyHex) {
    console.log(`owner key appears on rule(s): ${ownerOn.length ? ownerOn.join(', ') : 'NONE'}`);
  }

  // ─── what the app signs, and what the chain asks for ────────────────────────
  //
  // cancelRecovery builds exactly this op and signs the resulting auth entries
  // under context rule 0. If the recorded entry needs more than one context, or
  // is addressed to somebody else, the app's single signature cannot satisfy it.
  const ruleIds = [...Array(bound).keys()];
  for (const ruleId of ruleIds) {
    let hasPending = false;
    try {
      hasPending = Boolean(
        await simulateRead(
          RECOVERY_POLICY,
          'get_pending',
          xdr.ScVal.scvU32(ruleId),
          new Address(account).toScVal(),
        ),
      );
    } catch {
      /* none */
    }
    if (!hasPending) continue;

    console.log(`\nsimulating cancel(${account}, ${ruleId}) — recording mode, nothing submitted`);
    const op = new Contract(RECOVERY_POLICY).call(
      'cancel',
      new Address(account).toScVal(),
      xdr.ScVal.scvU32(ruleId),
    );
    const sim = await server.simulateTransaction(buildTx(op));
    if (rpc.Api.isSimulationError(sim)) {
      console.log(`  SIMULATION FAILED — ${sim.error.split('\n').slice(0, 4).join('\n  ')}`);
      continue;
    }

    const auth = sim.result?.auth ?? [];
    console.log(`  auth entries required: ${auth.length}`);
    for (const entry of auth) {
      const creds = entry.credentials();
      const who =
        creds.switch().name === 'sorobanCredentialsAddress'
          ? Address.fromScAddress(creds.address().address()).toString()
          : '(transaction source account)';
      const root = entry.rootInvocation();
      const fn = root.function();
      const target =
        fn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn'
          ? `${Address.fromScAddress(fn.contractFn().contractAddress()).toString()}.${fn
              .contractFn()
              .functionName()
              .toString()}`
          : fn.switch().name;
      let contexts = 1;
      const walk = (i: xdr.SorobanAuthorizedInvocation) => {
        for (const sub of i.subInvocations()) {
          contexts += 1;
          walk(sub);
        }
      };
      walk(root);
      console.log(`    authorised by ${who}`);
      console.log(`      root       : ${target}`);
      console.log(`      contexts   : ${contexts}  (context_rule_ids must have this many entries)`);
      console.log(`      matches the account address the app signs for: ${who === account}`);
    }
  }
  console.log();
}

void main().catch((e) => {
  console.error(`\nfailed: ${(e as Error).message}\n`);
  process.exit(1);
});
