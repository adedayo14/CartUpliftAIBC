import type { LoaderFunction, ActionFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import type { BigCommerceSession } from "../bigcommerce.server";

/**
 * Enhanced authentication wrapper for BigCommerce admin requests.
 */
export async function enhancedAuthenticate(request: Request) {
  try {
    return await authenticateAdmin(request);
  } catch (error) {
    // If authenticateAdmin threw a Response (401, redirect), re-throw it
    if (error instanceof Response) {
      throw error;
    }

    // For fetcher/action calls or API-like requests, return JSON error
    const isJsonAccept = request.headers.get('accept')?.includes('application/json');
    const isRemixFetch =
      request.headers.get('x-remix-request') === 'true' ||
      request.headers.get('x-remix-fetch') === 'true' ||
      request.headers.get('x-requested-with')?.toLowerCase() === 'xmlhttprequest';
    if (isJsonAccept || isRemixFetch || request.method.toUpperCase() === 'POST') {
      throw json(
        {
          error: 'Session expired',
          message: 'Your session has expired. Please reload the app.',
          needsRefresh: true,
        },
        { status: 401 }
      );
    }

    throw redirect('/auth?error=no_session');
  }
}

interface AuthResult {
  session: BigCommerceSession;
  storeHash: string;
}

/**
 * Wrapper for loaders that need authentication
 */
export function withAuth<T>(loader: (args: Parameters<LoaderFunction>[0] & { auth: AuthResult }) => T) {
  return async (args: Parameters<LoaderFunction>[0]) => {
    try {
      const auth = await enhancedAuthenticate(args.request);
      return loader({ ...args, auth });
    } catch (e) {
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
export function withAuthAction<T>(action: (args: Parameters<ActionFunction>[0] & { auth: AuthResult }) => T) {
  return async (args: Parameters<ActionFunction>[0]) => {
    try {
      const auth = await enhancedAuthenticate(args.request);
      return action({ ...args, auth });
    } catch (e) {
      if (e instanceof Response) {
        return e;
      }
      throw e;
    }
  };
}
