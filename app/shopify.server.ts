import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
  DeliveryMethod,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { logger } from "~/utils/logger.server";

interface WebhookUserError {
  field: string[];
  message: string;
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  isEmbeddedApp: true,
  webhooks: {
    ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks/orders/create",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // Register webhooks automatically after merchant installs/authenticates
      logger.info("Registering webhooks after auth", { shop: session.shop });

      // Fetch shop owner email for future communications
      let shopEmail: string | null = null;
      try {
        const shopResponse = await admin.graphql(
          `#graphql
          query {
            shop {
              email
              contactEmail
              name
              billingAddress {
                firstName
                lastName
              }
            }
          }`
        );
        const shopData = await shopResponse.json() as { data?: { shop?: { email?: string; contactEmail?: string; name?: string; billingAddress?: { firstName?: string; lastName?: string } } } };
        shopEmail = shopData.data?.shop?.email || shopData.data?.shop?.contactEmail || null;

        if (shopEmail) {
          logger.info("Shop email captured", { shop: session.shop, email: shopEmail });
          // Store email in Settings for superadmin dashboard
          await prisma.settings.upsert({
            where: { shop: session.shop },
            update: { ownerEmail: shopEmail },
            create: { shop: session.shop, ownerEmail: shopEmail }
          });
        }
      } catch (error: unknown) {
        logger.error("Failed to fetch shop email", { shop: session.shop, error });
      }

      try {
        const response = await admin.graphql(
          `#graphql
          mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
              webhookSubscription {
                id
                topic
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              topic: 'ORDERS_CREATE',
              webhookSubscription: {
                callbackUrl: `${process.env.SHOPIFY_APP_URL}/webhooks/orders/create`,
                format: 'JSON',
              },
            },
          }
        );

        const result = await response.json();

        if (result.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
          const errors = result.data.webhookSubscriptionCreate.userErrors as WebhookUserError[];
          // Check if it's just a duplicate webhook error
          if (errors.some((e: WebhookUserError) => e.message?.includes('already exists'))) {
            logger.info("Webhook already exists", { shop: session.shop });
          } else {
            logger.error("Webhook registration errors", { shop: session.shop, errors });
          }
        } else {
          logger.info("Webhook registered successfully", { shop: session.shop });
        }
      } catch (error: unknown) {
        logger.error("Failed to register webhook", { shop: session.shop, error });
      }

      // Auto-create starter ML bundle on install (if none exists)
      try {
        const existingBundles = await prisma.bundle.count({
          where: { shop: session.shop }
        });

        if (existingBundles === 0) {
          logger.info("Creating starter ML bundle", { shop: session.shop });

          await prisma.bundle.create({
            data: {
              shop: session.shop,
              name: "Frequently Bought Together",
              description: "AI-powered product recommendations based on shopping patterns",
              type: "ai_suggested",
              status: "active",
              discountType: "percentage",
              discountValue: 0, // No discount by default
              minProducts: 2,
              assignmentType: "all", // Show on all product pages
              bundleStyle: "grid",
              allowDeselect: true,
              hideIfNoML: false,
              productIds: "[]",
              collectionIds: "[]",
              assignedProducts: "[]",
            }
          });

          logger.info("Starter ML bundle created successfully", { shop: session.shop });
        }
      } catch (error: unknown) {
        logger.error("Failed to create starter bundle", { shop: session.shop, error });
      }
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    removeRest: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
