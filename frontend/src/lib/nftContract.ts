export type NFTChain = 'base' | 'monad';

export const CHAIN_CONFIG: Record<NFTChain, {
  chainId: number;
  name: string;
  contractAddress: string;
  explorerUrl: string;
  openSeaBase?: string;
}> = {
  base: {
    chainId: 8453,
    name: 'Base',
    contractAddress: '0x2344044DfE7685041B2e5E0Aa6DB5277CEA0f76b',
    explorerUrl: 'https://basescan.org',
    openSeaBase: 'https://opensea.io/assets/base',
  },
  monad: {
    chainId: 143,
    name: 'Monad',
    contractAddress: '', // TBD after contract deployment
    explorerUrl: 'https://explorer.monad.xyz',
  },
};

export function getChainConfig(chain: NFTChain) {
  return CHAIN_CONFIG[chain];
}

export function getNFTViewUrl(chain: NFTChain, tokenId: string): string {
  const config = CHAIN_CONFIG[chain];
  if (config.openSeaBase && config.contractAddress) {
    return `${config.openSeaBase}/${config.contractAddress}/${tokenId}`;
  }
  if (config.contractAddress) {
    return `${config.explorerUrl}/token/${config.contractAddress}?a=${tokenId}`;
  }
  return config.explorerUrl;
}

// Keep backward-compatible exports
const DEFAULT_CONTRACT_ADDRESS = '0x2344044DfE7685041B2e5E0Aa6DB5277CEA0f76b';
const rawContractAddress = import.meta.env.VITE_NFT_CONTRACT_ADDRESS as string | undefined;
const isValidContractAddress = (address: string | undefined): address is string => {
  if (!address) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};
export const NFT_CONTRACT_ADDRESS = isValidContractAddress(rawContractAddress)
  ? rawContractAddress
  : DEFAULT_CONTRACT_ADDRESS;

export const NFT_ABI = [
  {
    inputs: [{ name: 'to', type: 'address' }, { name: 'uri', type: 'string' }],
    name: 'mintOrUpdate',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'hasToken',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'tokenOfOwner',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
