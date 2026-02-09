import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, Button, InlineStack, Badge, Divider, Box } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getOrCreateSubscription } from "../services/billing.server";
import { PRICING_PLANS } from "../config/billing.server";

/**
 * Billing page for Shopify Managed Pricing
 * Shows pricing plans and directs users to App Store to upgrade
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const subscription = await getOrCreateSubscription(session.shop, admin);

  // Construct Shopify's billing page URL
  const shopName = session.shop.replace('.myshopify.com', '');
  const billingUrl = `https://admin.shopify.com/store/${shopName}/charges/cartupliftai/pricing_plans`;

  return json({
    shop: session.shop,
    currentPlan: subscription.planTier,
    orderCount: subscription.orderCount,
    orderLimit: subscription.orderLimit,
    plans: Object.values(PRICING_PLANS),
    billingUrl
  });
};

export default function Billing() {
  const { currentPlan, orderCount, orderLimit, plans, billingUrl } = useLoaderData<typeof loader>();

  const handleUpgrade = () => {
    window.open(billingUrl, '_blank');
  };

  return (
    <Page>
      <TitleBar title="Billing & Plans" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Current Plan
                  </Text>
                  <Badge tone="success">
                    {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  You've used {orderCount} of {orderLimit === Infinity ? 'unlimited' : orderLimit} orders this month
                </Text>
              </BlockStack>

              <Divider />

              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Available Plans
                </Text>

                {plans.map((plan) => (
                  <Card key={plan.id} background={currentPlan === plan.id ? 'bg-surface-secondary' : undefined}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="h3" variant="headingMd">
                              {plan.name}
                            </Text>
                            {currentPlan === plan.id && (
                              <Badge tone="success">Current</Badge>
                            )}
                          </InlineStack>
                          <Text as="p" variant="headingLg" fontWeight="bold">
                            ${plan.price}
                            <Text as="span" variant="bodySm" tone="subdued">
                              /month
                            </Text>
                          </Text>
                        </BlockStack>
                      </InlineStack>

                      <BlockStack gap="100">
                        {plan.features.map((feature, index) => (
                          <Text key={index} as="p" variant="bodySm">
                            • {feature}
                          </Text>
                        ))}
                      </BlockStack>

                      {plan.trialDays > 0 && (
                        <Box paddingBlockStart="200">
                          <Text as="p" variant="bodySm" tone="success">
                            ✓ {plan.trialDays}-day free trial
                          </Text>
                        </Box>
                      )}
                    </BlockStack>
                  </Card>
                ))}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text as="p" variant="headingMd">
                  Ready to upgrade?
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Click below to select a plan and start your 14-day free trial. You can change or cancel anytime.
                </Text>
                <Box paddingBlockStart="200">
                  <Button variant="primary" onClick={handleUpgrade}>
                    Select Plan
                  </Button>
                </Box>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
