/**
 * recovery-lifecycle.ts — inspect and exercise the Recovery Policy on testnet.
 *
 * Social recovery has no client implementation yet. This exists to answer the
 * questions a product decision depends on, before any UI is built:
 *
 *   - how long is the veto window, in real time rather than ledgers?
 *   - what does a pending recovery actually look like on chain?
 *   - does cancel work, and who can call it?
 *
 * Run it against a THROWAWAY testnet account. It is read-only unless you pass
 * a subcommand that writes, and it will refuse to touch mainnet.
 *
 *   bun run scripts/recovery-lifecycle.ts inspect <accountC...>
 *   bun run scripts/recovery-lifecycle.ts pending <accountC...> <ruleId>
 *
 * Deliberately NOT implemented here: installing the Admin Guard. Installing it
 * on an account without an "admin" context rule permanently destroys that
 * account's administrability, and a script is the wrong place for an
 * irreversible operation that needs a human looking at it.
 */

import { Address, contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

const RECOVERY_POLICY =
  process.env.EXPO_PUBLIC_RECOVERY_POLICY ??
  'CAOCYSLYOURJIQY2IC4AUI6FVYZEUH2G6MFHXRZHIMVVGDDD74F7AFQO';

/** Ledgers close about every 5 seconds on Stellar. */
const SECONDS_PER_LEDGER = 5;

function humanDuration(ledgers: number): string {
  const seconds = ledgers * SECONDS_PER_LEDGER;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

async function policyClient() {
  return contract.Client.from({
    contractId: RECOVERY_POLICY,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
}

async function accountClient(accountAddress: string) {
  return contract.Client.from({
    contractId: accountAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
  });
}

/** Print every context rule on the account, and which policies each carries. */
async function inspect(accountAddress: string): Promise<void> {
  const account = await accountClient(accountAddress);

  // contract.Client decodes return values through the contract's own spec, so
  // `.result` is already a native value — no scValToNative needed.
  const countTx = await (account as any).get_context_rules_count();
  const count = Number(countTx.result);
  console.log(`\ncontext rules on ${accountAddress}: ${count}\n`);

  for (let id = 0; id < count; id++) {
    try {
      const tx = await (account as any).get_context_rule({ context_rule_id: id });
      const rule = tx.result as any;
      console.log(`  [${id}] ${rule.name}`);
      console.log(`       type      : ${JSON.stringify(rule.context_type)}`);
      console.log(`       signers   : ${rule.signers?.length ?? 0}`);
      console.log(`       policies  : ${JSON.stringify(rule.policies ?? [])}`);
      console.log(`       valid_until: ${rule.valid_until ?? 'none'}`);
    } catch (e) {
      console.log(`  [${id}] could not read: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  // The recovery configuration is held by the policy, keyed by account + rule.
  console.log('\nrecovery configuration, per rule:');
  const policy = await policyClient();
  for (let id = 0; id < count; id++) {
    try {
      const tx = await (policy as any).get_recovery_data({
        context_rule_id: id,
        smart_account: accountAddress,
      });
      const data = tx.result as any;
      if (!data) continue;
      console.log(`  [${id}] target rule ${data.target_rule_id}`);
      console.log(
        `       delay  : ${data.delay_ledgers} ledgers (~${humanDuration(data.delay_ledgers)}) ` +
          `— the owner's window to cancel`,
      );
      console.log(
        `       window : ${data.window_ledgers} ledgers (~${humanDuration(data.window_ledgers)}) ` +
          `— how long it stays enforceable once ready`,
      );
    } catch {
      // No recovery policy installed on this rule. Expected for most.
    }
  }
  console.log();
}

/** Show any pending recovery on a rule, and how far through the delay it is. */
async function pending(accountAddress: string, ruleId: number): Promise<void> {
  const policy = await policyClient();
  const server = new (await import('@stellar/stellar-sdk')).rpc.Server(RPC_URL);
  const { sequence: currentLedger } = await server.getLatestLedger();

  const tx = await (policy as any).get_pending({
    context_rule_id: ruleId,
    smart_account: accountAddress,
  });
  const p = tx.result as any;

  if (!p) {
    console.log(`\nno pending recovery on rule ${ruleId}\n`);
    return;
  }

  console.log(`\npending recovery on rule ${ruleId}`);
  console.log(`  proposes : ${p.fn_name}(${JSON.stringify(p.args)})`);
  console.log(`  ready_at : ledger ${p.ready_at}`);
  console.log(`  expires  : ledger ${p.expires_at}`);
  console.log(`  now      : ledger ${currentLedger}`);

  if (currentLedger < p.ready_at) {
    const left = p.ready_at - currentLedger;
    console.log(`\n  IN VETO WINDOW — ~${humanDuration(left)} left to cancel.`);
  } else if (currentLedger <= p.expires_at) {
    const left = p.expires_at - currentLedger;
    console.log(`\n  ENFORCEABLE NOW — lapses in ~${humanDuration(left)}.`);
  } else {
    console.log('\n  EXPIRED — the window closed; it must be proposed again.');
  }
  console.log();
}

async function main() {
  const [cmd, account, ruleId] = process.argv.slice(2);

  if (!cmd || !account) {
    console.log(`
usage:
  bun run scripts/recovery-lifecycle.ts inspect <accountC...>
  bun run scripts/recovery-lifecycle.ts pending <accountC...> <ruleId>

Testnet only. Use a throwaway account.
`);
    process.exit(1);
  }

  if (!account.startsWith('C')) {
    console.error('expected a smart account contract address (C...)');
    process.exit(1);
  }

  if (cmd === 'inspect') await inspect(account);
  else if (cmd === 'pending') await pending(account, Number(ruleId ?? 0));
  else {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }
}

void main();

// Referenced so the imports stay meaningful to a reader extending this into
// the write path (propose / cancel need these).
export { Address, nativeToScVal, xdr };
