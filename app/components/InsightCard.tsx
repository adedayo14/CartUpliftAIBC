/**
 * Insight Card Component
 * Displays actionable insights and recommendations to merchants
 * Designed to be simple, informational, and action-oriented
 */

import { Flex, Text, Button, Box } from "@bigcommerce/big-design";
import { ErrorIcon, InfoIcon, CheckCircleIcon } from "@bigcommerce/big-design-icons";
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
    Icon: ErrorIcon,
    iconColor: "#D72C0D",
    bg: "#FEF3F2",
    borderColor: "#F04438",
  },
  warning: {
    Icon: InfoIcon,
    iconColor: "#DC6803",
    bg: "#FFFAEB",
    borderColor: "#F79009",
  },
  success: {
    Icon: CheckCircleIcon,
    iconColor: "#079455",
    bg: "#F0FDF4",
    borderColor: "#17B26A",
  },
  info: {
    Icon: InfoIcon,
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
  const IconComponent = config.Icon;

  // Map type to CSS class
  const typeClass = {
    critical: styles.insightCardCritical,
    warning: styles.insightCardWarning,
    success: styles.insightCardSuccess,
    info: styles.insightCardInfo,
  }[type];

  return (
    <div className={`${styles.insightCard} ${styles.insightCardInner} ${typeClass}`}>
      <Box padding="medium">
        <Flex flexDirection="column" flexGap="0.75rem" alignItems="flex-start">
          <div className={styles.insightCardHeader}>
            <IconComponent color={config.iconColor} />
            <Text bold>
              {title}
            </Text>
          </div>

          <Text color="secondary">
            {message}
          </Text>

          {(action || onDismiss) && (
            <Flex flexDirection="row" flexGap="0.5rem" alignItems="flex-start">
              {action && (
                <Button
                  variant={type === "critical" ? "primary" : "secondary"}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              )}
              {onDismiss && (
                <Button
                  variant="subtle"
                  onClick={onDismiss}
                >
                  Dismiss
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      </Box>
    </div>
  );
}
