import { ACTIVE_NETWORK } from './config';

export const TRACKED_TOKENS_STORAGE_KEY = 'latch_tracked_tokens';

export interface TokenConfig {
  code: string;
  /**
   * Classic Stellar G-address issuer. Required when sacContractId is absent.
   * Used to compute the SAC contract ID via Asset(code, issuer).contractId().
   */
  issuer?: string;
  /**
   * Direct SAC C-address. When present, used as-is — no issuer needed.
   * Smart-wallet users can add tokens by SAC contract ID without knowing the issuer.
   */
  sacContractId?: string;
  name: string;
}

/**
 * Curated list of tokens shown on the "Add Token" screen.
 * Issuers are network-aware (testnet vs mainnet) — a function, not a frozen
 * const, so a live network switch (see src/lib/network-switch.ts) is reflected
 * on the next call instead of only after a fresh app launch.
 */
export function getWellKnownTokens(): TokenConfig[] {
  return ACTIVE_NETWORK.network === 'TESTNET'
    ? [
        {
          code: 'USDC',
          issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
          name: 'USD Coin',
        },
        // {
        //   code: 'USDT',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Tether USD',
        // },
        // {
        //   code: 'BTC',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Bitcoin',
        // },
        // {
        //   code: 'ETH',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Ethereum',
        // },
        // {
        //   code: 'SOL',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Solana',
        // },
        // {
        //   code: 'XRP',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'XRP',
        // },
        // {
        //   code: 'ADA',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Cardano',
        // },
        // {
        //   code: 'AVAX',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Avalanche',
        // },
        // {
        //   code: 'DOGE',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Dogecoin',
        // },
        // {
        //   code: 'DOT',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Polkadot',
        // },
        // {
        //   code: 'MATIC',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Polygon',
        // },
        // {
        //   code: 'SHIB',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Shiba Inu',
        // },
        // {
        //   code: 'LINK',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Chainlink',
        // },
        // {
        //   code: 'LTC',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Litecoin',
        // },
        // {
        //   code: 'UNI',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Uniswap',
        // },
        // {
        //   code: 'ATOM',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Cosmos',
        // },
        // {
        //   code: 'XMR',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Monero',
        // },
        // {
        //   code: 'ETC',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Ethereum Classic',
        // },
        // {
        //   code: 'BCH',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Bitcoin Cash',
        // },
        // {
        //   code: 'ALGO',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Algorand',
        // },
        // {
        //   code: 'QNT',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Quant',
        // },
        // {
        //   code: 'VET',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'VeChain',
        // },
        // {
        //   code: 'FIL',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Filecoin',
        // },
        // {
        //   code: 'APE',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'ApeCoin',
        // },
        // {
        //   code: 'NEAR',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'NEAR Protocol',
        // },
        // {
        //   code: 'HBAR',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Hedera',
        // },
        // {
        //   code: 'ICP',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Internet Computer',
        // },
        // {
        //   code: 'MANA',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Decentraland',
        // },
        // {
        //   code: 'SAND',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'The Sandbox',
        // },
        // {
        //   code: 'THETA',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Theta Network',
        // },
        // {
        //   code: 'AAVE',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Aave',
        // },
        // {
        //   code: 'EOS',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'EOS',
        // },
        // {
        //   code: 'XTZ',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Tezos',
        // },
        // {
        //   code: 'AXS',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Axie Infinity',
        // },
        // {
        //   code: 'FLOW',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Flow',
        // },
        // {
        //   code: 'CHZ',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Chiliz',
        // },
        // {
        //   code: 'ENJ',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Enjin Coin',
        // },
        // {
        //   code: 'KCS',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'KuCoin Token',
        // },
        // {
        //   code: 'CRV',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Curve DAO Token',
        // },
        // {
        //   code: 'MKR',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Maker',
        // },
        // {
        //   code: 'ZEC',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Zcash',
        // },
        // {
        //   code: 'DASH',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Dash',
        // },
        // {
        //   code: 'GALA',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Gala',
        // },
        // {
        //   code: 'COMP',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Compound',
        // },
        // {
        //   code: 'HT',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Huobi Token',
        // },
        // {
        //   code: 'SNX',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Synthetix',
        // },
        // {
        //   code: 'NEXO',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Nexo',
        // },
        // {
        //   code: 'BAT',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'Basic Attention Token',
        // },
        // {
        //   code: 'RUNE',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'THORChain',
        // },
        // {
        //   code: 'YFI',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'yearn.finance',
        // },
        // {
        //   code: '1INCH',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: '1inch Network',
        // },
        // {
        //   code: 'SUSHI',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'SushiSwap',
        // },
        // {
        //   code: 'EURC',
        //   issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        //   name: 'EURC',
        // },
      ]
    : [
        {
          code: 'USDC',
          issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          name: 'USD Coin',
        },
        {
          code: 'EURC',
          issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2',
          name: 'EURC',
        },
      ];
}
