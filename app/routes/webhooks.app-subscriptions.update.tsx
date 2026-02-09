import { type ActionFunctionArgs } from "@remix-run/node";
import db from "~/db.server";
import { authenticate } from "~/shopify.server";
import type { PlanTier } from "~/types/billing";

/**
 * 💳 SUBSCRIPTION UPDATE WEBHOOK (Shopify Managed Pricing)
 *
 * Purpose: Sync plan changes from Shopify to our database
 * Triggered: When merchant upgrades/downgrades via Shopify App Store
 *
 * This is CRITICAL for Managed Pricing - without this webhook,
 * plan changes won't be reflected in the app until admin visits.
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();

  try {
    console.log("💳 Subscription webhook START:", new Date().toISOString());

    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log("✅ Webhook authenticated:", {
      topic,
      shop,
      subscriptionId: payload.id,
      planName: payload.name,
      status: payload.status
    });

    if (topic !== "APP_SUBSCRIPTIONS_UPDATE") {
      console.error("❌ Invalid topic:", topic);
      return new Response("Invalid topic", { status: 400 });
    }

    // Map Shopify plan name to our internal tier
    const planName = (payload.name?.toLowerCase() || '');
    let planTier: PlanTier = 'starter'; // Default

    if (planName.includes('starter')) {
      planTier = 'starter';
    } else if (planName.includes('growth')) {
      planTier = 'growth';
    } else if (planName.includes('pro')) {
      planTier = 'pro';
    }

    console.log(`📊 Plan mapping: "${payload.name}" → "${planTier}"`);

    // Map Shopify status to our status
    const shopifyStatus = payload.status?.toUpperCase();
    let planStatus = 'active';

    if (shopifyStatus === 'CANCELLED' || shopifyStatus === 'EXPIRED') {
      planStatus = 'cancelled';
    } else if (shopifyStatus === 'PENDING') {
      planStatus = 'pending';
    } else if (shopifyStatus === 'ACTIVE') {
      planStatus = 'active';
    }

    console.log(`📊 Status mapping: "${payload.status}" → "${planStatus}"`);

    // Get existing subscription
    const existingSub = await db.subscription.findUnique({
      where: { shop },
    });

    if (!existingSub) {
      console.log(`📝 No existing subscription found for ${shop}, creating new record`);
    } else {
      console.log(`📝 Existing subscription: ${existingSub.planTier} (${existingSub.planStatus})`);
    }

    // Update or create subscription
    const now = new Date();
    const subscription = await db.subscription.upsert({
      where: { shop },
      create: {
        shop,
        planTier,
        planStatus,
        chargeId: payload.id?.toString(),
        billingPeriodStart: now,
        monthlyOrderCount: 0,
        lastOrderCountReset: now,
      },
      update: {
        planTier,
        planStatus,
        chargeId: payload.id?.toString(),
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
      shop,
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
