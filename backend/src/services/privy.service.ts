import { NotFoundError, PrivyClient, type LinkedAccount, type User } from '@privy-io/node';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

// Match the old @privy-io/server-auth client: 10s timeout, no automatic retries
// (a retried POST /v1/users could race the first attempt).
const PRIVY_TIMEOUT_MS = 10_000;

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient | null {
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
    return null;
  }
  if (!privyClient) {
    privyClient = new PrivyClient({
      appId: PRIVY_APP_ID,
      appSecret: PRIVY_APP_SECRET,
      timeout: PRIVY_TIMEOUT_MS,
      maxRetries: 0,
    });
  }
  return privyClient;
}

type WalletAccount = Extract<LinkedAccount, { type: 'wallet' }>;

function walletAccounts(user: User): WalletAccount[] {
  return user.linked_accounts.filter((account): account is WalletAccount => account.type === 'wallet');
}

/**
 * Equivalent of server-auth's `user.wallet` convenience property: the first linked
 * account of type 'wallet' (embedded or external).
 */
function firstWalletAddress(user: User): string | undefined {
  return walletAccounts(user)[0]?.address;
}

/**
 * server-auth's getUserByEmail returned null on a 404; @privy-io/node throws NotFoundError.
 */
async function getUserByEmail(client: PrivyClient, email: string): Promise<User | null> {
  try {
    return await client.users().getByEmailAddress({ address: email });
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

/**
 * Create an embedded Ethereum wallet for a guest via Privy's create-user API.
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
    const existingUser = await getUserByEmail(client, email);
    if (existingUser) {
      // User already exists — find their embedded wallet
      const embeddedWallet = walletAccounts(existingUser).find(
        (account) => account.wallet_client_type === 'privy',
      );
      if (embeddedWallet?.address) {
        return {
          walletAddress: embeddedWallet.address,
          privyUserId: existingUser.id,
        };
      }

      // User exists but has no embedded wallet — fall back to their first wallet
      const existingAddress = firstWalletAddress(existingUser);
      if (existingAddress) {
        return {
          walletAddress: existingAddress,
          privyUserId: existingUser.id,
        };
      }

      // User exists but has no wallet at all — create one
      const updatedUser = await client.users().pregenerateWallets(existingUser.id, {
        wallets: [{ chain_type: 'ethereum' }],
      });
      const updatedAddress = firstWalletAddress(updatedUser);
      if (updatedAddress) {
        return {
          walletAddress: updatedAddress,
          privyUserId: updatedUser.id,
        };
      }

      console.warn(`Privy user ${existingUser.id} exists but no wallet could be created`);
      return null;
    }

    // No existing user — create (import) a new one with an embedded Ethereum wallet
    const user = await client.users().create({
      linked_accounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      wallets: [{ chain_type: 'ethereum' }],
    });

    const walletAddress = firstWalletAddress(user);
    if (!walletAddress) {
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
