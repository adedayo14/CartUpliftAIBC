import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
});

async function main() {
  console.log('🔄 Updating FREE subscriptions to STARTER trial...');

  const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Subscription"
    SET
      "planTier" = 'starter',
      "planStatus" = 'trial',
      "trialEndsAt" = $1
    WHERE "planTier" = 'free'
  `, trialEnd);

  console.log(`✅ Updated ${result} subscription(s)`);

  const check = await prisma.$queryRawUnsafe(`
    SELECT shop, "planTier", "planStatus", "trialEndsAt" FROM "Subscription" WHERE "planTier" IN ('starter', 'free')
  `);

  console.log('📊 Current subscriptions:', check);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
