import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Enhanced authentication wrapper that provides better session handling
 */
export async function enhancedAuthenticate(request: Request) {
  try {
    const result = await authenticate.admin(request);
    return result;
  } catch (_error) {
    // For fetcher/action calls or API-like requests, always return JSON error
    // (avoid redirects that can hang spinners)
    const isJsonAccept = request.headers.get('accept')?.includes('application/json');
    const isRemixFetch =
      request.headers.get('x-remix-request') === 'true' ||
      request.headers.get('x-remix-fetch') === 'true' ||
      request.headers.get('x-requested-with')?.toLowerCase() === 'xmlhttprequest';
    if (isJsonAccept || isRemixFetch || request.method.toUpperCase() === 'POST') {
      throw json(
        {
          error: 'Session expired',
          message: 'Your session has expired. Please refresh the page.',
          needsRefresh: true,
        },
        { status: 401 }
      );
    }

    // For full page loads, redirect to /auth preserving query (host/shop/embedded)
    const url = new URL(request.url);
    const search = url.search; // includes host/shop/embedded
    throw redirect(`/auth${search}`);
  }
}

/**
 * Wrapper for loaders that need authentication
 */
export function withAuth<T>(loader: (args: Parameters<LoaderFunction>[0] & { auth: Awaited<ReturnType<typeof authenticate.admin>> }) => T) {
  return async (args: Parameters<LoaderFunction>[0]) => {
    try {
      const auth = await enhancedAuthenticate(args.request);
      return loader({ ...args, auth });
    } catch (e) {
      // If enhancedAuthenticate threw a Remix Response (e.g., json 401), return it
      if (e instanceof Response) {
        return e;
      }
      throw e;
    }
  };
}

/**
 * Wrapper for actions that need authentication
 */
export function withAuthAction<T>(action: (args: Parameters<ActionFunction>[0] & { auth: Awaited<ReturnType<typeof authenticate.admin>> }) => T) {
  return async (args: Parameters<ActionFunction>[0]) => {
    try {
      const auth = await enhancedAuthenticate(args.request);
      return action({ ...args, auth });
    } catch (e) {
      // If enhancedAuthenticate threw a Remix Response (e.g., json 401), return it
      if (e instanceof Response) {
        return e;
      }
      throw e;
    }
  };
}
