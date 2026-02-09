import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import { AppProvider } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  Text,
  TextField,
  FormLayout,
  Banner,
} from "@shopify/polaris";

// This is a standalone page - no Shopify authentication required
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";

  return json({ shop });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  
  const formData = await request.formData();
  const subject = formData.get("subject")?.toString() || "";
  const message = formData.get("message")?.toString() || "";

  try {
    // Forward to the contact-support API
    const response = await fetch(`${url.origin}/api/contact-support`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Shop-Domain': shop,
      },
      body: JSON.stringify({ subject, message, shop }),
    });

    if (!response.ok) {
      return json({ success: false, error: "Failed to send message. Please try again." });
    }

    return json({ success: true });
  } catch (error) {
    console.error('Support form error:', error);
    return json({ success: false, error: "Failed to send message. Please try again." });
  }
};

export default function SupportPage() {
  const { shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const isSubmitting = fetcher.state === "submitting";
  const isSuccess = fetcher.data?.success === true;
  const error = fetcher.data?.error;

  const handleSubmit = () => {
    if (!subject || !message) return;

    const formData = new FormData();
    formData.append("subject", subject);
    formData.append("message", message);

    fetcher.submit(formData, { method: "POST" });
  };

  // Reset form on success
  if (isSuccess && subject) {
    setTimeout(() => {
      setSubject("");
      setMessage("");
    }, 2000);
  }

  return (
    <AppProvider i18n={{}}>
      <Page>
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {/* Header */}
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <Text variant="headingXl" as="h1">
                      Cart Uplift Support
                    </Text>
                    <Text variant="bodyLg" as="p" tone="subdued">
                      {shop && `Support for ${shop}`}
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Email Support Form */}
              <Card>
                <BlockStack gap="400">
                  <BlockStack gap="200">
                    <Text variant="headingLg" as="h2">
                      Send us a message
                    </Text>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      We'll get back to you as soon as possible.
                    </Text>
                  </BlockStack>

                  {isSuccess && (
                    <Banner tone="success">
                      <Text as="p">
                        Your message has been sent! We'll respond soon.
                      </Text>
                    </Banner>
                  )}

                  {error && (
                    <Banner tone="critical">
                      <Text as="p">{error}</Text>
                    </Banner>
                  )}

                  <FormLayout>
                    <TextField
                      label="Subject"
                      value={subject}
                      onChange={setSubject}
                      placeholder="e.g., Help with setting up bundles"
                      autoComplete="off"
                      disabled={isSuccess}
                    />

                    <TextField
                      label="Message"
                      value={message}
                      onChange={setMessage}
                      multiline={8}
                      placeholder="Please describe your issue or question in detail..."
                      autoComplete="off"
                      disabled={isSuccess}
                    />

                    <Button
                      onClick={handleSubmit}
                      loading={isSubmitting}
                      disabled={!subject || !message || isSuccess}
                      variant="primary"
                    >
                      {isSuccess ? "Sent!" : "Send message"}
                    </Button>
                  </FormLayout>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}
