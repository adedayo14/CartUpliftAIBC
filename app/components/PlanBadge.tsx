import { Badge, Text } from "@shopify/polaris";
import type { PlanTier } from "../types/billing";
import styles from "./PlanBadge.module.css";

interface PlanBadgeProps {
  plan: PlanTier;
  orderCount: number;
  orderLimit: number;
  isApproaching?: boolean;
  onClick?: () => void;
}

export function PlanBadge({ plan, orderCount, orderLimit, isApproaching, onClick }: PlanBadgeProps) {
  const planLabels: Record<PlanTier, string> = {
    starter: "Starter",
    growth: "Growth",
    pro: "Pro",
  };

  const badgeTone = isApproaching ? "warning" : "info";
  // Fallback for legacy "free" tier (migration in progress)
  const label = planLabels[plan] || "Starter (Trial)";
  // Check for Infinity (converted to 999999 in serialization) or Pro plan
  const isUnlimited = orderLimit >= 999999 || plan === 'pro';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper onClick={onClick} className={styles.planBadge} style={onClick ? undefined : { cursor: 'default' }}>
      <Badge tone={badgeTone}>{label}</Badge>
      {!isUnlimited && orderLimit > 0 && (
        <Text as="span" variant="bodySm" tone="subdued">
          {orderCount}/{orderLimit}
        </Text>
      )}
    </Wrapper>
  );
}
