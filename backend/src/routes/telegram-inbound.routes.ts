/**
 * suppli-58533: host DM submissions to Molto Benny.
 *
 *   POST /api/telegram/host-inbound
 *     Called by moltobene when someone REPLIES to the bot in Telegram (sends a
 *     photo/PDF, or types a number). moltobene forwards the inbound DM here; we
 *     resolve the submitter context (host or contributor) for the chatId and
 *     authorize PER SUBMISSION TYPE (suppli-58533):
 *       - image photo →
 *           host        → OCR'd; receipt → payout_documents, else event photo.
 *           contributor → ALWAYS an event photo (pending review); no OCR.
 *       - PDF (receipt) → HOST ONLY. Contributors are rejected.
 *       - text number (attendance) → HOST ONLY. Contributors are rejected.
 *     Contributors are non-host users who tapped a `submit_<token>` group link
 *     (party_telegram_contributors). Rejections are non-destructive + reply
 *     "Only the event host can submit receipts or attendance … Photos welcome".
 *
 *     Auth: header `x-api-key` must equal `TELEGRAM_LINK_CALLBACK_SECRET`
 *       (the exact pattern from telegram-link-callback.routes.ts):
 *         - env unset → 503 { ok:false, reason:'not configured' }
 *         - mismatch  → 401
 *
 *     Body: { chatId, kind:'photo'|'text', fileId?, fileUniqueId?,
 *             imageBase64?, text? }
 *     Returns: { ok, action:'receipt'|'photo'|'attendance'|'ignored',
 *                partyName?, reason? }
 *
 *     Mounted at /api/telegram (same router family as /link-host) in index.ts.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/database.js';
import {
  resolveSubmitterContext,
  downloadTelegramFile,
  type HostInboundParty,
} from '../services/hostInboundResolve.js';
import { sendTelegramMessage } from '../services/telegramSend.js';
import { analyzeReceipt } from '../services/ocr.service.js';
import { convertToUSD } from '../services/fx.service.js';
import { sanitizePgString, sanitizeForPg } from '../lib/sanitizePg.js';
import { rasterizePdfFirstPage } from '../services/pdfRasterize.js';

const router = Router();

// suppli-58533: minimum OCR confidence for a host-DM image to be treated as a
// receipt (rather than an event photo). Combined with amount>0 AND a merchant
// or line items so a blurry guess doesn't get filed as a reimbursement claim.
const RECEIPT_OCR_CONFIDENCE_MIN = 0.4;

const STORAGE_BUCKET = 'event-images';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  _supabase = createClient(url, key);
  return _supabase;
}

/**
 * Upload the downloaded buffer to the payouts folder for this party and return
 * the public URL. Mirrors taxFormStorage.service.ts:50-62 (upload + getPublicUrl
 * against the same `event-images` bucket); path matches the existing payout
 * convention `payouts/{partyId}/{uniqueName}` so the receipt/photo flows that
 * scope URLs to `payouts/{partyId}/` keep working.
 */
async function uploadPayoutBuffer(
  buffer: Buffer,
  partyId: string,
  mimeType: string,
): Promise<{ url: string; path: string }> {
  const supabase = getSupabaseAdmin();
  const ext = (mimeType.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
  const uniqueName = `tg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `payouts/${partyId}/${uniqueName}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
    cacheControl: '3600',
    upsert: false,
    contentType: mimeType,
  });
  if (error) {
    throw new Error(`Telegram inbound upload failed: ${error.message}`);
  }
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Event year for photoYear: event date year ?? null (upload-time fallback handled by NULL). */
function partyEventYear(p: HostInboundParty): number | null {
  return p.date ? p.date.getUTCFullYear() : null;
}

router.post(
  '/host-inbound',
  async (req: Request, res: Response, _next: NextFunction) => {
    try {
      // ---- Auth (exact pattern from telegram-link-callback.routes.ts) ----
      const secret = process.env.TELEGRAM_LINK_CALLBACK_SECRET;
      if (!secret) {
        return res.status(503).json({ ok: false, action: 'ignored', reason: 'not configured' });
      }
      const provided = req.header('x-api-key') || '';
      if (provided !== secret) {
        return res.status(401).json({ ok: false, action: 'ignored', reason: 'unauthorized' });
      }

      const { chatId, kind, fileId, imageBase64, text, mimeType } = (req.body || {}) as {
        chatId?: number | string;
        kind?: string;
        fileId?: string;
        fileUniqueId?: string;
        imageBase64?: string;
        text?: string;
        // suppli-58533: the bot now forwards PDF receipts with kind:'photo' and
        // a mimeType of 'application/pdf'. Optional; we also sniff the downloaded
        // file extension as a belt-and-suspenders PDF check below.
        mimeType?: string;
      };

      // Validate chatId is integer-like before BigInt() (which throws).
      if (chatId === undefined || chatId === null || `${chatId}`.trim() === '') {
        return res.status(400).json({ ok: false, action: 'ignored', reason: 'chatId is required' });
      }
      const chatIdStr = `${chatId}`.trim();
      if (!/^-?\d+$/.test(chatIdStr)) {
        return res.status(400).json({ ok: false, action: 'ignored', reason: 'chatId must be an integer' });
      }
      if (kind !== 'photo' && kind !== 'text') {
        return res.status(400).json({ ok: false, action: 'ignored', reason: "kind must be 'photo' or 'text'" });
      }

      // ---- Resolve the submitter (host or contributor) ----
      // suppli-58533: per-type authorization. The chatId may belong to a
      // VERIFIED host (parties.host_telegram_chat_id) or a photo-only
      // CONTRIBUTOR (party_telegram_contributors). Most recent action wins.
      const ctx = await resolveSubmitterContext(BigInt(chatIdStr));

      if (!ctx) {
        // chatId not linked to any party → reply nothing.
        return res.status(200).json({ ok: true, action: 'ignored', reason: 'no-party' });
      }

      const party = ctx.party;
      const isHost = ctx.role === 'host';
      const hostEmail = party.user?.email ?? null;

      // =====================================================================
      // TEXT → estimated attendance
      // =====================================================================
      if (kind === 'text') {
        // suppli-58533: attendance is HOST-ONLY. Contributors are photo-only.
        if (!isHost) {
          await sendTelegramMessage(
            chatIdStr,
            `Only the event host can submit receipts or attendance for ${party.name}. ` +
              `Photos are welcome though 📸`,
          );
          return res.status(200).json({
            ok: true,
            action: 'ignored',
            partyName: party.name,
            reason: 'host_only',
          });
        }
        const trimmed = typeof text === 'string' ? text.trim() : '';
        // Same validation as party.routes.ts attendance: a bare positive int.
        if (!/^\d+$/.test(trimmed)) {
          const slug = party.customUrl || party.inviteCode;
          await sendTelegramMessage(
            chatIdStr,
            `I can add a receipt photo, an event photo, or a headcount number for ${party.name}. ` +
              `For anything else, head to rsv.pizza/host/${slug}/payments`,
          );
          return res.status(200).json({
            ok: true,
            action: 'ignored',
            partyName: party.name,
            reason: 'non-numeric',
          });
        }
        const n = Number(trimmed);
        if (!Number.isInteger(n) || n < 1) {
          return res.status(200).json({
            ok: true,
            action: 'ignored',
            partyName: party.name,
            reason: 'invalid-number',
          });
        }
        await prisma.party.update({
          where: { id: party.id },
          data: { estimatedAttendance: n },
        });
        await sendTelegramMessage(chatIdStr, `✅ Set headcount for ${party.name} to ${n}.`);
        return res.status(200).json({ ok: true, action: 'attendance', partyName: party.name });
      }

      // =====================================================================
      // PHOTO → receipt or event photo
      // =====================================================================
      if (!fileId && !(typeof imageBase64 === 'string' && imageBase64.length > 0)) {
        return res.status(400).json({
          ok: false,
          action: 'ignored',
          reason: 'fileId or imageBase64 required for kind=photo',
        });
      }

      // suppli-58533: idempotency by fileUniqueId is best-effort only. There is
      // no column on payout_documents / photos to persist a Telegram file marker,
      // so we deliberately SKIP the dedupe here rather than add a migration (this
      // feature ships with no DB changes). Albums arrive as separate calls; a
      // host re-sending the same photo would create a second row — acceptable.

      let downloaded;
      try {
        downloaded = await downloadTelegramFile(fileId || '', imageBase64);
      } catch (err: any) {
        console.error('[suppli-58533][host-inbound] download failed:', err?.message || err);
        await sendTelegramMessage(
          chatIdStr,
          `I couldn't download that image — please try again, or add it at ` +
            `rsv.pizza/host/${party.customUrl || party.inviteCode}/payments`,
        );
        return res.status(200).json({ ok: false, action: 'ignored', reason: 'download-failed' });
      }

      // suppli-58533: PDF receipts. The bot forwards PDFs with kind:'photo' +
      // mimeType 'application/pdf'; also sniff the downloaded extension as a
      // belt-and-suspenders check when mimeType is absent. gpt-4o vision can't
      // read a PDF via image_url, so rasterize page 1 to a PNG and feed THAT
      // into the same receipt path (so it OCRs and renders in the /payments
      // <img> grids). PDFs are ALWAYS filed as receipts, never event photos.
      const claimedPdf =
        typeof mimeType === 'string' && mimeType.trim().toLowerCase() === 'application/pdf';
      const looksLikePdf =
        downloaded.mimeType.toLowerCase() === 'application/pdf' ||
        /\.pdf$/i.test(downloaded.fileName);
      const isPdf = claimedPdf || looksLikePdf;

      // suppli-58533: PDF = receipt → HOST ONLY. Reject a contributor before any
      // rasterize/OCR/upload work (non-destructive; photos are still welcome).
      if (isPdf && !isHost) {
        await sendTelegramMessage(
          chatIdStr,
          `Only the event host can submit receipts or attendance for ${party.name}. ` +
            `Photos are welcome though 📸`,
        );
        return res.status(200).json({
          ok: true,
          action: 'ignored',
          partyName: party.name,
          reason: 'host_only',
        });
      }

      // suppli-58533: CONTRIBUTOR images are ALWAYS event photos — never OCR,
      // never file a receipt. Upload + create a PENDING photo, attributed to the
      // contributor's @handle (no host email). Confirm and return.
      if (!isHost) {
        const { url: contribUrl } = await uploadPayoutBuffer(
          downloaded.buffer,
          party.id,
          downloaded.mimeType,
        );
        await prisma.photo.create({
          data: {
            partyId: party.id,
            url: contribUrl,
            fileName: sanitizePgString(downloaded.fileName),
            fileSize: downloaded.buffer.length,
            mimeType: downloaded.mimeType,
            uploadedBy: null,
            uploaderName: ctx.contributorUsername
              ? sanitizePgString(ctx.contributorUsername)
              : null,
            uploaderEmail: null,
            status: 'pending',
            photoYear: partyEventYear(party),
          },
        });
        await sendTelegramMessage(
          chatIdStr,
          `✅ Thanks! Added your photo to ${party.name}'s gallery (pending review).`,
        );
        return res.status(200).json({ ok: true, action: 'photo', partyName: party.name });
      }

      if (isPdf) {
        let raster: Awaited<ReturnType<typeof rasterizePdfFirstPage>>;
        try {
          raster = await rasterizePdfFirstPage(downloaded.buffer);
        } catch (err: any) {
          console.error('[suppli-58533][host-inbound] PDF rasterize failed:', err?.message || err);
          await sendTelegramMessage(
            chatIdStr,
            "I couldn't read that PDF — try sending a photo of the receipt instead.",
          );
          return res.status(200).json({ ok: false, action: 'ignored', reason: 'pdf_rasterize_failed' });
        }
        if (raster.pageCount > 1) {
          console.warn(
            `[suppli-58533] PDF has ${raster.pageCount} pages; only page 1 rasterized`,
          );
        }
        // Swap the image bytes/metadata to the rasterized PNG. Keep the original
        // .pdf base filename for traceability but as a .png so the upload + the
        // /payments <img> grid treat it as an image.
        const pngFileName = downloaded.fileName.replace(/\.pdf$/i, '') + '.png';
        downloaded = {
          buffer: raster.pngBuffer,
          mimeType: 'image/png',
          fileName: pngFileName,
        };
      }

      const { url } = await uploadPayoutBuffer(downloaded.buffer, party.id, downloaded.mimeType);

      // ---- OCR the image to decide receipt vs. event photo ----
      let ocr:
        | Awaited<ReturnType<typeof analyzeReceipt>>
        | null = null;
      try {
        ocr = await analyzeReceipt({ imageUrl: url, partyCountry: party.country });
      } catch (err: any) {
        console.warn('[suppli-58533][host-inbound] OCR failed; treating as photo:', err?.message || err);
        ocr = null;
      }

      const looksLikeReceipt =
        ocr != null &&
        ocr.amount > 0 &&
        ocr.confidence >= RECEIPT_OCR_CONFIDENCE_MIN &&
        (!!ocr.merchant || (Array.isArray(ocr.lineItems) && ocr.lineItems.length > 0));

      // suppli-58533: a PDF is ALWAYS filed as a receipt even when OCR threw or
      // read nothing. Synthesize an empty OCR result so the receipt-persist block
      // below (which dereferences ocr.*) is null-safe; the row stores with no
      // amount/currency (host can fix it on /payments) but the PDF is preserved.
      if (isPdf && ocr == null) {
        ocr = {
          amount: 0,
          currency: null,
          confidence: 0,
          items: undefined,
          lineItems: [],
          merchant: null,
          receiptDate: null,
          boundingHint: null,
          language: null,
          summary: null,
          raw: { receipts: [], note: 'pdf_ocr_failed' },
        };
      }

      // suppli-58533: a PDF is ALWAYS a receipt — file it as one even if OCR
      // confidence is low / no amount was read (store with whatever OCR fields
      // it got). Never route a PDF to the event-photo branch below. For PDFs
      // `ocr` is guaranteed non-null by the synthesize-empty guard above.
      if ((isPdf || looksLikeReceipt) && ocr) {
        // ---- RECEIPT path: mirror payout.routes.ts:731-796 column mapping ----
        const fx = await convertToUSD(ocr.amount, ocr.currency);
        const unresolved = fx.source === 'unresolved' || fx.usdAmount == null;

        // Attach to an existing pending payout for the party if one exists; else null
        // (the receipt is party-scoped via partyId and surfaces in the receipts library).
        const pendingPayout = await prisma.payout.findFirst({
          where: { partyId: party.id, status: 'pending' },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });

        // sortOrder = (max existing doc sortOrder for this party) + 1.
        const maxAgg = await prisma.payoutDocument.aggregate({
          where: { partyId: party.id },
          _max: { sortOrder: true },
        });
        const sortOrder = (maxAgg._max.sortOrder ?? -1) + 1;

        await prisma.payoutDocument.create({
          data: {
            partyId: party.id,
            payoutId: pendingPayout?.id ?? null,
            kind: 'receipt',
            url,
            fileName: sanitizePgString(downloaded.fileName),
            fileSize: downloaded.buffer.length,
            mimeType: downloaded.mimeType,
            ocrAmount: unresolved ? null : new Decimal(fx.usdAmount!),
            ocrCurrency: unresolved
              ? null
              : (fx.originalCurrency ? sanitizePgString(fx.originalCurrency) : fx.originalCurrency),
            ocrConfidence: new Decimal(ocr.confidence),
            originalAmount: new Decimal(fx.originalAmount),
            originalCurrency: unresolved
              ? null
              : (fx.originalCurrency ? sanitizePgString(fx.originalCurrency) : null),
            exchangeRate: unresolved
              ? null
              : (fx.exchangeRate != null ? new Decimal(fx.exchangeRate) : null),
            ocrRaw: sanitizeForPg({
              ocr: ocr.raw,
              fx: { source: fx.source, rate: fx.exchangeRate },
            } as Prisma.InputJsonValue),
            ocrLineItems:
              ocr.lineItems && ocr.lineItems.length > 0
                ? sanitizeForPg(ocr.lineItems as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            ocrError: unresolved ? 'CURRENCY_UNRESOLVED' : null,
            ocrAttemptedAt: new Date(),
            ocrAttemptCount: 1,
            ocrLanguage: ocr.language ? sanitizePgString(ocr.language) : null,
            ocrSummary: ocr.summary ? sanitizePgString(ocr.summary) : null,
            uploadedByEmail: hostEmail,
            sortOrder,
          },
        });

        const receiptCount = await prisma.payoutDocument.count({
          where: { partyId: party.id, kind: 'receipt' },
        });

        // suppli-58533: when no amount was read (e.g. a PDF whose OCR found no
        // total), omit the amount fragment so the confirmation still reads
        // cleanly ("Got your receipt for {party} — that's N receipts on file.").
        const amountLabel = unresolved
          ? (ocr.amount > 0 ? `${ocr.amount.toLocaleString()} ${ocr.currency ?? ''}`.trim() : '')
          : `$${fx.usdAmount!.toFixed(2)}`;
        const amountFragment = amountLabel ? ` — ${amountLabel}` : '';
        await sendTelegramMessage(
          chatIdStr,
          `✅ Got your receipt for ${party.name}${amountFragment}. ` +
            `That's ${receiptCount} receipt${receiptCount === 1 ? '' : 's'} on file.`,
        );
        return res.status(200).json({ ok: true, action: 'receipt', partyName: party.name });
      }

      // ---- EVENT PHOTO path: mirror photo.routes.ts:459-650 (host auto-approve) ----
      // payout_role stays NULL: 'group'/'box_stack'/'pizza' are the only designated
      // roles (partial unique index), and getPayoutSubmissionReadiness counts any
      // non-role photo dated >= party.date as an "additional" event photo. A photo
      // uploaded now only counts toward readiness when now >= the event start.
      const now = new Date();
      await prisma.photo.create({
        data: {
          partyId: party.id,
          url,
          fileName: sanitizePgString(downloaded.fileName),
          fileSize: downloaded.buffer.length,
          mimeType: downloaded.mimeType,
          uploadedBy: null,
          uploaderName: null,
          uploaderEmail: hostEmail ? hostEmail.toLowerCase() : null,
          status: 'approved',
          starred: true,
          starredAt: now,
          reviewedAt: now,
          reviewedBy: party.user?.id ?? null,
          photoYear: partyEventYear(party),
        },
      });

      // Cutoff note: if the upload is before the event start it still stores but
      // won't count toward the host's submission readiness.
      const beforeEventStart = party.date != null && now < party.date;
      const cutoffNote = beforeEventStart
        ? " (note: it's before your event start, so it won't count toward your submission yet)"
        : '';
      await sendTelegramMessage(
        chatIdStr,
        `✅ Added your event photo for ${party.name}.${cutoffNote}`,
      );
      return res.status(200).json({ ok: true, action: 'photo', partyName: party.name });
    } catch (err: any) {
      console.error('[suppli-58533][host-inbound] error:', err?.message || err);
      // Never 500 to moltobene — it's a fire-and-forward; surface a soft ignore.
      return res.status(200).json({ ok: false, action: 'ignored', reason: 'internal error' });
    }
  },
);

export default router;
