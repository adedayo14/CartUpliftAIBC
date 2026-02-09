import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  TextField,
  Text,
  Select,
  Toast,
  Frame,
  Checkbox,
  Banner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { BUNDLE_STATUS, DISCOUNT_TYPES } from "~/constants/bundle";

const COMPONENT_VERSION = "v3.0.0-full-edit-support";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  console.log('🔵 [BundleEdit] Loader called');
  
  try {
    // Authenticate with proper error handling
    const { session } = await authenticate.admin(request);
    const { shop } = session;
    const { id } = params;

    console.log('🔵 [BundleEdit] Shop:', shop, 'Bundle ID:', id);

    if (!id) {
      console.error('🔴 [BundleEdit] No bundle ID provided');
      throw new Response("Bundle ID is required", { status: 400 });
    }

    const bundle = await prisma.bundle.findFirst({
      where: { id, shop },
    });

    if (!bundle) {
      console.error('🔴 [BundleEdit] Bundle not found:', id);
      throw new Response("Bundle not found", { status: 404 });
    }

    console.log('✅ [BundleEdit] Bundle loaded successfully:', bundle.name);
    return json({ bundle, shop });
  } catch (error) {
    console.error('🔴 [BundleEdit] Loader error:', error);
    // If it's a Response (like redirect), throw it directly
    if (error instanceof Response) {
      throw error;
    }
    // Otherwise, throw a generic error
    throw new Response("Failed to load bundle", { status: 500 });
  }
};

export default function BundleEdit() {
  const { bundle, shop } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Feature flags - set to true to show advanced fields
  const SHOW_MINIMUM_FIELDS = false;
  const SHOW_ADVANCED_OPTIONS = false;

  useEffect(() => {
    console.log(`🎨 [BundleEdit] Component loaded - ${COMPONENT_VERSION}`);
    console.log('📦 [BundleEdit] Bundle:', bundle);
    console.log('🏪 [BundleEdit] Shop:', shop);
  }, [bundle, shop]);

  const [name, setName] = useState(bundle.name);
  const [description, setDescription] = useState(bundle.description || "");
  const [status, setStatus] = useState(bundle.status);
  const [discountType, setDiscountType] = useState(bundle.discountType || DISCOUNT_TYPES.PERCENTAGE);
  const [discountValue, setDiscountValue] = useState(String(bundle.discountValue));
  const [assignmentType, setAssignmentType] = useState(bundle.assignmentType || "specific");
  const [minProducts, setMinProducts] = useState(bundle.minProducts ? String(bundle.minProducts) : "");
  const [minBundlePrice, setMinBundlePrice] = useState(bundle.minBundlePrice ? String(bundle.minBundlePrice) : "");
  const [allowDeselect, setAllowDeselect] = useState(bundle.allowDeselect ?? true);
  const [hideIfNoML, setHideIfNoML] = useState(bundle.hideIfNoML ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ content: string; error?: boolean } | null>(null);

  const handleSave = useCallback(async () => {
    console.log('💾 [BundleEdit] Save clicked');
    console.log('📦 [BundleEdit] Bundle ID:', bundle.id);
    console.log('🏪 [BundleEdit] Shop:', shop);
    
    setIsSaving(true);

    try {
      const payload = {
        action: "update-bundle",
        shop,
        bundleId: bundle.id,
        name,
        description,
        status,
        discountType,
        discountValue: parseFloat(discountValue) || 0,
        assignmentType,
        minProducts: minProducts ? parseInt(minProducts) : null,
        minBundlePrice: minBundlePrice ? parseFloat(minBundlePrice) : null,
        allowDeselect,
        hideIfNoML,
      };
      
      // Use XMLHttpRequest to avoid Remix interception in Shopify embedded apps
      const xhr = new XMLHttpRequest();
      const authParams = window.location.search;
      const apiEndpoint = '/admin/api/bundle-management' + authParams;

      const result = await new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
        xhr.open('POST', apiEndpoint, true);
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data);
            } catch (_e) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`Server returned ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify(payload));
      });

      if (result.success) {
        setToast({ content: "Bundle updated successfully" });
        // Navigate back to bundles list immediately
        navigate('/app/bundles', { replace: true });
      } else {
        setToast({ content: result.error || "Failed to update bundle", error: true });
      }
    } catch (error) {
      setToast({ content: "Failed to update bundle", error: true });
    } finally {
      setIsSaving(false);
    }
  }, [bundle.id, shop, name, description, status, discountType, discountValue, assignmentType, minProducts, minBundlePrice, allowDeselect, hideIfNoML, navigate]);

  return (
    <Frame>
      <Page
        title={`Edit: ${bundle.name}`}
        backAction={{
          url: "/app/bundles" + window.location.search,
        }}
        primaryAction={{
          content: "Save",
          onAction: handleSave,
          loading: isSaving,
        }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Basic Information
                </Text>
                <TextField
                  label="Bundle Name"
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                />
                <TextField
                  label="Description"
                  value={description}
                  onChange={setDescription}
                  autoComplete="off"
                  multiline={3}
                />
                <TextField
                  label="Type"
                  value={bundle.type}
                  autoComplete="off"
                  disabled
                  helpText="Bundle type cannot be changed after creation"
                />
                <Select
                  label="Status"
                  options={[
                    { label: "Active", value: BUNDLE_STATUS.ACTIVE },
                    { label: "Paused", value: BUNDLE_STATUS.PAUSED },
                  ]}
                  value={status}
                  onChange={setStatus}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Discount Configuration
                </Text>
                <Banner tone="warning">
                  <Text as="p" variant="bodySm">
                    <strong>Discount Setup Required:</strong> Create a matching discount in Shopify Admin. Cart Uplift doesn't auto-generate discounts—this value is for display only.
                  </Text>
                </Banner>
                <Select
                  label="Discount Type"
                  options={[
                    { label: "Percentage", value: DISCOUNT_TYPES.PERCENTAGE },
                    { label: "Fixed Amount", value: DISCOUNT_TYPES.FIXED },
                  ]}
                  value={discountType}
                  onChange={setDiscountType}
                />
                <TextField
                  label="Discount Value"
                  value={discountValue}
                  onChange={setDiscountValue}
                  autoComplete="off"
                  type="number"
                  suffix={discountType === DISCOUNT_TYPES.PERCENTAGE ? "%" : "USD"}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Display & Assignment
                </Text>
                <Select
                  label="Show Bundle On"
                  options={[
                    { label: "All product pages", value: "all" },
                    { label: "Specific product pages", value: "specific" },
                  ]}
                  value={assignmentType}
                  onChange={setAssignmentType}
                  helpText={assignmentType === "specific" 
                    ? "This bundle will show on the product pages selected during creation" 
                    : "This bundle will appear on all product pages"}
                />
                {assignmentType === "all" && (
                  <Banner tone="info" hideIcon>
                    This bundle will be displayed on all product pages in your store.
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Hidden for now - keep for future use. Set SHOW_MINIMUM_FIELDS=true to enable */}
          {SHOW_MINIMUM_FIELDS && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Requirements & Constraints
                  </Text>
                  <TextField
                    label="Minimum Products"
                    value={minProducts}
                    onChange={setMinProducts}
                    autoComplete="off"
                    type="number"
                    helpText="Minimum number of products required in bundle (optional)"
                  />
                  <TextField
                    label="Minimum Bundle Price"
                    value={minBundlePrice}
                    onChange={setMinBundlePrice}
                    autoComplete="off"
                    type="number"
                    prefix="$"
                    helpText="Minimum total price required for bundle (optional)"
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Hidden - these are now defaults: allowDeselect=true, hideIfNoML=false 
              Set SHOW_ADVANCED_OPTIONS=true to enable */}
          {SHOW_ADVANCED_OPTIONS && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Advanced Options
                  </Text>
                  <Checkbox
                    label="Allow customers to deselect items"
                    checked={allowDeselect}
                    onChange={setAllowDeselect}
                    helpText="Let customers remove items from the bundle before adding to cart"
                  />
                  <Checkbox
                    label="Hide if no ML recommendations"
                    checked={hideIfNoML}
                    onChange={setHideIfNoML}
                    helpText="Only show this bundle when AI has confidence in recommendations"
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>
      </Page>
      {toast && (
        <Toast
          content={toast.content}
          error={toast.error}
          onDismiss={() => setToast(null)}
        />
      )}
    </Frame>
  );
}

export function ErrorBoundary() {
  return (
    <Page title="Error">
      <Layout>
        <Layout.Section>
          <Card>
            <Text as="p">Bundle not found or an error occurred.</Text>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
