import QRCode from 'qrcode';

/**
 * Check-in QR codes for emails, generated locally (no third-party QR service, so the check-in
 * URL, which identifies a guest, never leaves our infrastructure and never appears in a logged URL).
 *
 * Delivered as an inline CID attachment through Resend (`content_id`), referenced from the HTML
 * as `<img src="cid:checkin-qr">`. CID is supported by Gmail, Apple Mail and Outlook; `data:` URIs
 * are blocked by Gmail and Outlook, and a public QR-image URL would have to carry the guest token.
 */
export const CHECKIN_QR_CID = 'checkin-qr';
export const CHECKIN_QR_SRC = `cid:${CHECKIN_QR_CID}`;

export interface InlineAttachment {
  filename: string;
  content: string; // base64
  content_type: string;
  content_id: string;
}

/** PNG buffer (rendered 2x; shown at 200x200 in the email, same colours as the old qrserver image). */
export async function renderCheckInQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: 400,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1a1a2e', light: '#f9f9f9' },
  });
}

export async function checkInQrAttachment(url: string): Promise<InlineAttachment> {
  const png = await renderCheckInQrPng(url);
  return {
    filename: 'checkin-qr.png',
    content: png.toString('base64'),
    content_type: 'image/png',
    content_id: CHECKIN_QR_CID,
  };
}
