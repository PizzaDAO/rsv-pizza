// Shared call to the `mint-nft` Supabase edge function (the minter key lives only there).
// Used by mintOnApproval (host approves a guest) and nftClaim (post-event direct mint / claim).
// Never throws: a network or parse failure comes back as { ok: false }.

export interface MintEdgeParty {
  id: string;
  name: string;
  date: Date | null;
  venueName: string | null;
  address: string | null;
  eventImageUrl: string | null;
  customUrl: string | null;
  inviteCode: string;
  nftChain: string | null;
}

export interface MintEdgeResult {
  ok: boolean;
  /** HTTP status from the edge function (0 when it was unreachable or not configured). */
  status: number;
  txHash?: string;
  tokenId?: number;
  /** The wallet already held this event's token; no new mint happened. */
  alreadyMinted?: boolean;
  error?: string;
}

/** The edge function checks the recipient against guests.ethereum_address, so write that first. */
export async function callMintEdge(
  party: MintEdgeParty,
  guest: { id: string; name: string },
  recipient: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MintEdgeResult> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { ok: false, status: 0, error: 'supabase-not-configured' };

  try {
    const res = await fetchImpl(`${supabaseUrl}/functions/v1/mint-nft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        recipient,
        partyId: party.id,
        guestId: guest.id,
        guestName: guest.name,
        partyName: party.name,
        partyDate: party.date ? party.date.toISOString().split('T')[0] : null,
        partyVenue: party.venueName || null,
        partyAddress: party.address || null,
        imageUrl: party.eventImageUrl,
        inviteCode: party.customUrl || party.inviteCode,
        chain: party.nftChain || 'base',
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(data.error || res.statusText || 'mint-failed') };
    }
    const tokenId = data.tokenId !== undefined && data.tokenId !== null ? parseInt(data.tokenId, 10) : NaN;
    return {
      ok: true,
      status: res.status,
      txHash: typeof data.txHash === 'string' ? data.txHash : undefined,
      tokenId: Number.isInteger(tokenId) ? tokenId : undefined,
      alreadyMinted: data.alreadyMinted === true,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'mint-error' };
  }
}
