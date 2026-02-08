import { useEffect, useState } from 'react';
import { useAccount, useBalance, useReadContracts } from 'wagmi';
import { type Address, formatUnits } from 'viem';
import { SUPPORTED_TOKENS, ERC20_TRANSFER_ABI, type TokenInfo } from '../lib/tokens';

export interface TokenBalance {
  token: TokenInfo;
  balance: bigint;
  formatted: string;
}

/**
 * Fetches balances for all supported tokens on the current chain.
 * Returns native ETH balance + ERC-20 balances via multicall.
 */
export function useTokenBalances() {
  const { address, chainId } = useAccount();
  const [balances, setBalances] = useState<TokenBalance[]>([]);

  const tokens = chainId ? SUPPORTED_TOKENS[chainId] : undefined;
  const tokenList = tokens ? Object.values(tokens) : [];
  const erc20Tokens = tokenList.filter((t) => t.address !== null);

  // Fetch native ETH balance
  const { data: nativeBalance, isLoading: nativeLoading } = useBalance({
    address,
  });

  // Fetch ERC-20 balances via multicall
  const { data: erc20Balances, isLoading: erc20Loading } = useReadContracts({
    contracts: erc20Tokens.map((token) => ({
      address: token.address as Address,
      abi: ERC20_TRANSFER_ABI,
      functionName: 'balanceOf',
      args: [address as Address],
    })),
    query: {
      enabled: !!address && erc20Tokens.length > 0,
    },
  });

  useEffect(() => {
    if (!tokens || !address) {
      setBalances([]);
      return;
    }

    const result: TokenBalance[] = [];

    // Add native ETH balance
    const nativeToken = tokenList.find((t) => t.address === null);
    if (nativeToken && nativeBalance) {
      result.push({
        token: nativeToken,
        balance: nativeBalance.value,
        formatted: formatUnits(nativeBalance.value, nativeToken.decimals),
      });
    }

    // Add ERC-20 balances
    if (erc20Balances) {
      erc20Tokens.forEach((token, i) => {
        const res = erc20Balances[i];
        if (res && res.status === 'success') {
          const bal = res.result as bigint;
          result.push({
            token,
            balance: bal,
            formatted: formatUnits(bal, token.decimals),
          });
        } else {
          // Token read failed — show zero balance
          result.push({
            token,
            balance: 0n,
            formatted: '0',
          });
        }
      });
    }

    setBalances(result);
  }, [address, chainId, nativeBalance, erc20Balances, tokens]);

  return {
    balances,
    isLoading: nativeLoading || erc20Loading,
  };
}
