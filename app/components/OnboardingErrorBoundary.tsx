/**
 * Error Boundary for Onboarding Checklist
 *
 * Prevents the entire app from breaking if onboarding checklist has errors.
 * Falls back to a simple activation card if anything goes wrong.
 */

import * as React from "react";
import { Card, BlockStack, Text, Button, Banner, Box } from "@shopify/polaris";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class OnboardingErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    console.error("[OnboardingErrorBoundary] Caught error:", error, errorInfo);

    // In production, you might want to send this to Sentry or another error tracking service
    if (process.env.NODE_ENV === "production") {
      // Example: Sentry.captureException(error);
    }
  }

  render() {
    if (this.state.hasError) {
      // Render fallback UI if provided, otherwise render default fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback: Simple banner
      return (
        <Banner
          title="Onboarding setup temporarily unavailable"
          tone="info"
        >
          <p>
            The setup checklist is temporarily unavailable. You can still use all app features normally.
            Visit Settings to configure your cart and bundles.
          </p>
        </Banner>
      );
    }

    return this.props.children;
  }
}

/**
 * Hook-based alternative for functional components
 * Use this if you prefer hooks over class components
 */
export function useOnboardingErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (error) {
      console.error("[Onboarding] Error occurred:", error);
      // You can also send to error tracking here
    }
  }, [error]);

  const catchError = React.useCallback((fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  return { error, catchError, clearError: () => setError(null) };
}
