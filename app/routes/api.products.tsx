import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import { getShopCurrency } from "../services/currency.server";
import { getProducts, type BCProduct } from "../services/bigcommerce-api.server";

interface Variant {
  id: string;
  title: string;
  price: number;
  availableForSale: boolean;
}

interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  image: string | null;
  imageAlt: string;
  minPrice: number;
  currency: string;
  price: number;
  variants: Variant[];
  metafields: Record<string, Record<string, unknown>>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { storeHash } = await authenticateAdmin(request);

    // SECURITY: Rate limiting - 100 requests per minute
    const rateLimitResult = await rateLimitRequest(request, storeHash, {
      maxRequests: 100,
      windowMs: 60 * 1000,
      burstMax: 40,
      burstWindowMs: 10 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }

    // Fetch store currency
    const shopCurrency = await getShopCurrency(storeHash);

    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const limit = parseInt(url.searchParams.get('limit') || '50');

    // Fetch products from BigCommerce REST API
    const result = await getProducts(storeHash, {
      limit,
      keyword: query || undefined,
      include: "images,variants",
      is_visible: true,
    });

    // Transform BC products to match the frontend's expected format
    const products: Product[] = result.products.map((product: BCProduct) => {
      const variants: Variant[] = (product.variants || []).map((v) => ({
        id: String(v.id),
        title: v.option_values.map(ov => ov.label).join(' / ') || 'Default',
        price: v.calculated_price || v.price || product.price,
        availableForSale: !v.purchasing_disabled && v.inventory_level !== 0,
      }));

      const thumbnail = product.images?.find(img => img.is_thumbnail);
      const firstImage = product.images?.[0];
      const imageUrl = thumbnail?.url_standard || firstImage?.url_standard || null;

      const minPrice = product.calculated_price || product.price;

      return {
        id: String(product.id),
        title: product.name,
        handle: product.custom_url?.url?.replace(/^\/|\/$/g, '') || String(product.id),
        status: product.is_visible ? 'ACTIVE' : 'DRAFT',
        image: imageUrl,
        imageAlt: product.name,
        minPrice,
        currency: shopCurrency.code,
        price: minPrice,
        variants,
        metafields: {},
      };
    });

    return json({
      products,
      hasNextPage: result.hasNextPage,
      currency: shopCurrency.code,
      currencyFormat: shopCurrency.format
    });

  } catch (error: unknown) {
    console.error('Error fetching products:', error);
    return json({ products: [], error: 'Failed to fetch products' });
  }
}
