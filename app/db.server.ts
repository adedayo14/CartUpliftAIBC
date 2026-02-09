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
  // In production (Vercel), create a single instance per function
  // Vercel will manage connection lifecycle
  prisma = new PrismaClient(prismaClientConfig);
  
  // Graceful shutdown - disconnect on serverless function termination
  prisma.$connect().catch((err) => {
    console.error('Failed to connect to database:', err);
  });
} else {
  // In development, reuse connection across hot reloads
  if (!global.__prisma) {
    global.__prisma = new PrismaClient(prismaClientConfig);
  }
  prisma = global.__prisma;
}

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

export { prisma };
export default prisma;
