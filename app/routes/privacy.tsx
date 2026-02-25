import type { MetaFunction, LinksFunction } from "@remix-run/node";
import privacyHref from "../styles/privacy.css?url";

export const meta: MetaFunction = () => ([
  { title: "Privacy Policy | Cart Uplift" },
  {
    name: "description",
    content:
      "How Cart Uplift collects, uses, and protects data for AI recommendations, incentives, and analytics.",
  },
]);

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: privacyHref },
];

export default function PrivacyPolicy() {
  return (
    <main className="privacy-container">
      <h1 className="privacy-title">
        Cart Uplift Privacy Policy
      </h1>
      <p className="privacy-meta">
        Effective date: {new Date().toISOString().slice(0, 10)}
      </p>

      <section>
        <p>
          Cart Uplift ("we", "us") provides a BigCommerce app that adds AI-driven
          recommendations, smart product pairing, and spend-based incentives to
          your storefront. This policy explains what data we process, why, and
          your choices.
        </p>
      </section>

      <h2>Data we process</h2>
      <ul>
        <li>
          <strong>Store data</strong>: shop domain, app settings, and theme
          extension configuration.
        </li>
        <li>
          <strong>Catalog and orders</strong>: product, collection, order, and
          line-item metadata used to learn product pairings and generate
          recommendations.
        </li>
        <li>
          <strong>Cart interactions</strong>: add/remove events and applied
          promotions for operating features and analytics (impressions, adds,
          attributed revenue).
        </li>
        <li>
          <strong>Support</strong>: messages sent to our support email.
        </li>
      </ul>
      <p>
        We do not collect or store payment card data. Customer contact data is
        processed only if provided by BigCommerce or by you for operating app
        features.
      </p>

      <h2>How we use data</h2>
      <ul>
        <li>Generate AI recommendations and smart product pairings</li>
        <li>Run free-shipping and gift thresholds</li>
        <li>Provide analytics (impressions, adds, attributed revenue)</li>
        <li>Maintain, secure, and improve the service</li>
      </ul>

      <h2>Legal basis</h2>
      <p>
        We process data to perform the contract with the merchant (your BigCommerce
        store) and under our legitimate interests to improve and secure the
        service.
      </p>

      <h2>Retention</h2>
      <p>
        We retain store and usage data while the app is installed and delete or
        anonymize it within 30 days after uninstallation, unless longer
        retention is required by law.
      </p>

      <h2>Sharing</h2>
      <p>
        We use BigCommerce as a platform and standard sub-processors for hosting and
        analytics (for example, cloud hosting and database providers). We do not
        sell personal information.
      </p>

      <h2>Your choices</h2>
      <p>
        Configure data and feature behavior in the app admin (recommendation
        sources, thresholds, and privacy settings). You may request deletion of
        shop data by emailing our support address from your shop owner email.
      </p>

      <h2>Security</h2>
      <p>
        We use encryption in transit, least-privilege access, and audit logging.
      </p>

      <h2>Contact</h2>
      <p>
        Cart Uplift Support — <a href="mailto:support@cartuplift.com">support@cartuplift.com</a>
      </p>

      <h2>Regional rights</h2>
      <p>
        If you are subject to GDPR/UK GDPR/CCPA, you may have additional rights
        (access, correction, deletion). Contact us to exercise these rights.
      </p>
    </main>
  );
}
