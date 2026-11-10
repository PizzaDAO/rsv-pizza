/**
 * basil-14648 P2 (host menus): reading a menu upload off the request, with busboy.
 *
 * - Limits are busboy's own (`files: 3, fields: 0, parts: 3, fileSize: 4 MB`) plus a running 4 MB total over every
 *   file, so nothing past a limit is buffered. A declared Content-Length over 4.5 MB is refused before parsing.
 * - Each file is kept as the chunks busboy hands over and joined once at the end (one copy).
 * - Every refusal drains the rest of the body first (`drainRequest`), so the browser reads the 413/415/400 instead
 *   of a reset connection. A body that keeps coming past 16 MB or 10 s gets `Connection: close` instead.
 * The declared part types are ignored; uploadSniff.ts decides from the bytes.
 */
import type { IncomingMessage } from 'node:http';
import type { Response } from 'express';
import Busboy from 'busboy';
import { AppError } from '../middleware/error.js';
import { MENU_UPLOAD_LIMITS } from './uploadSniff.js';

const DRAIN_MAX_BYTES = 16 * 1024 * 1024;
const DRAIN_MAX_MS = 10_000;

const tooLarge = () => new AppError('The menu files are larger than 4 MB in total.', 413, 'MENU_TOO_LARGE');
const tooMany = () => new AppError('Send at most 3 photos of the menu.', 413, 'MENU_TOO_LARGE');
const unreadable = () => new AppError('We couldn\'t read that upload. Try choosing the files again.', 400, 'VALIDATION_FAILED');

/**
 * Read and discard what is left of the request body, so the answer can be sent on a connection the client is not
 * still writing into. Gives up after 16 MB or 10 s and marks the answer `Connection: close` instead.
 */
export function drainRequest(req: IncomingMessage, res: Response): Promise<void> {
  return new Promise((resolve) => {
    if (req.readableEnded || req.destroyed) return resolve();
    let seen = 0;
    let done = false;
    const finish = (close: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.off('data', onData);
      if (close && !res.headersSent) res.setHeader('Connection', 'close');
      resolve();
    };
    const onData = (c: Buffer) => {
      seen += c.length;
      if (seen > DRAIN_MAX_BYTES) finish(true);
    };
    const timer = setTimeout(() => finish(true), DRAIN_MAX_MS);
    req.on('data', onData);
    req.once('end', () => finish(false));
    req.once('close', () => finish(false));
    req.once('error', () => finish(true));
    req.resume();
  });
}

/** The files of a multipart menu upload (`files[]` or `files`), as bytes, in the order sent. */
export async function readMenuUpload(req: IncomingMessage, res: Response): Promise<Buffer[]> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MENU_UPLOAD_LIMITS.maxBodyBytes) {
    await drainRequest(req, res);
    throw tooLarge();
  }
  let bb: Busboy.Busboy;
  try {
    bb = Busboy({
      headers: req.headers,
      limits: { files: MENU_UPLOAD_LIMITS.maxImages, fields: 0, parts: MENU_UPLOAD_LIMITS.maxImages, fileSize: MENU_UPLOAD_LIMITS.maxTotalBytes },
    });
  } catch {
    await drainRequest(req, res);
    throw unreadable();
  }
  return new Promise<Buffer[]>((resolve, reject) => {
    const files: Buffer[] = [];
    let total = 0;
    let failed = false;
    const fail = (e: AppError) => {
      if (failed) return;
      failed = true;
      req.unpipe(bb);
      drainRequest(req, res).then(() => reject(e));
    };
    bb.on('file', (name, stream) => {
      if (name !== 'files[]' && name !== 'files') {
        stream.resume();
        return fail(new AppError('Send the menu as files only.', 400, 'VALIDATION_FAILED'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => {
        if (failed) return;
        size += c.length;
        total += c.length;
        if (total > MENU_UPLOAD_LIMITS.maxTotalBytes) return fail(tooLarge());
        chunks.push(c);
      });
      stream.on('limit', () => fail(tooLarge()));
      stream.on('end', () => {
        if (!failed) files.push(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size));
      });
    });
    bb.on('filesLimit', () => fail(tooMany()));
    bb.on('partsLimit', () => fail(tooMany()));
    bb.on('fieldsLimit', () => fail(new AppError('Send the menu as files only.', 400, 'VALIDATION_FAILED')));
    bb.on('error', () => fail(unreadable()));
    bb.on('close', () => {
      if (!failed) resolve(files);
    });
    req.pipe(bb);
  });
}
