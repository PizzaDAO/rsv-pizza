// sharp is a native module that is slow to load; import it on first use instead of at server boot
// (every route module is imported by index.ts, so a top-level `import sharp` costs cold-start time on
// every function invocation, including routes that never touch images).
let cached: Promise<typeof import('sharp').default> | null = null;

export function loadSharp(): Promise<typeof import('sharp').default> {
  if (!cached) cached = import('sharp').then((m) => m.default);
  return cached;
}
