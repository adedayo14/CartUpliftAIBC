import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Box,
  Flex,
  Panel,
  Text,
  H1,
  H2,
  Small,
  Button,
  Input,
  Textarea,
  Select,
  Checkbox,
} from "@bigcommerce/big-design";
import { ArrowBackIcon } from "@bigcommerce/big-design-icons";
import { authenticateAdmin } from "../bigcommerce.server";
import prisma from "../db.server";
import { BUNDLE_STATUS, DISCOUNT_TYPES } from "~/constants/bundle";

const COMPONENT_VERSION = "v3.0.0-full-edit-support";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  console.log('🔵 [BundleEdit] Loader called');

  try {
    // Authenticate with proper error handling
    const { session, storeHash } = await authenticateAdmin(request);
    const shop = storeHash;
    const { id } = params;

    console.log('🔵 [BundleEdit] Shop:', shop, 'Bundle ID:', id);

    if (!id) {
      console.error('🔴 [BundleEdit] No bundle ID provided');
      throw new Response("Bundle ID is required", { status: 400 });
    }

    const bundle = await prisma.bundle.findFirst({
      where: { id, storeHash: shop },
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

      // Use XMLHttpRequest to avoid Remix interception in embedded apps
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
    <>
      <Box padding="medium">
        {/* Page header with back button and save */}
        <Flex justifyContent="space-between" alignItems="center" marginBottom="large">
          <Flex alignItems="center" flexGap="1rem">
            <Button
              variant="subtle"
              onClick={() => navigate("/app/bundles" + window.location.search)}
              iconOnly={<ArrowBackIcon />}
            />
            <H1>{`Edit: ${bundle.name}`}</H1>
          </Flex>
          <Button
            variant="primary"
            onClick={handleSave}
            isLoading={isSaving}
          >
            Save
          </Button>
        </Flex>

        {/* Layout */}
        <Flex flexDirection="column" flexGap="1.5rem">
          {/* Basic Information */}
          <Box>
            <Panel header="Basic Information">
              <Box padding="xSmall">
                <Flex flexDirection="column" flexGap="1rem">
                  <Input
                    label="Bundle Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="off"
                  />
                  <Textarea
                    label="Description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                  <Input
                    label="Type"
                    value={bundle.type}
                    autoComplete="off"
                    disabled
                    description="Bundle type cannot be changed after creation"
                  />
                  <Select
                    label="Status"
                    options={[
                      { content: "Active", value: BUNDLE_STATUS.ACTIVE },
                      { content: "Paused", value: BUNDLE_STATUS.PAUSED },
                    ]}
                    value={status}
                    onOptionChange={setStatus}
                  />
                </Flex>
              </Box>
            </Panel>
          </Box>

          {/* Discount Configuration */}
          <Box>
            <Panel header="Discount Configuration">
              <Box padding="xSmall">
                <Flex flexDirection="column" flexGap="1rem">
                  {/* Warning banner */}
                  <Box
                    borderLeft="box"
                    padding="small"
                    backgroundColor="warning10"
                  >
                    <Text>
                      <strong>Discount Setup Required:</strong> Create a matching discount in BigCommerce Control Panel. Cart Uplift doesn't auto-generate discounts -- this value is for display only.
                    </Text>
                  </Box>
                  <Select
                    label="Discount Type"
                    options={[
                      { content: "Percentage", value: DISCOUNT_TYPES.PERCENTAGE },
                      { content: "Fixed Amount", value: DISCOUNT_TYPES.FIXED },
                    ]}
                    value={discountType}
                    onOptionChange={setDiscountType}
                  />
                  <Input
                    label="Discount Value"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    autoComplete="off"
                    type="number"
                    description={discountType === DISCOUNT_TYPES.PERCENTAGE ? "Value in %" : "Value in USD"}
                  />
                </Flex>
              </Box>
            </Panel>
          </Box>

          {/* Display & Assignment */}
          <Box>
            <Panel header="Display & Assignment">
              <Box padding="xSmall">
                <Flex flexDirection="column" flexGap="1rem">
                  <Select
                    label="Show Bundle On"
                    options={[
                      { content: "All product pages", value: "all" },
                      { content: "Specific product pages", value: "specific" },
                    ]}
                    value={assignmentType}
                    onOptionChange={setAssignmentType}
                    description={assignmentType === "specific"
                      ? "This bundle will show on the product pages selected during creation"
                      : "This bundle will appear on all product pages"}
                  />
                  {assignmentType === "all" && (
                    <Box
                      borderLeft="box"
                      padding="small"
                      backgroundColor="info10"
                    >
                      <Text>
                        This bundle will be displayed on all product pages in your store.
                      </Text>
                    </Box>
                  )}
                </Flex>
              </Box>
            </Panel>
          </Box>

          {/* Hidden for now - keep for future use. Set SHOW_MINIMUM_FIELDS=true to enable */}
          {SHOW_MINIMUM_FIELDS && (
            <Box>
              <Panel header="Requirements & Constraints">
                <Box padding="xSmall">
                  <Flex flexDirection="column" flexGap="1rem">
                    <Input
                      label="Minimum Products"
                      value={minProducts}
                      onChange={(e) => setMinProducts(e.target.value)}
                      autoComplete="off"
                      type="number"
                      description="Minimum number of products required in bundle (optional)"
                    />
                    <Input
                      label="Minimum Bundle Price"
                      value={minBundlePrice}
                      onChange={(e) => setMinBundlePrice(e.target.value)}
                      autoComplete="off"
                      type="number"
                      description="Minimum total price required for bundle (optional)"
                    />
                  </Flex>
                </Box>
              </Panel>
            </Box>
          )}

          {/* Hidden - these are now defaults: allowDeselect=true, hideIfNoML=false
              Set SHOW_ADVANCED_OPTIONS=true to enable */}
          {SHOW_ADVANCED_OPTIONS && (
            <Box>
              <Panel header="Advanced Options">
                <Box padding="xSmall">
                  <Flex flexDirection="column" flexGap="1rem">
                    <Checkbox
                      label="Allow customers to deselect items"
                      checked={allowDeselect}
                      onChange={(e) => setAllowDeselect(e.target.checked)}
                      description="Let customers remove items from the bundle before adding to cart"
                    />
                    <Checkbox
                      label="Hide if no ML recommendations"
                      checked={hideIfNoML}
                      onChange={(e) => setHideIfNoML(e.target.checked)}
                      description="Only show this bundle when AI has confidence in recommendations"
                    />
                  </Flex>
                </Box>
              </Panel>
            </Box>
          )}
        </Flex>
      </Box>

      {/* Toast notification */}
      {toast && (
        <Box
          style={{
            position: "fixed",
            bottom: "1rem",
            right: "1rem",
            zIndex: 9999,
            padding: "0.75rem 1rem",
            backgroundColor: toast.error ? "#DB3643" : "#208831",
            color: "#FFFFFF",
            borderRadius: "4px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            cursor: "pointer",
          }}
          onClick={() => setToast(null)}
        >
          <Text color="white">{toast.content}</Text>
        </Box>
      )}
    </>
  );
}

export function ErrorBoundary() {
  return (
    <Box padding="medium">
      <H1>Error</H1>
      <Flex flexDirection="column" flexGap="1.5rem" marginTop="large">
        <Box>
          <Panel>
            <Box padding="xSmall">
              <Text>Bundle not found or an error occurred.</Text>
            </Box>
          </Panel>
        </Box>
      </Flex>
    </Box>
  );
}
