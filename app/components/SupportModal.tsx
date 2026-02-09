import { useState } from "react";
import {
  Modal,
  TextField,
  FormLayout,
  Banner,
  Text,
  BlockStack,
} from "@shopify/polaris";
import { useFetcher } from "@remix-run/react";

interface SupportModalProps {
  open: boolean;
  onClose: () => void;
  planTier?: string;
}

export function SupportModal({ open, onClose, planTier = "starter" }: SupportModalProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const isSubmitting = fetcher.state === "submitting";
  const isSuccess = fetcher.data?.success === true;
  const error = fetcher.data?.error;
  
  // Get expected response time based on plan
  const responseTimes: Record<string, string> = {
    free: "48 hours",
    starter: "24 hours",
    growth: "12 hours",
    pro: "4 hours"
  };
  const responseTime = responseTimes[planTier] || "48 hours";

  const handleSubmit = () => {
    if (!subject || !message) return;

    const formData = new FormData();
    formData.append("subject", subject);
    formData.append("message", message);

    fetcher.submit(formData, {
      method: "POST",
      action: "/api/contact-support",
    });
  };

  const handleClose = () => {
    setSubject("");
    setMessage("");
    onClose();
  };

  // Reset form on success after a delay
  if (isSuccess && open) {
    setTimeout(() => {
      handleClose();
    }, 2000);
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Contact Support"
      primaryAction={{
        content: isSuccess ? "Sent!" : "Send message",
        onAction: handleSubmit,
        loading: isSubmitting,
        disabled: !subject || !message || isSuccess,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {isSuccess && (
            <Banner tone="success">
              <Text as="p">
                Your support request has been sent! We'll respond within {responseTime}.
              </Text>
            </Banner>
          )}

          {error && (
            <Banner tone="critical">
              <Text as="p">{error}</Text>
            </Banner>
          )}

          <Text as="p" tone="subdued">
            Expected response time: <Text as="span" fontWeight="semibold">{responseTime}</Text>
          </Text>

          <FormLayout>
            <TextField
              label="Subject"
              value={subject}
              onChange={setSubject}
              placeholder="e.g., Help with product recommendations"
              autoComplete="off"
              disabled={isSuccess}
            />

            <TextField
              label="Message"
              value={message}
              onChange={setMessage}
              multiline={6}
              placeholder="Please describe your issue or question in detail..."
              autoComplete="off"
              disabled={isSuccess}
            />
          </FormLayout>

          <Text as="p" variant="bodySm" tone="subdued">
            We'll respond to your email address on file. You can also email us directly at{" "}
            <Text as="span" fontWeight="semibold">support@cartuplift.com</Text>
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
