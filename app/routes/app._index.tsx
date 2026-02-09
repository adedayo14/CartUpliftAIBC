import * as React from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, useNavigate, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Divider,
  InlineGrid,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
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
    const { session } = await authenticate.admin(request);
    const { shop } = session;
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
  const { session, admin } = await authenticate.admin(request);
  const { shop } = session;

  const search = new URL(request.url).search;

  // Get app embed activation status and subscription info
  const settings = await getSettings(shop);
  const subscription = await getOrCreateSubscription(shop, admin);

  // AUTO-MIGRATION: Convert legacy FREE subscriptions to STARTER trial
  if (subscription.planTier === 'free' as any) {
    console.log('[app._index] Auto-migrating FREE subscription to STARTER trial');
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await prisma.subscription.update({
      where: { shop },
      data: {
        planTier: 'starter',
        planStatus: 'trial',
        trialEndsAt: trialEnd,
      }
    });
    // Reload subscription after migration
    const updatedSub = await getOrCreateSubscription(shop, admin);
    Object.assign(subscription, updatedSub);
  }

  // ROBUST: Use migration-aware query that works before AND after migration
  // This will never throw 500 errors
  const dbSettings = await getSettingsWithOnboarding(shop);

  // Count bundles for the store
  const bundleCount = await prisma.bundle.count({ where: { shop } });

  // Check if onboarding feature is available
  const onboardingAvailable = await hasOnboardingFields();

  console.log("[app._index loader] Shop:", shop, "Bundles:", bundleCount);

  // Shopify Managed Pricing - pass billing info to frontend
  // Frontend will handle upgrade navigation to App Store
  const isTestMode = process.env.SHOPIFY_BILLING_TEST_MODE === 'true';

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
    // Navigate to billing route which handles Shopify Managed Pricing redirect
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
      title: "Enable Cart Uplift in your theme",
      description: "In App embeds, switch on Cart Uplift – Smart Cart. You can switch this off at any time.",
      completed: onboarding.steps.themeEditor,
      videoUrl: "https://www.youtube.com/watch?v=ukL179incJ8",
      helpLink: {
        label: "Open App embeds",
        url: `https://${shop}/admin/themes/current/editor?context=apps`,
      },
      action: {
        label: "Enable Cart Uplift",
        url: `https://${shop}/admin/themes/current/editor?context=apps`,
        external: true,
      },
      completeAction: {
        label: "I've enabled it",
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
    <Page>
      <TitleBar title="Cart Uplift" />

      <Layout>
        <Layout.Section>
          <BlockStack gap="600">
            {/* Order Limit Warnings */}
            {isLimitReached && (
              <Banner
                title="Order limit reached"
                tone="critical"
              >
                <p>
                  You've reached your plan's order limit ({orderLimit} orders/month).
                  Please upgrade to continue using Cart Uplift features.
                </p>
                <Box paddingBlockStart="200">
                  <Button
                    variant="primary"
                    onClick={handleUpgradeClick}
                    disabled={isTestMode}
                  >
                    Upgrade Plan
                  </Button>
                </Box>
              </Banner>
            )}
            
            {!isLimitReached && isInGrace && (
              <Banner
                title="Approaching order limit"
                tone="warning"
              >
                <p>
                  You're in the grace period ({orderCount}/{orderLimit} orders).
                  Upgrade soon to avoid service interruption.
                </p>
                <Box paddingBlockStart="200">
                  <Button
                    onClick={handleUpgradeClick}
                    disabled={isTestMode}
                  >
                    View Plans
                  </Button>
                </Box>
              </Banner>
            )}
            
            {!isLimitReached && !isInGrace && isApproaching && (
              <Banner
                title="Nearing order limit"
                tone="info"
              >
                <p>
                  You've used {orderCount} of {orderLimit} orders this month.
                  Consider upgrading to avoid hitting your limit.
                </p>
                <Box paddingBlockStart="200">
                  <Button
                    onClick={handleUpgradeClick}
                    disabled={isTestMode}
                  >
                    View Plans
                  </Button>
                </Box>
              </Banner>
            )}

            {/* Hero */}
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <InlineStack gap="200" align="space-between" blockAlign="center">
                    <Text variant="heading2xl" as="h1">
                      Cart Uplift
                    </Text>
                    <PlanBadge
                      plan={planTier}
                      orderCount={orderCount}
                      orderLimit={orderLimit}
                      isApproaching={isApproaching || isInGrace}
                    />
                  </InlineStack>
                  <Text variant="bodyLg" as="p" tone="subdued">
                    AI cart upsells, bundles and frequently bought together. Configure what appears in your cart.
                  </Text>
                </BlockStack>

                <InlineStack gap="300">
                  <a href={`/admin/settings${safeSearch}`} className="app-link-no-decoration">
                    <Button size="large" variant="primary">
                      Settings
                    </Button>
                  </a>
                  <a href={`/admin/bundles${safeSearch}`} className="app-link-no-decoration">
                    <Button size="large" variant="secondary">
                      Frequently bought together
                    </Button>
                  </a>
                </InlineStack>
              </BlockStack>
            </Card>

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
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2">
                    Features that grow revenue
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Practical tools for higher spend and a smoother shopping experience.
                  </Text>
                </BlockStack>

                <Divider />

                <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 5 }} gap="400">
                  {/* AI Recommendations */}
                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Bespoke recommendations
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Suggestions tailored to each visitor, based on live browsing and purchase signals.
                      </Text>
                    </BlockStack>
                  </Box>

                  {/* Smart FBT */}
                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Smart bundles
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Spots items often bought together and builds offers with flexible discounts.
                      </Text>
                    </BlockStack>
                  </Box>

                  {/* Progress incentives */}
                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Progress incentives
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Progress bars for free shipping and rewards that help lift cart value.
                      </Text>
                    </BlockStack>
                  </Box>

                  {/* Gift with purchase */}
                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Gift with purchase
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Reward customers at set spend levels. The app handles the rest.
                      </Text>
                    </BlockStack>
                  </Box>

                  {/* Revenue analytics */}
                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Revenue analytics
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Track impressions, clicks, conversions and attributed revenue in real time.
                      </Text>
                    </BlockStack>
                  </Box>
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* How it works */}
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2">
                    How it works
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Three steps to raise average order value.
                  </Text>
                </BlockStack>

                <Divider />

                <InlineGrid columns={{ xs: 1, md: 3 }} gap="500">
                  {/* Step 1 */}
                  <BlockStack gap="300">
                    <Box
                      background="bg-fill-info"
                      padding="200"
                      borderRadius="200"
                      width="32px"
                      minHeight="32px"
                    >
                      <Text variant="headingMd" as="span" alignment="center">
                        1
                      </Text>
                    </Box>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Understands real behaviour
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        The model analyses browsing and purchase patterns to learn how your products relate each other.
                      </Text>
                    </BlockStack>
                  </BlockStack>

                  {/* Step 2 */}
                  <BlockStack gap="300">
                    <Box
                      background="bg-fill-success"
                      padding="200"
                      borderRadius="200"
                      width="32px"
                      minHeight="32px"
                    >
                      <Text variant="headingMd" as="span" alignment="center">
                        <span className="app-step-number-white">2</span>
                      </Text>
                    </Box>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Shows relevant suggestions
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Personalised products and smart offers appear in cart and on product pages.
                      </Text>
                    </BlockStack>
                  </BlockStack>

                  {/* Step 3 */}
                  <BlockStack gap="300">
                    <Box
                      background="bg-fill-warning"
                      padding="200"
                      borderRadius="200"
                      width="32px"
                      minHeight="32px"
                    >
                      <Text variant="headingMd" as="span" alignment="center">
                        3
                      </Text>
                    </Box>
                    <BlockStack gap="200">
                      <Text variant="headingMd" as="h3">
                        Measures and improves
                      </Text>
                      <Text variant="bodyMd" as="p" tone="subdued">
                        Built-in testing tracks performance and continually optimises the model. The more you use it the better it gets!
                      </Text>
                    </BlockStack>
                  </BlockStack>
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* Why it works */}
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text variant="headingLg" as="h2">
                    Why AI beats static rules
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Smarter recommendations, better results. Built to learn from real customer behaviour and adapt as patterns change.
                  </Text>
                </BlockStack>

                <Divider />

                <Box
                  padding="500"
                  borderRadius="300"
                >
                  <BlockStack gap="200">
                    <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h3">
                          Learns continuously
                        </Text>
                        <Text variant="bodyMd" as="p">
                          No hard-coded rules. The model adapts to what people view, click and buy so suggestions stay relevant.
                        </Text>
                      </BlockStack>

                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h3">
                          Personal to each shopper
                        </Text>
                        <Text variant="bodyMd" as="p">
                          Not generic. Visitors see products that fit their intent and context on your site.
                        </Text>
                      </BlockStack>

                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h3">
                          FBT - Smart product pairing
                        </Text>
                        <Text variant="bodyMd" as="p">
                          Identifies products often bought together and offers fair discounts that feel natural.
                        </Text>
                      </BlockStack>

                      <BlockStack gap="200">
                        <Text variant="headingMd" as="h3">
                          Optimises itself
                        </Text>
                        <Text variant="bodyMd" as="p">
                          Tracks what converts and quietly removes suggestions that don’t perform. Your recommendations get better over time.
                        </Text>
                      </BlockStack>
                    </InlineGrid>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>

            {/* Support */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h3">
                    Need help getting started?
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    We can help with set-up and best practice for your catalogue.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button onClick={() => setSupportModalOpen(true)}>
                    Contact support
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
      
      <SupportModal 
        open={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
        planTier={planTier}
      />
    </Page>
  );
}
