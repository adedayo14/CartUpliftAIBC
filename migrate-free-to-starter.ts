/**
 * Data migration: Convert all FREE subscriptions to STARTER trial
 * Run this once to migrate existing data after removing the FREE plan
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting migration: FREE -> STARTER trial...');

  // Find all subscriptions with planTier = "free"
  const freeSubscriptions = await prisma.subscription.findMany({
    where: { planTier: 'free' }
  });

  console.log(`📊 Found ${freeSubscriptions.length} FREE subscriptions to migrate`);

  if (freeSubscriptions.length === 0) {
    console.log('✅ No subscriptions to migrate');
    return;
  }

  // Calculate trial end date (14 days from now)
  const now = new Date();
  const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  // Update each subscription
  const results = await prisma.subscription.updateMany({
    where: { planTier: 'free' },
    data: {
      planTier: 'starter',
      planStatus: 'trial',
      trialEndsAt: trialEnd,
    }
  });

  console.log(`✅ Migrated ${results.count} subscriptions to STARTER trial`);
  console.log(`📅 Trial period: ${now.toISOString()} -> ${trialEnd.toISOString()}`);
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
