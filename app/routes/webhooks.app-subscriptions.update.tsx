import { type ActionFunctionArgs } from "@remix-run/node";
import db from "~/db.server";
import { authenticateWebhook } from "../bigcommerce.server";
import type { PlanTier } from "~/types/billing";

/**
 * 💳 SUBSCRIPTION UPDATE WEBHOOK (BigCommerce Billing)
 *
 * Purpose: Sync plan changes from BigCommerce to our database
 * Triggered: When merchant upgrades/downgrades via BigCommerce
 *
 * This is CRITICAL for billing sync - without this webhook,
 * plan changes won't be reflected in the app until admin visits.
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();

  try {
    console.log("💳 Subscription webhook START:", new Date().toISOString());

    const { storeHash, payload } = await authenticateWebhook(request);

    console.log("✅ Webhook authenticated:", {
      storeHash,
      subscriptionId: payload.id,
      planName: payload.name,
      status: payload.status
    });

    // Map BigCommerce plan name to our internal tier
    const productLevel = (payload.product?.productLevel || payload.product_level || '').toString().toLowerCase();
    const planName = (payload.name?.toLowerCase() || '');
    let planTier: PlanTier = 'starter'; // Default

    if (productLevel.includes('starter') || planName.includes('starter')) {
      planTier = 'starter';
    } else if (productLevel.includes('growth') || planName.includes('growth')) {
      planTier = 'growth';
    } else if (productLevel.includes('pro') || planName.includes('pro')) {
      planTier = 'pro';
    }

    console.log(`📊 Plan mapping: "${payload.name}" → "${planTier}"`);

    // Map BigCommerce status to our status
    const bcStatus = payload.status?.toUpperCase();
    let planStatus = 'active';

    if (bcStatus === 'CANCELLED' || bcStatus === 'EXPIRED') {
      planStatus = 'cancelled';
    } else if (bcStatus === 'PENDING') {
      planStatus = 'pending';
    } else if (bcStatus === 'ACTIVE') {
      planStatus = 'active';
    }

    console.log(`📊 Status mapping: "${payload.status}" → "${planStatus}"`);

    // Get existing subscription
    const existingSub = await db.subscription.findUnique({
      where: { storeHash },
    });

    if (!existingSub) {
      console.log(`📝 No existing subscription found for ${storeHash}, creating new record`);
    } else {
      console.log(`📝 Existing subscription: ${existingSub.planTier} (${existingSub.planStatus})`);
    }

    // Update or create subscription
    const now = new Date();
    const subscription = await db.subscription.upsert({
      where: { storeHash },
      create: {
        storeHash,
        planTier,
        planStatus,
        bcSubscriptionId: payload.id?.toString(),
        bcProductLevel: planTier,
        billingPeriodStart: now,
        monthlyOrderCount: 0,
        lastOrderCountReset: now,
      },
      update: {
        planTier,
        planStatus,
        bcSubscriptionId: payload.id?.toString(),
        bcProductLevel: planTier,
        // Reset limits on plan change
        orderLimitWarningShown: false,
        orderLimitReached: false,
        // If upgrading/downgrading, reset the billing period
        ...(existingSub && existingSub.planTier !== planTier ? {
          billingPeriodStart: now,
          lastOrderCountReset: now,
          monthlyOrderCount: 0, // Fresh start on new plan
        } : {}),
      },
    });

    const duration = Date.now() - startTime;
    console.log(`✅ Subscription updated in ${duration}ms:`, {
      storeHash,
      oldPlan: existingSub?.planTier,
      newPlan: subscription.planTier,
      status: subscription.planStatus,
      orderCountReset: existingSub?.planTier !== planTier
    });

    return new Response("OK", { status: 200 });

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof Response) {
      console.error(`❌ Subscription webhook error after ${duration}ms:`, {
        status: error.status,
        statusText: error.statusText,
      });
      return error;
    }

    console.error(`❌ Subscription webhook error after ${duration}ms:`, error);
    return new Response("Error", { status: 500 });
  }
};
