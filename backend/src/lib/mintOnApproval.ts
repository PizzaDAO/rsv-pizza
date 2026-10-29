import { prisma } from '../config/database.js';

// buffalo-35201: mint the attendance NFT when the host approves a guest on an
// approval-required event. Calls the same `mint-nft` Supabase edge function the
// client used at RSVP time (the minter key lives only there), then records the
// token on the guest row. Never throws: callers must not fail an approval
// because a mint failed.

export interface MintOnApprovalResult {
  minted: boolean;
  reason?: string;
}

export async function mintNftOnApproval(
  partyId: string,
  guestId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MintOnApprovalResult> {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return { minted: false, reason: 'supabase-not-configured' };
    }

    const [guest, party] = await Promise.all([
      prisma.guest.findFirst({ where: { id: guestId, partyId } }),
      prisma.party.findUnique({ where: { id: partyId } }),
    ]);
    if (!guest || !party) return { minted: false, reason: 'not-found' };
    if (!party.nftEnabled || !party.eventImageUrl) return { minted: false, reason: 'nft-disabled' };
    if (guest.approved !== true) return { minted: false, reason: 'not-approved' };
    if (!guest.ethereumAddress) return { minted: false, reason: 'no-address' };
    if (guest.nftTokenId !== null && guest.nftTokenId !== undefined) {
      return { minted: false, reason: 'already-minted' };
    }

    const res = await fetchImpl(`${supabaseUrl}/functions/v1/mint-nft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        recipient: guest.ethereumAddress,
        partyId,
        guestId,
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
      console.error(`[mintOnApproval] mint failed for guest ${guestId}:`, data.error || res.statusText);
      return { minted: false, reason: 'mint-failed' };
    }

    const tokenId = data.tokenId !== undefined && data.tokenId !== null ? parseInt(data.tokenId, 10) : NaN;
    if (data.txHash && Number.isInteger(tokenId)) {
      await prisma.guest.update({
        where: { id: guestId },
        data: { nftTokenId: tokenId, nftTransactionHash: data.txHash, nftMintedAt: new Date() },
      });
    }
    return { minted: true };
  } catch (err) {
    console.error(`[mintOnApproval] unexpected error for guest ${guestId}:`, err);
    return { minted: false, reason: 'error' };
  }
}
