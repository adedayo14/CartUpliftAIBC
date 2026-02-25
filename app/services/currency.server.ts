import prismaClient from "~/db.server";
import { getStoreInfo } from "~/services/bigcommerce-api.server";
import { logger } from "~/utils/logger.server";

const prisma = prismaClient;

// In-memory cache for store currency (TTL: 1 hour)
const CURRENCY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const currencyCache = new Map<string, { code: string; format: string; timestamp: number }>();

/**
 * Get store's currency code and money format
 * Uses cache and database to avoid repeated API calls
 */
export async function getShopCurrency(storeHash: string): Promise<{ code: string; format: string }> {
  // Check in-memory cache first
  const cached = currencyCache.get(storeHash);
  if (cached && Date.now() - cached.timestamp < CURRENCY_CACHE_TTL) {
    return { code: cached.code, format: cached.format };
  }

  // Check database settings
  try {
    const settings = await prisma.settings.findUnique({
      where: { storeHash },
      select: { currencyCode: true, moneyFormat: true }
    });

    if (settings?.currencyCode && settings?.moneyFormat) {
      // Update cache
      currencyCache.set(storeHash, {
        code: settings.currencyCode,
        format: settings.moneyFormat,
        timestamp: Date.now()
      });
      return { code: settings.currencyCode, format: settings.moneyFormat };
    }
  } catch (error: unknown) {
    logger.warn('[getShopCurrency] Database lookup failed:', error);
  }

  // Fetch from BigCommerce Store Info API
  try {
    const storeInfo = await getStoreInfo(storeHash);
    const currencyCode = storeInfo.currency || 'USD';
    const currencySymbol = storeInfo.currency_symbol || '$';
    const symbolLocation = storeInfo.currency_symbol_location || 'left';
    const decimalPlaces = storeInfo.decimal_places ?? 2;
    const decimalSeparator = storeInfo.decimal_separator || '.';
    const thousandsSeparator = storeInfo.thousands_separator || ',';

    // Build a money format string similar to common ecommerce templates
    const moneyFormat = symbolLocation === 'right'
      ? `{{amount}}${currencySymbol}`
      : `${currencySymbol}{{amount}}`;

    // Save to database for future use
    try {
      await prisma.settings.upsert({
        where: { storeHash },
        update: {
          currencyCode,
          moneyFormat
        },
        create: {
          storeHash,
          currencyCode,
          moneyFormat
        }
      });
    } catch (dbError: unknown) {
      logger.warn('[getShopCurrency] Failed to save to database:', dbError);
    }

    // Update cache
    currencyCache.set(storeHash, {
      code: currencyCode,
      format: moneyFormat,
      timestamp: Date.now()
    });

    return { code: currencyCode, format: moneyFormat };
  } catch (error: unknown) {
    logger.error('[getShopCurrency] Failed to fetch from BigCommerce:', error);
  }

  // Final fallback - return USD but log warning
  logger.warn(`[getShopCurrency] Using USD fallback for store: ${storeHash}`);
  return { code: 'USD', format: '${{amount}}' };
}

/**
 * Format price using store's currency
 */
export function formatPrice(amount: number, currency: { code: string; format: string }): string {
  try {
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
 * Clear currency cache for a store (useful after settings update)
 */
export function clearCurrencyCache(storeHash: string): void {
  currencyCache.delete(storeHash);
}
