import * as React from "react";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Box,
  Flex,
  Panel,
  Text,
  H1,
  H2,
  H3,
  Small,
  Button,
  Badge,
  Grid,
  HR,
  Input,
  Select,
  Checkbox,
} from "@bigcommerce/big-design";
import { CheckIcon } from "@bigcommerce/big-design-icons";
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
  const shop = auth.storeHash;
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

const mapBadgeVariant = (tone?: string): "success" | "warning" | "danger" | "primary" | "secondary" => {
  switch (tone) {
    case 'success': return 'success';
    case 'warning':
    case 'attention': return 'warning';
    case 'critical': return 'danger';
    case 'info':
    case 'new': return 'primary';
    default: return 'secondary';
  }
};

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
        storeHash: shop,
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

  const badgeVariant = mapBadgeVariant(dataQualityTone);

  return (
    <Box padding="medium">
      <Flex flexDirection="column" flexGap="1.5rem">
        {/* Page Header */}
        <Flex justifyContent="space-between" alignItems="center">
          <H1>Settings</H1>
          <Button
            variant={buttonSuccess ? "secondary" : "primary"}
            onClick={handleSaveSettings}
            isLoading={isSaving}
            iconLeft={buttonSuccess ? <CheckIcon /> : undefined}
          >
            {isSaving ? "Saving..." : buttonSuccess ? "Saved!" : "Save"}
          </Button>
        </Flex>

        {/* Success/Error Banners */}
        {showSuccessBanner && (
          <Box style={{ borderLeft: "4px solid #2e7d32", backgroundColor: "#e8f5e9", padding: "1rem", borderRadius: "6px" }}>
            <Text>Settings saved successfully!</Text>
          </Box>
        )}
        {showErrorBanner && (
          <Box style={{ borderLeft: "4px solid #c62828", backgroundColor: "#ffebee", padding: "1rem", borderRadius: "6px" }}>
            <Text>{errorMessage || 'Failed to save settings'}</Text>
          </Box>
        )}

        {/* Status Overview Cards */}
        <Grid gridColumns="repeat(4, 1fr)" gridGap="1rem">
          <Panel>
            <Box padding="medium">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Text color="secondary">Recommendations Status</Text>
                <Badge
                  variant={formSettings.enableRecommendations ? "success" : "primary"}
                  label={formSettings.enableRecommendations ? "On" : "Off"}
                />
              </Flex>
            </Box>
          </Panel>

          <Panel>
            <Box padding="medium">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Text color="secondary">ML Recommendations</Text>
                <Badge
                  variant={formSettings.enableMLRecommendations ? "success" : "primary"}
                  label={formSettings.enableMLRecommendations ? "On" : "Off"}
                />
              </Flex>
            </Box>
          </Panel>

          <Panel>
            <Box padding="medium">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Text color="secondary">Data Quality</Text>
                <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
                  <H2>{dataQualityLabel}</H2>
                  <Badge variant={badgeVariant} label={ordersBadgeText} />
                </Flex>
              </Flex>
            </Box>
          </Panel>

          <Panel>
            <Box padding="medium">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Text color="secondary">AI Learning Progress</Text>
                <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
                  <H2>{loaderData.dataMetrics.qualityScore}%</H2>
                  <Badge
                    variant={
                      loaderData.dataMetrics.qualityScore >= 75 ? "success" :
                      loaderData.dataMetrics.qualityScore >= 50 ? "warning" : "primary"
                    }
                    label={
                      loaderData.dataMetrics.recommendedMode === 'advanced' ? 'Advanced' :
                      loaderData.dataMetrics.recommendedMode === 'standard' ? 'Standard' : 'Basic'
                    }
                  />
                </Flex>
                <Small color="secondary">
                  {loaderData.dataMetrics.orderCount < 10 && "AI is learning from your store"}
                  {loaderData.dataMetrics.orderCount >= 10 && loaderData.dataMetrics.orderCount < 100 && "AI is actively learning patterns"}
                  {loaderData.dataMetrics.orderCount >= 100 && loaderData.dataMetrics.orderCount < 500 && "AI has strong learning data"}
                  {loaderData.dataMetrics.orderCount >= 500 && "AI fully optimized"}
                </Small>
              </Flex>
            </Box>
          </Panel>
        </Grid>

        {/* Main Settings */}
        <Grid gridColumns="repeat(3, 1fr)" gridGap="1rem">
          {/* Left Column */}
          <Flex flexDirection="column" flexGap="1rem">
            {/* Recommendations */}
            <Panel>
              <Box padding="medium">
                <Flex flexDirection="column" flexGap="1rem">
                  <H2>Product Recommendations</H2>

                  <Checkbox
                    label="Enable product recommendations"
                    checked={formSettings.enableRecommendations || false}
                    onChange={(e) => updateSetting("enableRecommendations", e.target.checked)}
                    description="Show personalized product suggestions in cart"
                  />

                  {formSettings.enableRecommendations && (
                    <>
                      <HR />

                      <Checkbox
                        label="Use AI-powered recommendations"
                        checked={formSettings.enableMLRecommendations || false}
                        onChange={(e) => {
                          const value = e.target.checked;
                          updateSetting("enableMLRecommendations", value);
                          if (value && !formSettings.enableRecommendations) {
                            updateSetting("enableRecommendations", true);
                          }
                        }}
                        description="Personalize suggestions with machine learning"
                      />

                      {formSettings.enableMLRecommendations && (
                        <>
                          <HR />

                          <Select
                            label="Recommendation strategy"
                            options={[
                              { content: 'Balanced - Mix of AI and popular products', value: 'balanced' },
                              { content: 'AI-First - Prioritize personalized suggestions', value: 'ai_first' },
                              { content: 'Popular - Show bestsellers and trending items', value: 'popular' }
                            ]}
                            value={formSettings.mlPersonalizationMode || "balanced"}
                            onOptionChange={(value) => updateSetting("mlPersonalizationMode", value)}
                          />
                        </>
                      )}

                      <HR />

                      <Checkbox
                        label="Threshold-based suggestions"
                        checked={formSettings.enableThresholdBasedSuggestions || false}
                        onChange={(e) => updateSetting("enableThresholdBasedSuggestions", e.target.checked)}
                        description="Help customers reach free shipping and gift thresholds"
                      />

                      {formSettings.enableThresholdBasedSuggestions && (
                        <>
                          <Select
                            label="Threshold strategy"
                            options={[
                              { content: 'Smart AI - Best relevance + price match', value: 'smart' },
                              { content: 'Price Only - Cheapest path to threshold', value: 'price' },
                              { content: 'Popular + Price - Trending items at right price', value: 'popular_price' }
                            ]}
                            value={formSettings.thresholdSuggestionMode || 'smart'}
                            onOptionChange={(value) => updateSetting("thresholdSuggestionMode", value)}
                          />

                          <HR />
                        </>
                      )}

                      <Checkbox
                        label="Hide recommendations when thresholds met"
                        checked={formSettings.hideRecommendationsAfterThreshold || false}
                        onChange={(e) => updateSetting("hideRecommendationsAfterThreshold", e.target.checked)}
                        description="Collapse section after all rewards unlocked"
                      />
                    </>
                  )}
                </Flex>
              </Box>
            </Panel>

          </Flex>

          {/* Middle Column - Privacy & Data */}
          <Flex flexDirection="column" flexGap="1rem">
            {formSettings.enableMLRecommendations && (
              <Panel>
                <Box padding="medium">
                  <Flex flexDirection="column" flexGap="1rem">
                    <Flex flexDirection="column" flexGap="0.5rem">
                      <H2>Privacy &amp; Data</H2>
                      <Text color="secondary">
                        Control what data the AI uses to learn
                      </Text>
                    </Flex>

                    <Panel>
                      <Box padding="medium" backgroundColor="secondary">
                        <Flex flexDirection="column" flexGap="0.75rem">
                          <Flex flexDirection="row" flexGap="0.5rem">
                            <Badge variant={badgeVariant} label={ordersBadgeText} />
                            <Badge variant={badgeVariant} label={`Quality: ${dataQualityLabel}`} />
                          </Flex>

                          <Select
                            label="Data usage level"
                            options={[
                              { content: 'Basic - Product data only (no personal tracking)', value: 'basic' },
                              { content: 'Standard - Session tracking (no customer ID)', value: 'standard' },
                              { content: 'Advanced - Full personalization (customer profiles)', value: 'advanced' }
                            ]}
                            value={formSettings.mlPrivacyLevel || "basic"}
                            onOptionChange={(value) => {
                              updateSetting("mlPrivacyLevel", value);
                              if (value === 'standard' || value === 'advanced') {
                                updateSetting("enableBehaviorTracking", true);
                              } else {
                                updateSetting("enableBehaviorTracking", false);
                              }
                            }}
                          />

                          {formSettings.mlPrivacyLevel === 'basic' && (
                            <Box marginTop="small">
                              <Text color="secondary">
                                <strong>Basic mode:</strong> Uses product order data and categories only. No session or customer tracking. Completely anonymous.
                              </Text>
                            </Box>
                          )}
                          {formSettings.mlPrivacyLevel === 'standard' && (
                            <Box marginTop="small">
                              <Text color="secondary">
                                <strong>Standard mode:</strong> Tracks anonymous shopping sessions but no customer identity. Shows what products go well together.
                              </Text>
                            </Box>
                          )}
                          {formSettings.mlPrivacyLevel === 'advanced' && (
                            <Box marginTop="small">
                              <Flex flexDirection="column" flexGap="0.75rem">
                                <Text color="secondary">
                                  <strong>Advanced mode:</strong> Full behavioral tracking with customer ID. Learns individual preferences for returning customers.
                                </Text>
                                <Box style={{ borderLeft: "4px solid #ed6c02", backgroundColor: "#fff3e0", padding: "1rem", borderRadius: "6px" }}>
                                  <Text>
                                    Update your privacy policy to inform customers about shopping pattern analysis.
                                  </Text>
                                </Box>
                              </Flex>
                            </Box>
                          )}
                        </Flex>
                      </Box>
                    </Panel>

                    <Input
                      label="Data retention period"
                      type="number"
                      value={formSettings.mlDataRetentionDays || "90"}
                      onChange={(e) => updateSetting("mlDataRetentionDays", e.target.value)}
                      description="How long to keep learning data"
                    />
                  </Flex>
                </Box>
              </Panel>
            )}
          </Flex>

          {/* Right Column - Text Customization */}
          <Flex flexDirection="column" flexGap="1rem">
            <Panel>
              <Box padding="medium">
                <Flex flexDirection="column" flexGap="1rem">
                  <H2>Text Customization</H2>

                  <Flex flexDirection="column" flexGap="1rem">
                    <H3>Cart Links</H3>

                    <Input
                      label="Promo code link"
                      value={formSettings.discountLinkText || "+ Got a promotion code?"}
                      onChange={(e) => updateSetting("discountLinkText", e.target.value)}
                      description="Text for discount code link"
                      placeholder="+ Got a promotion code?"
                    />

                    <Input
                      label="Order note link"
                      value={formSettings.notesLinkText || "+ Add order notes"}
                      onChange={(e) => updateSetting("notesLinkText", e.target.value)}
                      description="Text for order notes link"
                      placeholder="+ Add order notes"
                    />

                    <HR />

                    <H3>Gift Settings</H3>

                    <Input
                      label="Free gift price label"
                      value={formSettings.giftPriceText || "FREE"}
                      onChange={(e) => updateSetting("giftPriceText", e.target.value)}
                      description="Text shown instead of price for free gifts"
                      placeholder="FREE"
                    />

                    <HR />

                    <H3>Button Labels</H3>

                    <Input
                      label="Checkout button"
                      value={formSettings.checkoutButtonText || "CHECKOUT"}
                      onChange={(e) => updateSetting("checkoutButtonText", e.target.value)}
                    />

                    <Input
                      label="Add button"
                      value={formSettings.addButtonText || "Add"}
                      onChange={(e) => updateSetting("addButtonText", e.target.value)}
                    />

                    <Input
                      label="Apply button"
                      value={formSettings.applyButtonText || "Apply"}
                      onChange={(e) => updateSetting("applyButtonText", e.target.value)}
                    />
                  </Flex>
                </Flex>
              </Box>
            </Panel>
          </Flex>
        </Grid>
      </Flex>
    </Box>
  );
}

export function ErrorBoundary() {
  return (
    <Box padding="medium">
      <H1>Settings Error</H1>
      <Panel>
        <Box padding="medium">
          <Text>An error occurred while loading settings. Please refresh the page or contact support if the issue persists.</Text>
        </Box>
      </Panel>
    </Box>
  );
}
