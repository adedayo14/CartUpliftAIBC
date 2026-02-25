/**
 * BigCommerce API Client
 *
 * Wrapper around the BigCommerce REST V2/V3 APIs.
 * All methods require a storeHash and use the stored access token.
 */

import { getStoreSession } from "../bigcommerce.server";
import { logger } from "~/utils/logger.server";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BCProduct {
  id: number;
  name: string;
  type: string;
  sku: string;
  description: string;
  weight: number;
  price: number;
  sale_price: number;
  retail_price: number;
  cost_price: number;
  calculated_price: number;
  is_visible: boolean;
  availability: string;
  custom_url: { url: string; is_customized: boolean };
  categories: number[];
  brand_id: number;
  images?: BCProductImage[];
  variants?: BCVariant[];
}

export interface BCProductImage {
  id: number;
  product_id: number;
  url_standard: string;
  url_thumbnail: string;
  url_tiny: string;
  url_zoom: string;
  is_thumbnail: boolean;
  sort_order: number;
  description: string;
}

export interface BCVariant {
  id: number;
  product_id: number;
  sku: string;
  price: number | null;
  calculated_price: number;
  sale_price: number | null;
  retail_price: number | null;
  option_values: Array<{
    id: number;
    label: string;
    option_id: number;
    option_display_name: string;
  }>;
  inventory_level: number;
  purchasing_disabled: boolean;
}

export interface BCCategory {
  id: number;
  parent_id: number;
  name: string;
  description: string;
  sort_order: number;
  is_visible: boolean;
  url: { url: string; is_customized: boolean };
}

export interface BCOrder {
  id: number;
  customer_id: number;
  date_created: string;
  date_modified: string;
  status_id: number;
  status: string;
  subtotal_ex_tax: string;
  subtotal_inc_tax: string;
  total_ex_tax: string;
  total_inc_tax: string;
  items_total: number;
  currency_code: string;
  products?: { url: string; resource: string };
}

export interface BCOrderProduct {
  id: number;
  order_id: number;
  product_id: number;
  name: string;
  sku: string;
  quantity: number;
  price_inc_tax: string;
  price_ex_tax: string;
  total_inc_tax: string;
  total_ex_tax: string;
  variant_id: number;
}

export interface BCStoreInfo {
  id: string;
  domain: string;
  secure_url: string;
  name: string;
  admin_email: string;
  currency: string;
  currency_symbol: string;
  decimal_separator: string;
  thousands_separator: string;
  decimal_places: number;
  currency_symbol_location: string;
  weight_units: string;
  language: string;
  plan_name: string;
}

interface BCApiResponse<T> {
  data: T;
  meta?: {
    pagination?: {
      total: number;
      count: number;
      per_page: number;
      current_page: number;
      total_pages: number;
    };
  };
}

// ─── API Client ──────────────────────────────────────────────────────────────

async function apiRequest<T>(
  storeHash: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    version?: "v2" | "v3";
  } = {}
): Promise<T> {
  const session = await getStoreSession(storeHash);
  if (!session) throw new Error(`No session found for store: ${storeHash}`);

  const { method = "GET", body, version = "v3" } = options;
  const baseUrl = `https://api.bigcommerce.com/stores/${storeHash}/${version}`;

  const headers: Record<string, string> = {
    "X-Auth-Token": session.accessToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    logger.error("BigCommerce API error", {
      storeHash,
      path,
      status: response.status,
      error: errorText,
    });
    throw new Error(`BigCommerce API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// ─── Products ────────────────────────────────────────────────────────────────

export async function getProducts(
  storeHash: string,
  params: {
    limit?: number;
    page?: number;
    keyword?: string;
    include?: string;
    is_visible?: boolean;
  } = {}
): Promise<{ products: BCProduct[]; hasNextPage: boolean; total: number }> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.page) searchParams.set("page", String(params.page));
  if (params.keyword) searchParams.set("keyword", params.keyword);
  if (params.include) searchParams.set("include", params.include);
  if (params.is_visible !== undefined) searchParams.set("is_visible", String(params.is_visible));

  const query = searchParams.toString();
  const path = `/catalog/products${query ? `?${query}` : ""}`;

  const result = await apiRequest<BCApiResponse<BCProduct[]>>(storeHash, path);

  return {
    products: result.data || [],
    hasNextPage: (result.meta?.pagination?.current_page ?? 0) < (result.meta?.pagination?.total_pages ?? 0),
    total: result.meta?.pagination?.total ?? 0,
  };
}

export async function getProduct(
  storeHash: string,
  productId: number,
  include?: string
): Promise<BCProduct> {
  const params = include ? `?include=${include}` : "";
  const result = await apiRequest<BCApiResponse<BCProduct>>(
    storeHash,
    `/catalog/products/${productId}${params}`
  );
  return result.data;
}

export async function getProductImages(
  storeHash: string,
  productId: number
): Promise<BCProductImage[]> {
  const result = await apiRequest<BCApiResponse<BCProductImage[]>>(
    storeHash,
    `/catalog/products/${productId}/images`
  );
  return result.data || [];
}

export async function getProductVariants(
  storeHash: string,
  productId: number
): Promise<BCVariant[]> {
  const result = await apiRequest<BCApiResponse<BCVariant[]>>(
    storeHash,
    `/catalog/products/${productId}/variants`
  );
  return result.data || [];
}

// ─── Categories ──────────────────────────────────────────────────────────────

export async function getCategories(
  storeHash: string,
  params: { limit?: number; page?: number } = {}
): Promise<BCCategory[]> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.page) searchParams.set("page", String(params.page));

  const query = searchParams.toString();
  const path = `/catalog/categories${query ? `?${query}` : ""}`;

  const result = await apiRequest<BCApiResponse<BCCategory[]>>(storeHash, path);
  return result.data || [];
}

// ─── Orders (V2 API) ─────────────────────────────────────────────────────────

export async function getOrders(
  storeHash: string,
  params: {
    limit?: number;
    page?: number;
    sort?: string;
    min_date_created?: string;
    status_id?: number;
  } = {}
): Promise<BCOrder[]> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.page) searchParams.set("page", String(params.page));
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.min_date_created) searchParams.set("min_date_created", params.min_date_created);
  if (params.status_id) searchParams.set("status_id", String(params.status_id));

  const query = searchParams.toString();
  const path = `/orders${query ? `?${query}` : ""}`;

  // Orders API is V2
  const result = await apiRequest<BCOrder[]>(storeHash, path, { version: "v2" });
  return result || [];
}

export async function getOrder(
  storeHash: string,
  orderId: number
): Promise<BCOrder> {
  return apiRequest<BCOrder>(storeHash, `/orders/${orderId}`, { version: "v2" });
}

export async function getOrderProducts(
  storeHash: string,
  orderId: number
): Promise<BCOrderProduct[]> {
  return apiRequest<BCOrderProduct[]>(storeHash, `/orders/${orderId}/products`, {
    version: "v2",
  });
}

// ─── Store Info (V2 API) ─────────────────────────────────────────────────────

export async function getStoreInfo(
  storeHash: string
): Promise<BCStoreInfo> {
  return apiRequest<BCStoreInfo>(storeHash, "/store", { version: "v2" });
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

export async function createWebhook(
  storeHash: string,
  scope: string,
  destination: string,
  headers?: Record<string, string>
): Promise<unknown> {
  return apiRequest(storeHash, "/hooks", {
    method: "POST",
    body: {
      scope,
      destination,
      is_active: true,
      headers: headers || {},
    },
  });
}

export async function getWebhooks(storeHash: string): Promise<unknown[]> {
  const result = await apiRequest<BCApiResponse<unknown[]>>(storeHash, "/hooks");
  return result.data || [];
}

// ─── Scripts API ─────────────────────────────────────────────────────────────

export async function createScript(
  storeHash: string,
  script: {
    name: string;
    src: string;
    auto_uninstall: boolean;
    load_method: string;
    location: string;
    visibility: string;
    kind: string;
    consent_category?: string;
  }
): Promise<unknown> {
  return apiRequest(storeHash, "/content/scripts", {
    method: "POST",
    body: script,
  });
}

export async function getScripts(storeHash: string): Promise<unknown[]> {
  const result = await apiRequest<BCApiResponse<unknown[]>>(storeHash, "/content/scripts");
  return result.data || [];
}
