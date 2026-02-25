import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import { getCategories, type BCCategory } from "../services/bigcommerce-api.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { storeHash } = await authenticateAdmin(request);

    console.log('[Collections API] Fetching categories from BigCommerce...');

    const categories = await getCategories(storeHash, { limit: 250 });

    console.log('[Collections API] Found', categories.length, 'categories');

    return json({
      success: true,
      collections: categories.map((cat: BCCategory) => ({
        id: String(cat.id),
        title: cat.name,
        handle: cat.url?.url?.replace(/^\/|\/$/g, '') || String(cat.id),
        productsCount: 0, // BC categories API doesn't return product count directly
      }))
    });
  } catch (error: unknown) {
    console.error("[Collections API] error:", error);
    return json({ success: false, error: "Failed to load collections" }, { status: 500 });
  }
};
