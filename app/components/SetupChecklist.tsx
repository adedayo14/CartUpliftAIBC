/**
 * Setup Checklist Component
 * Guides new users through essential setup steps
 * Persists progress in database, not localStorage
 */

import { BlockStack, InlineStack, Text, Button, Box, Card, ProgressBar, Icon, Link } from "@shopify/polaris";
import { CheckCircleIcon, ExternalIcon, PlayCircleIcon } from "@shopify/polaris-icons";
import styles from "./SetupChecklist.module.css";

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  videoUrl?: string; // Optional video tutorial link
  helpLink?: {
    label: string;
    url: string;
  };
  action: {
    label: string;
    url?: string;
    onClick?: () => void;
    external?: boolean;
  };
  completeAction?: {
    label: string;
    onClick: () => void;
  };
}

export interface SetupChecklistProps {
  steps: SetupStep[];
  onDismiss?: () => void;
  showDismiss?: boolean;
}

export function SetupChecklist({ steps, onDismiss, showDismiss = false }: SetupChecklistProps) {
  const completedCount = steps.filter(s => s.completed).length;
  const totalSteps = steps.length;
  const progress = (completedCount / totalSteps) * 100;
  const allComplete = completedCount === totalSteps;

  if (allComplete) {
    return (
      <Card>
        <Box padding="400">
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <div className={styles.successIcon}>
                <Icon source={CheckCircleIcon} tone="success" />
              </div>
              <BlockStack gap="100">
                <Text variant="headingMd" as="h3">
                  Setup complete
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">
                  All done! Your store is ready to boost average order value with smart recommendations.
                </Text>
              </BlockStack>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="400">
          {/* Header */}
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <Text variant="headingMd" as="h3">
                Get started
              </Text>
              <Text variant="bodySm" as="span" tone="subdued">
                {completedCount} of {totalSteps} complete
              </Text>
            </InlineStack>
            <ProgressBar progress={progress} size="small" tone="primary" />
          </BlockStack>

          {/* Steps */}
          <BlockStack gap="300">
            {steps.map((step, index) => {
              const isNextStep = !step.completed && steps.slice(0, index).every(s => s.completed);

              return (
                <div
                  key={step.id}
                  className={`${styles.stepItem} ${step.completed ? styles.stepCompleted : ''} ${isNextStep ? styles.stepActive : ''}`}
                >
                  <InlineStack gap="300" blockAlign="start" wrap={false}>
                    {/* Status Icon */}
                    <div className={styles.stepIcon}>
                      {step.completed ? (
                        <Icon source={CheckCircleIcon} tone="success" />
                      ) : (
                        <div className={styles.stepNumber}>{index + 1}</div>
                      )}
                    </div>

                    {/* Content */}
                    <BlockStack gap="200">
                      {/* Title and Video Link on Same Line */}
                      <InlineStack gap="300" blockAlign="center" wrap={false}>
                        <Box minWidth="fit-content">
                          <Text variant="bodyMd" as="p" fontWeight={isNextStep ? "semibold" : "regular"}>
                            {step.title}
                          </Text>
                        </Box>
                        {/* Video link - Show inline with title for better visual hierarchy */}
                        {step.videoUrl && isNextStep && (
                          <Link url={step.videoUrl} target="_blank" removeUnderline>
                            <InlineStack gap="100" blockAlign="center">
                              <Icon source={PlayCircleIcon} tone="info" />
                              <Text variant="bodySm" as="span" tone="subdued">
                                Watch 3 minute video
                              </Text>
                            </InlineStack>
                          </Link>
                        )}
                      </InlineStack>

                      {/* Description */}
                      <BlockStack gap="100">
                        <Text variant="bodySm" as="p" tone="subdued">
                          {step.description}
                        </Text>
                        {/* Help link - always visible */}
                        {step.helpLink && (
                          <Link url={step.helpLink.url} target="_blank" removeUnderline>
                            <Text variant="bodySm" as="span">
                              {step.helpLink.label} →
                            </Text>
                          </Link>
                        )}
                      </BlockStack>

                      {/* Actions - Only show for incomplete steps */}
                      {!step.completed && isNextStep && (
                        <Box paddingBlockStart="100">
                          <InlineStack gap="200" wrap={true}>
                            {step.action.url ? (
                              <Button
                                size="slim"
                                variant="primary"
                                url={step.action.url}
                                target={step.action.external ? "_blank" : undefined}
                                icon={step.action.external ? ExternalIcon : undefined}
                              >
                                {step.action.label}
                              </Button>
                            ) : (
                              <Button
                                size="slim"
                                variant="primary"
                                onClick={step.action.onClick}
                              >
                                {step.action.label}
                              </Button>
                            )}
                            {step.completeAction && (
                              <Button
                                size="slim"
                                variant="plain"
                                onClick={step.completeAction.onClick}
                              >
                                {step.completeAction.label}
                              </Button>
                            )}
                          </InlineStack>
                        </Box>
                      )}
                    </BlockStack>
                  </InlineStack>
                </div>
              );
            })}
          </BlockStack>

          {/* Dismiss option */}
          {showDismiss && onDismiss && (
            <Box paddingBlockStart="200">
              <Button variant="plain" onClick={onDismiss}>
                I'll set up later
              </Button>
            </Box>
          )}
        </BlockStack>
      </Box>
    </Card>
  );
}
