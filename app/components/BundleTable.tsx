import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator } from "@remix-run/react";
import {
  Badge,
  Button,
  Table,
  Text,
  Flex,
  Box,
} from "@bigcommerce/big-design";
import { DeleteIcon, EditIcon, StopIcon, PlayArrowIcon } from "@bigcommerce/big-design-icons";
import { formatMoney } from "../utils/formatters";
import type { Bundle } from "../routes/admin.bundles";
import { BUNDLE_TYPES, BUNDLE_STATUS, DISCOUNT_TYPES } from "~/constants/bundle";
import styles from "./BundleTable.module.css";

interface BundleTableProps {
  storeHash: string;
  bundles: Bundle[];
  currencyCode: string;
  onEdit: (bundle: Bundle) => void;
  setToast: (toast: { content: string; error?: boolean }) => void;
}

export function BundleTable({ storeHash, bundles, currencyCode, onEdit, setToast }: BundleTableProps) {
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
              resolve(JSON.parse(xhr.responseText));
            } catch (_e) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`Server returned ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ action: 'toggle-status', storeHash, bundleId, status: newStatus }));
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
  }, [storeHash, bundles, setToast, revalidator]);

  const handleDeleteBundle = useCallback(async (bundleId: string) => {
    setLoadingAction({ bundleId, action: 'delete' });

    try {
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
              resolve(JSON.parse(xhr.responseText));
            } catch (_e) {
              reject(new Error('Failed to parse response'));
            }
          } else {
            reject(new Error(`Server returned ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ action: 'delete-bundle', storeHash, bundleId }));
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
  }, [storeHash, setToast, revalidator]);

  const columns = [
    { header: 'FBT Name', hash: 'name' as const, render: ({ name, id }: Bundle) => <Text bold>{name}</Text> },
    { header: 'Type', hash: 'type' as const, render: ({ type }: Bundle) => type === BUNDLE_TYPES.MANUAL ? 'Manual' : type === BUNDLE_TYPES.COLLECTION ? 'Collection' : 'AI Suggested' },
    { header: 'Status', hash: 'status' as const, render: ({ status }: Bundle) => <Badge variant={status === BUNDLE_STATUS.ACTIVE ? 'success' : 'warning'} label={status} /> },
    { header: 'Discount', hash: 'discountValue' as const, render: ({ discountType, discountValue }: Bundle) => discountType === DISCOUNT_TYPES.PERCENTAGE ? `${discountValue}%` : formatMoney(discountValue, currencyCode) },
    { header: 'Purchases', hash: 'totalPurchases' as const, render: ({ totalPurchases }: Bundle) => <Text>{(totalPurchases || 0).toLocaleString()}</Text> },
    { header: 'Revenue', hash: 'totalRevenue' as const, render: ({ totalRevenue }: Bundle) => <Text>{formatMoney(totalRevenue || 0, currencyCode)}</Text> },
    {
      header: 'Actions',
      hash: 'id' as const,
      render: (bundle: Bundle) => (
        <Flex flexDirection="row" flexGap="0.5rem" justifyContent="flex-end" alignItems="center">
          <Button
            variant="subtle"
            onClick={() => handleToggleStatus(bundle.id, bundle.status)}
            isLoading={loadingAction?.bundleId === bundle.id && loadingAction?.action === 'toggle'}
            iconOnly={bundle.status === BUNDLE_STATUS.ACTIVE ? <StopIcon /> : <PlayArrowIcon />}
          />
          <Button
            variant="subtle"
            onClick={() => onEdit(bundle)}
            iconOnly={<EditIcon />}
          />
          <Button
            variant="subtle"
            onClick={() => handleDeleteBundle(bundle.id)}
            isLoading={loadingAction?.bundleId === bundle.id && loadingAction?.action === 'delete'}
            iconOnly={<DeleteIcon />}
          />
        </Flex>
      ),
    },
  ];

  return (
    <Box style={{ maxWidth: "1400px" }}>
      <div className={styles.tableWrapper}>
        <Table
          columns={columns}
          items={optimisticBundles}
          stickyHeader
        />
      </div>
    </Box>
  );
}
