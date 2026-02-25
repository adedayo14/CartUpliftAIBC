import { PrismaClient } from "@prisma/client";
import type { TypedPrismaClient } from "./types/prisma";

let prisma: TypedPrismaClient;

declare global {
  var __prisma: TypedPrismaClient | undefined;
}

// Optimized connection pool configuration for serverless environments
// CRITICAL for scaling to 1000+ stores: Uses connection pooling to prevent exhaustion
const prismaClientConfig = {
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: process.env.NODE_ENV === 'development' 
    ? ['query' as const, 'error' as const, 'warn' as const] 
    : ['error' as const],
};

// Connection pool management for Vercel serverless
if (process.env.NODE_ENV === "production") {
  // In production (Vercel), let Prisma lazily connect on first query.
  // Do NOT eagerly $connect() — Neon closes idle connections and
  // Prisma cannot reuse stale handles, causing "kind: Closed" errors.
  prisma = new PrismaClient(prismaClientConfig);
} else {
  // In development, reuse connection across hot reloads
  if (!global.__prisma) {
    global.__prisma = new PrismaClient(prismaClientConfig);
  }
  prisma = global.__prisma;
}

export { prisma };
export default prisma;
