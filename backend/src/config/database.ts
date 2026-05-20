import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

// Prevent multiple instances during development hot reload
export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV !== 'production' ? ['query', 'error', 'warn'] : ['error'],
  // calabrese-58204: cap interactive transactions at 20s and don't wait more
  // than 5s to acquire one. Defense-in-depth against the pool-saturation
  // pattern from the 2026-05-19 outage — without these, a single stuck
  // transaction can hold a pool connection indefinitely. 20s headroom for
  // legitimate bulk operations (underboss bulk-delete cascades, bulk sponsor
  // updates) while still preventing pathological hangs.
  transactionOptions: {
    maxWait: 5000,
    timeout: 20000,
  },
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

// Test connection
prisma.$connect().catch((err) => {
  console.error('Failed to connect to database:', err);
});
