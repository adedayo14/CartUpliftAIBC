import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // This will refresh/validate the session
    const { session, storeHash } = await authenticateAdmin(request);

    return json({
      success: true,
      message: "Session refreshed successfully",
      shop: storeHash
    });
  } catch (_error) {
    return json({ 
      success: false, 
      message: "Failed to refresh session" 
    }, { status: 401 });
  }
};
