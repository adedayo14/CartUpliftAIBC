/**
 * Setup Checklist Component
 * Guides new users through essential setup steps
 * Persists progress in database, not localStorage
 */

import { Flex, Text, Button, Box, Panel, ProgressBar, Link, H3, Small } from "@bigcommerce/big-design";
import { CheckCircleIcon, OpenInNewIcon, PlayArrowIcon } from "@bigcommerce/big-design-icons";
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
      <Panel>
        <Flex flexDirection="column" flexGap="1rem">
          <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
            <div className={styles.successIcon}>
              <CheckCircleIcon color="green" />
            </div>
            <Flex flexDirection="column" flexGap="0.25rem">
              <H3>
                Setup complete
              </H3>
              <Text color="secondary">
                All done! Your store is ready to boost average order value with smart recommendations.
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </Panel>
    );
  }

  return (
    <Panel>
      <Flex flexDirection="column" flexGap="1rem">
        {/* Header */}
        <Flex flexDirection="column" flexGap="0.5rem">
          <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
            <H3>
              Get started
            </H3>
            <Small color="secondary">
              {completedCount} of {totalSteps} complete
            </Small>
          </Flex>
          <ProgressBar percent={progress} />
        </Flex>

        {/* Steps */}
        <Flex flexDirection="column" flexGap="0.75rem">
          {steps.map((step, index) => {
            const isNextStep = !step.completed && steps.slice(0, index).every(s => s.completed);

            return (
              <div
                key={step.id}
                className={`${styles.stepItem} ${step.completed ? styles.stepCompleted : ''} ${isNextStep ? styles.stepActive : ''}`}
              >
                <Flex flexDirection="row" flexGap="0.75rem" alignItems="flex-start" flexWrap="nowrap">
                  {/* Status Icon */}
                  <div className={styles.stepIcon}>
                    {step.completed ? (
                      <CheckCircleIcon color="green" />
                    ) : (
                      <div className={styles.stepNumber}>{index + 1}</div>
                    )}
                  </div>

                  {/* Content */}
                  <Flex flexDirection="column" flexGap="0.5rem">
                    {/* Title and Video Link on Same Line */}
                    <Flex flexDirection="row" flexGap="0.75rem" alignItems="center" flexWrap="nowrap">
                      <Box style={{ minWidth: "fit-content" }}>
                        <Text bold={isNextStep}>
                          {step.title}
                        </Text>
                      </Box>
                      {/* Video link - Show inline with title for better visual hierarchy */}
                      {step.videoUrl && isNextStep && (
                        <Link href={step.videoUrl} target="_blank">
                          <Flex flexDirection="row" flexGap="0.25rem" alignItems="center">
                            <PlayArrowIcon />
                            <Small color="secondary">
                              Watch 3 minute video
                            </Small>
                          </Flex>
                        </Link>
                      )}
                    </Flex>

                    {/* Description */}
                    <Flex flexDirection="column" flexGap="0.25rem">
                      <Small color="secondary">
                        {step.description}
                      </Small>
                      {/* Help link - always visible */}
                      {step.helpLink && (
                        <Link href={step.helpLink.url} target="_blank">
                          <Small>
                            {step.helpLink.label} →
                          </Small>
                        </Link>
                      )}
                    </Flex>

                    {/* Actions - Only show for incomplete steps */}
                    {!step.completed && isNextStep && (
                      <Box marginTop="xxSmall">
                        <Flex flexDirection="row" flexGap="0.5rem" flexWrap="wrap">
                          {step.action.url ? (
                            <Button
                              variant="primary"
                              onClick={() => {
                                if (step.action.external) {
                                  window.open(step.action.url, "_blank");
                                } else {
                                  window.location.href = step.action.url!;
                                }
                              }}
                            >
                              {step.action.label}
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              onClick={step.action.onClick}
                            >
                              {step.action.label}
                            </Button>
                          )}
                          {step.completeAction && (
                            <Button
                              variant="subtle"
                              onClick={step.completeAction.onClick}
                            >
                              {step.completeAction.label}
                            </Button>
                          )}
                        </Flex>
                      </Box>
                    )}
                  </Flex>
                </Flex>
              </div>
            );
          })}
        </Flex>

        {/* Dismiss option */}
        {showDismiss && onDismiss && (
          <Box marginTop="small">
            <Button variant="subtle" onClick={onDismiss}>
              I'll set up later
            </Button>
          </Box>
        )}
      </Flex>
    </Panel>
  );
}
