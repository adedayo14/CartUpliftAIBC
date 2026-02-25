import prisma from "~/db.server";
import { env } from "~/utils/env.server";
import { logger } from "~/utils/logger.server";
import { bigcommerceApi } from "~/bigcommerce.server";
import { getPlan, PRICING_PLANS } from "~/config/billing.server";
import type { PlanTier } from "~/types/billing";

const DEFAULT_CURRENCY = "USD";

interface AccountGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface UnifiedBillingSubscription {
  id: string;
  status?: string | null;
  planTier: PlanTier;
}

function getProductId(): string {
  return `bc/account/product/${env.bcApplicationId}`;
}

function getAccountGraphQLEndpoint(): string {
  return `https://api.bigcommerce.com/accounts/${env.bcPartnerAccountUuid}/graphql`;
}

function mapBillingInterval(interval: string): string {
  if (interval === "EVERY_30_DAYS") return "MONTH";
  return interval;
}

function mapProductLevelToPlan(productLevel?: string | null): PlanTier | null {
  if (!productLevel) return null;
  const normalized = productLevel.toLowerCase();
  if (normalized in PRICING_PLANS) return normalized as PlanTier;
  return null;
}

function mapSubscriptionStatus(status?: string | null): string {
  const normalized = (status || "").toUpperCase();
  if (normalized === "ACTIVE") return "active";
  if (normalized === "CANCELLED" || normalized === "EXPIRED") return "cancelled";
  if (normalized === "PENDING") return "pending";
  if (normalized === "TRIAL") return "trial";
  return "trial";
}

function matchesScopeId(scopeId: string, storeHash: string): boolean {
  if (scopeId === storeHash) return true;
  if (scopeId.endsWith(`/${storeHash}`)) return true;
  if (scopeId.includes(storeHash)) return true;
  return false;
}

async function accountGraphQLRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(getAccountGraphQLEndpoint(), {
    method: "POST",
    headers: {
      "X-Auth-Token": env.bcAccountApiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Account GraphQL request failed: ${response.status} ${errorText}`);
  }

  const json = (await response.json()) as AccountGraphQLResponse<T>;
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Account GraphQL error: ${json.errors.map(e => e.message).join(", ")}`);
  }

  if (!json.data) {
    throw new Error("Account GraphQL response missing data");
  }

  return json.data;
}

export async function getMerchantAccountUuid(storeHash: string): Promise<string> {
  const existing = await prisma.settings.findUnique({
    where: { storeHash },
    select: { accountUuid: true },
  });

  if (existing?.accountUuid) return existing.accountUuid;

  const storeResponse = await bigcommerceApi(storeHash, "/store", { version: "v2" });
  if (!storeResponse.ok) {
    const errorText = await storeResponse.text();
    throw new Error(`Failed to fetch store info for account UUID: ${errorText}`);
  }

  const storeData = await storeResponse.json();
  const accountUuid = storeData.account_uuid || storeData.accountUuid;
  if (!accountUuid) {
    throw new Error("Store info response missing account_uuid");
  }

  await prisma.settings.upsert({
    where: { storeHash },
    update: { accountUuid },
    create: { storeHash, accountUuid },
  });

  return accountUuid;
}

export async function createUnifiedBillingCheckout(args: {
  storeHash: string;
  planTier: PlanTier;
  subscriptionId?: string | null;
}): Promise<{ checkoutUrl: string; checkoutId?: string; subscriptionId?: string }> {
  const plan = getPlan(args.planTier);
  const accountUuid = await getMerchantAccountUuid(args.storeHash);
  const redirectUrl = env.bcBillingReturnUrl || `${env.bcAppUrl}/admin/billing?billing=complete`;

  const mutation = `mutation CreateCheckout($checkout: CreateCheckoutInput!) {\n  checkout {\n    createCheckout(input: $checkout) {\n      checkout {\n        id\n        status\n        checkoutUrl\n        items(first: 1) {\n          edges {\n            node {\n              subscriptionId\n            }\n          }\n        }\n      }\n    }\n  }\n}`;

  const variables = {
    checkout: {
      accountId: accountUuid,
      description: `Cart Uplift ${plan.name} Plan`,
      redirectUrl,
      ...(args.subscriptionId ? { subscriptionId: args.subscriptionId } : {}),
      items: [
        {
          product: {
            id: getProductId(),
            type: "APPLICATION",
            productLevel: plan.id,
          },
          scope: {
            type: "STORE",
            id: args.storeHash,
          },
          pricingPlan: {
            interval: mapBillingInterval(plan.interval),
            price: {
              value: plan.price,
              currencyCode: DEFAULT_CURRENCY,
            },
            trialDays: plan.trialDays,
          },
        },
      ],
    },
  };

  const data = await accountGraphQLRequest<{ checkout: { createCheckout: { checkout: { id: string; checkoutUrl: string; items?: { edges?: Array<{ node?: { subscriptionId?: string } }> } } } } }>(
    mutation,
    variables
  );

  const checkout = data.checkout.createCheckout.checkout;
  const subscriptionId = checkout.items?.edges?.[0]?.node?.subscriptionId;

  if (!checkout.checkoutUrl) {
    throw new Error("Unified billing checkout missing checkoutUrl");
  }

  return {
    checkoutUrl: checkout.checkoutUrl,
    checkoutId: checkout.id,
    subscriptionId,
  };
}

export async function fetchUnifiedBillingSubscription(storeHash: string): Promise<UnifiedBillingSubscription | null> {
  await getMerchantAccountUuid(storeHash);
  const productId = getProductId();

  const query = `query Subscriptions($first: Int!) {\n  account {\n    subscriptions(first: $first) {\n      edges {\n        node {\n          id\n          status\n          product {\n            id\n            productLevel\n          }\n          scope {\n            id\n            type\n          }\n        }\n      }\n    }\n  }\n}`;

  const data = await accountGraphQLRequest<{ account: { subscriptions: { edges: Array<{ node: { id: string; status?: string | null; product?: { id?: string | null; productLevel?: string | null }; scope?: { id?: string | null; type?: string | null } } }> } } }>(
    query,
    { first: 50 }
  );

  const nodes = data.account.subscriptions.edges.map(edge => edge.node);
  const matching = nodes.find(node => {
    const scopeId = node.scope?.id || "";
    const product = node.product?.id || "";
    return matchesScopeId(scopeId, storeHash) && (product === productId || product.endsWith(`/${env.bcApplicationId}`));
  });

  if (!matching) return null;

  const planTier = mapProductLevelToPlan(matching.product?.productLevel);
  if (!planTier) return null;

  return {
    id: matching.id,
    status: matching.status || undefined,
    planTier,
  };
}

export async function syncUnifiedBillingSubscription(storeHash: string): Promise<void> {
  if (env.billingProvider !== "bigcommerce") return;
  if (!process.env.BC_PARTNER_ACCOUNT_UUID || !process.env.BC_ACCOUNT_API_TOKEN || !process.env.BC_APPLICATION_ID) {
    logger.warn("Unified billing not configured yet", { storeHash });
    return;
  }

  try {
    const unified = await fetchUnifiedBillingSubscription(storeHash);
    if (!unified) return;

    const current = await prisma.subscription.findUnique({ where: { storeHash } });

    const mappedStatus = mapSubscriptionStatus(unified.status);
    const now = new Date();

    if (!current) {
      await prisma.subscription.create({
        data: {
          storeHash,
          planTier: unified.planTier,
          planStatus: mappedStatus,
          bcSubscriptionId: unified.id,
          bcProductLevel: unified.planTier,
          billingPeriodStart: now,
          monthlyOrderCount: 0,
          lastOrderCountReset: now,
        },
      });
      return;
    }

    const planChanged = unified.planTier !== current.planTier;

    await prisma.subscription.update({
      where: { storeHash },
      data: {
        planTier: unified.planTier,
        planStatus: mappedStatus,
        bcSubscriptionId: unified.id,
        bcProductLevel: unified.planTier,
        ...(planChanged ? {
          billingPeriodStart: now,
          lastOrderCountReset: now,
          monthlyOrderCount: 0,
          orderLimitWarningShown: false,
          orderLimitReached: false,
        } : {}),
      },
    });
  } catch (error) {
    logger.warn("Unified billing sync failed", { storeHash, error });
  }
}

export function mapUnifiedBillingStatus(status?: string | null): string {
  return mapSubscriptionStatus(status);
}
