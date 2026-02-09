/**
 * Insight Card Component
 * Displays actionable insights and recommendations to merchants
 * Designed to be simple, informational, and action-oriented
 */

import { BlockStack, InlineStack, Text, Button, Icon, Box } from "@shopify/polaris";
import { 
  AlertCircleIcon, 
  InfoIcon, 
  CheckCircleIcon,
  LightbulbIcon 
} from "@shopify/polaris-icons";
import styles from "./InsightCard.module.css";

export type InsightType = "critical" | "warning" | "success" | "info";
export type InsightPriority = 1 | 2 | 3 | 4 | 5;

export interface InsightCardProps {
  id: string;
  type: InsightType;
  priority: InsightPriority;
  title: string;
  message: string;
  action?: {
    label: string;
    url?: string;
    onClick?: () => void;
  };
  onDismiss?: () => void;
}

const typeConfig = {
  critical: {
    icon: AlertCircleIcon,
    iconColor: "#D72C0D",
    bg: "#FEF3F2",
    borderColor: "#F04438",
  },
  warning: {
    icon: InfoIcon,
    iconColor: "#DC6803",
    bg: "#FFFAEB",
    borderColor: "#F79009",
  },
  success: {
    icon: CheckCircleIcon,
    iconColor: "#079455",
    bg: "#F0FDF4",
    borderColor: "#17B26A",
  },
  info: {
    icon: LightbulbIcon,
    iconColor: "#0086C9",
    bg: "#F0F9FF",
    borderColor: "#0BA5EC",
  },
};

export function InsightCard({
  type,
  title,
  message,
  action,
  onDismiss,
}: InsightCardProps) {
  const config = typeConfig[type];
  
  // Map type to CSS class
  const typeClass = {
    critical: styles.insightCardCritical,
    warning: styles.insightCardWarning,
    success: styles.insightCardSuccess,
    info: styles.insightCardInfo,
  }[type];

  return (
    <div className={`${styles.insightCard} ${styles.insightCardInner} ${typeClass}`}>
      <Box paddingBlock="300" paddingInline="300">
        <BlockStack gap="300" inlineAlign="start">
          <div className={styles.insightCardHeader}>
            <Icon source={config.icon} tone={type === "critical" ? "critical" : undefined} />
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {title}
            </Text>
          </div>
          
          <Text as="p" variant="bodySm" tone="subdued">
            {message}
          </Text>

          {(action || onDismiss) && (
            <InlineStack gap="200" align="start">
              {action && (
                action.url ? (
                  <Button
                    size="micro"
                    url={action.url}
                    variant={type === "critical" ? "primary" : undefined}
                  >
                    {action.label}
                  </Button>
                ) : (
                  <Button
                    size="micro"
                    onClick={action.onClick}
                    variant={type === "critical" ? "primary" : undefined}
                  >
                    {action.label}
                  </Button>
                )
              )}
              {onDismiss && (
                <Button
                  size="micro"
                  variant="plain"
                  onClick={onDismiss}
                >
                  Dismiss
                </Button>
              )}
            </InlineStack>
          )}
        </BlockStack>
      </Box>
    </div>
  );
}
