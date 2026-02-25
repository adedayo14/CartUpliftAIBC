import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { storeHash } = await authenticateAdmin(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return json({ error: "Shop parameter is required" }, { status: 400 });
  }

  try {
    // Fetch products sorted by total_sold (best sellers)
    const productsResponse = await bigcommerceApi(storeHash, "/catalog/products?include=images,variants&sort=total_sold&direction=desc&limit=6&is_visible=true");

    if (!productsResponse.ok) {
      console.error('BigCommerce products API error:', productsResponse.status);
      return json([], { status: 200 });
    }

    const productsData = await productsResponse.json();
    const products = productsData.data || [];

    const upsells = products.map((product: any) => {
      const defaultVariant = product.variants?.[0];
      const defaultImage = product.images?.[0];

      return {
        id: String(product.id),
        title: product.name,
        price: Math.round((defaultVariant?.price || product.price || 0) * 100), // cents
        image: defaultImage?.url_standard || '',
        variant_id: String(defaultVariant?.id || product.id),
        handle: product.custom_url?.url?.replace(/^\/|\/$/g, '') || String(product.id),
        performance: {
          revenue: product.total_sold * (product.price || 0),
          quantity: product.total_sold || 0,
          orders: 0,
          avgOrderValue: 0
        }
      };
    });

    return json(upsells);
  } catch (error: unknown) {
    console.error('Error fetching products for upsells:', error);
    return json({ error: "Failed to fetch upsells" }, { status: 500 });
  }
};
