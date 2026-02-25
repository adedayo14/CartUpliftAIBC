import { type ActionFunctionArgs } from "@remix-run/node";
import db from "~/db.server";
import { authenticateWebhook } from "~/bigcommerce.server";
import { incrementOrderCount, canUseApp, getOrCreateSubscription } from "~/services/billing.server";
import { incrementLifetimeOrders } from "~/services/lifetimeMetrics.server";
import { sendOrderLimitWarning } from "~/services/email.server";
import type { JsonValue, JsonObject } from "~/types/common";
import type { TrackingEventModel, BundleModel, MLUserProfileModel } from "~/types/prisma";
import { logger } from "~/utils/logger.server";

/**
 * BigCommerce Webhook Payload Types
 */
interface LineItemProperty {
  name: string;
  value: string;
}

interface OrderLineItemWebhook {
  id: string | number;
  product_id?: string | number;
  variant_id?: string | number;
  title: string;
  quantity: number;
  price: string | number;
  properties?: LineItemProperty[];
}

interface OrderCustomerWebhook {
  id: string | number;
  email?: string;
  first_name?: string;
  last_name?: string;
}

interface BCOrderWebhook {
  id: string | number;
  order_number?: number;
  number?: number;
  total_price?: string | number;
  email?: string;
  customer?: OrderCustomerWebhook;
  line_items?: OrderLineItemWebhook[];
}

interface ProductSourceQuantities {
  bundle: number;
  rec: number;
  manual: number;
}

interface BundleGroupItem extends OrderLineItemWebhook {
  bundleName?: string | null;
}

/**
 * 🎯 PURCHASE ATTRIBUTION WEBHOOK
 * 
 * Purpose: Track which recommended products were actually purchased + order counting for billing
 * Triggered: Every time a customer completes an order
 * 
 * Process:
 * 1. Receive order data from BigCommerce
 * 2. Increment order count for billing limits
 * 3. Extract purchased product IDs
 * 4. Look up recommendations shown in last 7 days for this customer
 * 5. Match purchases to recommendations
 * 6. Create attribution records (revenue tracking)
 * 7. Update MLUserProfile with purchase data
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const startTime = Date.now();
  try {
    logger.info("Order webhook started", { timestamp: new Date().toISOString() });

    const { storeHash, payload } = await authenticateWebhook(request);
    const shop = storeHash;
    const topic = "ORDERS_CREATE"; // BigCommerce webhook scope: store/order/created

    logger.info("Webhook authenticated", {
      topic,
      shop,
      orderId: payload.id,
      orderNumber: payload.order_number || payload.number,
      lineItemCount: payload.line_items?.length || 0
    });

    if (topic !== "ORDERS_CREATE") {
      logger.error("Invalid webhook topic", { topic, expected: "ORDERS_CREATE" });
      return new Response("Invalid topic", { status: 400 });
    }

    // 🛡️ DUPLICATE BILLING PREVENTION: Check if we already counted this order
    // This prevents counting the same order multiple times if webhook fires multiple times
    const orderId = payload.id?.toString();
    const alreadyCounted = await db.billedOrder?.findFirst({
      where: {
        storeHash: shop,
        orderId
      }
    });
    
    if (alreadyCounted) {
      logger.info("Order already counted for billing, skipping duplicate", {
        shop,
        orderNumber: payload.order_number,
        orderId
      });
      return new Response("OK", { status: 200 });
    }

    // Process the order for ML learning and attribution FIRST
    // This determines if the order used our app features
    const { usedApp: orderUsedApp, attributedRevenue } = await processOrderForAttribution(shop, payload);

    // Track lifetime metrics for ALL orders (not just app-attributed)
    const orderValue = parseFloat(String(payload.total_price || 0));
    await incrementLifetimeOrders(shop, orderValue, attributedRevenue);

    // Only increment order count for billing if the order actually used our app features
    if (orderUsedApp) {
      try {
        const { newCount, limitReached, shouldShowWarning } = await incrementOrderCount(shop);
        logger.info("Order count updated for billing", {
          shop,
          newCount,
          limitReached,
          shouldShowWarning
        });

        // Mark this order as counted to prevent duplicates
        await db.billedOrder?.create({
          data: {
            storeHash: shop,
            orderId,
            orderNumber: payload.order_number || payload.number,
            countedAt: new Date()
          }
        }).catch((error: unknown) => logger.warn("Failed to create billed order record", { shop, orderId, error }));
        
        // Send email warning if approaching limit
        if (shouldShowWarning) {
          const subscription = await getOrCreateSubscription(shop);
          // Get merchant email from order payload
          const merchantEmail = payload.email || payload.customer?.email;
          
          if (merchantEmail) {
            await sendOrderLimitWarning(
              merchantEmail,
              subscription.orderCount,
              subscription.orderLimit,
              subscription.planTier
            );
            logger.info("Order limit warning email sent", {
              shop,
              merchantEmail,
              orderCount: subscription.orderCount,
              orderLimit: subscription.orderLimit
            });
          } else {
            logger.warn("No merchant email available for order limit warning", { shop });
          }
        }
        
        // Check if app can still be used
        const canUse = await canUseApp(shop);
        if (!canUse) {
          logger.warn("Shop has reached order limit", { shop, action: "app_should_be_disabled" });
        }
      } catch (error: unknown) {
        logger.error("Failed to update order count", { shop, error });
        // Don't fail the webhook if billing update fails
      }
    } else {
      logger.info("Order did not use app features, not counting toward billing", {
        shop,
        orderNumber: payload.order_number
      });
    }

    const duration = Date.now() - startTime;
    logger.info("Order webhook completed", { shop, duration });
    
    return new Response("OK", { status: 200 });
  } catch (error) {
    const duration = Date.now() - startTime;

    if (error instanceof Response) {
      logger.error("Order webhook error (Response type)", {
        duration,
        status: error.status,
        statusText: error.statusText,
      });

      if (error.status === 401) {
        logger.error("Webhook unauthorized", {
          storeHash: request.headers.get("X-BigCommerce-Store-Hash"),
          topicHeader: request.headers.get("X-BigCommerce-Topic"),
          webhookIdPresent: request.headers.has("webhook-id") || request.headers.has("svix-id"),
          webhookTimestampPresent: request.headers.has("webhook-timestamp") || request.headers.has("svix-timestamp"),
          webhookSignaturePresent: request.headers.has("webhook-signature") || request.headers.has("svix-signature"),
          apiSecretConfigured: Boolean(process.env.BC_CLIENT_SECRET),
        });
      }

      return error;
    }

    logger.error("Order webhook error", { duration, error });
    return new Response("Error", { status: 500 });
  }
};

async function processOrderForAttribution(shop: string, order: BCOrderWebhook): Promise<{usedApp: boolean, attributedRevenue: number}> {
  let usedAppFeatures = false;
  let totalAttributedRevenue = 0;

  try {
    const customerId = order.customer?.id?.toString();
    const orderNumber = order.order_number || order.number;
    const orderValue = parseFloat(String(order.total_price || 0));

    logger.debug("Attribution processing started", {
      shop,
      orderId: order.id,
      orderNumber,
      timestamp: new Date().toISOString()
    });

    // Log all purchased products with their details
    const lineItems = order.line_items?.map((item: OrderLineItemWebhook) => ({
      productId: item.product_id?.toString(),
      variantId: item.variant_id?.toString(),
      title: item.title,
      price: item.price
    })) || [];

    logger.debug("Purchased products and order details", {
      shop,
      orderNumber,
      customerId,
      orderValue,
      lineItemCount: order.line_items?.length,
      products: lineItems
    });
    
    // 🛡️ DUPLICATE PREVENTION: Check if we already processed this order
    const existingAttribution = await db.recommendationAttribution?.findFirst({
      where: {
        storeHash: shop,
        orderId: order.id?.toString()
      }
    });
    
    if (existingAttribution) {
      logger.info("Order already attributed, skipping duplicate", {
        shop,
        orderNumber,
        orderId: order.id?.toString()
      });
      // Return existing attributed revenue from database
      const existingRevenue = existingAttribution.attributedRevenue || 0;
      return { usedApp: true, attributedRevenue: existingRevenue };
    }
    
    // 🎁 BUNDLE TRACKING: Check for bundle purchases and update analytics
    const { usedBundles: bundleUsed, bundleRevenue } = await processBundlePurchases(shop, order);
    if (bundleUsed) {
      usedAppFeatures = true;
      totalAttributedRevenue += bundleRevenue; // Add bundle revenue to attributed total
    }
    
    // Extract purchased product IDs AND variant IDs (for matching with tracking)
    // Build comprehensive maps for attribution matching
    const purchasedProductIds: string[] = [];
    const purchasedVariantIds: string[] = [];
    const variantToProductMap = new Map<string, string>();
    const productToVariantsMap = new Map<string, string[]>();
    
    order.line_items?.forEach((item: OrderLineItemWebhook) => {
      const productId = item.product_id?.toString();
      const variantId = item.variant_id?.toString();

      if (productId) {
        purchasedProductIds.push(productId);

        // Track all variants for this product
        if (!productToVariantsMap.has(productId)) {
          productToVariantsMap.set(productId, []);
        }
        if (variantId) {
          productToVariantsMap.get(productId)!.push(variantId);
        }
      }

      if (variantId) {
        purchasedVariantIds.push(variantId);
        if (productId) {
          variantToProductMap.set(variantId, productId);
        }
      }
    });
    
    // Deduplicate
    const uniqueProductIds = [...new Set(purchasedProductIds)];
    const uniqueVariantIds = [...new Set(purchasedVariantIds)];
    
    logger.debug("Purchased products mapped", {
      shop,
      productCount: uniqueProductIds.length,
      variantCount: uniqueVariantIds.length,
      productIds: uniqueProductIds,
      variantIds: uniqueVariantIds
    });

    if (uniqueProductIds.length === 0 && uniqueVariantIds.length === 0) {
      logger.debug("No products in order, skipping attribution", { shop, orderNumber });
      return { usedApp: usedAppFeatures, attributedRevenue: 0 };
    }

    logger.debug("Checking attribution", {
      shop,
      productCount: uniqueProductIds.length,
      variantCount: uniqueVariantIds.length
    });
    
    // Look up recommendations shown in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    logger.debug("Querying tracking events for attribution", {
      shop,
      since: sevenDaysAgo.toISOString(),
      eventTypes: ['impression', 'ml_recommendation_served', 'click']
    });
    
    // Find recent tracking events for this shop - get impressions AND clicks
    const recentEvents = await db.trackingEvent?.findMany({
      where: {
        storeHash: shop,
        event: { in: ['impression', 'ml_recommendation_served', 'click'] },
        createdAt: { gte: sevenDaysAgo }
      },
      orderBy: { createdAt: 'desc' },
      take: 500
    });

    logger.debug("Tracking events found", {
      shop,
      eventCount: recentEvents?.length || 0,
      sample: recentEvents?.slice(0, 5).map((e: TrackingEventModel) => ({
        event: e.event,
        productId: e.productId,
        variantId: e.variantId,
        createdAt: e.createdAt
      }))
    });

    if (!recentEvents || recentEvents.length === 0) {
      logger.debug("No recent tracking events found for attribution", { shop });
      return { usedApp: usedAppFeatures, attributedRevenue: 0 };
    }
    
    // Separate impression/served and clicked events
    const impressionEvents = recentEvents.filter((e: TrackingEventModel) =>
      e.event === 'impression' || e.event === 'ml_recommendation_served'
    );
    const clickEvents = recentEvents.filter((e: TrackingEventModel) => e.event === 'click');
    
    logger.debug("Event breakdown", {
      shop,
      impressions: impressionEvents.length,
      clicks: clickEvents.length
    });
    
    // Build a set of clicked product IDs AND variant IDs
    // Need to check both because clicks might be tracked as variants
    // 🕐 Only include clicks from the last 1 hour to ensure attribution is for intentional purchases
    // (not items clicked days ago to view, then manually added later)
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const clickedProductIds = new Set<string>();
    const clickedVariantIds = new Set<string>();
    const recentClickEvents = clickEvents.filter((e: TrackingEventModel) => {
      const clickTime = new Date(e.createdAt);
      return clickTime >= oneHourAgo;
    });

    logger.debug("Click filtering applied", {
      shop,
      totalClicks: clickEvents.length,
      recentClicks: recentClickEvents.length
    });

    recentClickEvents.forEach((e: TrackingEventModel) => {
      const id = String(e.productId);

      // Add the clicked ID (could be variant or product)
      if (id.length > 10) {
        // Likely a variant ID
        clickedVariantIds.add(id);
      } else {
        // Likely a product ID
        clickedProductIds.add(id);
      }

      // Check metadata for parent product ID and variant ID
      try {
        const metadata = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;

        // New tracking format: parentProductId is the product, variantId is the variant
        if (metadata && typeof metadata === 'object' && 'variantId' in metadata) {
          clickedVariantIds.add(String(metadata.variantId));
        }
        if (metadata && typeof metadata === 'object' && 'productId' in metadata) {
          clickedProductIds.add(String(metadata.productId));
        }
      } catch (_err) {
        // Ignore parse errors
      }
    });

    logger.debug("Clicked and purchased IDs", {
      clickedProducts: Array.from(clickedProductIds).slice(0, 5),
      clickedVariants: Array.from(clickedVariantIds).slice(0, 5),
      totalClicks: clickEvents.length,
      purchasedProducts: uniqueProductIds.slice(0, 5),
      purchasedVariants: uniqueVariantIds.slice(0, 5)
    });

    // 🎁 Build a map of product IDs with their source quantities
    // Track how many of each product came from bundles, recommendations, and manual adds
    const productSourceQuantities = new Map<string, ProductSourceQuantities>();

    order.line_items?.forEach((item: OrderLineItemWebhook) => {
      if (!item.product_id) return;

      const productId = item.product_id.toString();
      const properties = item.properties || [];

      // Parse source quantities from properties
      const bundleQty = parseInt(properties.find((p: LineItemProperty) => p.name === '_source_bundle_qty')?.value || '0');
      const recQty = parseInt(properties.find((p: LineItemProperty) => p.name === '_source_rec_qty')?.value || '0');
      const manualQty = parseInt(properties.find((p: LineItemProperty) => p.name === '_source_manual_qty')?.value || '0');

      // If no source tracking exists, assume it was manually added
      const totalSourceQty = bundleQty + recQty + manualQty;
      const actualQty = item.quantity || 1;

      const finalBundleQty = bundleQty;
      const finalRecQty = recQty;
      const finalManualQty = totalSourceQty === 0 ? actualQty : manualQty;

      productSourceQuantities.set(productId, {
        bundle: finalBundleQty,
        rec: finalRecQty,
        manual: finalManualQty
      });

      logger.debug("Product source quantities", {
        productId,
        title: item.title,
        bundleQty: finalBundleQty,
        recQty: finalRecQty,
        manualQty: finalManualQty
      });
    });

    logger.debug("Product source tracking summary", {
      sources: Array.from(productSourceQuantities.entries()).map(([id, qty]) => ({
        productId: id,
        bundle: qty.bundle,
        rec: qty.rec,
        manual: qty.manual
      }))
    });

    // Parse metadata to find recommended products that were ALSO clicked
    // 🎯 KEY: Only attribute by PRODUCT ID to avoid duplicates (not variants)
    const attributedProductIds = new Set<string>(); // Use Set to prevent duplicates
    let recommendationIds: string[] = [];

    for (const event of impressionEvents) {
      try {
        const metadata = typeof event.metadata === 'string'
          ? JSON.parse(event.metadata)
          : event.metadata;

        const recommendedIds = (metadata && typeof metadata === 'object' && 'recommendationIds' in metadata)
          ? (metadata.recommendationIds as unknown[])
          : [];

        logger.debug("Processing impression event", {
          eventId: event.id,
          recommendedIdsCount: recommendedIds.length,
          recommendedIdsSample: recommendedIds.slice(0, 3)
        });
        
        // Check each purchased PRODUCT to see if it was recommended AND clicked
        // We only attribute by product ID, never by variant ID (to avoid duplicates)
        for (const productId of uniqueProductIds) {
          // Skip if already attributed
          if (attributedProductIds.has(productId)) continue;

          // Check if this product has any quantity from recommendations
          const sourceQty = productSourceQuantities.get(productId);
          const recQtyFromSource = sourceQty?.rec || 0;

          // 🎁 If there's no recommendation quantity for this product, skip it
          // This means it was either manually added or came from a bundle only
          if (recQtyFromSource === 0) {
            logger.debug("Skipping product without recommendation quantity", { productId });
            continue;
          }

          // Was this product recommended?
          const wasRecommended = recommendedIds.includes(productId) ||
                                recommendedIds.includes(Number(productId)) ||
                                recommendedIds.includes(String(productId));

          if (!wasRecommended) continue;

          // Was this product (or any of its variants) clicked?
          let wasClicked = clickedProductIds.has(productId);

          if (!wasClicked && productToVariantsMap.has(productId)) {
            // Check if any variant of this product was clicked
            const variants = productToVariantsMap.get(productId)!;
            wasClicked = variants.some(vid => clickedVariantIds.has(vid));
          }

          logger.debug("Product attribution check", {
            productId,
            wasRecommended,
            wasClicked
          });

          if (wasClicked) {
            attributedProductIds.add(productId);
            recommendationIds.push(event.id);
            logger.debug("Product attributed", { productId });
          }
        }
      } catch (e) {
        logger.warn("Failed to parse event metadata", { error: e });
      }
    }
    
    // Convert Set to Array for processing
    const attributedProducts = Array.from(attributedProductIds);

    logger.debug("Attribution summary", {
      totalProducts: uniqueProductIds.length,
      totalVariants: uniqueVariantIds.length,
      totalRecommended: impressionEvents.length,
      totalClicked: clickedProductIds.size + clickedVariantIds.size,
      totalAttributed: attributedProducts.length,
      attributedProducts,
      recommendationEventIds: [...new Set(recommendationIds)]
    });

    if (attributedProducts.length === 0) {
      logger.info("No attributed products (recommendations not clicked or different items purchased)", { shop });

      // Still valuable: track what they bought INSTEAD
      await trackMissedOpportunity(shop, uniqueProductIds, impressionEvents[0]);
      return { usedApp: usedAppFeatures, attributedRevenue: 0 };
    }

    // If we got here, recommendations were used!
    usedAppFeatures = true;

    logger.info("Attribution found", {
      attributedProductsCount: attributedProducts.length,
      message: "recommended → clicked → purchased"
    });
    
    // Calculate total attributed revenue for this order (only counting recommendation quantities)
    totalAttributedRevenue = attributedProducts.reduce((sum, productId) => {
      const sourceQty = productSourceQuantities.get(productId);
      const recQty = sourceQty?.rec || 0;
      return sum + calculateProductRevenue(order, productId, recQty);
    }, 0);
    
    // Calculate uplift percentage
    const baseOrderValue = orderValue - totalAttributedRevenue;
    const upliftPercentage = baseOrderValue > 0 ? ((totalAttributedRevenue / baseOrderValue) * 100) : 0;

    logger.info("Order breakdown and uplift", {
      totalOrderValue: orderValue,
      baseValue: baseOrderValue,
      attributedRevenue: totalAttributedRevenue,
      upliftPercentage: parseFloat(upliftPercentage.toFixed(1)),
      message: `Customer would've spent £${baseOrderValue.toFixed(2)}, our recommendations added £${totalAttributedRevenue.toFixed(2)} (${upliftPercentage.toFixed(1)}% increase)`
    });
    
    // Create attribution records
    const attributionPromises = attributedProducts.map(productId => {
      const sourceQty = productSourceQuantities.get(productId);
      const recQty = sourceQty?.rec || 0;
      const productRevenue = calculateProductRevenue(order, productId, recQty);

      return db.recommendationAttribution?.create({
        data: {
          storeHash: shop,
          productId,
          orderId: order.id?.toString(),
          orderNumber,
          orderValue, // Total order value
          customerId,
          recommendationEventIds: recommendationIds,
          attributedRevenue: productRevenue, // Revenue from this specific product
          conversionTimeMinutes: calculateConversionTime(recentEvents[0]),
          createdAt: new Date()
        }
      }).catch((error: unknown) => logger.warn("Failed to create attribution", { error }));
    });

    await Promise.all(attributionPromises);

    // Update user profile with purchase data
    if (customerId) {
      await updateUserProfilePurchase(shop, customerId, purchasedProductIds);
    }

    logger.info("Attribution complete", {
      attributedProductsCount: attributedProducts.length,
      orderValue,
      attributedRevenue: totalAttributedRevenue
    });

    return { usedApp: usedAppFeatures, attributedRevenue: totalAttributedRevenue };

  } catch (error: unknown) {
    logger.error("Attribution processing error", { error });
    return { usedApp: false, attributedRevenue: 0 };
  }
}

async function trackMissedOpportunity(shop: string, purchasedIds: string[], lastRecommendationEvent: TrackingEventModel) {
  // Track what they bought that we DIDN'T recommend
  // This is gold for learning!
  try {
    const metadata = typeof lastRecommendationEvent.metadata === 'string'
      ? JSON.parse(lastRecommendationEvent.metadata)
      : lastRecommendationEvent.metadata;

    const anchors = (metadata && typeof metadata === 'object' && 'anchors' in metadata)
      ? (metadata.anchors as unknown[])
      : [];
    
    // For each purchased product, create a "missed opportunity" signal
    for (const productId of purchasedIds) {
      const anchorId = String(anchors[0] || 'unknown');
      await db.mLProductSimilarity?.upsert({
        where: {
          storeHash_productId1_productId2: {
            storeHash: shop,
            productId1: anchorId,
            productId2: productId
          }
        },
        create: {
          storeHash: shop,
          productId1: anchorId,
          productId2: productId,
          overallScore: 0.5,
          coPurchaseScore: 1.0, // Start at 1.0 for first co-purchase
          sampleSize: 1,
          computedAt: new Date()
        },
        update: {
          coPurchaseScore: { increment: 0.1 }, // Increase by 0.1 each time they're bought together
          overallScore: { increment: 0.05 }, // Gradually learn this is a good pairing
          sampleSize: { increment: 1 },
          computedAt: new Date()
        }
      }).catch((error: unknown) => logger.warn("Failed to update similarity", { error }));
    }
  } catch (error: unknown) {
    logger.warn("Failed to track missed opportunity", { error });
  }
}

function calculateProductRevenue(order: BCOrderWebhook, productId: string, quantity?: number): number {
  // First try matching by product_id
  let lineItem = order.line_items?.find((item: OrderLineItemWebhook) =>
    item.product_id?.toString() === productId
  );

  // If not found, try matching by variant_id (since attributed products could be variants)
  if (!lineItem) {
    lineItem = order.line_items?.find((item: OrderLineItemWebhook) =>
      item.variant_id?.toString() === productId
    );
  }

  if (!lineItem) {
    logger.warn("Could not find line item for product/variant", { productId });
    return 0;
  }

  // Use provided quantity if specified (for source-based revenue calculation), otherwise use total quantity
  const qty = quantity !== undefined ? quantity : (lineItem.quantity || 1);
  const revenue = parseFloat(String(lineItem.price || 0)) * qty;
  logger.debug("Product revenue calculated", {
    productId,
    price: lineItem.price,
    quantity: qty,
    revenue: parseFloat(revenue.toFixed(2))
  });

  return revenue;
}

function calculateConversionTime(recommendationEvent: TrackingEventModel): number {
  if (!recommendationEvent?.createdAt) return 0;

  const recommendedAt = new Date(recommendationEvent.createdAt);
  const now = new Date();
  const diffMs = now.getTime() - recommendedAt.getTime();

  return Math.floor(diffMs / 60000); // Convert to minutes
}

async function updateUserProfilePurchase(shop: string, customerId: string, productIds: string[]) {
  try {
    // Find or create user profile
    const profiles = await db.mLUserProfile?.findMany({
      where: { storeHash: shop, customerId }
    });

    if (profiles && profiles.length > 0) {
      // Update existing profile(s)
      for (const profile of profiles) {
        const existingPurchased = Array.isArray(profile.purchasedProducts)
          ? profile.purchasedProducts
          : [];

        const newPurchased = [...new Set([...existingPurchased.map(String), ...productIds])];

        await db.mLUserProfile?.update({
          where: { id: profile.id },
          data: {
            purchasedProducts: newPurchased,
            lastActivity: new Date(),
            updatedAt: new Date()
          }
        });
      }
    }
  } catch (error: unknown) {
    logger.warn("Failed to update user profile", { error });
  }
}

/**
 * 🎁 Process Bundle Purchases
 * Track bundle purchases and update analytics
 */
async function processBundlePurchases(shop: string, order: BCOrderWebhook): Promise<{usedBundles: boolean, bundleRevenue: number}> {
  try {
    const orderId = order.id?.toString();
    const customerId = order.customer?.id ? order.customer.id.toString() : null;
    logger.debug("Checking for bundle purchases in order", { orderId });

    // 🛡️ DUPLICATE PREVENTION: Check if we already tracked bundles for this order
    const existingBundleTracking = await db.bundlePurchase?.findFirst({
      where: {
        storeHash: shop,
        orderId
      }
    });

    if (existingBundleTracking) {
      logger.info("Bundle tracking already exists, skipping duplicate", { orderId });
      const existingRevenue = existingBundleTracking.totalValue || 0;
      return { usedBundles: true, bundleRevenue: existingRevenue };
    }

    // Group line items by bundle_id from properties
    const bundleGroups = new Map<string, BundleGroupItem[]>();

    logger.debug("Analyzing line items for bundle properties", {
      lineItemCount: order.line_items?.length || 0
    });
    order.line_items?.forEach((item: OrderLineItemWebhook, index: number) => {
      const properties = item.properties || [];

      logger.debug("Processing line item", {
        index: index + 1,
        title: item.title,
        propertyCount: properties.length,
        properties: properties.length > 0
          ? properties.map(p => `${p.name}=${p.value}`).join(', ')
          : undefined
      });

      // Find bundle properties (stored as custom properties in array of {name, value} objects)
      let bundleId: string | null = null;
      let bundleName: string | null = null;

      properties.forEach((prop: LineItemProperty) => {
        if (prop.name === '_bundle_id') {
          bundleId = prop.value;
          logger.debug("Found bundle ID in line item", {
            bundleId,
            itemTitle: item.title
          });
        }
        if (prop.name === '_bundle_name') {
          bundleName = prop.value;
          logger.debug("Found bundle name", { bundleName });
        }
      });

      if (bundleId) {
        if (!bundleGroups.has(bundleId)) {
          bundleGroups.set(bundleId, []);
        }
        bundleGroups.get(bundleId)!.push({
          ...item,
          bundleName
        });
      }
    });

    if (bundleGroups.size === 0) {
      logger.info("No bundle purchases found in this order", { orderId });
      return { usedBundles: false, bundleRevenue: 0 };
    }

    logger.info("Found bundle purchases in order", {
      bundleCount: bundleGroups.size,
      orderId
    });
    
    // Track total revenue across all bundles in this order
    let totalBundleRevenue = 0;
    
    // Process each bundle purchase
    for (const [bundleId, items] of bundleGroups) {
      try {
        const bundleName = items[0].bundleName || 'Unknown Bundle';

        // Calculate total revenue for this bundle purchase (only counting bundle quantities)
        let totalRevenue = 0;
        items.forEach((item: BundleGroupItem) => {
          const price = parseFloat(String(item.price || 0));
          const properties = item.properties || [];

          // Get the quantity that came from bundles specifically
          const bundleQtyProp = properties.find((p: LineItemProperty) => p.name === '_source_bundle_qty');
          const bundleQty = bundleQtyProp ? parseInt(bundleQtyProp.value || '0') : item.quantity || 1;

          totalRevenue += price * bundleQty;
          logger.debug("Bundle item revenue", {
            title: item.title,
            price,
            bundleQty,
            revenue: parseFloat((price * bundleQty).toFixed(2))
          });
        });

        totalBundleRevenue += totalRevenue;

        logger.info("Bundle purchase totals", {
          bundleId,
          bundleName,
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          itemCount: items.length
        });

        // Extract product IDs from this bundle purchase
        const purchasedProductIds = items
          .map((item: BundleGroupItem) => item.product_id?.toString())
          .filter((id): id is string => !!id)
          .sort(); // Sort for consistent comparison

        logger.debug("Bundle product IDs", { purchasedProductIds });

        // Strategy 1: Try to find bundle by ID (works for manual bundles)
        const dbBundleId = bundleId.startsWith('ai-') ? bundleId.replace('ai-', '') : bundleId;
        let bundle = await db.bundle?.findFirst({
          where: {
            storeHash: shop,
            id: dbBundleId
          }
        });

        // Strategy 2: For dynamic bundles, find the ML bundle assigned to this product
        if (!bundle && bundleId.startsWith('bundle_dynamic_')) {
          // Extract product ID from bundle_dynamic_[productId]
          const productIdFromBundle = bundleId.replace('bundle_dynamic_', '');
          logger.debug("Dynamic bundle detected, looking for ML bundle", {
            productIdFromBundle
          });

          // Find ML bundle assigned to this specific product or "all products"
          const mlBundles = await db.bundle?.findMany({
            where: {
              storeHash: shop,
              type: { in: ['ml', 'ai_suggested'] },
              status: 'active',
              OR: [
                { assignmentType: 'all' }, // Show on all products
                { assignedProducts: { contains: productIdFromBundle } }, // Assigned to this specific product
                { productIds: { contains: productIdFromBundle } } // Legacy field
              ]
            },
            orderBy: {
              // Prioritize specific assignments over "all"
              assignmentType: 'asc' // 'all' comes before 'specific', but we want specific first
            }
          });

          if (mlBundles && mlBundles.length > 0) {
            // Prefer bundles specifically assigned to this product over "all products"
            bundle = mlBundles.find(b => b.assignmentType === 'specific') || mlBundles[0];
            logger.info("Found ML bundle for product", {
              productIdFromBundle,
              bundleName: bundle.name,
              bundleId: bundle.id
            });
          } else {
            logger.warn("No ML bundle found for product", { productIdFromBundle });
          }
        }

        // Strategy 3: If still not found, try original ID
        if (!bundle && bundleId !== dbBundleId) {
          logger.debug("Trying original bundle ID", { bundleId });
          bundle = await db.bundle?.findFirst({
            where: {
              storeHash: shop,
              id: bundleId
            }
          });
        }

        // Strategy 4: REMOVED - No longer auto-creating duplicate bundles
        // Dynamic bundles should always match to existing ML bundles
        if (!bundle && bundleId.startsWith('bundle_dynamic_')) {
          logger.warn("Dynamic bundle could not be matched to existing ML bundle", {
            bundleId,
            message: "Bundle may have been deleted or deactivated"
          });
        }

        const trackedBundleId = bundle?.id || dbBundleId || bundleId || 'unknown_bundle';

        if (bundle) {
          logger.debug("Found bundle in DB", {
            bundleName: bundle.name,
            bundleType: bundle.type
          });
          const currentPurchases = bundle.totalPurchases || 0;
          const currentRevenue = bundle.totalRevenue || 0;

          await db.bundle?.update({
            where: { id: bundle.id },
            data: {
              totalPurchases: currentPurchases + 1,
              totalRevenue: currentRevenue + totalRevenue,
              updatedAt: new Date()
            }
          });

          logger.info("Updated bundle purchase stats", {
            bundleId,
            purchasesBefore: currentPurchases,
            purchasesAfter: currentPurchases + 1,
            revenueBefore: currentRevenue,
            revenueAfter: parseFloat((currentRevenue + totalRevenue).toFixed(2))
          });

          // Verify the update was committed
          const verifyBundle = await db.bundle?.findUnique({
            where: { id: bundle.id },
            select: { totalPurchases: true, totalRevenue: true }
          });
          logger.debug("Bundle update verification", {
            bundleId: bundle.id,
            purchases: verifyBundle?.totalPurchases,
            revenue: verifyBundle?.totalRevenue
          });
        } else {
          logger.warn("Bundle not found in database", {
            bundleId,
            dbBundleId,
            shop
          });
        }

        try {
          await db.customerBundle?.create({
            data: {
              storeHash: shop,
              customerId,
              bundleId: trackedBundleId,
              sessionId: null,
              action: 'purchase',
              cartValue: totalRevenue,
              discountApplied: null,
              createdAt: new Date()
            }
          });
          logger.debug("Recorded customer bundle purchase", {
            bundleId: trackedBundleId,
            cartValue: parseFloat(totalRevenue.toFixed(2))
          });
        } catch (error: unknown) {
          logger.warn("Failed to record customer bundle purchase", {
            bundleId: trackedBundleId,
            error
          });
        }

      } catch (error: unknown) {
        logger.error("Failed to process bundle", { bundleId, error });
      }
    }

    // 📝 Create tracking record to prevent duplicate processing
    try {
      await db.bundlePurchase?.create({
        data: {
          storeHash: shop,
          orderId: order.id?.toString(),
          orderNumber: order.order_number || order.number,
          bundleCount: bundleGroups.size,
          totalValue: totalBundleRevenue,
          createdAt: new Date()
        }
      });
      logger.info("Created bundle purchase tracking record", {
        orderId: order.id,
        totalBundleRevenue: parseFloat(totalBundleRevenue.toFixed(2)),
        bundleCount: bundleGroups.size
      });
    } catch (error: unknown) {
      logger.error("Failed to create bundle purchase tracking", { error });
    }

    return { usedBundles: true, bundleRevenue: totalBundleRevenue };

  } catch (error: unknown) {
    logger.error("Failed to process bundle purchases", { error });
    return { usedBundles: false, bundleRevenue: 0 };
  }
}
