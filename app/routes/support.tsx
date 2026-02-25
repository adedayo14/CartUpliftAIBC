import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState } from "react";
import {
  Box,
  Grid,
  GridItem,
  Panel,
  Button,
  Flex,
  Text,
  Input,
  Textarea,
  Message,
  H1,
  H2,
} from "@bigcommerce/big-design";

// This is a standalone page - no BigCommerce authentication required
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
    <>
      <Box padding="medium">
        <Grid gridColumns="1fr">
          <GridItem>
            <Flex flexDirection="column" flexGap="1.25rem">
              {/* Header */}
              <Panel>
                <Flex flexDirection="column" flexGap="1rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <H1>
                      Cart Uplift Support
                    </H1>
                    <Text color="secondary">
                      {shop && `Support for ${shop}`}
                    </Text>
                  </Flex>
                </Flex>
              </Panel>

              {/* Email Support Form */}
              <Panel>
                <Flex flexDirection="column" flexGap="1rem">
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <H2>
                      Send us a message
                    </H2>
                    <Text color="secondary">
                      We'll get back to you as soon as possible.
                    </Text>
                  </Flex>

                  {isSuccess && (
                    <Message
                      type="success"
                      messages={[
                        {
                          text: "Your message has been sent! We'll respond soon.",
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

                  <Input
                    label="Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g., Help with setting up bundles"
                    disabled={isSuccess}
                  />

                  <Textarea
                    label="Message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={8}
                    placeholder="Please describe your issue or question in detail..."
                    disabled={isSuccess}
                  />

                  <Button
                    onClick={handleSubmit}
                    isLoading={isSubmitting}
                    disabled={!subject || !message || isSuccess}
                    variant="primary"
                  >
                    {isSuccess ? "Sent!" : "Send message"}
                  </Button>
                </Flex>
              </Panel>
            </Flex>
          </GridItem>
        </Grid>
      </Box>
    </>
  );
}
