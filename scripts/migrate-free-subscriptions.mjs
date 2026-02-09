/**
 * Data migration: Convert FREE subscriptions to STARTER trial
 * Run: node scripts/migrate-free-subscriptions.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Migrating FREE subscriptions to STARTER trial...');

  try {
    // Execute raw SQL to update free subscriptions
    const result = await prisma.$executeRaw`
      UPDATE "Subscription"
      SET
        "planTier" = 'starter',
        "planStatus" = 'trial',
        "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days'
      WHERE "planTier" = 'free'
    `;

    console.log(`✅ Migrated ${result} subscription(s) from FREE to STARTER trial`);

    // Verify the migration
    const starterTrialCount = await prisma.subscription.count({
      where: {
        planTier: 'starter',
        planStatus: 'trial'
      }
    });

    console.log(`📊 Total STARTER trial subscriptions: ${starterTrialCount}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

main()
  .catch((e) => {
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
