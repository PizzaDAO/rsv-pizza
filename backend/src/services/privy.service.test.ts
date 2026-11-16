import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * privy.service maps guest RSVPs to Privy embedded wallets. The SDK (@privy-io/node)
 * is mocked; these tests pin the call paths that used to go through
 * @privy-io/server-auth (getUserByEmail / createWallets / importUser).
 */
const sdk = vi.hoisted(() => {
  class NotFoundError extends Error {
    status = 404;
  }
  const users = {
    getByEmailAddress: vi.fn(),
    pregenerateWallets: vi.fn(),
    create: vi.fn(),
  };
  const ctor = vi.fn();
  class PrivyClient {
    constructor(opts: unknown) {
      ctor(opts);
    }
    users() {
      return users;
    }
  }
  return { NotFoundError, PrivyClient, users, ctor };
});

vi.mock('@privy-io/node', () => ({ PrivyClient: sdk.PrivyClient, NotFoundError: sdk.NotFoundError }));

const embedded = (address: string) => ({
  type: 'wallet',
  address,
  chain_type: 'ethereum',
  wallet_client: 'privy',
  wallet_client_type: 'privy',
  connector_type: 'embedded',
});
const external = (address: string) => ({
  type: 'wallet',
  address,
  chain_type: 'ethereum',
  wallet_client: 'unknown',
  wallet_client_type: 'metamask',
  connector_type: 'injected',
});
const emailAcct = (address: string) => ({ type: 'email', address });
const user = (id: string, linked_accounts: unknown[]) => ({ id, linked_accounts });

async function load(env: { id?: string; secret?: string } = { id: 'app-id', secret: 'app-secret' }) {
  vi.resetModules();
  if (env.id === undefined) delete process.env.PRIVY_APP_ID;
  else process.env.PRIVY_APP_ID = env.id;
  if (env.secret === undefined) delete process.env.PRIVY_APP_SECRET;
  else process.env.PRIVY_APP_SECRET = env.secret;
  return import('./privy.service.js');
}

const ORIG_ID = process.env.PRIVY_APP_ID;
const ORIG_SECRET = process.env.PRIVY_APP_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ORIG_ID === undefined) delete process.env.PRIVY_APP_ID;
  else process.env.PRIVY_APP_ID = ORIG_ID;
  if (ORIG_SECRET === undefined) delete process.env.PRIVY_APP_SECRET;
  else process.env.PRIVY_APP_SECRET = ORIG_SECRET;
});

describe('createEmbeddedWalletForGuest', () => {
  it('returns null and never builds a client when Privy env is missing', async () => {
    const { createEmbeddedWalletForGuest } = await load({ id: 'app-id' });
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toBeNull();
    expect(sdk.ctor).not.toHaveBeenCalled();
    expect(sdk.users.getByEmailAddress).not.toHaveBeenCalled();
  });

  it('builds the client from PRIVY_APP_ID / PRIVY_APP_SECRET once (10s timeout, no retries)', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockResolvedValue(user('did:privy:1', [embedded('0xE')]));
    await createEmbeddedWalletForGuest('a@b.com', 'A');
    await createEmbeddedWalletForGuest('a@b.com', 'A');
    expect(sdk.ctor).toHaveBeenCalledTimes(1);
    expect(sdk.ctor).toHaveBeenCalledWith({ appId: 'app-id', appSecret: 'app-secret', timeout: 10_000, maxRetries: 0 });
    expect(sdk.users.getByEmailAddress).toHaveBeenCalledWith({ address: 'a@b.com' });
  });

  it('existing user: prefers the Privy embedded wallet over an earlier external wallet', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockResolvedValue(
      user('did:privy:1', [emailAcct('a@b.com'), external('0xEXT'), embedded('0xEMB')]),
    );
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toEqual({
      walletAddress: '0xEMB',
      privyUserId: 'did:privy:1',
    });
    expect(sdk.users.pregenerateWallets).not.toHaveBeenCalled();
    expect(sdk.users.create).not.toHaveBeenCalled();
  });

  it('existing user with only an external wallet: returns that wallet (old user.wallet fallback)', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockResolvedValue(user('did:privy:2', [emailAcct('a@b.com'), external('0xEXT')]));
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toEqual({
      walletAddress: '0xEXT',
      privyUserId: 'did:privy:2',
    });
    expect(sdk.users.pregenerateWallets).not.toHaveBeenCalled();
  });

  it('existing user with no wallet: pregenerates an Ethereum wallet', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockResolvedValue(user('did:privy:3', [emailAcct('a@b.com')]));
    sdk.users.pregenerateWallets.mockResolvedValue(user('did:privy:3', [emailAcct('a@b.com'), embedded('0xNEW')]));
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toEqual({
      walletAddress: '0xNEW',
      privyUserId: 'did:privy:3',
    });
    expect(sdk.users.pregenerateWallets).toHaveBeenCalledWith('did:privy:3', {
      wallets: [{ chain_type: 'ethereum' }],
    });
    expect(sdk.users.create).not.toHaveBeenCalled();
  });

  it('existing user with no wallet, pregenerate returns none: null', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockResolvedValue(user('did:privy:4', [emailAcct('a@b.com')]));
    sdk.users.pregenerateWallets.mockResolvedValue(user('did:privy:4', [emailAcct('a@b.com')]));
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toBeNull();
  });

  it('new user (404 -> NotFoundError): creates the user with email + Ethereum wallet', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockRejectedValue(new sdk.NotFoundError('not found'));
    sdk.users.create.mockResolvedValue(user('did:privy:5', [emailAcct('new@b.com'), embedded('0xFRESH')]));
    expect(await createEmbeddedWalletForGuest('new@b.com', 'New')).toEqual({
      walletAddress: '0xFRESH',
      privyUserId: 'did:privy:5',
    });
    expect(sdk.users.create).toHaveBeenCalledWith({
      linked_accounts: [{ type: 'email', address: 'new@b.com' }],
      wallets: [{ chain_type: 'ethereum' }],
    });
    expect(sdk.users.pregenerateWallets).not.toHaveBeenCalled();
  });

  it('new user created without a wallet in the response: null', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockRejectedValue(new sdk.NotFoundError('not found'));
    sdk.users.create.mockResolvedValue(user('did:privy:6', [emailAcct('new@b.com')]));
    expect(await createEmbeddedWalletForGuest('new@b.com', 'New')).toBeNull();
  });

  it('non-404 lookup errors are swallowed (null) and do not fall through to create', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toBeNull();
    expect(sdk.users.create).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('create errors are swallowed (null)', async () => {
    const { createEmbeddedWalletForGuest } = await load();
    sdk.users.getByEmailAddress.mockRejectedValue(new sdk.NotFoundError('not found'));
    sdk.users.create.mockRejectedValue(new Error('boom'));
    expect(await createEmbeddedWalletForGuest('a@b.com', 'A')).toBeNull();
  });
});
