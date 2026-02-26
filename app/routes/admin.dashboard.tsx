import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Box,
  Flex,
  Panel,
  Text,
  H1,
  H2,
  H3,
  Small,
  Button,
  Badge,
  Select,
  Modal,
  ProgressBar,
  Message,
} from "@bigcommerce/big-design";
import { authenticateAdmin, ensureStorefrontScripts } from "../bigcommerce.server";
import { getSettings } from "../models/settings.server";
import prisma from "../db.server";
import { getShopCurrency } from "../services/currency.server";
import db from "../db.server";
import { PRICING_PLANS } from "../config/billing.server";
import { getLifetimeMetricsFormatted } from "../services/lifetimeMetrics.server";
import type { PlanTier } from "../types/billing";
import { generateInsights } from "../utils/insights";
import dashboardStyles from "../styles/dashboard.module.css";
import { InsightCard } from "../components/InsightCard";
import { getOrders, getOrderProducts, getStoreInfo } from "../services/bigcommerce-api.server";
import type { BCOrder, BCStoreInfo } from "../services/bigcommerce-api.server";
import type { TrackingEventModel, RecommendationAttributionModel, MLProductPerformanceModel } from "~/types/prisma";
import type { JsonValue } from "~/types/common";

// BigCommerce Dashboard Types
interface DashboardOrder {
  id: number;
  total: number;
  currencyCode: string;
  createdAt: string;
  lineItems: DashboardLineItem[];
}

interface DashboardLineItem {
  productId: string;
  name: string;
  quantity: number;
  totalPrice: number;
  variantId: string;
}

// Dashboard Data Types
interface PeriodMetrics {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  multiProductOrderCount: number;
}

interface GiftThreshold {
  threshold: number;
  productId: string;
  productTitle: string;
}

interface GiftThresholdBreakdown {
  threshold: number;
  ordersReached: number;
  percentReached: number;
}

interface ProductStats {
  orders: number;
  revenue: number;
  quantity: number;
}

interface TopProduct {
  product: string;
  orders: number;
  quantity: number;
  revenue: number;
  avgOrderValue: string;
}

interface ProductPair {
  id: string;
  title: string;
}

interface BundleOpportunity {
  product1: { id: string; title: string };
  product2: { id: string; title: string };
  count: number;
  coOccurrenceRate: number;
}

interface RecSummary {
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
}

interface RecCTRSeriesItem {
  date: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface TopRecommendedProduct {
  productId: string;
  productTitle: string;
  impressions: number;
  clicks: number;
  ctr: number;
  revenueCents: number;
}

interface TopAttributedProduct {
  productId: string;
  productTitle: string;
  revenue: number;
  orders: number;
}

interface OrderUpliftBreakdown {
  orderNumber: string;
  totalValue: number;
  baseValue: number;
  attributedValue: number;
  upliftPercentage: number;
  products: string[];
}

interface TopBundle {
  bundleId: string;
  bundleName: string;
  bundleType: string; // 'Manual' or 'AI'
  products: { title: string; fullTitle: string }[]; // Array of product titles (max 2, one is main product)
  purchases: number;
  revenue: number;
}

interface RevenueBreakdown {
  recommendationsOnly: { revenue: number; orders: number };
  bundlesOnly: { revenue: number; orders: number };
  mixed: { revenue: number; orders: number };
}

interface MLStatus {
  productsAnalyzed: number;
  highPerformers: number;
  blacklistedProducts: number;
  performanceChange: number;
  lastUpdated: Date | null;
}

interface TopUpsell {
  product: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionRate: string;
  revenue: string;
  ctr: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, storeHash } = await authenticateAdmin(request);

  try {
    await ensureStorefrontScripts(storeHash);
  } catch (error) {
    console.warn("[Dashboard] Failed to sync storefront scripts", { storeHash, error });
  }

  const url = new URL(request.url);
  const timeframe = url.searchParams.get("timeframe") || "30d";
  const search = url.search;
  const customStartDate = url.searchParams.get("startDate");
  const customEndDate = url.searchParams.get("endDate");
  
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;

  const normalizeProductId = (value: string | null | undefined): string | null => {
    if (!value || typeof value !== 'string') return null;
    return value.includes('/') ? value.split('/').pop()! : value;
  };
  
  if (customStartDate && customEndDate) {
    startDate = new Date(customStartDate);
    endDate = new Date(customEndDate);
    endDate.setHours(23, 59, 59, 999);
  } else {
    switch (timeframe) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "ytd":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "all":
        startDate = new Date(2020, 0, 1);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  const periodDuration = endDate.getTime() - startDate.getTime();
  const previousPeriodEnd = new Date(startDate.getTime() - 1);
  const previousPeriodStart = new Date(previousPeriodEnd.getTime() - periodDuration);

  try {
    if (!session || !storeHash) {
      throw new Error('No authenticated session');
    }

    const extractIdsFromParsedValue = (input: unknown): string[] => {
      const results: string[] = [];
      if (!input) return results;
      if (Array.isArray(input)) {
        input.forEach((item) => {
          if (typeof item === 'string') {
            results.push(item);
          } else if (item && typeof item === 'object') {
            const idCandidate = (item as Record<string, unknown>).id || (item as Record<string, unknown>).productId;
            if (typeof idCandidate === 'string') {
              results.push(idCandidate);
            }
          }
        });
        return results;
      }
      if (typeof input === 'string') {
        results.push(input);
        return results;
      }
      if (typeof input === 'object') {
        const idCandidate = (input as Record<string, unknown>).id || (input as Record<string, unknown>).productId;
        if (typeof idCandidate === 'string') {
          results.push(idCandidate);
        }
      }
      return results;
    };

    const parseJsonStringOfIds = (value?: string | null): string[] => {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        return extractIdsFromParsedValue(parsed);
      } catch (error) {
        console.warn('Failed to parse bundle product ids JSON', { value, error });
        return [];
      }
    };

    const parseTrackingMetadata = (metadata: JsonValue | null): Record<string, unknown> | null => {
      if (!metadata) return null;
      if (typeof metadata === 'string') {
        try {
          return JSON.parse(metadata);
        } catch (error) {
          console.warn('Failed to parse tracking metadata string', error);
          return null;
        }
      }
      if (typeof metadata === 'object') {
        return metadata as Record<string, unknown>;
      }
      return null;
    };

    const getBundleProductIdsFromTracking = (bundleId: string): string[] => {
      if (!trackingEvents.length) return [];
      const ids = new Set<string>();
      trackingEvents.forEach((event) => {
        if (event.productId !== bundleId || event.source !== 'bundle') {
          return;
        }
        const metadata = parseTrackingMetadata(event.metadata);
        if (!metadata) return;
        const candidateValues = ['products', 'bundleProducts', 'selectedProducts', 'productIds']
          .map((key) => (metadata as Record<string, unknown>)[key])
          .filter((value): value is unknown => value !== undefined);

        candidateValues.forEach((rawValue) => {
          const rawIds = extractIdsFromParsedValue(rawValue);
          rawIds.forEach((candidate) => {
            const normalized = normalizeProductId(candidate);
            if (normalized) {
              ids.add(normalized);
            }
          });
        });
      });
      return Array.from(ids);
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (dbError) {
      throw new Error(`Database connection error: ${dbError instanceof Error ? dbError.message : 'Unknown DB error'}`);
    }

    let hasOrderAccess = true;
    let allDashboardOrders: DashboardOrder[] = [];
    let storeInfo: BCStoreInfo | null = null;

    try {
      // Fetch orders with pagination from BigCommerce REST API (V2)
      // BC V2 orders API returns up to 250 per page
      const allBCOrders: BCOrder[] = [];
      let page = 1;
      const maxPages = 20; // Safety limit: 20 pages * 250 = 5000 orders max

      while (page <= maxPages) {
        const pageOrders = await getOrders(storeHash, {
          limit: 250,
          page,
          sort: "date_created:desc",
        });

        if (!pageOrders || pageOrders.length === 0) break;
        allBCOrders.push(...pageOrders);
        if (pageOrders.length < 250) break; // No more pages
        page++;
      }

      // Fetch line items for each order and build DashboardOrder objects
      allDashboardOrders = await Promise.all(
        allBCOrders.map(async (order) => {
          let lineItems: DashboardLineItem[] = [];
          try {
            const orderProducts = await getOrderProducts(storeHash, order.id);
            lineItems = orderProducts.map((p) => ({
              productId: String(p.product_id),
              name: p.name,
              quantity: p.quantity,
              totalPrice: parseFloat(p.total_inc_tax),
              variantId: String(p.variant_id),
            }));
          } catch {
            // If we can't get line items for an order, continue with empty
          }
          return {
            id: order.id,
            total: parseFloat(order.total_inc_tax),
            currencyCode: order.currency_code || '',
            createdAt: order.date_created,
            lineItems,
          };
        })
      );
    } catch (_orderError) {
      console.error('[Dashboard] Error fetching orders:', _orderError);
      hasOrderAccess = false;
      allDashboardOrders = [];
    }

    // Fetch store info from BigCommerce REST API
    try {
      storeInfo = await getStoreInfo(storeHash);
    } catch (e) {
      console.error('[Dashboard] Error fetching store info:', e);
    }

    const settings = await getSettings(storeHash);

    // Get subscription to calculate accurate app cost based on tier
    const subscription = await prisma.subscription.findUnique({
      where: { storeHash },
      select: { planTier: true, planStatus: true, createdAt: true }
    });

    const allOrders = hasOrderAccess ? allDashboardOrders : [];

    const orders = allOrders.filter((order: DashboardOrder) => {
      const orderDate = new Date(order.createdAt);
      return orderDate >= startDate && orderDate <= endDate;
    });

    const previousOrders = allOrders.filter((order: DashboardOrder) => {
      const orderDate = new Date(order.createdAt);
      return orderDate >= previousPeriodStart && orderDate <= previousPeriodEnd;
    });

    const shopCurrency = await getShopCurrency(storeHash);
    const storeCurrency = orders.length > 0 && orders[0].currencyCode
      ? orders[0].currencyCode : shopCurrency.code;
    
    const calculatePeriodMetrics = (periodOrders: DashboardOrder[]): PeriodMetrics => {
      const totalOrders = periodOrders.length;
      const totalRevenue = periodOrders.reduce((sum: number, order: DashboardOrder) => {
        return sum + order.total;
      }, 0);
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const multiProductOrders = periodOrders.filter((order: DashboardOrder) => {
        const lineItemCount = order.lineItems?.length || 0;
        return lineItemCount > 1;
      });

      return {
        totalOrders,
        totalRevenue,
        averageOrderValue,
        multiProductOrderCount: multiProductOrders.length
      };
    };
    
    const currentMetrics = calculatePeriodMetrics(orders);
    const totalOrders = currentMetrics.totalOrders;
    const totalRevenue = currentMetrics.totalRevenue;
    const averageOrderValue = currentMetrics.averageOrderValue;
    const previousMetrics = calculatePeriodMetrics(previousOrders);
    
    let cartImpressions = 0;
    let cartOpensToday = 0;
    
    try {
      const cartOpenEvents = await db.analyticsEvent.findMany({
        where: {
          storeHash,
          eventType: 'cart_open',
          createdAt: { gte: startDate, lte: endDate }
        }
      });

      cartImpressions = cartOpenEvents.length;

      if (timeframe === "today") {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEvents = await db.analyticsEvent.findMany({
          where: {
            storeHash,
            eventType: 'cart_open',
            createdAt: { gte: todayStart, lte: endDate }
          }
        });
        cartOpensToday = todayEvents.length;
      } else {
        cartOpensToday = cartImpressions;
      }
    } catch (_e) {
      cartImpressions = 0;
      cartOpensToday = 0;
    }
    
    const checkoutsCompleted = totalOrders;
    const cartToCheckoutRate = cartImpressions > 0 ? (totalOrders / cartImpressions) * 100 : 0;
    
    const freeShippingThreshold = settings?.freeShippingThreshold || 0;
    
    let ordersWithFreeShipping = 0;
    let ordersWithoutFreeShipping = 0;
    let avgAOVWithFreeShipping = 0;
    let avgAOVWithoutFreeShipping = 0;
    let freeShippingRevenue = 0;
    let nonFreeShippingRevenue = 0;
    
    orders.forEach((order: DashboardOrder) => {
      const orderTotal = order.total;
      if (orderTotal >= freeShippingThreshold) {
        ordersWithFreeShipping += 1;
        freeShippingRevenue += orderTotal;
      } else {
        ordersWithoutFreeShipping += 1;
        nonFreeShippingRevenue += orderTotal;
      }
    });
    
    avgAOVWithFreeShipping = ordersWithFreeShipping > 0 ? freeShippingRevenue / ordersWithFreeShipping : 0;
    avgAOVWithoutFreeShipping = ordersWithoutFreeShipping > 0 ? nonFreeShippingRevenue / ordersWithoutFreeShipping : 0;
    
    const freeShippingConversionRate = totalOrders > 0 ? (ordersWithFreeShipping / totalOrders) * 100 : 0;
    const freeShippingAOVLift = avgAOVWithoutFreeShipping > 0 ? 
      ((avgAOVWithFreeShipping - avgAOVWithoutFreeShipping) / avgAOVWithoutFreeShipping) * 100 : 0;
    
    const avgAmountAddedForFreeShipping = avgAOVWithFreeShipping > freeShippingThreshold 
      ? avgAOVWithFreeShipping - freeShippingThreshold 
      : 0;
    
    let giftThresholds: GiftThreshold[] = [];

    if (settings?.giftThresholds) {
      try {
        const parsed = JSON.parse(settings.giftThresholds) as JsonValue;
        if (Array.isArray(parsed)) {
          giftThresholds = parsed as GiftThreshold[];
        }
      } catch (e) {
        console.error('Error parsing gift thresholds:', e);
      }
    }
    
    let ordersReachingGifts = 0;
    let ordersNotReachingGifts = 0;
    let avgAOVWithGift = 0;
    let avgAOVWithoutGift = 0;
    let giftRevenue = 0;
    let nonGiftRevenue = 0;
    let giftThresholdBreakdown: GiftThresholdBreakdown[] = [];
    
    if (giftThresholds.length > 0) {
      const lowestThreshold = Math.min(...giftThresholds.map(g => g.threshold));
      
      if (lowestThreshold > 0) {
        orders.forEach((order: DashboardOrder) => {
          const orderTotal = order.total;
          if (orderTotal >= lowestThreshold) {
            ordersReachingGifts += 1;
            giftRevenue += orderTotal;
          } else {
            ordersNotReachingGifts += 1;
            nonGiftRevenue += orderTotal;
          }
        });

        avgAOVWithGift = ordersReachingGifts > 0 ? giftRevenue / ordersReachingGifts : 0;
        avgAOVWithoutGift = ordersNotReachingGifts > 0 ? nonGiftRevenue / ordersNotReachingGifts : 0;

        giftThresholdBreakdown = giftThresholds.map(gift => {
          const ordersReached = orders.filter((order: DashboardOrder) =>
            order.total >= gift.threshold
          ).length;
          return {
            threshold: gift.threshold,
            ordersReached,
            percentReached: totalOrders > 0 ? (ordersReached / totalOrders) * 100 : 0
          };
        });
      }
    }
    
    const giftConversionRate = totalOrders > 0 ? (ordersReachingGifts / totalOrders) * 100 : 0;
    const giftAOVLift = avgAOVWithoutGift > 0 ? 
      ((avgAOVWithGift - avgAOVWithoutGift) / avgAOVWithoutGift) * 100 : 0;
    
    const lowestGiftThreshold = giftThresholds.length > 0 
      ? Math.min(...giftThresholds.map(g => g.threshold)) 
      : 0;
    const avgAmountAddedForGift = lowestGiftThreshold > 0 && avgAOVWithGift > lowestGiftThreshold
      ? avgAOVWithGift - lowestGiftThreshold
      : 0;
    
    const productStats = new Map<string, ProductStats>();
    orders.forEach((order: DashboardOrder) => {
      order.lineItems?.forEach((lineItem) => {
        const productTitle = lineItem.name;
        if (productTitle) {
          const existing = productStats.get(productTitle) || { orders: 0, revenue: 0, quantity: 0 };
          existing.orders += 1;
          existing.revenue += lineItem.totalPrice || 0;
          existing.quantity += lineItem.quantity;
          productStats.set(productTitle, existing);
        }
      });
    });
    
    const topProducts: TopProduct[] = Array.from(productStats.entries())
      .sort(([,a], [,b]) => b.revenue - a.revenue)
      .slice(0, 10)
      .map(([title, stats]) => ({
        product: title,
        orders: stats.orders,
        quantity: stats.quantity,
        revenue: stats.revenue,
        avgOrderValue: stats.orders > 0 ? (stats.revenue / stats.orders).toFixed(2) : '0.00'
      }));

    const topUpsells: TopUpsell[] = [];

    const bundleOpportunities: BundleOpportunity[] = [];
    const productTitlesMap = new Map<string, string>();
    if (orders.length > 10) {
      const productPairs = new Map<string, BundleOpportunity>();
      const productNames = new Map<string, string>();

      orders.forEach((order: DashboardOrder) => {
        const lineItems = order.lineItems || [];
        const products = lineItems.map((item) => ({
          id: item.productId,
          title: item.name
        })).filter((p): p is ProductPair => Boolean(p.id && p.title));

        products.forEach((product: ProductPair) => {
          productNames.set(product.id, product.title);
        });

        for (let i = 0; i < products.length; i++) {
          for (let j = i + 1; j < products.length; j++) {
            const pair = [products[i].id, products[j].id].sort().join('|');
            const pairInfo = productPairs.get(pair) || {
              product1: { id: products[i].id, title: products[i].title },
              product2: { id: products[j].id, title: products[j].title },
              count: 0,
              coOccurrenceRate: 0
            };
            pairInfo.count += 1;
            productPairs.set(pair, pairInfo);
          }
        }
      });

      const totalOrdersWithMultipleItems = orders.filter((order: DashboardOrder) => {
        const lineItemCount = order.lineItems?.length || 0;
        return lineItemCount > 1;
      }).length;

      if (totalOrdersWithMultipleItems > 0) {
        const highFrequencyPairs = Array.from(productPairs.values())
          .map(pairData => ({
            ...pairData,
            coOccurrenceRate: Math.round((pairData.count / totalOrdersWithMultipleItems) * 100)
          }))
          .filter(pair => pair.coOccurrenceRate >= 60)
          .sort((a, b) => b.coOccurrenceRate - a.coOccurrenceRate)
          .slice(0, 3);

        bundleOpportunities.push(...highFrequencyPairs);
      }
    }

    let trackingEvents: TrackingEventModel[] = [];
    let recSummary: RecSummary = { totalImpressions: 0, totalClicks: 0, ctr: 0 };
    let recCTRSeries: RecCTRSeriesItem[] = [];
    let topRecommended: TopRecommendedProduct[] = [];
    try {
      const events = await db.trackingEvent.findMany({
        where: { storeHash, createdAt: { gte: startDate, lte: endDate } }
      });
      trackingEvents = events;

      const impressions = events.filter((e: TrackingEventModel) => e.event === 'impression').length;
      const clicks = events.filter((e: TrackingEventModel) => e.event === 'click').length;
      recSummary.totalImpressions = impressions;
      recSummary.totalClicks = clicks;
      recSummary.ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

      const byDay: Record<string, { imp: number; clk: number }> = {};
      for (const e of events) {
        const d = new Date(e.createdAt);
        const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
        const b = byDay[key] || (byDay[key] = { imp: 0, clk: 0 });
        if (e.event === 'impression') b.imp++;
        else if (e.event === 'click') b.clk++;
      }
      recCTRSeries = Object.entries(byDay)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({ date, impressions: v.imp, clicks: v.clk, ctr: v.imp > 0 ? (v.clk / v.imp) * 100 : 0 }));

      const byProduct: Record<string, { title: string; imp: number; clk: number; rev: number }>= {};
      for (const e of events) {
        const pid = e.productId as string | null;
        if (!pid) continue;

        // Only filter out invalid/null string literals, not legitimate IDs with underscores
        if (pid === 'undefined' || pid === 'null' || pid === 'NaN') continue;

        const rec = byProduct[pid] || (byProduct[pid] = { title: e.productTitle || '', imp: 0, clk: 0, rev: 0 });
        if (e.event === 'impression') rec.imp++;
        else if (e.event === 'click') rec.clk++;
        if (typeof e.revenueCents === 'number' && isFinite(e.revenueCents)) rec.rev += e.revenueCents;
        if (e.productTitle && !rec.title) rec.title = e.productTitle;
      }
      topRecommended = Object.entries(byProduct)
        .filter(([productId, v]) => {
          // Filter out invalid/placeholder entries
          if (!productId || productId === 'undefined' || productId === 'null' || productId === 'NaN') return false;
          if (productId === 'empty_cart' || productId.startsWith('empty_')) return false;
          // Only show entries with a proper product title (not just numeric ID)
          if (!v.title || v.title === productId) return false;
          return true;
        })
        .map(([productId, v]) => ({
          productId,
          productTitle: v.title,
          impressions: v.imp,
          clicks: v.clk,
          ctr: v.imp > 0 ? (v.clk / v.imp) * 100 : 0,
          revenueCents: v.rev
        }))
        .sort((a,b) => (b.clicks - a.clicks) || (b.impressions - a.impressions))
        .slice(0, 10);
    } catch (trackingError) { 
      console.error('Error fetching tracking events:', trackingError);
    }

    let attributedRevenue = 0;
    let attributedOrders = 0;
    let topAttributedProducts: TopAttributedProduct[] = [];
    let orderUpliftBreakdown: OrderUpliftBreakdown[] = [];

    try {
      const attributions = await db.recommendationAttribution.findMany({
        where: {
          storeHash,
          createdAt: { gte: startDate, lte: endDate }
        }
      });

      attributedRevenue = attributions.reduce((sum: number, a: RecommendationAttributionModel) =>
        sum + (a.attributedRevenue || 0), 0
      );

      const uniqueOrderIds = new Set(attributions.map((a: RecommendationAttributionModel) => a.orderId));
      attributedOrders = uniqueOrderIds.size;
      
      productTitlesMap.clear();
      orders.forEach((order: DashboardOrder) => {
        order.lineItems?.forEach((lineItem) => {
          const productTitle = lineItem.name;
          if (productTitle) {
            productTitlesMap.set(lineItem.productId, productTitle);
            if (lineItem.variantId) {
              productTitlesMap.set(lineItem.variantId, productTitle);
            }
          }
        });
      });
      
      const productMap = new Map<string, { revenue: number; orders: Set<string>; title: string }>();
      for (const attr of attributions) {
        const pid = attr.productId;
        if (!productMap.has(pid)) {
          productMap.set(pid, { revenue: 0, orders: new Set(), title: '' });
        }
        const p = productMap.get(pid)!;
        p.revenue += attr.attributedRevenue || 0;
        p.orders.add(attr.orderId);
      }
      
      topAttributedProducts = Array.from(productMap.entries())
        .map(([productId, data]) => {
          const numericId = productId.includes('/') ? productId.split('/').pop()! : productId;
          const title = productTitlesMap.get(numericId) || productTitlesMap.get(productId) || `Product ${numericId}`;
          
          return {
            productId,
            productTitle: title,
            revenue: data.revenue,
            orders: data.orders.size
          };
        })
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);
      
      const orderUpliftMap = new Map<string, { 
        orderNumber: string; 
        totalValue: number; 
        attributedValue: number; 
        products: Set<string>;
        productCount: number;
      }>();
      
      for (const attr of attributions) {
        const orderKey = attr.orderId;
        if (!orderUpliftMap.has(orderKey)) {
          orderUpliftMap.set(orderKey, {
            orderNumber: attr.orderNumber || orderKey,
            totalValue: attr.orderValue || 0,
            attributedValue: 0,
            products: new Set(),
            productCount: 0
          });
        }
        const orderData = orderUpliftMap.get(orderKey)!;
        
        orderData.attributedValue += attr.attributedRevenue || 0;
        orderData.productCount++;
        
        const pid = attr.productId;
        const numericId = pid.includes('/') ? pid.split('/').pop()! : pid;
        const title = productTitlesMap.get(numericId) || productTitlesMap.get(pid) || `Product ${numericId}`;
        orderData.products.add(title);
      }
      
      orderUpliftBreakdown = Array.from(orderUpliftMap.values())
        .map(order => {
          const cappedAttributedValue = Math.min(order.attributedValue, order.totalValue);
          const baseValue = order.totalValue - cappedAttributedValue;
          const upliftPercentage = order.totalValue > 0 ? ((cappedAttributedValue / order.totalValue) * 100) : 0;
          
          return {
            orderNumber: order.orderNumber,
            totalValue: order.totalValue,
            baseValue: Math.max(0, baseValue),
            attributedValue: cappedAttributedValue,
            upliftPercentage,
            products: Array.from(order.products),
            productCount: order.productCount
          };
        })
        .filter(order => order.attributedValue > 0 && order.totalValue > 0)
        .sort((a, b) => b.upliftPercentage - a.upliftPercentage)
        .slice(0, 10);
      
      if (topRecommended.length > 0) {
        topRecommended = topRecommended.map(rec => {
          const attribution = topAttributedProducts.find(p => 
            p.productId === rec.productId || 
            p.productTitle === rec.productTitle ||
            p.productId.includes(rec.productId)
          );
          
          return {
            ...rec,
            revenueCents: attribution ? Math.round(attribution.revenue * 100) : rec.revenueCents
          };
        });
      }
      
      const attributedProductMap = new Map<string, { revenue: number; orders: number }>();
      topAttributedProducts.forEach((product) => {
        attributedProductMap.set(product.productTitle, {
          revenue: product.revenue,
          orders: product.orders
        });
      });
      
      topUpsells.push(...topRecommended.slice(0, 10).map((tracked) => {
        const attributedData = attributedProductMap.get(tracked.productTitle);
        const orders = attributedData?.orders || 0;
        const revenue = attributedData?.revenue || 0;
        const conversionRate = tracked.clicks > 0 ? ((orders / tracked.clicks) * 100).toFixed(1) : '0.0';
        
        return {
          product: tracked.productTitle,
          impressions: tracked.impressions,
          clicks: tracked.clicks,
          conversions: orders,
          conversionRate: conversionRate,
          revenue: revenue.toFixed(2),
          ctr: tracked.ctr.toFixed(1)
        };
      }));
        
    } catch (error) {
      console.error('Error fetching attribution data:', error);
    }

    // 🎁 BUNDLE ANALYTICS
    let bundleRevenue = 0;
    let bundleOrders = 0;
    let bundleImpressions = 0;
    let bundleClicks = 0;
    let bundleClickRate = 0;
    let bundleConversionRate = 0;
    let topBundles: TopBundle[] = [];

    try {
      // Get all bundles with their purchase data
      const bundles = await db.bundle.findMany({
        where: {
          storeHash,
          status: 'active'
        },
        select: {
          id: true,
          name: true,
          totalPurchases: true,
          totalRevenue: true,
          type: true,
          productIds: true,
          assignedProducts: true
        }
      });

      // Get bundle purchases in current period
      const bundlePurchases = await db.bundlePurchase.findMany({
        where: {
          storeHash,
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          totalValue: true
        }
      });

      bundleOrders = bundlePurchases.length;

      // Calculate bundle revenue from bundle purchases in the current date range
      bundleRevenue = bundlePurchases.reduce((sum: number, purchase) =>
        sum + (purchase.totalValue || 0), 0
      );

      let bundleEvents: TrackingEventModel[] = [];
      if (trackingEvents.length > 0) {
        bundleEvents = trackingEvents.filter((event) =>
          event.source === 'bundle' &&
          (event.event === 'view' || event.event === 'impression' || event.event === 'click')
        );
      } else {
        bundleEvents = await db.trackingEvent.findMany({
          where: {
            storeHash,
            event: { in: ['view', 'impression', 'click'] },
            source: 'bundle',
            createdAt: { gte: startDate, lte: endDate }
          }
        });
      }

      const bundleViewEvents = bundleEvents.filter(e => e.event === 'view' || e.event === 'impression').length;
      const bundleClickEvents = bundleEvents.filter(e => e.event === 'click').length;

      bundleImpressions = bundleViewEvents;
      bundleClicks = bundleClickEvents;
      bundleClickRate = bundleImpressions > 0 ? (bundleClicks / bundleImpressions) * 100 : 0;
      const rawBundleConversion = bundleClicks > 0 ? (bundleOrders / bundleClicks) * 100 : 0;
      bundleConversionRate = Math.min(rawBundleConversion, 100);

      // Count bundle purchases by bundleId using CustomerBundle table
      const bundlePurchasesByBundleId = new Map<string, { count: number, revenue: number, productIds: Set<string> }>();

      const allBundlePurchases = await db.customerBundle.findMany({
        where: {
          storeHash,
          action: 'purchase',
          createdAt: { gte: startDate, lte: endDate }
        },
        select: {
          bundleId: true,
          cartValue: true
        }
      });

      allBundlePurchases.forEach(bp => {
        const current = bundlePurchasesByBundleId.get(bp.bundleId) || { count: 0, revenue: 0, productIds: new Set<string>() };
        bundlePurchasesByBundleId.set(bp.bundleId, {
          count: current.count + 1,
          revenue: current.revenue + (bp.cartValue || 0),
          productIds: current.productIds
        });
      });

      const extractBundleProductIds = (bundle: typeof bundles[number]) => {
        const fromProductIds = parseJsonStringOfIds(bundle.productIds);
        const fromAssignedProducts = parseJsonStringOfIds(bundle.assignedProducts);
        const fromTracking = getBundleProductIdsFromTracking(bundle.id);
        
        const sources = [fromProductIds, fromAssignedProducts, fromTracking];
        const unique = new Set<string>();
        sources.flat().forEach((id) => {
          const normalized = normalizeProductId(id);
          if (normalized) {
            unique.add(normalized);
          }
        });
        return Array.from(unique);
      };

      // Get ML insights to show all actual product combinations purchased
      const mlInsights = await import('../models/bundleInsights.server');
      const insights = await mlInsights.getBundleInsights({
        storeHash,
        orderLimit: 100,
        minPairOrders: 1
      });

      const truncateTitle = (title: string, maxLength: number = 30) => {
        if (title.length <= maxLength) return title;
        return title.substring(0, maxLength) + '...';
      };

      // Convert ML insights to top bundles format
      const mlBundlesFormatted = insights.bundles.map((mlBundle) => ({
        bundleId: `ml-${mlBundle.id}`,
        bundleName: mlBundle.productTitles.join(' + '),
        bundleType: 'AI' as const,
        products: mlBundle.productTitles.slice(0, 2).map(title => ({
          title: truncateTitle(title),
          fullTitle: title
        })),
        purchases: mlBundle.orderCount,
        revenue: mlBundle.revenue
      }));

      // Get manual bundles with product details
      const manualBundlesWithProducts = await Promise.all(
        bundles
          .filter((b) => b.type === 'manual' && bundlePurchasesByBundleId.has(b.id))
          .map(async (b) => {
            const stats = bundlePurchasesByBundleId.get(b.id)!;
            const products = await db.bundleProduct.findMany({
              where: { bundleId: b.id },
              orderBy: { position: 'asc' },
              take: 2,
              select: { productTitle: true, productId: true }
            });

            let productDisplay = products.map(p => {
              const normalizedId = normalizeProductId(p.productId);
              const fallbackTitle = normalizedId
                ? (p.productTitle || productTitlesMap.get(normalizedId) || `Product ${normalizedId}`)
                : (p.productTitle || 'Product');
              const fullTitle = fallbackTitle;
              return {
                title: truncateTitle(fullTitle),
                fullTitle
              };
            });

            while (productDisplay.length < 2) {
              productDisplay.push({ title: '-', fullTitle: '-' });
            }

            return {
              bundleId: b.id,
              bundleName: b.name,
              bundleType: 'Manual' as const,
              products: productDisplay.slice(0, 2),
              purchases: stats.count,
              revenue: stats.revenue
            };
          })
      );

      // Combine ML and manual bundles, sort by revenue
      topBundles = [...mlBundlesFormatted, ...manualBundlesWithProducts]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

    } catch (error) {
      console.error('Error fetching bundle data:', error);
    }

    // Store recommendation-only revenue
    const recommendationRevenue = attributedRevenue;

    // Don't add bundleRevenue here - it will be calculated in revenue breakdown
    // to avoid double-counting when orders have both recommendations and bundles

    // 📊 REVENUE BREAKDOWN BY FEATURE
    let revenueBreakdown: RevenueBreakdown = {
      recommendationsOnly: { revenue: 0, orders: 0 },
      bundlesOnly: { revenue: 0, orders: 0 },
      mixed: { revenue: 0, orders: 0 }
    };

    try {
      // Get all attributed orders with their revenue
      const attributedOrderIds = await db.recommendationAttribution.findMany({
        where: {
          storeHash,
          createdAt: { gte: startDate, lte: endDate }
        },
        select: { orderId: true, attributedRevenue: true }
      });

      const bundleOrderIds = await db.bundlePurchase.findMany({
        where: {
          storeHash,
          createdAt: { gte: startDate, lte: endDate }
        },
        select: { orderId: true, totalValue: true }
      });

      // Aggregate revenue per order for recommendations
      const recOrderMap = new Map<string, number>();
      attributedOrderIds.forEach((a) => {
        const current = recOrderMap.get(a.orderId) || 0;
        recOrderMap.set(a.orderId, current + (a.attributedRevenue || 0));
      });

      const bundleOrderMap = new Map<string, number>(bundleOrderIds.map((b) => [String(b.orderId), Number(b.totalValue) || 0]));

      // Categorize orders
      const allOrderIds = new Set<string>([...recOrderMap.keys(), ...bundleOrderMap.keys()]);
      
      allOrderIds.forEach((orderId) => {
        const hasRec = recOrderMap.has(orderId);
        const hasBundle = bundleOrderMap.has(orderId);
        const recRevenue = recOrderMap.get(orderId) || 0;
        const bundleRevenue = bundleOrderMap.get(orderId) || 0;

        if (hasRec && hasBundle) {
          revenueBreakdown.mixed.orders++;
          revenueBreakdown.mixed.revenue += recRevenue + bundleRevenue; // Sum both revenue streams
        } else if (hasRec) {
          revenueBreakdown.recommendationsOnly.orders++;
          revenueBreakdown.recommendationsOnly.revenue += recRevenue;
        } else if (hasBundle) {
          revenueBreakdown.bundlesOnly.orders++;
          revenueBreakdown.bundlesOnly.revenue += bundleRevenue;
        }
      });
    } catch (error) {
      console.error('Error calculating revenue breakdown:', error);
    }

    // Calculate total attributedRevenue from breakdown to avoid double-counting
    attributedRevenue = revenueBreakdown.recommendationsOnly.revenue + revenueBreakdown.bundlesOnly.revenue + revenueBreakdown.mixed.revenue;

    let previousAttributedRevenue = 0;
    let previousAttributedOrders = 0;

    try {
      const previousAttributions = await db.recommendationAttribution.findMany({
        where: {
          storeHash,
          createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
        }
      });

      previousAttributedRevenue = previousAttributions.reduce((sum: number, a: RecommendationAttributionModel) =>
        sum + (a.attributedRevenue || 0), 0
      );

      // Add previous period bundle revenue
      const previousBundlePurchases = await db.bundlePurchase.findMany({
        where: {
          storeHash,
          createdAt: { gte: previousPeriodStart, lte: previousPeriodEnd }
        },
        select: { totalValue: true }
      });

      const previousBundleRevenue = previousBundlePurchases.reduce((sum: number, purchase) =>
        sum + (purchase.totalValue || 0), 0
      );

      previousAttributedRevenue += previousBundleRevenue;

      const previousUniqueOrders = new Set(previousAttributions.map((a: RecommendationAttributionModel) => a.orderId));
      previousAttributedOrders = previousUniqueOrders.size;
    } catch (e) {
      console.warn("Failed to fetch previous period attributions:", e);
    }
    
    let mlStatus: MLStatus = {
      productsAnalyzed: 0,
      highPerformers: 0,
      blacklistedProducts: 0,
      performanceChange: 0,
      lastUpdated: null
    };

    try {
      const mlPerformance = await db.mLProductPerformance.findMany({
        where: { storeHash }
      });

      if (mlPerformance.length > 0) {
        mlStatus.productsAnalyzed = mlPerformance.length;
        mlStatus.highPerformers = mlPerformance.filter((p: MLProductPerformanceModel) => (p.confidence || 0) > 0.7).length;
        mlStatus.blacklistedProducts = mlPerformance.filter((p: MLProductPerformanceModel) => p.isBlacklisted).length;
      } else {
        mlStatus.productsAnalyzed = topRecommended.length;
        mlStatus.highPerformers = topRecommended.filter(p => p.ctr > 5).length;
      }

      const latestJob = await db.mLSystemHealth.findFirst({
        where: { storeHash },
        orderBy: { completedAt: 'desc' }
      });

      if (latestJob?.completedAt) {
        mlStatus.lastUpdated = latestJob.completedAt;
      } else if (topRecommended.length > 0 || recSummary.totalImpressions > 0) {
        const latestTracking = await db.trackingEvent.findFirst({
          where: { storeHash },
          orderBy: { createdAt: 'desc' }
        });
        if (latestTracking?.createdAt) {
          mlStatus.lastUpdated = latestTracking.createdAt;
        }
      }
      
      if (recCTRSeries.length >= 14) {
        const recentWeek = recCTRSeries.slice(-7);
        const previousWeek = recCTRSeries.slice(-14, -7);
        const recentAvg = recentWeek.reduce((sum, d) => sum + d.ctr, 0) / recentWeek.length;
        const previousAvg = previousWeek.reduce((sum, d) => sum + d.ctr, 0) / previousWeek.length;
        if (previousAvg > 0) {
          mlStatus.performanceChange = ((recentAvg - previousAvg) / previousAvg) * 100;
        }
      }
      
    } catch (error) {
      console.error('Error fetching ML status:', error);
    }

    // Calculate app cost based on actual subscription tier
    const planTier = (subscription?.planTier as PlanTier) || 'starter';
    const appCost = PRICING_PLANS[planTier]?.price || 0;
    const roi = appCost > 0 && attributedRevenue > 0 ? (attributedRevenue / appCost) : 0;

    const hasRecommendations = recSummary.totalImpressions > 0;
    const hasClicks = recSummary.totalClicks > 0;
    const hasAttributions = attributedOrders > 0;
    
    const setupProgress = !hasRecommendations ? 0 :
                          !hasClicks ? 33 :
                          !hasAttributions ? 66 : 100;

    // Calculate how many days since app installation
    let appInstalledDays = 0;
    try {
      if (subscription?.createdAt) {
        appInstalledDays = Math.floor((Date.now() - new Date(subscription.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      } else if (settings?.appEmbedActivatedAt) {
        appInstalledDays = Math.floor((Date.now() - new Date(settings.appEmbedActivatedAt).getTime()) / (1000 * 60 * 60 * 24));
      }
    } catch (e) {
      console.warn('Failed to calculate app installed days:', e);
    }

    // Count active bundles
    let activeBundleCount = 0;
    try {
      activeBundleCount = await db.bundle.count({
        where: {
          storeHash,
          status: 'active'
        }
      });
    } catch (e) {
      console.warn('Failed to count active bundles:', e);
    }

    // Generate actionable insights
    // Get lifetime metrics (never resets)
    const lifetimeMetrics = await getLifetimeMetricsFormatted(storeHash);

    const insights = generateInsights({
      cartEnabled: settings?.enableApp ?? false,
      recommendationsVisible: recSummary.totalImpressions > 0,
      totalOrders,
      attributedOrders,
      totalRevenue,
      attributedRevenue,
      recImpressions: recSummary.totalImpressions,
      recClicks: recSummary.totalClicks,
      recCTR: recSummary.ctr,
      conversionRate: recSummary.totalClicks > 0 ? (attributedOrders / recSummary.totalClicks) * 100 : 0,
      roi,
      appInstalledDays,
      activeBundleCount,
      freeShippingEnabled: settings?.enableFreeShipping ?? false,
      freeShippingThreshold: settings?.freeShippingThreshold ?? 0,
      ordersReachingFreeShipping: ordersWithFreeShipping,
      aiRecommendationsEnabled: settings?.enableMLRecommendations ?? false,
      lastMLUpdate: mlStatus.lastUpdated,
      mlPerformanceChange: mlStatus.performanceChange,
    });

    return json({
      lifetimeMetrics,
      debug: {
        hasOrderAccess,
        ordersDataExists: allDashboardOrders.length > 0,
        ordersLength: orders.length,
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        shop: storeHash
      },
      analytics: {
        totalOrders,
        totalRevenue,
        averageOrderValue,
        checkoutsCompleted: checkoutsCompleted,
        
        previousMetrics: {
          totalOrders: previousMetrics.totalOrders,
          totalRevenue: previousMetrics.totalRevenue,
          averageOrderValue: previousMetrics.averageOrderValue,
          attributedRevenue: previousAttributedRevenue,
          attributedOrders: previousAttributedOrders,
        },
        
        attributedRevenue,
        attributedOrders,
        recommendationRevenue,
        
        // Bundle analytics
        bundleRevenue,
        bundleOrders,
        bundleImpressions,
        bundleClicks,
        bundleClickRate,
        bundleConversionRate,
        topBundles,
        
        // Revenue breakdown by feature
        revenueBreakdown,
        
        appCost,
        roi,
        topAttributedProducts,
        orderUpliftBreakdown,
        mlStatus,
        setupProgress,
        setupComplete: setupProgress === 100,
        cartImpressions: cartImpressions,
        cartOpensToday: cartOpensToday,
        cartToCheckoutRate,
        topProducts,
        topUpsells,
        recImpressions: recSummary.totalImpressions,
        recClicks: recSummary.totalClicks,
        recCTR: recSummary.ctr,
        recCTRSeries,
        topRecommended,
        bundleOpportunities,
        cartAbandonmentRate: cartToCheckoutRate > 0 ? 100 - cartToCheckoutRate : 0,
        freeShippingThreshold,
        ordersWithFreeShipping,
        ordersWithoutFreeShipping,
        avgAOVWithFreeShipping,
        avgAOVWithoutFreeShipping,
        freeShippingConversionRate,
        freeShippingAOVLift,
        freeShippingRevenue,
        avgAmountAddedForFreeShipping,
        giftThresholds,
        ordersReachingGifts,
        ordersNotReachingGifts,
        avgAOVWithGift,
        avgAOVWithoutGift,
        giftConversionRate,
        giftAOVLift,
        giftRevenue,
        avgAmountAddedForGift,
        giftThresholdBreakdown,
        timeframe,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isCustomDateRange: !!(customStartDate && customEndDate),
        shopName: storeInfo?.name || storeHash,
        currency: storeCurrency
      },
      insights,
      shop: storeHash,
      search
    });
  } catch (error: unknown) {
    console.error('Dashboard loader error:', error);
    return json({
      debug: { hasOrderAccess: false, ordersDataExists: false, ordersLength: 0, timeframe: "30d", startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), endDate: new Date().toISOString(), shop: storeHash || 'unknown' },
      analytics: { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0, checkoutsCompleted: 0, previousMetrics: { totalOrders: 0, totalRevenue: 0, averageOrderValue: 0, attributedRevenue: 0, attributedOrders: 0 }, attributedRevenue: 0, attributedOrders: 0, appCost: 49, roi: 0, topAttributedProducts: [], mlStatus: { productsAnalyzed: 0, highPerformers: 0, blacklistedProducts: 0, performanceChange: 0, lastUpdated: null }, cartImpressions: 0, cartOpensToday: 0, cartToCheckoutRate: 0, topProducts: [], topUpsells: [], recImpressions: 0, recClicks: 0, recCTR: 0, recCTRSeries: [], topRecommended: [], bundleOpportunities: [], cartAbandonmentRate: 0, freeShippingEnabled: false, freeShippingThreshold: 100, ordersWithFreeShipping: 0, ordersWithoutFreeShipping: 0, avgAOVWithFreeShipping: 0, avgAOVWithoutFreeShipping: 0, freeShippingConversionRate: 0, freeShippingAOVLift: 0, freeShippingRevenue: 0, avgAmountAddedForFreeShipping: 0, giftGatingEnabled: false, giftThresholds: [], ordersReachingGifts: 0, ordersNotReachingGifts: 0, avgAOVWithGift: 0, avgAOVWithoutGift: 0, giftConversionRate: 0, giftAOVLift: 0, giftRevenue: 0, avgAmountAddedForGift: 0, giftThresholdBreakdown: [], setupProgress: 0, setupComplete: false, timeframe: "30d", shopName: "demo-shop", currency: 'USD' },
      shop: 'demo-shop',
      search
    });
  }
};

interface DashboardInsight {
  type: string;
  title: string;
  message: string;
  action?: {
    label: string;
    url: string;
  };
  priority?: string;
}

export default function Dashboard() {
  const { analytics, insights, search, lifetimeMetrics } = useLoaderData<typeof loader>();
  const [selectedOrderProducts, setSelectedOrderProducts] = useState<{orderNumber: string; products: string[]; totalValue: number; attributedValue: number; upliftPercentage: number} | null>(null);
  const [insightsExpanded, setInsightsExpanded] = useState(false);

  const settingsHref = `/app/settings${search ?? ""}`;

  // Load insights expansion preference from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('cart-uplift-insights-expanded');
      if (saved !== null) {
        setInsightsExpanded(saved === 'true');
      }
    }
  }, []);

  // Toggle insights expansion and save preference
  const toggleInsights = () => {
    const newState = !insightsExpanded;
    setInsightsExpanded(newState);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cart-uplift-insights-expanded', String(newState));
    }
  };

  const getTimeframeLabel = (timeframe: string) => {
    switch (timeframe) {
      case "today": return "Today";
      case "7d": return "Last 7 days";
      case "30d": return "Last 30 days";
      case "90d": return "Last 90 days";
      case "ytd": return "Year to date";
      case "all": return "All time";
      default: return "Last 30 days";
    }
  };

  const formatCurrency = (amount: number) => {
    const currencySymbols: { [key: string]: string } = {
      'USD': '$', 'EUR': '€', 'GBP': '£', 'CAD': 'C$', 'AUD': 'A$', 'JPY': '¥', 'INR': '₹', 'BRL': 'R$', 'MXN': '$', 'SGD': 'S$', 'HKD': 'HK$',
    }; 
    
    const symbol = currencySymbols[analytics.currency] || analytics.currency + ' ';
    const formattedAmount = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${symbol}${formattedAmount}`;
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  };

  const downloadCSV = (filename: string, csvContent: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportFullDashboard = () => {
    const sections = [];
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');

    // Header Section
    sections.push(`Cart Uplift AI Analytics Export`);
    sections.push(`Store,${analytics.shopName}`);
    sections.push(`Period,${getTimeframeLabel(analytics.timeframe)}`);
    sections.push(`Date Range,"${analytics.startDate.split('T')[0]} to ${analytics.endDate.split('T')[0]}"`);
    sections.push(`Export Date,${now.toISOString()}`);
    sections.push(`Currency,${analytics.currency}`);
    sections.push('');

    // === EXECUTIVE SUMMARY ===
    sections.push('EXECUTIVE SUMMARY');
    sections.push('Metric,Value,Previous Period,Change %');
    sections.push(`Total Revenue,${formatCurrency(analytics.totalRevenue)},${formatCurrency(analytics.previousMetrics.totalRevenue)},${calculateChange(analytics.totalRevenue, analytics.previousMetrics.totalRevenue).toFixed(1)}%`);
    sections.push(`Total Orders,${analytics.totalOrders},${analytics.previousMetrics.totalOrders},${calculateChange(analytics.totalOrders, analytics.previousMetrics.totalOrders).toFixed(1)}%`);
    sections.push(`Average Order Value,${formatCurrency(analytics.averageOrderValue)},${formatCurrency(analytics.previousMetrics.averageOrderValue)},${calculateChange(analytics.averageOrderValue, analytics.previousMetrics.averageOrderValue).toFixed(1)}%`);
    sections.push(`Cart Uplift AI Revenue,${formatCurrency(analytics.attributedRevenue)},${formatCurrency(analytics.previousMetrics.attributedRevenue)},${calculateChange(analytics.attributedRevenue, analytics.previousMetrics.attributedRevenue).toFixed(1)}%`);
    sections.push(`Cart Uplift AI Orders,${analytics.attributedOrders},${analytics.previousMetrics.attributedOrders},${calculateChange(analytics.attributedOrders, analytics.previousMetrics.attributedOrders).toFixed(1)}%`);
    sections.push(`ROI,${analytics.roi.toFixed(2)}x,,,"`);
    sections.push('');

    // === REVENUE ATTRIBUTION ===
    sections.push('REVENUE ATTRIBUTION BY FEATURE');
    sections.push('Feature,Revenue,Orders,Percentage of Total');
    sections.push(`Recommendations Only,${formatCurrency(analytics.revenueBreakdown.recommendationsOnly.revenue)},${analytics.revenueBreakdown.recommendationsOnly.orders},${((analytics.revenueBreakdown.recommendationsOnly.revenue / analytics.totalRevenue) * 100).toFixed(1)}%`);
    sections.push(`Bundles Only,${formatCurrency(analytics.revenueBreakdown.bundlesOnly.revenue)},${analytics.revenueBreakdown.bundlesOnly.orders},${((analytics.revenueBreakdown.bundlesOnly.revenue / analytics.totalRevenue) * 100).toFixed(1)}%`);
    sections.push(`Combined (Rec + Bundle),${formatCurrency(analytics.revenueBreakdown.mixed.revenue)},${analytics.revenueBreakdown.mixed.orders},${((analytics.revenueBreakdown.mixed.revenue / analytics.totalRevenue) * 100).toFixed(1)}%`);
    sections.push(`Total AI-Driven Revenue,${formatCurrency(analytics.attributedRevenue)},${analytics.attributedOrders},${((analytics.attributedRevenue / analytics.totalRevenue) * 100).toFixed(1)}%`);
    sections.push('');

    // === RECOMMENDATION PERFORMANCE ===
    sections.push('RECOMMENDATION PERFORMANCE');
    sections.push('Metric,Value');
    sections.push(`Impressions,${analytics.recImpressions.toLocaleString()}`);
    sections.push(`Clicks,${analytics.recClicks.toLocaleString()}`);
    sections.push(`Click-Through Rate,${analytics.recCTR.toFixed(2)}%`);
    sections.push(`Revenue,${formatCurrency(analytics.recommendationRevenue || 0)}`);
    sections.push(`Conversion Rate,${analytics.recClicks > 0 ? ((analytics.attributedOrders / analytics.recClicks) * 100).toFixed(2) : 0}%`);
    sections.push('');

    // === TOP RECOMMENDED PRODUCTS ===
    if (analytics.topRecommended && analytics.topRecommended.length > 0) {
      sections.push('TOP RECOMMENDED PRODUCTS');
      sections.push('Product,Impressions,Clicks,CTR %,Revenue');
      analytics.topRecommended.forEach((rec: any) => {
        sections.push(`"${rec.productTitle}",${rec.impressions},${rec.clicks},${rec.ctr.toFixed(2)},${formatCurrency(rec.revenueCents)}`);
      });
      sections.push('');
    }

    // === BUNDLE PERFORMANCE ===
    sections.push('BUNDLE PERFORMANCE');
    sections.push('Metric,Value');
    sections.push(`Bundle Revenue,${formatCurrency(analytics.bundleRevenue || 0)}`);
    sections.push(`Bundle Orders,${analytics.bundleOrders || 0}`);
    sections.push(`Bundle Impressions,${analytics.bundleImpressions || 0}`);
    sections.push(`Bundle Clicks,${analytics.bundleClicks || 0}`);
    sections.push(`Bundle Click Rate,${(analytics.bundleClickRate || 0).toFixed(2)}%`);
    sections.push(`Bundle Conversion Rate,${(analytics.bundleConversionRate || 0).toFixed(2)}%`);
    sections.push('');

    // === TOP PERFORMING BUNDLES ===
    if (analytics.topBundles && analytics.topBundles.length > 0) {
      sections.push('TOP PERFORMING BUNDLES');
      sections.push('Type,Bundle Name,Item 1,Item 2,Purchases,Revenue');
      analytics.topBundles.forEach((bundle: any) => {
        sections.push(`${bundle.bundleType},"${bundle.bundleName}","${bundle.products[0]?.title || '-'}","${bundle.products[1]?.title || '-'}",${bundle.purchases},${formatCurrency(bundle.revenue)}`);
      });
      sections.push('');
    }

    // === TOP PRODUCTS ===
    if (analytics.topProducts && analytics.topProducts.length > 0) {
      sections.push('TOP SELLING PRODUCTS');
      sections.push('Product,Orders,Quantity Sold,Revenue,Avg Order Value');
      analytics.topProducts.forEach((product: TopProduct) => {
        sections.push(`"${product.product}",${product.orders},${product.quantity},${formatCurrency(product.revenue)},${product.avgOrderValue}`);
      });
      sections.push('');
    }

    // === CART ENGAGEMENT ===
    sections.push('CART ENGAGEMENT');
    sections.push('Metric,Value');
    sections.push(`Cart Impressions,${analytics.cartImpressions.toLocaleString()}`);
    sections.push(`Cart Opens Today,${analytics.cartOpensToday.toLocaleString()}`);
    sections.push(`Cart to Checkout Rate,${analytics.cartToCheckoutRate.toFixed(2)}%`);
    sections.push(`Cart Abandonment Rate,${analytics.cartAbandonmentRate.toFixed(2)}%`);
    sections.push('');

    // === FREE SHIPPING PERFORMANCE ===
    if (analytics.freeShippingThreshold > 0) {
      sections.push('FREE SHIPPING PERFORMANCE');
      sections.push('Metric,Value');
      sections.push(`Free Shipping Threshold,${formatCurrency(analytics.freeShippingThreshold)}`);
      sections.push(`Orders With Free Shipping,${analytics.ordersWithFreeShipping}`);
      sections.push(`Orders Without Free Shipping,${analytics.ordersWithoutFreeShipping}`);
      sections.push(`Avg AOV With Free Shipping,${formatCurrency(analytics.avgAOVWithFreeShipping)}`);
      sections.push(`Avg AOV Without Free Shipping,${formatCurrency(analytics.avgAOVWithoutFreeShipping)}`);
      sections.push(`Free Shipping Conversion Rate,${analytics.freeShippingConversionRate.toFixed(2)}%`);
      sections.push(`AOV Lift from Free Shipping,${analytics.freeShippingAOVLift.toFixed(2)}%`);
      sections.push(`Total Free Shipping Revenue,${formatCurrency(analytics.freeShippingRevenue)}`);
      sections.push(`Avg Amount Added for Free Shipping,${formatCurrency(analytics.avgAmountAddedForFreeShipping)}`);
      sections.push('');
    }

    // === GIFT GATING PERFORMANCE ===
    if (analytics.giftThresholds && analytics.giftThresholds.length > 0) {
      sections.push('GIFT GATING PERFORMANCE');
      sections.push('Metric,Value');
      sections.push(`Orders Reaching Gift Threshold,${analytics.ordersReachingGifts}`);
      sections.push(`Orders Not Reaching Threshold,${analytics.ordersNotReachingGifts}`);
      sections.push(`Avg AOV With Gift,${formatCurrency(analytics.avgAOVWithGift)}`);
      sections.push(`Avg AOV Without Gift,${formatCurrency(analytics.avgAOVWithoutGift)}`);
      sections.push(`Gift Conversion Rate,${analytics.giftConversionRate.toFixed(2)}%`);
      sections.push(`AOV Lift from Gifts,${analytics.giftAOVLift.toFixed(2)}%`);
      sections.push(`Total Gift-Driven Revenue,${formatCurrency(analytics.giftRevenue)}`);
      sections.push(`Avg Amount Added for Gift,${formatCurrency(analytics.avgAmountAddedForGift)}`);
      sections.push('');
    }

    // === DAILY CTR TREND ===
    if (analytics.recCTRSeries && analytics.recCTRSeries.length > 0) {
      sections.push('RECOMMENDATION CTR TREND (DAILY)');
      sections.push('Date,Impressions,Clicks,CTR %');
      analytics.recCTRSeries.forEach((day: any) => {
        sections.push(`${day.date},${day.impressions},${day.clicks},${day.ctr.toFixed(2)}`);
      });
      sections.push('');
    }

    const csv = sections.join('\n');
    downloadCSV(`CartUpliftAI_Analytics_${dateStr}_${timeStr}.csv`, csv);
  };

  // Main dashboard
  return (
    <Box padding="medium">
      <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '1.25rem' }}>
        <H1>Analytics</H1>
        <Button variant="primary" onClick={exportFullDashboard}>Export</Button>
      </Flex>

      <Flex flexDirection="column" flexGap="1.25rem">
        {/* Setup progress banner — shown until all milestones are reached */}
        {analytics.setupProgress < 100 && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="0.75rem">
                <Flex justifyContent="space-between" alignItems="center">
                  <H3>Setup Progress</H3>
                  <Badge variant="secondary">{analytics.setupProgress}%</Badge>
                </Flex>
                <ProgressBar percent={analytics.setupProgress} />
                <Flex flexGap="1.5rem" flexWrap="wrap">
                  <Flex flexGap="0.35rem" alignItems="center">
                    <Text>{analytics.recImpressions > 0 ? '\u2705' : '\u23F3'}</Text>
                    <Small>Recommendations showing</Small>
                  </Flex>
                  <Flex flexGap="0.35rem" alignItems="center">
                    <Text>{analytics.recClicks > 0 ? '\u2705' : '\u23F3'}</Text>
                    <Small>Customers clicking</Small>
                  </Flex>
                  <Flex flexGap="0.35rem" alignItems="center">
                    <Text>{analytics.attributedOrders > 0 ? '\u2705' : '\u23F3'}</Text>
                    <Small>Revenue tracked</Small>
                  </Flex>
                </Flex>
                <Small color="secondary60">
                  Only orders driven by recommendations count toward your plan. The AI learns from each sale to improve over time.
                </Small>
              </Flex>
            </Box>
          </Panel>
        )}

        {/* Date Filter */}
        <Panel>
          <Box padding="xSmall">
            <Flex justifyContent="space-between" flexWrap="nowrap">
              <Flex flexDirection="column" flexGap="0.25rem">
                <H3 color="secondary60">Time period</H3>
                <Text>{getTimeframeLabel(analytics.timeframe)}</Text>
              </Flex>

              <Select
                options={[
                  { content: 'Today', value: 'today' },
                  { content: 'Last 7 days', value: '7d' },
                  { content: 'Last 30 days', value: '30d' },
                  { content: 'Last 90 days', value: '90d' },
                  { content: 'Year to date', value: 'ytd' },
                  { content: 'All time', value: 'all' },
                ]}
                value={analytics.timeframe}
                onOptionChange={(value) => {
                  const params = new URLSearchParams(window.location.search);
                  params.set('timeframe', value);
                  window.location.href = `${window.location.pathname}?${params.toString()}`;
                }}
              />
            </Flex>
          </Box>
        </Panel>

        {/* Lifetime Metrics - Never Resets */}
        <Panel>
          <Box padding="xSmall">
            <Flex flexDirection="column" flexGap="1rem">
              <Flex flexDirection="column" flexGap="0.25rem">
                <Flex justifyContent="space-between" alignItems="center">
                  <H2>Lifetime Stats</H2>
                  <Badge variant="secondary">{lifetimeMetrics.daysSinceInstall} days with Cart Uplift</Badge>
                </Flex>
                <Small color="secondary60">
                  Your all-time performance since installing Cart Uplift
                </Small>
              </Flex>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <Flex flexDirection="column" flexGap="0.25rem">
                  <Small color="secondary60">Total Orders</Small>
                  <H2>{lifetimeMetrics.totalOrders.toLocaleString()}</H2>
                </Flex>

                <Flex flexDirection="column" flexGap="0.25rem">
                  <Small color="secondary60">Total Revenue</Small>
                  <H2>{lifetimeMetrics.totalRevenueFormatted}</H2>
                </Flex>

                <Flex flexDirection="column" flexGap="0.25rem">
                  <Small color="secondary60">AI Attributed Orders</Small>
                  <H2>{lifetimeMetrics.totalAttributedOrders.toLocaleString()}</H2>
                </Flex>

                <Flex flexDirection="column" flexGap="0.25rem">
                  <Small color="secondary60">AI Attributed Revenue</Small>
                  <H2>{lifetimeMetrics.totalAttributedRevenueFormatted}</H2>
                </Flex>
              </div>
            </Flex>
          </Box>
        </Panel>

        {/* Key Metrics Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {/* Total Revenue */}
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Small color="secondary60">Total sales</Small>
                <H1>{formatCurrency(analytics.totalRevenue)}</H1>
                {analytics.previousMetrics.totalRevenue > 0 && (
                  <Badge variant={analytics.totalRevenue >= analytics.previousMetrics.totalRevenue ? "success" : "secondary"}>
                    {`${analytics.totalRevenue >= analytics.previousMetrics.totalRevenue ? "↗" : "↘"} ${Math.abs(calculateChange(analytics.totalRevenue, analytics.previousMetrics.totalRevenue)).toFixed(1)}%`}
                  </Badge>
                )}
              </Flex>
            </Box>
          </Panel>

          {/* AI Revenue */}
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Small color="secondary60">Cart Uplift AI sales</Small>
                <H1>{formatCurrency(analytics.attributedRevenue)}</H1>
                <Badge variant="success">{analytics.roi > 0 ? `${analytics.roi.toFixed(1)}x ROI` : 'Getting started'}</Badge>
                <Small color="secondary60">From AI recommendations & bundles</Small>
              </Flex>
            </Box>
          </Panel>

          {/* Orders */}
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Small color="secondary60">Orders</Small>
                <H1>{analytics.totalOrders}</H1>
                {analytics.previousMetrics.totalOrders > 0 && (
                  <Badge variant={analytics.totalOrders >= analytics.previousMetrics.totalOrders ? "success" : "secondary"}>
                    {`${analytics.totalOrders >= analytics.previousMetrics.totalOrders ? "↗" : "↘"} ${Math.abs(calculateChange(analytics.totalOrders, analytics.previousMetrics.totalOrders)).toFixed(1)}%`}
                  </Badge>
                )}
              </Flex>
            </Box>
          </Panel>

          {/* AOV */}
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="0.5rem">
                <Small color="secondary60">Average order value</Small>
                <H1>{formatCurrency(analytics.averageOrderValue)}</H1>
                {analytics.previousMetrics.averageOrderValue > 0 && (
                  <Badge variant={analytics.averageOrderValue >= analytics.previousMetrics.averageOrderValue ? "success" : "secondary"}>
                    {`${analytics.averageOrderValue >= analytics.previousMetrics.averageOrderValue ? "↗" : "↘"} ${Math.abs(calculateChange(analytics.averageOrderValue, analytics.previousMetrics.averageOrderValue)).toFixed(1)}%`}
                  </Badge>
                )}
              </Flex>
            </Box>
          </Panel>
        </div>

        {/* Insights & Recommendations */}
        {insights && insights.length > 0 && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <button
                  onClick={toggleInsights}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    width: '100%',
                    textAlign: 'left'
                  }}
                >
                  <Flex justifyContent="space-between" alignItems="center">
                    <H2>Insights & recommendations</H2>
                    <Text color="secondary60">
                      {insightsExpanded ? '▼ Collapse' : '▶ Expand'}
                    </Text>
                  </Flex>
                </button>
                {insightsExpanded && (
                  <div className={dashboardStyles.insightGrid}>
                    {insights.map((insight: DashboardInsight, index: number) => (
                      <InsightCard key={index} {...insight} />
                    ))}
                  </div>
                )}
              </Flex>
            </Box>
          </Panel>
        )}

        {/* Recommendation Performance */}
        <Panel>
          <Box padding="xSmall">
            <Flex flexDirection="column" flexGap="1rem">
              <H2>Recommendation performance</H2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Recommendation revenue</Small>
                  <H2>{formatCurrency(analytics.recommendationRevenue || 0)}</H2>
                  <Small color="secondary60">From AI recommendations</Small>
                </Flex>

                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Click rate</Small>
                  <H2>{analytics.recCTR.toFixed(1)}%</H2>
                  <Small color="secondary60">{analytics.recClicks} clicks from {analytics.recImpressions} views</Small>
                </Flex>

                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Orders with CartUpliftAI</Small>
                  <H2>{analytics.attributedOrders}</H2>
                  <Small color="secondary60">{analytics.totalOrders > 0 ? ((analytics.attributedOrders / analytics.totalOrders) * 100).toFixed(1) : 0}% of all orders</Small>
                </Flex>

                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Conversion rate</Small>
                  <H2>
                    {analytics.recClicks > 0 && analytics.attributedOrders > 0 ? `${((analytics.attributedOrders / analytics.recClicks) * 100).toFixed(1)}%` : '0%'}
                  </H2>
                  <Small color="secondary60">Clicks to purchase</Small>
                </Flex>
              </div>
            </Flex>
          </Box>
        </Panel>

        {/* Bundle Performance */}
        {(analytics.bundleOrders > 0 || analytics.bundleRevenue > 0) && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <H2>Bundle performance</H2>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <Flex flexDirection="column" flexGap="0.5rem">
                    <Small color="secondary60">Bundle revenue</Small>
                    <H2>{formatCurrency(analytics.bundleRevenue)}</H2>
                    <Small color="secondary60">Total from bundle purchases</Small>
                  </Flex>

                  <Flex flexDirection="column" flexGap="0.5rem">
                    <Small color="secondary60">Click rate</Small>
                    <H2>{analytics.bundleClickRate.toFixed(1)}%</H2>
                    <Small color="secondary60">{analytics.bundleClicks} clicks from {analytics.bundleImpressions} views</Small>
                  </Flex>

                  <Flex flexDirection="column" flexGap="0.5rem">
                    <Small color="secondary60">Orders with bundles</Small>
                    <H2>{analytics.bundleOrders}</H2>
                    <Small color="secondary60">{analytics.totalOrders > 0 ? ((analytics.bundleOrders / analytics.totalOrders) * 100).toFixed(1) : 0}% of all orders</Small>
                  </Flex>

                  <Flex flexDirection="column" flexGap="0.5rem">
                    <Small color="secondary60">Conversion rate</Small>
                    <H2>
                      {analytics.bundleClicks > 0 && analytics.bundleOrders > 0 ? `${analytics.bundleConversionRate.toFixed(1)}%` : '0%'}
                    </H2>
                    <Small color="secondary60">Clicks to purchase</Small>
                  </Flex>
                </div>
              </Flex>
            </Box>
          </Panel>
        )}

        {/* Top Performing Bundles */}
        {analytics.topBundles && analytics.topBundles.length > 0 && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <H2>Top performing bundles</H2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Type', 'Item 1', 'Item 2', 'Purchases', 'Revenue'].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #D9DCE9', fontSize: '0.875rem', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topBundles.slice(0, 5).map((bundle: TopBundle, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{bundle.bundleType}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{bundle.products[0]?.title || '-'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{bundle.products[1]?.title || '-'}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{bundle.purchases.toString()}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{formatCurrency(bundle.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Flex>
            </Box>
          </Panel>
        )}

        {/* Revenue Breakdown by Feature */}
        {(analytics.revenueBreakdown &&
          (analytics.revenueBreakdown.recommendationsOnly.orders > 0 ||
           analytics.revenueBreakdown.bundlesOnly.orders > 0 ||
           analytics.revenueBreakdown.mixed.orders > 0)) && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <H2>Revenue by feature</H2>
                <Text color="secondary60">See which features drive the most value</Text>

                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Feature', 'Revenue', '% of AI Sales', 'Orders'].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #D9DCE9', fontSize: '0.875rem', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        'Recommendations only',
                        formatCurrency(analytics.revenueBreakdown.recommendationsOnly.revenue),
                        `${analytics.attributedRevenue > 0 ? ((analytics.revenueBreakdown.recommendationsOnly.revenue / analytics.attributedRevenue) * 100).toFixed(1) : 0}%`,
                        analytics.revenueBreakdown.recommendationsOnly.orders.toString()
                      ],
                      [
                        'Bundles only',
                        formatCurrency(analytics.revenueBreakdown.bundlesOnly.revenue),
                        `${analytics.attributedRevenue > 0 ? ((analytics.revenueBreakdown.bundlesOnly.revenue / analytics.attributedRevenue) * 100).toFixed(1) : 0}%`,
                        analytics.revenueBreakdown.bundlesOnly.orders.toString()
                      ],
                      [
                        'Mixed (Both features)',
                        formatCurrency(analytics.revenueBreakdown.mixed.revenue),
                        `${analytics.attributedRevenue > 0 ? ((analytics.revenueBreakdown.mixed.revenue / analytics.attributedRevenue) * 100).toFixed(1) : 0}%`,
                        analytics.revenueBreakdown.mixed.orders.toString()
                      ]
                    ].map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j} style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      {[
                        'Total AI Revenue',
                        formatCurrency(analytics.attributedRevenue),
                        '100%',
                        analytics.attributedOrders.toString()
                      ].map((cell, j) => (
                        <td key={j} style={{ padding: '0.5rem 0.75rem', fontWeight: 600, borderTop: '2px solid #D9DCE9' }}>{cell}</td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </Flex>
            </Box>
          </Panel>
        )}

        {/* Top Sales Generators */}
        {analytics.topAttributedProducts && analytics.topAttributedProducts.length > 0 && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <H2>Top sales generators</H2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Product', 'Orders', 'Sales'].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #D9DCE9', fontSize: '0.875rem', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topAttributedProducts.slice(0, 5).map((product: TopAttributedProduct, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{product.productTitle}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{product.orders.toString()}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{formatCurrency(product.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Flex>
            </Box>
          </Panel>
        )}

        {/* Order Uplift Breakdown */}
        {analytics.orderUpliftBreakdown && analytics.orderUpliftBreakdown.length > 0 && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <H2>Recent wins</H2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Order', 'Total', 'From AI', 'Impact'].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #D9DCE9', fontSize: '0.875rem', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.orderUpliftBreakdown.slice(0, 5).map((order: OrderUpliftBreakdown, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{`#${order.orderNumber}`}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{formatCurrency(order.totalValue)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{formatCurrency(order.attributedValue)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{`${order.upliftPercentage.toFixed(0)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Flex>
            </Box>
          </Panel>
        )}

        {/* ML Learning Status */}
        <Panel>
          <Box padding="xSmall">
            <Flex flexDirection="column" flexGap="1rem">
              <H2>AI learning status</H2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Products analyzed</Small>
                  <H2>{analytics.mlStatus.productsAnalyzed}</H2>
                </Flex>

                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">High performers</Small>
                  <H2>{analytics.mlStatus.highPerformers}</H2>
                </Flex>

                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Performance trend</Small>
                  <H2>
                    {analytics.mlStatus.performanceChange > 5 ? '📈' : analytics.mlStatus.performanceChange < -5 ? '📉' : '✅'}
                  </H2>
                </Flex>

                <Flex flexDirection="column" flexGap="0.5rem">
                  <Small color="secondary60">Last updated</Small>
                  <Text>
                    {analytics.mlStatus.lastUpdated
                      ? new Date(analytics.mlStatus.lastUpdated).toLocaleString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'Never'}
                  </Text>
                </Flex>
              </div>
            </Flex>
          </Box>
        </Panel>

        {/* Top Products */}
        <Panel>
          <Box padding="xSmall">
            <Flex flexDirection="column" flexGap="1rem">
              <H2>Top products</H2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Product', 'Orders', 'Quantity', 'Revenue'].map((h, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #D9DCE9', fontSize: '0.875rem', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {analytics.topProducts.slice(0, 5).map((item: TopProduct, i: number) => (
                    <tr key={i}>
                      <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{item.product}</td>
                      <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{item.orders.toString()}</td>
                      <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{item.quantity.toString()}</td>
                      <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{formatCurrency(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Flex>
          </Box>
        </Panel>

        {/* Recommendations Table */}
        {analytics.topRecommended && analytics.topRecommended.length > 0 && (
          <Panel>
            <Box padding="xSmall">
              <Flex flexDirection="column" flexGap="1rem">
                <H2>Most recommended</H2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Product', 'Shown', 'Clicked', 'Click rate'].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', borderBottom: '2px solid #D9DCE9', fontSize: '0.875rem', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topRecommended.slice(0, 5).map((r: TopRecommendedProduct, i: number) => (
                      <tr key={i}>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{r.productTitle}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{r.impressions.toString()}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{r.clicks.toString()}</td>
                        <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid #D9DCE9' }}>{`${r.ctr.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Flex>
            </Box>
          </Panel>
        )}
      </Flex>

      {/* Product Details Modal */}
      {selectedOrderProducts && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedOrderProducts(null)}
          header={`Order #${selectedOrderProducts.orderNumber}`}
          actions={[{ text: 'Close', onClick: () => setSelectedOrderProducts(null), variant: 'primary' as const }]}
        >
          <Flex flexDirection="column" flexGap="0.75rem">
            {selectedOrderProducts.products.map((product: string, idx: number) => (
              <Flex key={idx} flexGap="0.5rem" alignItems="center">
                <Text>{idx + 1}.</Text>
                <Text>{product}</Text>
              </Flex>
            ))}
          </Flex>
        </Modal>
      )}
    </Box>
  );
}
