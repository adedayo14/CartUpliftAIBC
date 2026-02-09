import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator } from "@remix-run/react";
import {
  Badge,
  Button,
  DataTable,
  Text,
  InlineStack,
  Box,
} from "@shopify/polaris";
import { DeleteIcon, EditIcon, PauseCircleIcon, PlayCircleIcon } from "@shopify/polaris-icons";
import { formatMoney } from "../utils/formatters";
import type { Bundle } from "../routes/admin.bundles";
import { BUNDLE_TYPES, BUNDLE_STATUS, DISCOUNT_TYPES } from "~/constants/bundle";
import styles from "./BundleTable.module.css";

interface BundleTableProps {
  shop: string;
  bundles: Bundle[];
  currencyCode: string;
  onEdit: (bundle: Bundle) => void;
  setToast: (toast: { content: string; error?: boolean }) => void;
}

export function BundleTable({ shop, bundles, currencyCode, onEdit, setToast }: BundleTableProps) {
  const [loadingAction, setLoadingAction] = useState<{ bundleId: string; action: 'toggle' | 'delete' } | null>(null);
  const [optimisticBundles, setOptimisticBundles] = useState<Bundle[]>(bundles);
  const revalidator = useRevalidator();

  // Update optimistic bundles when bundles prop changes
  useEffect(() => {
    setOptimisticBundles(bundles);
  }, [bundles]);

  const handleToggleStatus = useCallback(async (bundleId: string, currentStatus: string) => {
    setLoadingAction({ bundleId, action: 'toggle' });
    const newStatus = currentStatus === BUNDLE_STATUS.ACTIVE ? BUNDLE_STATUS.PAUSED : BUNDLE_STATUS.ACTIVE;

    // Optimistically update UI immediately
    setOptimisticBundles(prev => prev.map(b =>
      b.id === bundleId ? { ...b, status: newStatus } : b
    ));

    try {
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
              resolve(JSON.parse(xhr.responseText));
            } catch (_e) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`Server returned ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ action: 'toggle-status', shop, bundleId, status: newStatus }));
      });

      if (result.success) {
        // Show success toast after API confirms
        setToast({ content: 'FBT status updated' });
        // Delay revalidation to allow optimistic update to settle and prevent error boundary flash
        setTimeout(() => {
          revalidator.revalidate();
        }, 300);
      } else {
        // Revert optimistic update on error
        setOptimisticBundles(bundles);
        setToast({ content: result.error || 'Failed to update status', error: true });
      }
    } catch (error) {
      // Revert optimistic update on error
      setOptimisticBundles(bundles);
      setToast({ content: 'Failed to update status', error: true });
    } finally {
      setLoadingAction(null);
    }
  }, [shop, bundles, setToast, revalidator]);

  const handleDeleteBundle = useCallback(async (bundleId: string) => {
    setLoadingAction({ bundleId, action: 'delete' });

    try {
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
              resolve(JSON.parse(xhr.responseText));
            } catch (_e) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`Server returned ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ action: 'delete-bundle', shop, bundleId }));
      });

      if (result.success) {
        setToast({ content: 'FBT deleted' });
        setOptimisticBundles(prev => prev.filter(bundle => bundle.id !== bundleId));
        // Delay revalidation to prevent error boundary flash
        setTimeout(() => {
          revalidator.revalidate();
        }, 300);
      } else {
        setToast({ content: result.error || 'Failed to delete FBT', error: true });
      }
    } catch (error) {
      setToast({ content: 'Failed to delete FBT', error: true });
    } finally {
      setLoadingAction(null);
    }
  }, [shop, setToast, revalidator]);

  const rows = useMemo(() => optimisticBundles.map((bundle, index) => [
    <Text key={`name-${bundle.id}-${index}`} variant="bodyMd" fontWeight="semibold" as="span">{bundle.name}</Text>,
    bundle.type === BUNDLE_TYPES.MANUAL ? 'Manual' : bundle.type === BUNDLE_TYPES.COLLECTION ? 'Collection' : 'AI Suggested',
    <Badge key={`status-${bundle.id}-${index}`} tone={bundle.status === BUNDLE_STATUS.ACTIVE ? 'success' : 'attention'}>{bundle.status}</Badge>,
    bundle.discountType === DISCOUNT_TYPES.PERCENTAGE ? `${bundle.discountValue}%` : formatMoney(bundle.discountValue, currencyCode),
    <Text key={`purchases-${bundle.id}-${index}`} variant="bodyMd" as="span">{(bundle.totalPurchases || 0).toLocaleString()}</Text>,
    <Text key={`revenue-${bundle.id}-${index}`} variant="bodyMd" as="span">{formatMoney(bundle.totalRevenue || 0, currencyCode)}</Text>,
    <InlineStack key={`actions-${bundle.id}-${index}`} gap="200" align="end" blockAlign="center">
      <Button
        size="large"
        variant="plain"
        onClick={() => handleToggleStatus(bundle.id, bundle.status)}
        loading={loadingAction?.bundleId === bundle.id && loadingAction?.action === 'toggle'}
        icon={bundle.status === BUNDLE_STATUS.ACTIVE ? PauseCircleIcon : PlayCircleIcon}
        accessibilityLabel={bundle.status === BUNDLE_STATUS.ACTIVE ? 'Pause FBT' : 'Activate FBT'}
      />
      <Button 
        size="large" 
        variant="plain"
        onClick={() => onEdit(bundle)}
        icon={EditIcon}
        accessibilityLabel="Edit FBT"
      />
      <Button 
        size="large" 
        variant="plain"
        tone="critical" 
        onClick={() => handleDeleteBundle(bundle.id)} 
        loading={loadingAction?.bundleId === bundle.id && loadingAction?.action === 'delete'} 
        icon={DeleteIcon}
        accessibilityLabel="Delete FBT"
      />
    </InlineStack>,
  ]), [optimisticBundles, currencyCode, handleToggleStatus, handleDeleteBundle, onEdit, loadingAction]);

  return (
    <Box maxWidth="1400px">
      <div className={styles.tableWrapper}>
        <DataTable
          columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'text']}
          headings={['FBT Name', 'Type', 'Status', 'Discount', 'Purchases', 'Revenue', 'Actions']}
          rows={rows}
        />
      </div>
    </Box>
  );
}
