import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Try to authenticate - if this fails, session is expired
    const { session } = await authenticate.admin(request);
    
    // Return session status
    return json({ 
      valid: true, 
      shop: session.shop,
      expiresIn: null // Shopify doesn't provide expiry info easily
    });
  } catch (_error) {
    // Session is invalid/expired
    return json({ valid: false }, { status: 401 });
  }
};
