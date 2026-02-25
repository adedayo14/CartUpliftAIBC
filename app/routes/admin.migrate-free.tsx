import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin } from "~/bigcommerce.server";
import prisma from "~/db.server";

/**
 * Emergency migration route to convert FREE subscriptions to STARTER trial
 * Visit /admin/migrate-free to run the migration for your shop
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, storeHash } = await authenticateAdmin(request);

  try {
    // Calculate trial end date (14 days from now)
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Update this shop's subscription if it's on free plan
    const updated = await prisma.subscription.updateMany({
      where: {
        shop: storeHash,
        planTier: 'free'
      },
      data: {
        planTier: 'starter',
        planStatus: 'trial',
        trialEndsAt: trialEnd,
      }
    });

    if (updated.count > 0) {
      return json({
        success: true,
        message: `✅ Migrated ${updated.count} subscription(s) from FREE to STARTER trial`,
        shop: storeHash,
        trialEndsAt: trialEnd.toISOString()
      });
    } else {
      return json({
        success: true,
        message: "✅ No migration needed - subscription already on STARTER or higher",
        shop: storeHash
      });
    }
  } catch (error) {
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      shop: storeHash
    }, { status: 500 });
  }
};

export default function MigrateFree() {
  return null; // This route only needs the loader
}
