import { Flex, H1 } from "@bigcommerce/big-design";
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
    <Flex flexDirection="row" flexGap="1rem" justifyContent="space-between" alignItems="center" flexWrap="nowrap">
      <H1>
        Cart Uplift
      </H1>
      <PlanBadge
        plan={planTier}
        orderCount={orderCount}
        orderLimit={orderLimit}
        isApproaching={isApproaching}
      />
    </Flex>
  );
}
