import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

/**
 * Base auth route - redirects to the appropriate BigCommerce callback.
 * This handles cases where the app is accessed without a valid session.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const context = url.searchParams.get("context");
  const hasValidContext = !!(context && /^[a-z0-9]+$/i.test(context));

  if (error === "no_session") {
    // If we have context, try cookie-less auth fallback route first.
    if (hasValidContext) {
      return redirect(`/admin?context=${context}`);
    }

    // No valid session - show a message or redirect to BC
    return new Response(
      `<html>
        <head><title>CartUplift - Session Required</title></head>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center;">
            <h1>Session Expired</h1>
            <p>Please open CartUplift from your BigCommerce admin panel.</p>
          </div>
        </body>
      </html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }
    );
  }

  // Default: redirect to admin dashboard if we somehow land here
  if (hasValidContext) {
    return redirect(`/admin?context=${context}`);
  }
  return redirect("/admin");
};
