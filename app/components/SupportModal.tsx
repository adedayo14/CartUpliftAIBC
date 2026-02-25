import { useState } from "react";
import {
  Modal,
  Input,
  Textarea,
  Message,
  Text,
  Flex,
  Button,
  Box,
} from "@bigcommerce/big-design";
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
      isOpen={open}
      onClose={handleClose}
      header="Contact Support"
      actions={[
        {
          text: "Cancel",
          variant: "subtle",
          onClick: handleClose,
        },
        {
          text: isSuccess ? "Sent!" : "Send message",
          onClick: handleSubmit,
          isLoading: isSubmitting,
          disabled: !subject || !message || isSuccess,
        },
      ]}
    >
      <Flex flexDirection="column" flexGap="1rem">
        {isSuccess && (
          <Message
            type="success"
            messages={[
              {
                text: `Your support request has been sent! We'll respond within ${responseTime}.`,
              },
            ]}
          />
        )}

        {error && (
          <Message
            type="error"
            messages={[
              {
                text: error,
              },
            ]}
          />
        )}

        <Text>
          Expected response time: <strong>{responseTime}</strong>
        </Text>

        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g., Help with product recommendations"
          disabled={isSuccess}
        />

        <Textarea
          label="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          placeholder="Please describe your issue or question in detail..."
          disabled={isSuccess}
        />

        <Text>
          We'll respond to your email address on file. You can also email us directly at{" "}
          <strong>support@cartuplift.com</strong>
        </Text>
      </Flex>
    </Modal>
  );
}
