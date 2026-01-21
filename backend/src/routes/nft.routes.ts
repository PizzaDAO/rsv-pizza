import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Validation helpers
const isValidEthereumAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

const isValidTransactionHash = (hash: string): boolean => {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
};

// PATCH /api/nft/guest/:guestId - Save NFT data after minting
// Requires email verification to prevent unauthorized updates
router.patch('/guest/:guestId', async (req, res) => {
  try {
    const { guestId } = req.params;
    const { tokenId, transactionHash, email } = req.body;

    // Validate required fields
    if (!tokenId || !transactionHash) {
      return res.status(400).json({ error: 'tokenId and transactionHash are required' });
    }

    if (!email) {
      return res.status(400).json({ error: 'email is required for verification' });
    }

    // Validate tokenId is a positive integer
    const parsedTokenId = typeof tokenId === 'string' ? parseInt(tokenId, 10) : tokenId;
    if (!Number.isInteger(parsedTokenId) || parsedTokenId < 0) {
      return res.status(400).json({ error: 'tokenId must be a non-negative integer' });
    }

    // Validate transaction hash format (0x + 64 hex chars)
    if (!isValidTransactionHash(transactionHash)) {
      return res.status(400).json({ error: 'Invalid transaction hash format' });
    }

    // Fetch guest and verify email matches
    const existingGuest = await prisma.guest.findUnique({
      where: { id: guestId },
      select: { id: true, email: true, nftTokenId: true },
    });

    if (!existingGuest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    // Verify email matches (case-insensitive)
    if (!existingGuest.email || existingGuest.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'Email verification failed' });
    }

    // Prevent overwriting existing NFT data (idempotency check)
    if (existingGuest.nftTokenId !== null) {
      return res.status(409).json({
        error: 'NFT already minted for this guest',
        existingTokenId: existingGuest.nftTokenId
      });
    }

    const guest = await prisma.guest.update({
      where: { id: guestId },
      data: {
        nftTokenId: parsedTokenId,
        nftTransactionHash: transactionHash,
        nftMintedAt: new Date(),
      },
    });

    res.json({ success: true, guest });
  } catch (error) {
    console.error('Failed to save NFT data:', error);
    res.status(500).json({ error: 'Failed to save NFT data' });
  }
});

// GET /api/nft/guest/:guestId - Check if guest has NFT
router.get('/guest/:guestId', async (req, res) => {
  try {
    const { guestId } = req.params;

    const guest = await prisma.guest.findUnique({
      where: { id: guestId },
      select: {
        nftTokenId: true,
        nftTransactionHash: true,
        nftMintedAt: true,
      },
    });

    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    res.json({
      hasNft: !!guest.nftTokenId,
      tokenId: guest.nftTokenId,
      transactionHash: guest.nftTransactionHash,
      mintedAt: guest.nftMintedAt,
    });
  } catch (error) {
    console.error('Failed to get NFT data:', error);
    res.status(500).json({ error: 'Failed to get NFT data' });
  }
});

export default router;
