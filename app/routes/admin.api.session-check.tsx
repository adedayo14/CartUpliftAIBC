import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Try to authenticate - if this fails, session is expired
    const { session, storeHash } = await authenticateAdmin(request);

    // Return session status
    return json({
      valid: true,
      shop: storeHash,
      expiresIn: null
    });
  } catch (_error) {
    // Session is invalid/expired
    return json({ valid: false }, { status: 401 });
  }
};
