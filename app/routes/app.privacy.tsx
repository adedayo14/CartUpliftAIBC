import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, Card, Text, BlockStack, Divider } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ 
    appName: "Cart Uplift",
    lastUpdated: "October 30, 2025",
    supportEmail: "support@cartuplift.com",
    companyName: "Cart Uplift"
  });
};

export default function Privacy() {
  const { appName, lastUpdated, supportEmail, companyName } = useLoaderData<typeof loader>();

  return (
    <Page
      title="Privacy Policy"
      subtitle={`Last updated: ${lastUpdated}`}
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Introduction</Text>
              <Text variant="bodyMd" as="p">
                {appName} ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy 
                explains how we collect, use, and safeguard information when you use our Shopify application.
              </Text>

              <Divider />

              <Text variant="headingMd" as="h2">Information We Collect</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  Store Information
                </Text>
                <Text variant="bodyMd" as="p">
                  • Shop domain and store name
                </Text>
                <Text variant="bodyMd" as="p">
                  • Merchant email address
                </Text>
                <Text variant="bodyMd" as="p">
                  • Store currency and locale settings
                </Text>

                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  Product Data
                </Text>
                <Text variant="bodyMd" as="p">
                  • Product titles, descriptions, and prices
                </Text>
                <Text variant="bodyMd" as="p">
                  • Product images and variants
                </Text>
                <Text variant="bodyMd" as="p">
                  • Inventory levels and availability
                </Text>

                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  Order Data (with Protected Customer Data Access)
                </Text>
                <Text variant="bodyMd" as="p">
                  • Order line items and totals
                </Text>
                <Text variant="bodyMd" as="p">
                  • Product purchase patterns (for ML recommendations)
                </Text>
                <Text variant="bodyMd" as="p">
                  • Order timestamps and fulfillment status
                </Text>
                <Text variant="bodyMd" as="p">
                  • <strong>Note:</strong> Customer personal information (names, addresses, emails) is accessed 
                  only for analytics aggregation and is never stored in our database.
                </Text>

                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  Usage Analytics
                </Text>
                <Text variant="bodyMd" as="p">
                  • Cart interaction events (opens, adds, removals)
                </Text>
                <Text variant="bodyMd" as="p">
                  • Recommendation impressions and clicks
                </Text>
                <Text variant="bodyMd" as="p">
                  • A/B test variant assignments (anonymous)
                </Text>
                <Text variant="bodyMd" as="p">
                  • Conversion and attribution data
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">How We Use Your Information</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  <strong>App Functionality:</strong> Provide cart drawer enhancements, product recommendations, 
                  and free shipping progress features.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Machine Learning:</strong> Analyze purchase patterns to generate personalized product 
                  recommendations and optimize bundle suggestions.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Analytics:</strong> Display performance metrics, revenue attribution, and conversion 
                  rates in your dashboard.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Personalization:</strong> Customize cart drawer appearance based on your store's 
                  branding and settings.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>A/B Testing:</strong> Compare different recommendation strategies to optimize 
                  conversion rates for your store.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">Data Storage and Security</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  <strong>Database Hosting:</strong> All data is stored in a secure PostgreSQL database hosted 
                  by Neon (AWS infrastructure) with encryption at rest.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Encryption:</strong> Data in transit is encrypted using TLS 1.3. Database connections 
                  use SSL/TLS encryption.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Access Control:</strong> Database access is restricted to our application servers via 
                  environment-variable authentication. No human access to production data without audit logs.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Data Minimization:</strong> We only store data necessary for app functionality. 
                  Customer personal information is queried from Shopify APIs but never persisted in our database.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Session Management:</strong> Shopify session tokens are stored securely and expire 
                  automatically to prevent unauthorized access.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">Data Retention</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  <strong>Active Stores:</strong> Data is retained for the duration of your app installation 
                  to provide continuous service and analytics.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>App Uninstallation:</strong> When you uninstall {appName}, we retain anonymized 
                  analytics data for 90 days to allow for potential reinstallation. After 90 days, all 
                  store-specific data is permanently deleted.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Immediate Deletion:</strong> You can request immediate data deletion by contacting 
                  us at support@cartuplift.com or via the Shopify App Store.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">Data Sharing and Third Parties</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  <strong>No Data Sales:</strong> We never sell, rent, or trade your data to third parties.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Service Providers:</strong> We use the following trusted service providers:
                </Text>
                <Text variant="bodyMd" as="p">
                  • <strong>Vercel:</strong> Application hosting and serverless functions
                </Text>
                <Text variant="bodyMd" as="p">
                  • <strong>Neon/AWS:</strong> Database hosting with encryption and security compliance
                </Text>
                <Text variant="bodyMd" as="p">
                  • <strong>Shopify:</strong> All data originates from and remains within Shopify's ecosystem
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Legal Requirements:</strong> We may disclose information if required by law, court 
                  order, or to protect our legal rights.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">Your Rights (GDPR & Privacy Compliance)</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  <strong>Access:</strong> Request a copy of all data we store about your store.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Correction:</strong> Update or correct inaccurate data through the app settings.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Deletion:</strong> Request complete data deletion at any time.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Portability:</strong> Export your analytics data in CSV format via the dashboard.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Objection:</strong> Opt out of specific data processing activities (e.g., A/B testing).
                </Text>
                <Text variant="bodyMd" as="p">
                  To exercise these rights, contact us via the Shopify App Store or at your support email.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">Cookies and Tracking</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  <strong>Essential Cookies:</strong> We use session cookies required for Shopify authentication 
                  and app functionality. These cannot be disabled.
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Analytics Tracking:</strong> We track anonymous cart interactions and recommendation 
                  performance using first-party data (no third-party analytics services like Google Analytics).
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>No Customer Tracking:</strong> End customers visiting your storefront are not tracked 
                  by our app beyond standard Shopify analytics.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="headingMd" as="h2">Children's Privacy</Text>
              <Text variant="bodyMd" as="p">
                {appName} is designed for Shopify merchants (businesses) and is not intended for use by 
                individuals under 18 years of age. We do not knowingly collect data from children.
              </Text>

              <Divider />

              <Text variant="headingMd" as="h2">International Data Transfers</Text>
              <Text variant="bodyMd" as="p">
                Your data may be processed in the United States or other countries where our service providers 
                operate. We ensure all transfers comply with GDPR and applicable data protection laws through 
                appropriate safeguards.
              </Text>

              <Divider />

              <Text variant="headingMd" as="h2">Changes to This Privacy Policy</Text>
              <Text variant="bodyMd" as="p">
                We may update this Privacy Policy periodically to reflect changes in our practices or legal 
                requirements. The "Last updated" date at the top indicates the most recent revision. Continued 
                use of the app after changes constitutes acceptance of the updated policy.
              </Text>

              <Divider />

              <Text variant="headingMd" as="h2">Contact Us</Text>
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  If you have questions or concerns about this Privacy Policy or our data practices:
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>App Name:</strong> {appName}
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Email:</strong> support@cartuplift.com
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Support:</strong> Available via Shopify App Store support channel
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Website:</strong> https://cartuplift.com
                </Text>
                <Text variant="bodyMd" as="p">
                  <strong>Response Time:</strong> We aim to respond to all privacy inquiries within 48 hours.
                </Text>
              </BlockStack>

              <Divider />

              <Text variant="bodyMd" as="p" tone="subdued">
                This privacy policy is compliant with GDPR, CCPA, and Shopify's App Store requirements.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
