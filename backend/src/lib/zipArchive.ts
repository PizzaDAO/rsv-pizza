import { ZipArchive } from 'archiver';

/**
 * Create a streaming ZIP archive for the partner photo download.
 *
 * archiver@8 is ESM-only and has no default factory function (the v7
 * `archiver('zip', opts)` call throws "archiver is not a function"); use the
 * `ZipArchive` class instead.
 *
 * zlib level 1: images are already compressed (JPEG/WebP/PNG); spending CPU on
 * level 6+ rarely shrinks the archive but adds significant latency.
 */
export function createZipArchive(): ZipArchive {
  return new ZipArchive({ zlib: { level: 1 } });
}
