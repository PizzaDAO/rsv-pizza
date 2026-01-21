const rawContractAddress = import.meta.env.VITE_NFT_CONTRACT_ADDRESS as string | undefined;

// Validate contract address format
const isValidContractAddress = (address: string | undefined): address is string => {
  if (!address) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

export const NFT_CONTRACT_ADDRESS = isValidContractAddress(rawContractAddress)
  ? rawContractAddress
  : '';

export const isNFTContractConfigured = (): boolean => {
  return isValidContractAddress(rawContractAddress);
};

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
