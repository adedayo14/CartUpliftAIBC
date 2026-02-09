import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // This will refresh/validate the session
    const { session } = await authenticate.admin(request);
    
    return json({ 
      success: true, 
      message: "Session refreshed successfully",
      shop: session.shop
    });
  } catch (_error) {
    return json({ 
      success: false, 
      message: "Failed to refresh session" 
    }, { status: 401 });
  }
};
