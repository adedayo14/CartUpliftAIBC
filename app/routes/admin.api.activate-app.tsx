import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Admin-authenticated endpoint to mark the app embed as activated
export const action = async ({ request }: ActionFunctionArgs) => {
  // Basic visibility log to confirm POST reaches this route
  console.log("[admin.api.activate-app] incoming", request.method);

  if (request.method !== "POST") {
    return json({ success: false, message: "Method not allowed" }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const { shop } = session;

    // Accept either JSON or form submissions
    let intent = "";
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      intent = body?.action || body?.intent || "";
    } else {
      const form = await request.formData();
      intent = (form.get("action") as string) || (form.get("intent") as string) || "";
    }

    if (intent !== "mark-activated") {
      return json({ success: false, message: "Invalid intent" }, { status: 400 });
    }

    const result = await prisma.settings.upsert({
      where: { shop },
      update: { appEmbedActivated: true, appEmbedActivatedAt: new Date() },
      create: { shop, appEmbedActivated: true, appEmbedActivatedAt: new Date() },
    });

    // Verify the save with a fresh query
    const verification = await prisma.settings.findUnique({
      where: { shop },
      select: { appEmbedActivated: true, appEmbedActivatedAt: true }
    });

    console.log("[admin.api.activate-app] ===============================");
    console.log("[admin.api.activate-app] Shop:", shop);
    console.log("[admin.api.activate-app] Upsert result:", result.appEmbedActivated);
    console.log("[admin.api.activate-app] Verification query:", JSON.stringify(verification, null, 2));
    console.log("[admin.api.activate-app] ===============================");
    
    return json({ success: true, activated: result.appEmbedActivated });
  } catch (error) {
    console.error("[admin.api.activate-app] ❌ error", error);
    return json({ success: false, message: "Unauthorized or server error" }, { status: 401 });
  }
};
