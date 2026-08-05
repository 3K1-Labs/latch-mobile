/**
 * account-network.ts — which network a smart account actually lives on.
 *
 * A WalletAccount's smartAccountAddress carries no network of its own, while
 * ACTIVE_NETWORK is switchable at runtime — so an account deployed on one
 * network stays selectable while the app is pointed at the other, where its
 * contract does not exist. Accounts deployed from here on record `network` at
 * deploy time; ones persisted before that are resolved by probing the chain.
 */

import { Address, xdr } from '@stellar/stellar-sdk';

import { ledgerKeyToBase64, sorobanCall } from '@/src/api/smart-account';
import { MAINNET_NETWORK, TESTNET_NETWORK, getNetworkId } from '@/src/constants/config';

export type NetworkId = 'testnet' | 'mainnet';

/** Whether the contract's instance entry exists in the given network's ledger. */
async function isDeployedOn(network: NetworkId, address: string): Promise<boolean> {
  const rpcUrl = (network === 'testnet' ? TESTNET_NETWORK : MAINNET_NETWORK).sorobanRpcUrl;
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const raw = await sorobanCall(rpcUrl, 'getLedgerEntries', { keys: [ledgerKeyToBase64(key)] });
  return Boolean(raw?.entries?.length);
}

/**
 * The network `address` is deployed on, or null when that can't be established
 * — either it's on neither, or the probes failed. Null means "don't know" and
 * never "not deployed": an RPC blip has to leave callers doing exactly what
 * they did before this check existed.
 *
 * The active network is probed first, so the ordinary case costs one RPC call.
 */
export async function findDeployedNetwork(address: string): Promise<NetworkId | null> {
  const active = getNetworkId();
  const order: NetworkId[] = active === 'testnet' ? ['testnet', 'mainnet'] : ['mainnet', 'testnet'];
  for (const network of order) {
    try {
      if (await isDeployedOn(network, address)) return network;
    } catch {
      // Probe failed (RPC down, device offline) — try the other, then give up.
    }
  }
  return null;
}
