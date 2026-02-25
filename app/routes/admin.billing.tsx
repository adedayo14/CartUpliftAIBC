import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useSearchParams } from "@remix-run/react";
import { Box, Text, H2, H3, Flex, Button, Badge, HR, Panel, Grid, GridItem } from "@bigcommerce/big-design";
import { authenticateAdmin } from "../bigcommerce.server";
import { getOrCreateSubscription } from "../services/billing.server";
import { PRICING_PLANS, isValidPlan } from "../config/billing.server";
import type { PlanTier } from "~/types/billing";
import prisma from "~/db.server";
import { createUnifiedBillingCheckout } from "~/services/unified-billing.server";

/**
 * Billing page for BigCommerce
 * Shows pricing plans and directs users to upgrade
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, storeHash } = await authenticateAdmin(request);
  const subscription = await getOrCreateSubscription(storeHash);

  // Construct BigCommerce's billing page URL
  const billingUrl = `https://store-${storeHash}.mybigcommerce.com/manage/marketplace/apps`;

  return json({
    shop: storeHash,
    currentPlan: subscription.planTier,
    orderCount: subscription.orderCount,
    orderLimit: subscription.orderLimit,
    plans: Object.values(PRICING_PLANS),
    billingUrl
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { storeHash } = await authenticateAdmin(request);
    if (!process.env.BC_PARTNER_ACCOUNT_UUID || !process.env.BC_ACCOUNT_API_TOKEN || !process.env.BC_APPLICATION_ID) {
      return json({ error: "Unified Billing not configured yet" }, { status: 400 });
    }
    const formData = await request.formData();
    const planId = String(formData.get("plan") || "");

    if (!isValidPlan(planId)) {
      return json({ error: "Invalid plan" }, { status: 400 });
    }

    const subscription = await prisma.subscription.findUnique({ where: { storeHash } });

    const checkout = await createUnifiedBillingCheckout({
      storeHash,
      planTier: planId as PlanTier,
      subscriptionId: subscription?.bcSubscriptionId,
    });

    return redirect(checkout.checkoutUrl);
  } catch (error) {
    console.error("[Billing Action] Failed to create checkout:", error);
    return json({ error: "Failed to start billing checkout" }, { status: 500 });
  }
};

export default function Billing() {
  const { currentPlan, orderCount, orderLimit, plans, billingUrl } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const billingComplete = searchParams.get("billing") === "complete";

  return (
    <Box>
      <Grid gridColumns="1fr">
        <GridItem>
          <Panel>
            <Flex flexDirection="column" flexGap="1rem">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
                  <H2>Current Plan</H2>
                  <Badge variant="success" label={currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} />
                </Flex>
                <Text color="secondary">
                  You've used {orderCount} of {orderLimit === Infinity ? 'unlimited' : orderLimit} orders this month
                </Text>
                {billingComplete && (
                  <Text color="success">Billing updated successfully.</Text>
                )}
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="1rem">
                <H2>Available Plans</H2>

                {plans.map((plan) => (
                  <Panel key={plan.id}>
                    <Flex flexDirection="column" flexGap="0.75rem">
                      <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start">
                        <Flex flexDirection="column" flexGap="0.25rem">
                          <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
                            <H3>{plan.name}</H3>
                            {currentPlan === plan.id && (
                              <Badge variant="success" label="Current" />
                            )}
                          </Flex>
                          <Text bold>
                            ${plan.price}
                            <Text color="secondary"> /month</Text>
                          </Text>
                        </Flex>
                      </Flex>

                      <Flex flexDirection="column" flexGap="0.25rem">
                        {plan.features.map((feature, index) => (
                          <Text key={index}>
                            • {feature}
                          </Text>
                        ))}
                      </Flex>

                      {plan.trialDays > 0 && (
                        <Box marginTop="medium">
                          <Text color="success">
                            ✓ {plan.trialDays}-day free trial
                          </Text>
                        </Box>
                      )}

                      <Box marginTop="medium">
                        <Form method="post">
                          <input type="hidden" name="plan" value={plan.id} />
                          <Button
                            variant="primary"
                            type="submit"
                            disabled={currentPlan === plan.id}
                          >
                            {currentPlan === plan.id ? "Current Plan" : "Select Plan"}
                          </Button>
                        </Form>
                      </Box>
                    </Flex>
                  </Panel>
                ))}
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.5rem">
                <H2>Ready to upgrade?</H2>
                <Text color="secondary">
                  Click below to select a plan and start your 14-day free trial. You can change or cancel anytime.
                </Text>
                <Box marginTop="medium">
                  <Button variant="subtle" onClick={() => window.open(billingUrl, '_blank')}>
                    Manage billing in BigCommerce
                  </Button>
                </Box>
              </Flex>
            </Flex>
          </Panel>
        </GridItem>
      </Grid>
    </Box>
  );
}
