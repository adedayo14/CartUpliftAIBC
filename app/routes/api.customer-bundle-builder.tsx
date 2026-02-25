import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "../bigcommerce.server";
import { getSettings } from "../models/settings.server";
import { rateLimitByIP } from "../utils/rateLimiter.server";

/**
 * Customer Bundle Builder API
 * Enables customers to create their own bundles based on category rules
 * Example: "Pick 5 supplements, get 20% off"
 */

// Type definitions
interface BundleProduct {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  price: number;
  available: boolean;
  inventory: number;
  variant_id: string;
  image: string;
}

interface BundleRule {
  id: string;
  name: string;
  description: string;
  category: string;
  min_items: number;
  max_items: number;
  discount_type: string;
  discount_value: number;
  badge_text: string;
  is_active: boolean;
}

interface CreateBundleSessionData {
  rule_id: string;
  session_id: string;
}

interface UpdateBundleSelectionData {
  bundle_session_id: string;
  selected_products: Array<{ price: string; quantity?: number }>;
}

interface CalculateBundlePriceData {
  rule_id: string;
  selected_products: Array<{ price: string; quantity?: number }>;
}

interface FinalizeBundleData {
  bundle_session_id: string;
  selected_products: unknown[];
  final_price: number;
}

interface GraphQLProductEdge {
  node: {
    id: string;
    title: string;
    handle: string;
    vendor: string;
    productType: string;
    tags: string[];
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          price: string;
          availableForSale: boolean;
          inventoryQuantity: number;
        };
      }>;
    };
    media: {
      edges: Array<{
        node: {
          image?: {
            url: string;
          };
        };
      }>;
    };
  };
}

interface GraphQLProductsResponse {
  data: {
    products: {
      edges: GraphQLProductEdge[];
    };
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session, storeHash } = await authenticateAdmin(request);

    if (!storeHash) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'get_bundle_rules') {
      return await getBundleRules(storeHash);
    }

    if (action === 'get_products_for_rule') {
      const ruleId = url.searchParams.get('rule_id');
      return await getProductsForRule(storeHash, ruleId);
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: unknown) {
    console.error('Bundle builder loader error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    // SECURITY: IP-based rate limiting for bundle creation
    const rateLimitResult = await rateLimitByIP(request, {
      maxRequests: 20,
      windowMs: 60 * 1000, // 20 per minute per IP
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }

    const { session, storeHash } = await authenticateAdmin(request);

    if (!storeHash) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const actionType = data.action;

    switch (actionType) {
      case 'create_bundle_session':
        return await createBundleSession(storeHash, data);

      case 'update_bundle_selection':
        return await updateBundleSelection(storeHash, data);

      case 'calculate_bundle_price':
        return await calculateBundlePrice(storeHash, data);

      case 'finalize_bundle':
        return await finalizeBundle(storeHash, data);
      
      default:
        return json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: unknown) {
    console.error('Bundle builder action error:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function getBundleRules(shop: string) {
  // In production, this would query the manual_bundles table
  // For now, return example rules based on settings
  
  const settings = await getSettings(shop);
  
  // Mock bundle rules - in production these come from database
  const bundleRules = [
    {
      id: 'skincare_5_for_20',
      name: 'Skincare Bundle',
      description: 'Pick any 5 skincare products and save 20%',
      category: 'Skincare',
      min_items: 5,
      max_items: 10,
      discount_type: 'percentage',
      discount_value: 20,
      badge_text: '20% OFF Bundle',
      is_active: true
    },
    {
      id: 'supplements_3_for_15',
      name: 'Supplement Saver',
      description: 'Choose 3 or more supplements for 15% off',
      category: 'Supplements',
      min_items: 3,
      max_items: 8,
      discount_type: 'percentage', 
      discount_value: 15,
      badge_text: 'Multi-Buy Discount',
      is_active: settings?.enableSmartBundles
    },
    {
      id: 'accessories_fixed_10',
      name: 'Accessory Pack',
      description: 'Any 2 accessories - $10 off total',
      category: 'Accessories',
      min_items: 2,
      max_items: 5,
      discount_type: 'fixed_amount',
      discount_value: 10,
      badge_text: '$10 OFF',
      is_active: true
    }
  ];

  const activeRules = bundleRules.filter(rule => rule.is_active);

  return json({
    success: true,
    bundle_rules: activeRules,
    ml_enabled: settings?.enableMLRecommendations || false
  });
}

async function getProductsForRule(shop: string, ruleId: string | null) {
  if (!ruleId) {
    return json({ error: 'Rule ID required' }, { status: 400 });
  }

  try {
    // Fetch visible products from BigCommerce catalog
    const productsResponse = await bigcommerceApi(shop, "/catalog/products?include=variants,images&is_visible=true&limit=50");
    const productsData = await productsResponse.json();

    const products: BundleProduct[] = (productsData.data || []).map((p: Record<string, unknown>) => {
      const variants = (p.variants as Array<Record<string, unknown>>) || [];
      const firstVariant = variants[0];
      const images = (p.images as Array<{ url_standard?: string }>) || [];

      return {
        id: String(p.id),
        title: (p.name as string) || 'Untitled Product',
        handle: ((p.custom_url as { url?: string })?.url || `/${p.id}/`).replace(/^\/|\/$/g, ''),
        vendor: (p.brand_id as string) || '',
        productType: (p.type as string) || 'physical',
        tags: [],
        price: Number(p.price) || 0,
        available: (p.is_visible as boolean) && ((p.inventory_level as number) || 0) > 0,
        inventory: (p.inventory_level as number) || 0,
        variant_id: firstVariant ? String(firstVariant.id) : String(p.id),
        image: images[0]?.url_standard || '',
      };
    });

    return json({
      success: true,
      products,
      rule_id: ruleId
    });

  } catch (error: unknown) {
    console.error('Error fetching products for rule:', error);
    return json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

async function createBundleSession(shop: string, data: CreateBundleSessionData) {
  const { rule_id, session_id } = data;
  
  if (!rule_id || !session_id) {
    return json({ error: 'Rule ID and session ID required' }, { status: 400 });
  }

  // In production, save to database
  const bundleSession = {
    id: `bundle_${session_id}_${Date.now()}`,
    shop_id: shop,
    session_id,
    rule_id,
    selected_products: [],
    total_value: 0,
    discount_applied: 0,
    final_price: 0,
    status: 'building',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
  };

  console.log('🛒 Created bundle session:', bundleSession);

  return json({
    success: true,
    bundle_session: bundleSession
  });
}

async function updateBundleSelection(shop: string, data: UpdateBundleSelectionData) {
  const { bundle_session_id, selected_products } = data;

  if (!bundle_session_id || !Array.isArray(selected_products)) {
    return json({ error: 'Session ID and products required' }, { status: 400 });
  }

  // Calculate totals
  const totalValue = selected_products.reduce((sum: number, item: { price: string; quantity?: number }) =>
    sum + (parseFloat(item.price) * (item.quantity || 1)), 0
  );

  // In production, update database record
  console.log('📝 Updated bundle selection:', {
    bundle_session_id,
    product_count: selected_products.length,
    total_value: totalValue
  });

  return json({
    success: true,
    selected_products,
    total_value: totalValue,
    product_count: selected_products.length
  });
}

async function calculateBundlePrice(shop: string, data: CalculateBundlePriceData) {
  const { rule_id, selected_products } = data;

  if (!rule_id || !Array.isArray(selected_products)) {
    return json({ error: 'Rule ID and products required' }, { status: 400 });
  }

  // Get rule configuration (in production, from database)
  const rule = await getBundleRuleById(rule_id);

  if (!rule) {
    return json({ error: 'Recommendation rule not found' }, { status: 404 });
  }

  const itemCount = selected_products.length;
  const subtotal = selected_products.reduce((sum: number, item: { price: string; quantity?: number }) =>
    sum + (parseFloat(item.price) * (item.quantity || 1)), 0
  );

  let discountAmount = 0;
  let finalPrice = subtotal;
  let isEligible = itemCount >= rule.min_items;

  if (isEligible) {
    if (rule.discount_type === 'percentage') {
      discountAmount = subtotal * (rule.discount_value / 100);
    } else if (rule.discount_type === 'fixed_amount') {
      discountAmount = Math.min(rule.discount_value, subtotal);
    }
    finalPrice = Math.max(0, subtotal - discountAmount);
  }

  return json({
    success: true,
    calculation: {
      rule_id,
      item_count: itemCount,
      min_items_required: rule.min_items,
      is_eligible: isEligible,
      subtotal,
      discount_amount: discountAmount,
      final_price: finalPrice,
      savings_percentage: subtotal > 0 ? Math.round((discountAmount / subtotal) * 100) : 0,
      rule_name: rule.name,
      badge_text: rule.badge_text
    }
  });
}

async function finalizeBundle(shop: string, data: FinalizeBundleData) {
  const { bundle_session_id, selected_products, final_price } = data;
  
  if (!bundle_session_id || !selected_products || typeof final_price !== 'number') {
    return json({ error: 'Missing required fields' }, { status: 400 });
  }

  // In production, update database and create cart line items
  const bundleData = {
    id: bundle_session_id,
    status: 'completed',
    completed_at: new Date().toISOString(),
    products: selected_products,
    final_price
  };

  // Track bundle completion analytics
  console.log('✅ Bundle finalized:', bundleData);

  return json({
    success: true,
    bundle: bundleData,
    message: 'Products added successfully! Continue to cart to complete your order.'
  });
}

// Helper function to get bundle rule configuration
async function getBundleRuleById(ruleId: string): Promise<BundleRule | null> {
  // Mock rules - in production, query database
  const rules: Record<string, BundleRule> = {
    'skincare_5_for_20': {
      id: 'skincare_5_for_20',
      name: 'Skincare Bundle',
      min_items: 5,
      discount_type: 'percentage',
      discount_value: 20,
      badge_text: '20% OFF Bundle'
    },
    'supplements_3_for_15': {
      id: 'supplements_3_for_15', 
      name: 'Supplement Saver',
      min_items: 3,
      discount_type: 'percentage',
      discount_value: 15,
      badge_text: 'Multi-Buy Discount'
    },
    'accessories_fixed_10': {
      id: 'accessories_fixed_10',
      name: 'Accessory Pack',
      min_items: 2,
      discount_type: 'fixed_amount',
      discount_value: 10,
      badge_text: '$10 OFF'
    }
  };

  return rules[ruleId] || null;
}