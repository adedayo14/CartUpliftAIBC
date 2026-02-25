import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Box, Flex, Panel, Text, H1, H2, HR, Link } from "@bigcommerce/big-design";
import { authenticateAdmin } from "../bigcommerce.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateAdmin(request);
  return json({
    appName: "Cart Uplift",
    lastUpdated: "October 30, 2025",
    supportEmail: "support@cartuplift.com",
    companyName: "Cart Uplift",
  });
};

export default function Privacy() {
  const { appName, lastUpdated, supportEmail, companyName } = useLoaderData<typeof loader>();

  return (
    <Box padding="medium" style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <Flex flexDirection="column" flexGap="1.5rem">
        <Flex flexDirection="column" flexGap="0.5rem">
          <Link href="/app/settings">← Settings</Link>
          <H1>Privacy Policy</H1>
          <Text color="secondary">Last updated: {lastUpdated}</Text>
        </Flex>

        <Panel>
          <Box padding="medium">
            <Flex flexDirection="column" flexGap="1.5rem">
              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Introduction</H2>
                <Text>
                  {appName} ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy
                  explains how we collect, use, and safeguard information when you use our BigCommerce application.
                </Text>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Information We Collect</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text bold>Store Information</Text>
                  <Text>• Shop domain and store name</Text>
                  <Text>• Merchant email address</Text>
                  <Text>• Store currency and locale settings</Text>

                  <Text bold>Product Data</Text>
                  <Text>• Product titles, descriptions, and prices</Text>
                  <Text>• Product images and variants</Text>
                  <Text>• Inventory levels and availability</Text>

                  <Text bold>Order Data (with Protected Customer Data Access)</Text>
                  <Text>• Order line items and totals</Text>
                  <Text>• Product purchase patterns (for ML recommendations)</Text>
                  <Text>• Order timestamps and fulfillment status</Text>
                  <Text>
                    • <strong>Note:</strong> Customer personal information (names, addresses, emails) is accessed
                    only for analytics aggregation and is never stored in our database.
                  </Text>

                  <Text bold>Usage Analytics</Text>
                  <Text>• Cart interaction events (opens, adds, removals)</Text>
                  <Text>• Recommendation impressions and clicks</Text>
                  <Text>• A/B test variant assignments (anonymous)</Text>
                  <Text>• Conversion and attribution data</Text>
                </Flex>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>How We Use Your Information</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text>
                    <strong>App Functionality:</strong> Provide cart drawer enhancements, product recommendations,
                    and free shipping progress features.
                  </Text>
                  <Text>
                    <strong>Machine Learning:</strong> Analyze purchase patterns to generate personalized product
                    recommendations and optimize bundle suggestions.
                  </Text>
                  <Text>
                    <strong>Analytics:</strong> Display performance metrics, revenue attribution, and conversion
                    rates in your dashboard.
                  </Text>
                  <Text>
                    <strong>Personalization:</strong> Customize cart drawer appearance based on your store's
                    branding and settings.
                  </Text>
                  <Text>
                    <strong>A/B Testing:</strong> Compare different recommendation strategies to optimize
                    conversion rates for your store.
                  </Text>
                </Flex>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Data Storage and Security</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text>
                    <strong>Database Hosting:</strong> All data is stored in a secure PostgreSQL database hosted
                    by Neon (AWS infrastructure) with encryption at rest.
                  </Text>
                  <Text>
                    <strong>Encryption:</strong> Data in transit is encrypted using TLS 1.3. Database connections
                    use SSL/TLS encryption.
                  </Text>
                  <Text>
                    <strong>Access Control:</strong> Database access is restricted to our application servers via
                    environment-variable authentication. No human access to production data without audit logs.
                  </Text>
                  <Text>
                    <strong>Data Minimization:</strong> We only store data necessary for app functionality.
                    Customer personal information is queried from BigCommerce APIs but never persisted in our database.
                  </Text>
                  <Text>
                    <strong>Session Management:</strong> BigCommerce session tokens are stored securely and expire
                    automatically to prevent unauthorized access.
                  </Text>
                </Flex>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Data Retention</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text>
                    <strong>Active Stores:</strong> Data is retained for the duration of your app installation
                    to provide continuous service and analytics.
                  </Text>
                  <Text>
                    <strong>App Uninstallation:</strong> When you uninstall {appName}, we retain anonymized
                    analytics data for 90 days to allow for potential reinstallation. After 90 days, all
                    store-specific data is permanently deleted.
                  </Text>
                  <Text>
                    <strong>Immediate Deletion:</strong> You can request immediate data deletion by contacting
                    us at {supportEmail}.
                  </Text>
                </Flex>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Data Sharing and Third Parties</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text>
                    <strong>No Data Sales:</strong> We never sell, rent, or trade your data to third parties.
                  </Text>
                  <Text>
                    <strong>Service Providers:</strong> We use the following trusted service providers:
                  </Text>
                  <Text>• <strong>Vercel:</strong> Application hosting and serverless functions</Text>
                  <Text>• <strong>Neon/AWS:</strong> Database hosting with encryption and security compliance</Text>
                  <Text>• <strong>BigCommerce:</strong> All data originates from and remains within BigCommerce's ecosystem</Text>
                  <Text>
                    <strong>Legal Requirements:</strong> We may disclose information if required by law, court
                    order, or to protect our legal rights.
                  </Text>
                </Flex>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Your Rights (GDPR & Privacy Compliance)</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text>
                    <strong>Access:</strong> Request a copy of all data we store about your store.
                  </Text>
                  <Text>
                    <strong>Correction:</strong> Request corrections to any inaccurate data.
                  </Text>
                  <Text>
                    <strong>Deletion:</strong> Request deletion of your store's data at any time.
                  </Text>
                  <Text>
                    <strong>Portability:</strong> Request export of your data in a portable format.
                  </Text>
                  <Text>
                    <strong>Contact:</strong> Email us at {supportEmail} for any privacy requests.
                  </Text>
                </Flex>
              </Flex>

              <HR />

              <Flex flexDirection="column" flexGap="0.75rem">
                <H2>Contact Us</H2>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Text>
                    If you have questions about this Privacy Policy or our data practices, contact us at:
                  </Text>
                  <Text>
                    <strong>Email:</strong> {supportEmail}
                  </Text>
                  <Text>
                    <strong>Company:</strong> {companyName}
                  </Text>
                </Flex>
              </Flex>
            </Flex>
          </Box>
        </Panel>
      </Flex>
    </Box>
  );
}
