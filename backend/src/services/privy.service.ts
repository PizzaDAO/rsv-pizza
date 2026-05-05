import { PrivyClient } from '@privy-io/server-auth';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient | null {
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
    return null;
  }
  if (!privyClient) {
    privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
  }
  return privyClient;
}

/**
 * Create an embedded Ethereum wallet for a guest via Privy's importUser API.
 * If the user already exists in Privy (same email), their existing wallet is returned.
 *
 * Returns { walletAddress, privyUserId } on success, or null on failure.
 * This is intentionally non-fatal — callers should catch errors gracefully.
 */
export async function createEmbeddedWalletForGuest(
  email: string,
  name: string,
): Promise<{ walletAddress: string; privyUserId: string } | null> {
  const client = getPrivyClient();
  if (!client) {
    console.warn('Privy not configured (missing PRIVY_APP_ID or PRIVY_APP_SECRET), skipping wallet provisioning');
    return null;
  }

  try {
    // Check if a Privy user already exists for this email
    const existingUser = await client.getUserByEmail(email);
    if (existingUser) {
      // User already exists — find their embedded wallet
      const embeddedWallet = existingUser.linkedAccounts.find(
        (account) => account.type === 'wallet' && 'walletClientType' in account && account.walletClientType === 'privy',
      );
      if (embeddedWallet && 'address' in embeddedWallet) {
        return {
          walletAddress: embeddedWallet.address,
          privyUserId: existingUser.id,
        };
      }

      // User exists but has no embedded wallet — use convenience property
      if (existingUser.wallet?.address) {
        return {
          walletAddress: existingUser.wallet.address,
          privyUserId: existingUser.id,
        };
      }

      // User exists but has no wallet at all — create one
      const updatedUser = await client.createWallets({
        userId: existingUser.id,
        createEthereumWallet: true,
      });
      if (updatedUser.wallet?.address) {
        return {
          walletAddress: updatedUser.wallet.address,
          privyUserId: updatedUser.id,
        };
      }

      console.warn(`Privy user ${existingUser.id} exists but no wallet could be created`);
      return null;
    }

    // No existing user — import a new one with an embedded wallet
    const user = await client.importUser({
      linkedAccounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      createEthereumWallet: true,
    });

    // Find the embedded wallet address from the response
    const walletAddress = user.wallet?.address;
    if (!walletAddress) {
      // Fallback: search linkedAccounts
      const walletAccount = user.linkedAccounts.find(
        (account) => account.type === 'wallet' && 'address' in account,
      );
      if (walletAccount && 'address' in walletAccount) {
        return {
          walletAddress: walletAccount.address,
          privyUserId: user.id,
        };
      }
      console.warn(`Privy importUser succeeded but no wallet address found for ${email}`);
      return null;
    }

    return {
      walletAddress,
      privyUserId: user.id,
    };
  } catch (error) {
    console.error('Failed to provision Privy embedded wallet:', error);
    return null;
  }
}
