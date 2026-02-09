import { unauthenticated } from "~/shopify.server";
import prismaClient from "~/db.server";
import { logger } from "~/utils/logger.server";

const prisma = prismaClient;

interface ShopCurrencyResponse {
  data?: {
    shop?: {
      currencyCode: string;
      currencyFormats?: {
        moneyFormat: string;
      };
    };
  };
  errors?: unknown[];
}

// In-memory cache for shop currency (TTL: 1 hour)
const CURRENCY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const currencyCache = new Map<string, { code: string; format: string; timestamp: number }>();

/**
 * Get shop's currency code and money format
 * Uses cache and database to avoid repeated GraphQL calls
 */
export async function getShopCurrency(shop: string): Promise<{ code: string; format: string }> {
  // Check in-memory cache first
  const cached = currencyCache.get(shop);
  if (cached && Date.now() - cached.timestamp < CURRENCY_CACHE_TTL) {
    return { code: cached.code, format: cached.format };
  }

  // Check database settings
  try {
    const settings = await prisma.settings.findUnique({
      where: { shop },
      select: { currencyCode: true, moneyFormat: true }
    });

    if (settings?.currencyCode && settings?.moneyFormat) {
      // Update cache
      currencyCache.set(shop, {
        code: settings.currencyCode,
        format: settings.moneyFormat,
        timestamp: Date.now()
      });
      return { code: settings.currencyCode, format: settings.moneyFormat };
    }
  } catch (error: unknown) {
    logger.warn('[getShopCurrency] Database lookup failed:', error);
  }

  // Fetch from Shopify if not in DB
  try {
    const { admin } = await unauthenticated.admin(shop);
    
    const response = await admin.graphql(`#graphql
      query getShopCurrency {
        shop {
          currencyCode
          currencyFormats {
            moneyFormat
          }
        }
      }
    `);

    if (response.ok) {
      const data: ShopCurrencyResponse = await response.json();
      const currencyCode = data?.data?.shop?.currencyCode || 'USD';
      const moneyFormat = data?.data?.shop?.currencyFormats?.moneyFormat || '${{amount}}';

      // Save to database for future use
      try {
        await prisma.settings.upsert({
          where: { shop },
          update: {
            currencyCode,
            moneyFormat
          },
          create: {
            shop,
            currencyCode,
            moneyFormat
          }
        });
      } catch (dbError: unknown) {
        logger.warn('[getShopCurrency] Failed to save to database:', dbError);
      }

      // Update cache
      currencyCache.set(shop, {
        code: currencyCode,
        format: moneyFormat,
        timestamp: Date.now()
      });

      return { code: currencyCode, format: moneyFormat };
    }
  } catch (error: unknown) {
    logger.error('[getShopCurrency] Failed to fetch from Shopify:', error);
  }

  // Final fallback - return USD but log warning
  logger.warn(`[getShopCurrency] Using USD fallback for shop: ${shop}`);
  return { code: 'USD', format: '${{amount}}' };
}

/**
 * Format price using shop's currency
 */
export function formatPrice(amount: number, currency: { code: string; format: string }): string {
  try {
    // Handle Shopify's money format template
    const formatted = currency.format.replace('{{amount}}', amount.toFixed(2));
    return formatted;
  } catch (error: unknown) {
    logger.error('[formatPrice] Error formatting price:', error);
    return `${currency.code} ${amount.toFixed(2)}`;
  }
}

/**
 * Get currency symbol from currency code
 */
export function getCurrencySymbol(currencyCode: string): string {
  const symbols: { [key: string]: string } = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'CAD': 'CA$',
    'AUD': 'A$',
    'NZD': 'NZ$',
    'INR': '₹',
    'CHF': 'CHF',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'PLN': 'zł',
    'CZK': 'Kč',
    'HUF': 'Ft',
    'ILS': '₪',
    'MXN': 'MX$',
    'BRL': 'R$',
    'MYR': 'RM',
    'SGD': 'S$',
    'THB': '฿',
    'PHP': '₱',
    'IDR': 'Rp',
    'AED': 'AED',
    'SAR': 'SAR',
    'ZAR': 'R'
  };

  return symbols[currencyCode] || currencyCode;
}

/**
 * Clear currency cache for a shop (useful after settings update)
 */
export function clearCurrencyCache(shop: string): void {
  currencyCache.delete(shop);
}
