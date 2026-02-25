import { Badge, Small } from "@bigcommerce/big-design";
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

  const badgeVariant = isApproaching ? "warning" : "secondary";
  // Fallback for legacy "free" tier (migration in progress)
  const label = planLabels[plan] || "Starter (Trial)";
  // Check for Infinity (converted to 999999 in serialization) or Pro plan
  const isUnlimited = orderLimit >= 999999 || plan === 'pro';

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper onClick={onClick} className={styles.planBadge} style={onClick ? undefined : { cursor: 'default' }}>
      <Badge variant={badgeVariant} label={label} />
      {!isUnlimited && orderLimit > 0 && (
        <Small>
          {orderCount}/{orderLimit}
        </Small>
      )}
    </Wrapper>
  );
}
