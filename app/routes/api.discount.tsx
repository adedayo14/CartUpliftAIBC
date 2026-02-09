import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { rateLimitByIP } from "../utils/rateLimiter.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // SECURITY: IP-based rate limiting to prevent discount code enumeration
    const rateLimitResult = await rateLimitByIP(request, {
      maxRequests: 10,
      windowMs: 60 * 1000, // 10 per minute per IP
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }

    const { session } = await authenticate.public.appProxy(request);

    if (!session) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { discountCode } = body;

    if (!discountCode) {
      return json({ error: "Discount code is required" }, { status: 400 });
    }

    // Use Shopify Admin API to validate discount
    const { admin } = await authenticate.admin(request);
    
    try {
      // Query for discount codes
      const discountQuery = `
        query getDiscountByCode($query: String!) {
          discountCodes(first: 1, query: $query) {
            edges {
              node {
                id
                code
                ... on DiscountCodeBasic {
                  status
                  summary
                  startsAt
                  endsAt
                  usageLimit
                }
                ... on DiscountCodeBxgy {
                  status
                  summary
                  startsAt
                  endsAt
                  usageLimit
                }
                ... on DiscountCodeFreeShipping {
                  status
                  summary
                  startsAt
                  endsAt
                  usageLimit
                }
              }
            }
          }
        }
      `;

      const discountResponse = await admin.graphql(discountQuery, {
        variables: {
          query: `code:${discountCode}`
        }
      });

      const discountData = await discountResponse.json();
      
      if (discountData.data?.discountCodes?.edges?.length > 0) {
        const discount = discountData.data.discountCodes.edges[0].node;
        
        // Check if discount is active
        const now = new Date();
        const startsAt = discount.startsAt ? new Date(discount.startsAt) : null;
        const endsAt = discount.endsAt ? new Date(discount.endsAt) : null;
        
        if (discount.status === 'ACTIVE' && 
            (!startsAt || startsAt <= now) && 
            (!endsAt || endsAt >= now)) {
          
          return json({ 
            success: true, 
            discount: {
              code: discount.code,
              summary: discount.summary,
              status: discount.status
            }
          });
        } else {
          return json({ 
            success: false, 
            error: "Discount code is not active or has expired" 
          });
        }
      } else {
        return json({ 
          success: false, 
          error: "Invalid discount code" 
        });
      }

    } catch (graphqlError) {
      console.error('GraphQL Error:', graphqlError);
      return json({ 
        success: false, 
        error: "Unable to validate discount code" 
      });
    }

  } catch (error) {
    console.error('Discount validation error:', error);
    return json({ 
      success: false, 
      error: "Internal server error" 
    }, { status: 500 });
  }
};
