import * as React from "react";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  TextField,
  Select,
  BlockStack,
  Text,
  Banner,
  Checkbox,
  Button,
  InlineStack,
  InlineGrid,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";
import { CheckIcon } from '@shopify/polaris-icons';
import { withAuth } from "../utils/auth.server";
import { getSettings } from "../models/settings.server";
import { getDataQualityMetrics } from "../services/ml-analytics.server";

interface AppSettings {
  enableRecommendations?: boolean;
  enableMLRecommendations?: boolean;
  mlPersonalizationMode?: string;
  enableThresholdBasedSuggestions?: boolean;
  thresholdSuggestionMode?: string;
  hideRecommendationsAfterThreshold?: boolean;
  discountLinkText?: string;
  notesLinkText?: string;
  giftPriceText?: string;
  checkoutButtonText?: string;
  addButtonText?: string;
  applyButtonText?: string;
  mlPrivacyLevel?: string;
  enableBehaviorTracking?: boolean;
  mlDataRetentionDays?: string;
  enableRecommendationTitleCaps?: boolean;
  [key: string]: unknown;
}

export const loader = withAuth(async ({ auth }) => {
  const shop = auth.session.shop;
  const settings = await getSettings(shop);

  console.log('[Settings Loader] Cart Interaction fields from DB:', {
    enableRecommendationTitleCaps: settings.enableRecommendationTitleCaps,
    discountLinkText: settings.discountLinkText,
    notesLinkText: settings.notesLinkText
  });

  const dataMetrics = await getDataQualityMetrics(shop);

  let ordersBadgeText = `${dataMetrics.orderCount} Orders`;
  let dataQualityTone: 'info' | 'success' | 'warning' | 'critical' = 'info';
  let dataQualityLabel = 'New Store';

  if (dataMetrics.qualityLevel === 'new_store') {
    dataQualityTone = 'info';
    dataQualityLabel = 'New Store';
  } else if (dataMetrics.qualityLevel === 'growing') {
    dataQualityTone = 'warning';
    dataQualityLabel = 'Growing';
  } else if (dataMetrics.qualityLevel === 'good') {
    dataQualityTone = 'success';
    dataQualityLabel = 'Good';
  } else if (dataMetrics.qualityLevel === 'rich') {
    dataQualityTone = 'success';
    dataQualityLabel = 'Excellent';
  }

  return json({
    shop,
    settings,
    ordersBadgeText,
    dataQualityTone,
    dataQualityLabel,
    dataMetrics
  });
});

export default function AppSettings() {
  const loaderData = useLoaderData<typeof loader>();
  const [formSettings, setFormSettings] = React.useState<AppSettings>(loaderData.settings || {});
  const [showSuccessBanner, setShowSuccessBanner] = React.useState(false);
  const [showErrorBanner, setShowErrorBanner] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [buttonSuccess, setButtonSuccess] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  const ordersBadgeText = loaderData.ordersBadgeText || "0 Orders";
  const dataQualityTone = loaderData.dataQualityTone || "info";
  const dataQualityLabel = loaderData.dataQualityLabel || "Low";

  const updateSetting = (key: string, value: unknown) => {
    setFormSettings((prev: AppSettings) => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setShowSuccessBanner(false);
    setShowErrorBanner(false);

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const sessionToken = urlParams.get('id_token') || '';
      
      // Use shop from loader data instead of URL params
      const shop = loaderData.shop;
      
      if (!shop) {
        setShowErrorBanner(true);
        setErrorMessage('Shop information missing. Please refresh the page.');
        setIsSaving(false);
        return;
      }
      
      const payload = {
        shop,
        sessionToken,
        settings: formSettings
      };
      
      console.log('[Settings Save] Payload:', payload);
      console.log('[Settings Save] Cart Interaction fields:', {
        enableRecommendationTitleCaps: formSettings.enableRecommendationTitleCaps,
        discountLinkText: formSettings.discountLinkText,
        notesLinkText: formSettings.notesLinkText
      });
      
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      
      const data = await response.json();
      console.log('[Settings Save] API Response:', data);
      console.log('[Settings Save] Returned Cart Interaction:', {
        enableRecommendationTitleCaps: data.settings?.enableRecommendationTitleCaps,
        discountLinkText: data.settings?.discountLinkText,
        notesLinkText: data.settings?.notesLinkText
      });

      if (data.success) {
        setShowSuccessBanner(true);
        setButtonSuccess(true);
        setTimeout(() => {
          setShowSuccessBanner(false);
          setButtonSuccess(false);
        }, 3000);
      } else {
        setShowErrorBanner(true);
        setErrorMessage(data.error || 'Failed to save settings');
        setTimeout(() => setShowErrorBanner(false), 5000);
      }
    } catch (error: unknown) {
      setShowErrorBanner(true);
      const message = error instanceof Error ? error.message : 'Failed to save settings';
      setErrorMessage(message);
      setTimeout(() => setShowErrorBanner(false), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const badgeTone = dataQualityTone === 'info' ? 'info' :
    dataQualityTone === 'success' ? 'success' :
    dataQualityTone === 'warning' ? 'warning' :
    dataQualityTone === 'critical' ? 'critical' : undefined;

  return (
    <Page
      title="Settings"
      fullWidth
      primaryAction={
        <Button
          variant="primary"
          tone={buttonSuccess ? "success" : undefined}
          onClick={handleSaveSettings}
          loading={isSaving}
          icon={buttonSuccess ? CheckIcon : undefined}
        >
          {isSaving ? "Saving..." : buttonSuccess ? "Saved!" : "Save"}
        </Button>
      }
    >
      <Box paddingBlockEnd="800">
        <BlockStack gap="500">
          {/* Success/Error Banners */}
          {showSuccessBanner && (
            <Banner tone="success">Settings saved successfully!</Banner>
          )}
          {showErrorBanner && (
            <Banner tone="critical">{errorMessage || 'Failed to save settings'}</Banner>
          )}

        {/* Status Overview Cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 2, lg: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Recommendations Status</Text>
              <Badge tone={formSettings.enableRecommendations ? "success" : "info"}>
                {formSettings.enableRecommendations ? "On" : "Off"}
              </Badge>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">ML Recommendations</Text>
              <Badge tone={formSettings.enableMLRecommendations ? "success" : "info"}>
                {formSettings.enableMLRecommendations ? "On" : "Off"}
              </Badge>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">Data Quality</Text>
              <InlineStack gap="200" align="start" blockAlign="center">
                <Text as="h2" variant="headingLg">{dataQualityLabel}</Text>
                <Badge tone={badgeTone}>{ordersBadgeText}</Badge>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">AI Learning Progress</Text>
              <InlineStack gap="200" align="start" blockAlign="center">
                <Text as="h2" variant="headingLg">{loaderData.dataMetrics.qualityScore}%</Text>
                <Badge tone={
                  loaderData.dataMetrics.qualityScore >= 75 ? "success" : 
                  loaderData.dataMetrics.qualityScore >= 50 ? "attention" : "info"
                }>
                  {loaderData.dataMetrics.recommendedMode === 'advanced' ? 'Advanced' :
                   loaderData.dataMetrics.recommendedMode === 'standard' ? 'Standard' : 'Basic'}
                </Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {loaderData.dataMetrics.orderCount < 10 && "AI is learning from your store"}
                {loaderData.dataMetrics.orderCount >= 10 && loaderData.dataMetrics.orderCount < 100 && "AI is actively learning patterns"}
                {loaderData.dataMetrics.orderCount >= 100 && loaderData.dataMetrics.orderCount < 500 && "AI has strong learning data"}
                {loaderData.dataMetrics.orderCount >= 500 && "AI fully optimized"}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Main Settings */}
        <InlineGrid columns={{ xs: 1, sm: 1, md: 2, lg: 3 }} gap="400">
          {/* Left Column */}
          <BlockStack gap="400">
            {/* Recommendations */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Product Recommendations</Text>
                
                <Checkbox
                  label="Enable product recommendations"
                  checked={formSettings.enableRecommendations}
                  onChange={(value) => updateSetting("enableRecommendations", value)}
                  helpText="Show personalized product suggestions in cart"
                />

                {formSettings.enableRecommendations && (
                  <>
                    <Divider />
                    
                    <Checkbox
                      label="Use AI-powered recommendations"
                      checked={formSettings.enableMLRecommendations}
                      onChange={(value) => {
                        updateSetting("enableMLRecommendations", value);
                        if (value && !formSettings.enableRecommendations) {
                          updateSetting("enableRecommendations", true);
                        }
                      }}
                      helpText="Personalize suggestions with machine learning"
                    />

                    {formSettings.enableMLRecommendations && (
                      <>
                        <Divider />
                        
                        <Select
                          label="Recommendation strategy"
                          options={[
                            { label: 'Balanced - Mix of AI and popular products', value: 'balanced' },
                            { label: 'AI-First - Prioritize personalized suggestions', value: 'ai_first' },
                            { label: 'Popular - Show bestsellers and trending items', value: 'popular' }
                          ]}
                          value={formSettings.mlPersonalizationMode || "balanced"}
                          onChange={(value) => updateSetting("mlPersonalizationMode", value)}
                        />
                      </>
                    )}

                    <Divider />
                    
                    <Checkbox
                      label="Threshold-based suggestions"
                      checked={formSettings.enableThresholdBasedSuggestions}
                      onChange={(value) => updateSetting("enableThresholdBasedSuggestions", value)}
                      helpText="Help customers reach free shipping and gift thresholds"
                    />

                    {formSettings.enableThresholdBasedSuggestions && (
                      <>
                        <Select
                          label="Threshold strategy"
                          options={[
                            { label: 'Smart AI - Best relevance + price match', value: 'smart' },
                            { label: 'Price Only - Cheapest path to threshold', value: 'price' },
                            { label: 'Popular + Price - Trending items at right price', value: 'popular_price' }
                          ]}
                          value={formSettings.thresholdSuggestionMode || 'smart'}
                          onChange={(value) => updateSetting("thresholdSuggestionMode", value)}
                        />

                        <Divider />
                      </>
                    )}

                    <Checkbox
                      label="Hide recommendations when thresholds met"
                      checked={formSettings.hideRecommendationsAfterThreshold}
                      onChange={(value) => updateSetting("hideRecommendationsAfterThreshold", value)}
                      helpText="Collapse section after all rewards unlocked"
                    />
                  </>
                )}
              </BlockStack>
            </Card>

          </BlockStack>

          {/* Middle Column - Privacy & Data */}
          <BlockStack gap="400">
            {formSettings.enableMLRecommendations && (
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h2">Privacy & Data</Text>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Control what data the AI uses to learn
                    </Text>
                  </BlockStack>

                  <Card background="bg-surface-secondary">
                    <BlockStack gap="300">
                      <InlineStack gap="200">
                        <Badge tone={badgeTone}>{ordersBadgeText}</Badge>
                        <Badge tone={badgeTone}>{`Quality: ${dataQualityLabel}`}</Badge>
                      </InlineStack>

                      <Select
                        label="Data usage level"
                        options={[
                          { label: 'Basic - Product data only (no personal tracking)', value: 'basic' },
                          { label: 'Standard - Session tracking (no customer ID)', value: 'standard' },
                          { label: 'Advanced - Full personalization (customer profiles)', value: 'advanced' }
                        ]}
                        value={formSettings.mlPrivacyLevel || "basic"}
                        onChange={(value) => {
                          updateSetting("mlPrivacyLevel", value);
                          if (value === 'standard' || value === 'advanced') {
                            updateSetting("enableBehaviorTracking", true);
                          } else {
                            updateSetting("enableBehaviorTracking", false);
                          }
                        }}
                      />

                      {formSettings.mlPrivacyLevel === 'basic' && (
                        <Box paddingBlockStart="200">
                          <Text as="p" variant="bodyMd" tone="subdued">
                            <strong>Basic mode:</strong> Uses product order data and categories only. No session or customer tracking. Completely anonymous.
                          </Text>
                        </Box>
                      )}
                      {formSettings.mlPrivacyLevel === 'standard' && (
                        <Box paddingBlockStart="200">
                          <Text as="p" variant="bodyMd" tone="subdued">
                            <strong>Standard mode:</strong> Tracks anonymous shopping sessions but no customer identity. Shows what products go well together.
                          </Text>
                        </Box>
                      )}
                      {formSettings.mlPrivacyLevel === 'advanced' && (
                        <Box paddingBlockStart="200">
                          <BlockStack gap="300">
                            <Text as="p" variant="bodyMd" tone="subdued">
                              <strong>Advanced mode:</strong> Full behavioral tracking with customer ID. Learns individual preferences for returning customers.
                            </Text>
                            <Banner tone="warning">
                              <Text as="p" variant="bodyMd">
                                Update your privacy policy to inform customers about shopping pattern analysis.
                              </Text>
                            </Banner>
                          </BlockStack>
                        </Box>
                      )}
                    </BlockStack>
                  </Card>

                  <TextField
                    label="Data retention period"
                    type="number"
                    value={formSettings.mlDataRetentionDays || "90"}
                    onChange={(value) => updateSetting("mlDataRetentionDays", value)}
                    suffix="days"
                    helpText="How long to keep learning data"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>
            )}
          </BlockStack>

          {/* Right Column - Text Customization */}
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Text Customization</Text>
                
                <BlockStack gap="400">
                  <Text variant="headingSm" as="h3">Cart Links</Text>

                  <TextField
                    label="Promo code link"
                    value={formSettings.discountLinkText || "+ Got a promotion code?"}
                    onChange={(value) => updateSetting("discountLinkText", value)}
                    helpText="Text for discount code link"
                    placeholder="+ Got a promotion code?"
                    autoComplete="off"
                  />

                  <TextField
                    label="Order note link"
                    value={formSettings.notesLinkText || "+ Add order notes"}
                    onChange={(value) => updateSetting("notesLinkText", value)}
                    helpText="Text for order notes link"
                    placeholder="+ Add order notes"
                    autoComplete="off"
                  />

                  <Divider />

                  <Text variant="headingSm" as="h3">Gift Settings</Text>
                  
                  <TextField
                    label="Free gift price label"
                    value={formSettings.giftPriceText || "FREE"}
                    onChange={(value) => updateSetting("giftPriceText", value)}
                    helpText="Text shown instead of price for free gifts"
                    placeholder="FREE"
                    autoComplete="off"
                  />

                  <Divider />

                  <Text variant="headingSm" as="h3">Button Labels</Text>

                  <TextField
                    label="Checkout button"
                    value={formSettings.checkoutButtonText || "CHECKOUT"}
                    onChange={(value) => updateSetting("checkoutButtonText", value)}
                    autoComplete="off"
                  />

                  <TextField
                    label="Add button"
                    value={formSettings.addButtonText || "Add"}
                    onChange={(value) => updateSetting("addButtonText", value)}
                    autoComplete="off"
                  />

                  <TextField
                    label="Apply button"
                    value={formSettings.applyButtonText || "Apply"}
                    onChange={(value) => updateSetting("applyButtonText", value)}
                    autoComplete="off"
                  />
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </InlineGrid>
      </BlockStack>
      </Box>
    </Page>
  );
}

export function ErrorBoundary() {
  return (
    <Page title="Settings Error">
      <Card>
        <BlockStack gap="400">
          <Text as="p">An error occurred while loading settings. Please refresh the page or contact support if the issue persists.</Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
