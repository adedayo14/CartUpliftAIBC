import type { MetaFunction, LinksFunction } from "@remix-run/node";
import privacyHref from "../styles/privacy.css?url";

export const meta: MetaFunction = () => ([
  { title: "Terms of Service | Cart Uplift" },
  {
    name: "description",
    content:
      "Terms of Service for Cart Uplift - AI-powered product recommendations and smart bundles for BigCommerce stores.",
  },
]);

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: privacyHref },
];

export default function TermsOfService() {
  return (
    <main className="privacy-container">
      <h1 className="privacy-title">
        Cart Uplift Terms of Service
      </h1>
      <p className="privacy-meta">
        Effective date: {new Date().toISOString().slice(0, 10)}
      </p>

      <section>
        <p>
          These Terms of Service ("Terms") govern your access to and use of Cart Uplift
          ("the App"), a BigCommerce application provided by Cart Uplift ("we", "us", "our").
          By installing or using the App, you ("Merchant", "you", "your") agree to be
          bound by these Terms.
        </p>
      </section>

      <h2>1. Acceptance of Terms</h2>
      <p>
        By installing the App from the BigCommerce App Marketplace and using our services, you agree
        to these Terms, our Privacy Policy, and any additional terms referenced herein.
        If you do not agree to these Terms, you may not use the App.
      </p>

      <h2>2. Description of Service</h2>
      <p>
        Cart Uplift provides AI-powered product recommendations, smart product bundles,
        cart enhancement features, and analytics for BigCommerce merchants. The App includes:
      </p>
      <ul>
        <li>AI-driven product recommendations based on purchase patterns</li>
        <li>Smart product pairing and bundle suggestions</li>
        <li>Enhanced cart drawer with progress bars and incentives</li>
        <li>Free shipping threshold and gift gating promotions</li>
        <li>Real-time analytics and performance insights</li>
        <li>Customizable styling and layout options</li>
      </ul>

      <h2>3. Account and Subscription</h2>

      <h3>3.1 Eligibility</h3>
      <p>
        You must be a BigCommerce merchant in good standing to use the App. You represent
        that you have the authority to bind your business to these Terms.
      </p>

      <h3>3.2 Pricing Plans</h3>
      <p>
        The App offers multiple pricing tiers based on monthly order volume:
      </p>
      <ul>
        <li><strong>Free Plan</strong>: Up to 15 orders per month, $0/month</li>
        <li><strong>Starter Plan</strong>: Up to 500 orders per month, $29/month</li>
        <li><strong>Growth Plan</strong>: Up to 2,500 orders per month, $79/month</li>
        <li><strong>Pro Plan</strong>: Unlimited orders, $199/month</li>
      </ul>
      <p>
        All plans include access to all features. Pricing is based solely on order volume.
        Paid plans include a 14-day free trial period.
      </p>

      <h3>3.3 Billing</h3>
      <p>
        Billing is managed through BigCommerce's billing system. By subscribing to a paid plan,
        you authorize BigCommerce to charge your account the subscription fee on a recurring
        monthly basis. Charges will appear on your BigCommerce invoice.
      </p>

      <h3>3.4 Order Limits</h3>
      <p>
        Order limits are enforced with a 10% grace buffer. When you approach or exceed
        your plan's order limit, you will be prompted to upgrade. Continued use beyond
        the grace period may result in service interruption until you upgrade your plan.
      </p>

      <h3>3.5 Changes to Pricing</h3>
      <p>
        We reserve the right to modify pricing with 30 days' notice. Price changes will
        not affect your current billing cycle and will apply from your next renewal date.
      </p>

      <h2>4. Your Responsibilities</h2>

      <h3>4.1 Compliance</h3>
      <p>
        You agree to use the App in compliance with all applicable laws, including but not
        limited to privacy laws (GDPR, CCPA), consumer protection laws, and BigCommerce's
        Terms of Service and Acceptable Use Policy.
      </p>

      <h3>4.2 Data Accuracy</h3>
      <p>
        You are responsible for ensuring that product data, pricing, and inventory
        information in your BigCommerce store is accurate. The App relies on this data to
        generate recommendations and bundles.
      </p>

      <h3>4.3 Theme Integration</h3>
      <p>
        You are responsible for enabling and configuring the App's theme extension in
        your BigCommerce theme editor. We provide documentation and support but cannot
        guarantee compatibility with all third-party themes.
      </p>

      <h2>5. Prohibited Uses</h2>
      <p>
        You may not use the App to:
      </p>
      <ul>
        <li>Violate any applicable laws or regulations</li>
        <li>Infringe on intellectual property rights of others</li>
        <li>Transmit malicious code, viruses, or harmful content</li>
        <li>Attempt to reverse engineer, decompile, or access the App's source code</li>
        <li>Use the App to compete with or harm our business</li>
        <li>Sell, resell, or redistribute the App to third parties</li>
        <li>Remove or modify any proprietary notices or labels</li>
      </ul>

      <h2>6. Intellectual Property</h2>

      <h3>6.1 Our Rights</h3>
      <p>
        The App, including all software, algorithms, designs, trademarks, and content,
        is owned by Cart Uplift and protected by copyright, trademark, and other
        intellectual property laws. These Terms do not grant you any ownership rights
        in the App.
      </p>

      <h3>6.2 Your Rights</h3>
      <p>
        You retain all rights to your store data, product information, and customer data.
        We only access and process this data as necessary to provide the App's features,
        as described in our Privacy Policy.
      </p>

      <h3>6.3 License Grant</h3>
      <p>
        Subject to these Terms, we grant you a limited, non-exclusive, non-transferable,
        revocable license to access and use the App solely for your internal business
        purposes in connection with your BigCommerce store.
      </p>

      <h2>7. Data and Privacy</h2>
      <p>
        Our collection and use of data is governed by our Privacy Policy, which is
        incorporated into these Terms by reference. By using the App, you consent to
        our data practices as described in the Privacy Policy.
      </p>
      <p>
        We process order data, product data, and cart interaction data to provide
        AI recommendations and analytics. We implement appropriate security measures
        and comply with GDPR and other applicable privacy regulations.
      </p>

      <h2>8. Service Level and Support</h2>

      <h3>8.1 Availability</h3>
      <p>
        We strive to maintain 99.9% uptime but do not guarantee uninterrupted service.
        We may perform scheduled maintenance with advance notice when possible.
      </p>

      <h3>8.2 Support</h3>
      <p>
        Support levels vary by plan:
      </p>
      <ul>
        <li><strong>Free Plan</strong>: Community support via email</li>
        <li><strong>Starter & Growth Plans</strong>: Priority email support</li>
        <li><strong>Pro Plan</strong>: Dedicated support with faster response times</li>
      </ul>
      <p>
        Support is provided via email at <a href="mailto:support@cartuplift.com">support@cartuplift.com</a>.
        We aim to respond to all inquiries within 24-48 hours during business days.
      </p>

      <h2>9. Modifications to the App</h2>
      <p>
        We reserve the right to modify, update, or discontinue features of the App at
        any time. We will provide reasonable notice of material changes that negatively
        impact functionality. Continued use of the App after changes constitutes
        acceptance of the modified service.
      </p>

      <h2>10. Term and Termination</h2>

      <h3>10.1 Term</h3>
      <p>
        These Terms remain in effect for as long as you use the App.
      </p>

      <h3>10.2 Termination by You</h3>
      <p>
        You may terminate your use of the App at any time by uninstalling it from your
        BigCommerce store. If you are on a paid plan, uninstalling will cancel your
        subscription at the end of the current billing period. No refunds are provided
        for partial months.
      </p>

      <h3>10.3 Termination by Us</h3>
      <p>
        We may suspend or terminate your access to the App immediately if you violate
        these Terms, fail to pay applicable fees, or engage in fraudulent or illegal
        activity. We will provide notice when reasonably possible.
      </p>

      <h3>10.4 Effect of Termination</h3>
      <p>
        Upon termination, your right to use the App ceases immediately. We will delete
        or anonymize your shop data within 30 days of termination in accordance with
        our Privacy Policy and GDPR requirements. You may request an export of your
        data before uninstalling.
      </p>

      <h2>11. Warranties and Disclaimers</h2>

      <h3>11.1 Limited Warranty</h3>
      <p>
        We warrant that the App will perform substantially in accordance with its
        documentation. If the App fails to meet this warranty, your sole remedy is
        for us to use commercially reasonable efforts to correct the issue or, if
        we cannot, to refund any prepaid fees for the affected period.
      </p>

      <h3>11.2 Disclaimer</h3>
      <p>
        EXCEPT AS EXPRESSLY PROVIDED ABOVE, THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE"
        WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT
        LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        NON-INFRINGEMENT, OR COURSE OF PERFORMANCE.
      </p>
      <p>
        We do not warrant that the App will be uninterrupted, error-free, or secure, or
        that all errors will be corrected. We do not guarantee specific results, sales
        increases, or revenue improvements from using the App.
      </p>

      <h2>12. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT SHALL CART UPLIFT, ITS
        AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED
        TO LOSS OF PROFITS, REVENUE, DATA, USE, OR GOODWILL, WHETHER IN CONTRACT, TORT,
        OR OTHERWISE, ARISING OUT OF OR RELATED TO YOUR USE OF THE APP, EVEN IF ADVISED
        OF THE POSSIBILITY OF SUCH DAMAGES.
      </p>
      <p>
        OUR TOTAL LIABILITY TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATED TO THESE TERMS
        OR THE APP SHALL NOT EXCEED THE AMOUNT YOU PAID US IN THE TWELVE (12) MONTHS
        PRECEDING THE CLAIM, OR ONE HUNDRED DOLLARS ($100), WHICHEVER IS GREATER.
      </p>
      <p>
        Some jurisdictions do not allow limitation of liability for consequential damages,
        so these limitations may not apply to you.
      </p>

      <h2>13. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless Cart Uplift and its affiliates,
        officers, directors, employees, and agents from any claims, losses, damages,
        liabilities, and expenses (including reasonable attorneys' fees) arising out of
        or related to:
      </p>
      <ul>
        <li>Your use of the App</li>
        <li>Your violation of these Terms</li>
        <li>Your violation of any applicable laws or third-party rights</li>
        <li>Your store's products, services, or business practices</li>
        <li>Any data or content you provide to the App</li>
      </ul>

      <h2>14. Dispute Resolution</h2>

      <h3>14.1 Informal Resolution</h3>
      <p>
        Before filing a claim, you agree to contact us at <a href="mailto:support@cartuplift.com">support@cartuplift.com</a> to
        attempt to resolve the dispute informally. We will attempt to resolve the
        dispute within 30 days.
      </p>

      <h3>14.2 Governing Law</h3>
      <p>
        These Terms are governed by the laws of the jurisdiction where Cart Uplift is
        registered, without regard to conflict of law principles.
      </p>

      <h3>14.3 Arbitration</h3>
      <p>
        Any disputes arising out of these Terms or the App that cannot be resolved
        informally shall be resolved through binding arbitration, except that either
        party may seek injunctive relief in court for intellectual property infringement
        or violation of confidentiality obligations.
      </p>

      <h2>15. General Provisions</h2>

      <h3>15.1 Entire Agreement</h3>
      <p>
        These Terms, together with our Privacy Policy, constitute the entire agreement
        between you and Cart Uplift regarding the App and supersede all prior agreements.
      </p>

      <h3>15.2 Amendments</h3>
      <p>
        We may update these Terms from time to time. We will notify you of material changes
        by email or through the App. Your continued use after changes constitutes acceptance
        of the updated Terms. If you disagree with changes, you must stop using the App.
      </p>

      <h3>15.3 Severability</h3>
      <p>
        If any provision of these Terms is found to be unenforceable, the remaining
        provisions will continue in full force and effect.
      </p>

      <h3>15.4 Waiver</h3>
      <p>
        Our failure to enforce any right or provision of these Terms will not constitute
        a waiver of such right or provision.
      </p>

      <h3>15.5 Assignment</h3>
      <p>
        You may not assign these Terms without our prior written consent. We may assign
        these Terms without restriction, including in connection with a merger, acquisition,
        or sale of assets.
      </p>

      <h3>15.6 No Agency</h3>
      <p>
        These Terms do not create any agency, partnership, joint venture, or employment
        relationship between you and Cart Uplift.
      </p>

      <h3>15.7 Force Majeure</h3>
      <p>
        We will not be liable for any delay or failure to perform due to circumstances
        beyond our reasonable control, including acts of God, natural disasters, war,
        terrorism, labor disputes, or internet service provider failures.
      </p>

      <h2>16. Contact Information</h2>
      <p>
        If you have questions about these Terms, please contact us:
      </p>
      <p>
        <strong>Cart Uplift Support</strong><br />
        Email: <a href="mailto:support@cartuplift.com">support@cartuplift.com</a><br />
        Website: <a href="https://cartuplift.com">https://cartuplift.com</a>
      </p>

      <section>
        <p className="privacy-meta">
          Last updated: {new Date().toISOString().slice(0, 10)}
        </p>
      </section>
    </main>
  );
}
