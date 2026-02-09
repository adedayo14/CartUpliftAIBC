import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * This route handles Shopify OAuth authentication.
 * When embedded apps need to authenticate, they redirect here.
 * The Shopify library handles the OAuth flow automatically.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};
