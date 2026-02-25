import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import db from "../db.server";

interface TrackingEventWhere {
  storeHash: string;
  createdAt: {
    gte: Date;
  };
  productId?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // SECURITY: Require admin authentication for debug endpoint
  const { session, storeHash } = await authenticateAdmin(request);

  try {
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId");

    // Get recent tracking events
    const where: TrackingEventWhere = {
      storeHash,
      createdAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
      }
    };

    if (productId) {
      where.productId = productId;
    }

    const events = await db.trackingEvent?.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        event: true,
        productId: true,
        variantId: true,
        sessionId: true,
        createdAt: true,
        metadata: true
      }
    });

    return json({
      success: true,
      storeHash,
      productId: productId || "all",
      eventCount: events?.length || 0,
      events: events || []
    });
  } catch (error: unknown) {
    console.error("Debug tracking error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return json({ error: errorMessage }, { status: 500 });
  }
};
