import { type Address } from 'viem';

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  /** null = native token (ETH) */
  address: Address | null;
  logoColor: string;
}

export type ChainTokens = Record<string, TokenInfo>;

/**
 * Supported tokens per chain.
 * Addresses sourced from official token lists.
 */
export const SUPPORTED_TOKENS: Record<number, ChainTokens> = {
  // Ethereum Mainnet
  1: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      address: null,
      logoColor: '#627eea',
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      logoColor: '#2775ca',
    },
    USDT: {
      symbol: 'USDT',
      name: 'Tether',
      decimals: 6,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      logoColor: '#26a17b',
    },
    DAI: {
      symbol: 'DAI',
      name: 'Dai',
      decimals: 18,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      logoColor: '#f5ac37',
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      logoColor: '#627eea',
    },
  },
  // Base
  8453: {
    ETH: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      address: null,
      logoColor: '#627eea',
    },
    USDC: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      logoColor: '#2775ca',
    },
    DAI: {
      symbol: 'DAI',
      name: 'Dai',
      decimals: 18,
      address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      logoColor: '#f5ac37',
    },
    WETH: {
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      address: '0x4200000000000000000000000000000000000006',
      logoColor: '#627eea',
    },
  },
};

/** Get the block explorer URL for a given chain */
export function getExplorerUrl(chainId: number): string {
  switch (chainId) {
    case 8453:
      return 'https://basescan.org';
    default:
      return 'https://etherscan.io';
  }
}

/** Get the block explorer tx URL */
export function getExplorerTxUrl(chainId: number, txHash: string): string {
  return `${getExplorerUrl(chainId)}/tx/${txHash}`;
}

/** Get chain display name */
export function getChainName(chainId: number): string {
  switch (chainId) {
    case 1:
      return 'Ethereum';
    case 8453:
      return 'Base';
    default:
      return `Chain ${chainId}`;
  }
}

/** ERC-20 transfer ABI (just the transfer function) */
export const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
