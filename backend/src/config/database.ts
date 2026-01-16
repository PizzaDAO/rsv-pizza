import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

// Prevent multiple instances during development hot reload
export const prisma = global.prisma || new PrismaClient({
  log: process.env.NODE_ENV !== 'production' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

// Test connection
prisma.$connect().catch((err) => {
  console.error('Failed to connect to database:', err);
});
