import { InlineStack, Text } from "@shopify/polaris";
import { PlanBadge } from "./PlanBadge";
import type { PlanTier } from "../types/billing";

interface AppHeaderProps {
  planTier: PlanTier;
  orderCount: number;
  orderLimit: number;
  isApproaching?: boolean;
}

export function AppHeader({ planTier, orderCount, orderLimit, isApproaching }: AppHeaderProps) {
  return (
    <InlineStack gap="400" align="space-between" blockAlign="center" wrap={false}>
      <Text variant="heading2xl" as="h1">
        Cart Uplift
      </Text>
      <PlanBadge
        plan={planTier}
        orderCount={orderCount}
        orderLimit={orderLimit}
        isApproaching={isApproaching}
      />
    </InlineStack>
  );
}
