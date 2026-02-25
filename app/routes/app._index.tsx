import * as React from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate, useFetcher } from "@remix-run/react";
import {
  Box,
  Flex,
  Panel,
  Text,
  H1,
  H2,
  H3,
  Button,
  Badge,
  Grid,
  HR,
} from "@bigcommerce/big-design";
import { CloseIcon } from "@bigcommerce/big-design-icons";
import { authenticateAdmin } from "../bigcommerce.server";
import { getSettings } from "../models/settings.server";
import { getOrCreateSubscription } from "../services/billing.server";
import { PlanBadge } from "../components/PlanBadge";
import { SupportModal } from "../components/SupportModal";
import { SetupChecklist, type SetupStep } from "../components/SetupChecklist";
import { OnboardingErrorBoundary } from "../components/OnboardingErrorBoundary";
import prisma from "../db.server";
import {
  updateOnboardingStep,
  dismissOnboarding,
  getSettingsWithOnboarding,
  hasOnboardingFields,
} from "../utils/db-migration.server";
import "../styles/app-index.css";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Log any incoming requests to this action for debugging visibility
  console.log("[app._index action] ===============================");
  console.log("[app._index action] POST received!");
  console.log("[app._index action] Method:", request.method);
  console.log("[app._index action] URL:", new URL(request.url).pathname);
  console.log("[app._index action] ===============================");

  try {
    const { session, storeHash } = await authenticateAdmin(request);
    const shop = storeHash;
    console.log("[app._index action] Authenticated shop:", shop);
    
    const formData = await request.formData();
    const action = formData.get("action");
    console.log("[app._index action] Form action:", action);
    
    if (action === "mark-activated") {
      console.log("[app._index action] Processing mark-activated...");

      try {
        // Use robust migration-aware update
        await updateOnboardingStep(shop, "theme-editor");

        console.log("[app._index action] ✅ Database updated");

        // Return success - let client handle navigation to preserve auth params
        return json({ success: true, activated: true });
      } catch (error) {
        console.error("[app._index action] ❌ Database error:", error);
        return json({ success: false, error: String(error) }, { status: 500 });
      }
    }

    // Handle onboarding step completions
    if (action === "complete-onboarding-step") {
      const stepId = formData.get("stepId") as string;
      console.log("[app._index action] Completing onboarding step:", stepId);

      try {
        // Use robust migration-aware update
        await updateOnboardingStep(shop, stepId);
        return json({ success: true, stepId });
      } catch (error) {
        console.error("[app._index action] ❌ Error completing step:", error);
        return json({ success: false, error: String(error) }, { status: 500 });
      }
    }

    // Handle onboarding dismissal
    if (action === "dismiss-onboarding") {
      try {
        // Use robust migration-aware dismissal
        await dismissOnboarding(shop);
        return json({ success: true });
      } catch (error) {
        console.error("[app._index action] ❌ Error dismissing onboarding:", error);
        // Return success even on error to not break UX
        return json({ success: true });
      }
    }

    console.log("[app._index action] No matching action, returning false");
    return json({ success: false });
  } catch (authError) {
    console.error("[app._index action] ❌ Authentication failed:", authError);
    return json({ success: false, error: "Authentication failed" }, { status: 401 });
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, storeHash } = await authenticateAdmin(request);
  const shop = storeHash;

  const search = new URL(request.url).search;

  // Get app embed activation status and subscription info
  const settings = await getSettings(shop);
  const subscription = await getOrCreateSubscription(shop);

  // AUTO-MIGRATION: Convert legacy FREE subscriptions to STARTER trial
  if (subscription.planTier === 'free' as any) {
    console.log('[app._index] Auto-migrating FREE subscription to STARTER trial');
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { storeHash },
      data: {
        planTier: 'starter',
        planStatus: 'trial',
        trialEndsAt: trialEnd,
      }
    });
    // Reload subscription after migration
    const updatedSub = await getOrCreateSubscription(shop);
    Object.assign(subscription, updatedSub);
  }

  // ROBUST: Use migration-aware query that works before AND after migration
  // This will never throw 500 errors
  const dbSettings = await getSettingsWithOnboarding(shop);

  // Count bundles for the store
  const bundleCount = await prisma.bundle.count({ where: { storeHash } });

  // Check if onboarding feature is available
  const onboardingAvailable = await hasOnboardingFields();

  console.log("[app._index loader] Shop:", shop, "Bundles:", bundleCount);

  // BigCommerce billing - pass billing info to frontend
  const isTestMode = process.env.BILLING_TEST_MODE === 'true';

  return json({
    shop,
    search,
    appEmbedActivated: settings.appEmbedActivated,
    appEmbedActivatedAt: settings.appEmbedActivatedAt,
    planTier: subscription.planTier,
    orderCount: subscription.orderCount,
    orderLimit: subscription.orderLimit,
    isApproaching: subscription.isApproaching,
    isInGrace: subscription.isInGrace,
    isLimitReached: subscription.isLimitReached,
    isTestMode,
    // ROBUST: Onboarding data with safe fallbacks
    onboarding: {
      available: onboardingAvailable, // Whether the feature is ready to use
      completed: (dbSettings as any)?.onboardingCompleted ?? false,
      dismissed: (dbSettings as any)?.onboardingDismissed ?? false,
      steps: {
        themeEditor: (dbSettings as any)?.onboardingStepThemeEditor ?? dbSettings?.appEmbedActivated ?? false,
        recommendations: (dbSettings as any)?.onboardingStepRecommendations ?? dbSettings?.enableRecommendations ?? false,
        firstBundle: (dbSettings as any)?.onboardingStepFirstBundle ?? bundleCount > 0,
        preview: (dbSettings as any)?.onboardingStepPreview ?? false,
      }
    },
    bundleCount,
    recommendationsEnabled: dbSettings?.enableRecommendations ?? false,
  });
};

export default function Index() {
  const {
    shop,
    search,
    appEmbedActivated,
    appEmbedActivatedAt,
    planTier,
    orderCount,
    orderLimit,
    isApproaching,
    isInGrace,
    isLimitReached,
    isTestMode,
    onboarding,
    bundleCount,
    recommendationsEnabled,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const safeSearch = search || "";

  // Support modal state
  const [supportModalOpen, setSupportModalOpen] = React.useState(false);

  // Check for ?dialog=true parameter
  React.useEffect(() => {
    if (searchParams.get('dialog') === 'true') {
      setSupportModalOpen(true);
      // Clean up URL parameter
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('dialog');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams]);

  // ROBUST: Only show checklist if feature is available AND not completed/dismissed
  // This prevents showing the checklist if migration hasn't run yet
  const showOnboarding = onboarding.available && !onboarding.completed && !onboarding.dismissed;

  const handleUpgradeClick = () => {
    // Navigate to billing route which handles BigCommerce billing redirect
    navigate('/admin/billing');
  };

  // Handle completing an onboarding step
  const completeStep = (stepId: string) => {
    fetcher.submit(
      { action: "complete-onboarding-step", stepId },
      { method: "post" }
    );
  };

  // Handle dismissing onboarding
  const dismissOnboarding = () => {
    fetcher.submit(
      { action: "dismiss-onboarding" },
      { method: "post" }
    );
  };

  // Build setup steps for checklist
  // Recommendations and bundles are auto-enabled on install, so only show theme activation
  const setupSteps: SetupStep[] = [
    {
      id: "theme-editor",
      title: "Verify storefront scripts",
      description: "Cart Uplift installs storefront scripts automatically. Confirm your settings and preview results.",
      completed: onboarding.steps.themeEditor,
      action: {
        label: "Open Settings",
        url: "/admin/settings",
      },
      completeAction: {
        label: "I've verified it",
        onClick: () => completeStep("theme-editor"),
      },
    },
    {
      id: "preview",
      title: "Preview your cart",
      description: "Add a product to your cart and check that upsells and bundles appear.",
      completed: onboarding.steps.preview,
      action: {
        label: "View store",
        url: `https://${shop}`,
        external: true,
      },
      completeAction: {
        label: "I've checked it",
        onClick: () => completeStep("preview"),
      },
    },
  ];

  return (
    <Box padding="medium" style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <Flex flexDirection="column" flexGap="1.5rem">
        <Box>
          <Flex flexDirection="column" flexGap="1.5rem">
            {/* Order Limit Warnings */}
            {isLimitReached && (
              <Box
                style={{
                  borderLeft: "4px solid #c62828",
                  backgroundColor: "#ffebee",
                  padding: "1rem",
                  borderRadius: "6px",
                }}
              >
                <Box>
                  <H3>Order limit reached</H3>
                  <p>
                    You've reached your plan's order limit ({orderLimit} orders/month).
                    Please upgrade to continue using Cart Uplift features.
                  </p>
                  <Box style={{ paddingTop: "0.5rem" }}>
                    <Button
                      variant="primary"
                      onClick={handleUpgradeClick}
                      disabled={isTestMode}
                    >
                      Upgrade Plan
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}

            {!isLimitReached && isInGrace && (
              <Box
                style={{
                  borderLeft: "4px solid #ed6c02",
                  backgroundColor: "#fff3e0",
                  padding: "1rem",
                  borderRadius: "6px",
                }}
              >
                <Box>
                  <H3>Approaching order limit</H3>
                  <p>
                    You're in the grace period ({orderCount}/{orderLimit} orders).
                    Upgrade soon to avoid service interruption.
                  </p>
                  <Box style={{ paddingTop: "0.5rem" }}>
                    <Button
                      variant="secondary"
                      onClick={handleUpgradeClick}
                      disabled={isTestMode}
                    >
                      View Plans
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}

            {!isLimitReached && !isInGrace && isApproaching && (
              <Box
                style={{
                  borderLeft: "4px solid #1565c0",
                  backgroundColor: "#e3f2fd",
                  padding: "1rem",
                  borderRadius: "6px",
                }}
              >
                <Box>
                  <H3>Nearing order limit</H3>
                  <p>
                    You've used {orderCount} of {orderLimit} orders this month.
                    Consider upgrading to avoid hitting your limit.
                  </p>
                  <Box style={{ paddingTop: "0.5rem" }}>
                    <Button
                      variant="secondary"
                      onClick={handleUpgradeClick}
                      disabled={isTestMode}
                    >
                      View Plans
                    </Button>
                  </Box>
                </Box>
              </Box>
            )}

            {/* Hero */}
            <Panel>
              <Box style={{ padding: "1rem", borderRadius: "6px" }}>
                <Flex flexDirection="column" flexGap="1.25rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <Flex flexDirection="row" flexGap="0.5rem" justifyContent="space-between" alignItems="center">
                      <H1>Cart Uplift</H1>
                      <PlanBadge
                        plan={planTier}
                        orderCount={orderCount}
                        orderLimit={orderLimit}
                        isApproaching={isApproaching || isInGrace}
                      />
                    </Flex>
                    <Text color="secondary">
                      AI cart upsells, bundles and frequently bought together. Configure what appears in your cart.
                    </Text>
                  </Flex>

                  <Flex flexDirection="row" flexGap="0.75rem">
                    <a href={`/admin/settings${safeSearch}`} className="app-link-no-decoration">
                      <Button variant="primary">
                        Settings
                      </Button>
                    </a>
                    <a href={`/admin/bundles${safeSearch}`} className="app-link-no-decoration">
                      <Button variant="secondary">
                        Frequently bought together
                      </Button>
                    </a>
                  </Flex>
                </Flex>
              </Box>
            </Panel>

            {/* Setup Checklist - Shows until all steps complete or dismissed */}
            {/* ROBUST: Wrapped in error boundary to prevent breaking the entire app */}
            {showOnboarding && (
              <OnboardingErrorBoundary>
                <SetupChecklist
                  steps={setupSteps}
                  onDismiss={dismissOnboarding}
                  showDismiss={true}
                />
              </OnboardingErrorBoundary>
            )}

            {/* Features */}
            <Panel>
              <Box style={{ padding: "1rem", borderRadius: "6px" }}>
                <Flex flexDirection="column" flexGap="1.25rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <H2>Features that grow revenue</H2>
                    <Text color="secondary">
                      Practical tools for higher spend and a smoother shopping experience.
                    </Text>
                  </Flex>

                  <HR />

                  <Grid
                    gridColumns={{
                      mobile: "repeat(1, minmax(0, 1fr))",
                      tablet: "repeat(2, minmax(0, 1fr))",
                      desktop: "repeat(3, minmax(0, 1fr))",
                      wide: "repeat(5, minmax(0, 1fr))",
                    }}
                    gridGap="1rem"
                  >
                    {/* AI Recommendations */}
                    <Box backgroundColor="secondary10" style={{ padding: "1rem", borderRadius: "8px" }}>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Bespoke recommendations</H3>
                        <Text color="secondary">
                          Suggestions tailored to each visitor, based on live browsing and purchase signals.
                        </Text>
                      </Flex>
                    </Box>

                    {/* Smart FBT */}
                    <Box backgroundColor="secondary10" style={{ padding: "1rem", borderRadius: "8px" }}>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Smart bundles</H3>
                        <Text color="secondary">
                          Spots items often bought together and builds offers with flexible discounts.
                        </Text>
                      </Flex>
                    </Box>

                    {/* Progress incentives */}
                    <Box backgroundColor="secondary10" style={{ padding: "1rem", borderRadius: "8px" }}>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Progress incentives</H3>
                        <Text color="secondary">
                          Progress bars for free shipping and rewards that help lift cart value.
                        </Text>
                      </Flex>
                    </Box>

                    {/* Gift with purchase */}
                    <Box backgroundColor="secondary10" style={{ padding: "1rem", borderRadius: "8px" }}>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Gift with purchase</H3>
                        <Text color="secondary">
                          Reward customers at set spend levels. The app handles the rest.
                        </Text>
                      </Flex>
                    </Box>

                    {/* Revenue analytics */}
                    <Box backgroundColor="secondary10" style={{ padding: "1rem", borderRadius: "8px" }}>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Revenue analytics</H3>
                        <Text color="secondary">
                          Track impressions, clicks, conversions and attributed revenue in real time.
                        </Text>
                      </Flex>
                    </Box>
                  </Grid>
                </Flex>
              </Box>
            </Panel>

            {/* How it works */}
            <Panel>
              <Box style={{ padding: "1rem", borderRadius: "6px" }}>
                <Flex flexDirection="column" flexGap="1.25rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <H2>How it works</H2>
                    <Text color="secondary">
                      Three steps to raise average order value.
                    </Text>
                  </Flex>

                  <HR />

                  <Grid
                    gridColumns={{
                      mobile: "repeat(1, minmax(0, 1fr))",
                      tablet: "repeat(1, minmax(0, 1fr))",
                      desktop: "repeat(3, minmax(0, 1fr))",
                    }}
                    gridGap="1.25rem"
                  >
                    {/* Step 1 */}
                    <Flex flexDirection="column" flexGap="0.75rem">
                      <Box
                        backgroundColor="primary10"
                        style={{
                          padding: "0.5rem",
                          borderRadius: "6px",
                          width: "32px",
                          minHeight: "32px",
                          textAlign: "center",
                        }}
                      >
                        <H3>1</H3>
                      </Box>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Understands real behaviour</H3>
                        <Text color="secondary">
                          The model analyses browsing and purchase patterns to learn how your products relate each other.
                        </Text>
                      </Flex>
                    </Flex>

                    {/* Step 2 */}
                    <Flex flexDirection="column" flexGap="0.75rem">
                      <Box
                        backgroundColor="success10"
                        style={{
                          padding: "0.5rem",
                          borderRadius: "6px",
                          width: "32px",
                          minHeight: "32px",
                          textAlign: "center",
                        }}
                      >
                        <H3><span className="app-step-number-white">2</span></H3>
                      </Box>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Shows relevant suggestions</H3>
                        <Text color="secondary">
                          Personalised products and smart offers appear in cart and on product pages.
                        </Text>
                      </Flex>
                    </Flex>

                    {/* Step 3 */}
                    <Flex flexDirection="column" flexGap="0.75rem">
                      <Box
                        backgroundColor="warning10"
                        style={{
                          padding: "0.5rem",
                          borderRadius: "6px",
                          width: "32px",
                          minHeight: "32px",
                          textAlign: "center",
                        }}
                      >
                        <H3>3</H3>
                      </Box>
                      <Flex flexDirection="column" flexGap="0.5rem">
                        <H3>Measures and improves</H3>
                        <Text color="secondary">
                          Built-in testing tracks performance and continually optimises the model. The more you use it the better it gets!
                        </Text>
                      </Flex>
                    </Flex>
                  </Grid>
                </Flex>
              </Box>
            </Panel>

            {/* Why it works */}
            <Panel>
              <Box style={{ padding: "1rem", borderRadius: "6px" }}>
                <Flex flexDirection="column" flexGap="1.25rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <H2>Why AI beats static rules</H2>
                    <Text color="secondary">
                      Smarter recommendations, better results. Built to learn from real customer behaviour and adapt as patterns change.
                    </Text>
                  </Flex>

                  <HR />

                  <Box style={{ padding: "1.25rem", borderRadius: "8px" }}>
                    <Flex flexDirection="column" flexGap="0.5rem">
                      <Grid
                        gridColumns={{
                          mobile: "repeat(1, minmax(0, 1fr))",
                          tablet: "repeat(1, minmax(0, 1fr))",
                          desktop: "repeat(2, minmax(0, 1fr))",
                        }}
                        gridGap="1rem"
                      >
                        <Flex flexDirection="column" flexGap="0.5rem">
                          <H3>Learns continuously</H3>
                          <Text>
                            No hard-coded rules. The model adapts to what people view, click and buy so suggestions stay relevant.
                          </Text>
                        </Flex>

                        <Flex flexDirection="column" flexGap="0.5rem">
                          <H3>Personal to each shopper</H3>
                          <Text>
                            Not generic. Visitors see products that fit their intent and context on your site.
                          </Text>
                        </Flex>

                        <Flex flexDirection="column" flexGap="0.5rem">
                          <H3>FBT - Smart product pairing</H3>
                          <Text>
                            Identifies products often bought together and offers fair discounts that feel natural.
                          </Text>
                        </Flex>

                        <Flex flexDirection="column" flexGap="0.5rem">
                          <H3>Optimises itself</H3>
                          <Text>
                            Tracks what converts and quietly removes suggestions that don't perform. Your recommendations get better over time.
                          </Text>
                        </Flex>
                      </Grid>
                    </Flex>
                  </Box>
                </Flex>
              </Box>
            </Panel>

            {/* Support */}
            <Panel>
              <Box style={{ padding: "1rem", borderRadius: "6px" }}>
                <Flex flexDirection="column" flexGap="1rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <H3>Need help getting started?</H3>
                    <Text color="secondary">
                      We can help with set-up and best practice for your catalogue.
                    </Text>
                  </Flex>
                  <Flex flexDirection="row" flexGap="0.75rem">
                    <Button variant="secondary" onClick={() => setSupportModalOpen(true)}>
                      Contact support
                    </Button>
                  </Flex>
                </Flex>
              </Box>
            </Panel>
          </Flex>
        </Box>
      </Flex>

      <SupportModal
        open={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
        planTier={planTier}
      />
    </Box>
  );
}
