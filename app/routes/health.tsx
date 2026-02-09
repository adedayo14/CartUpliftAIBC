import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import db from "../db.server";

export const loader = async ({ request: _request }: LoaderFunctionArgs) => {
  try {
    // Test database connection
    await db.$connect();
    
    // Test a simple query
    let hasSettings = false;
    try {
      const result = await db.settings.findFirst({
        select: { id: true }
      });
      hasSettings = !!result;
    } catch (dbError) {
      console.log('Database query test failed:', (dbError as Error).message);
    }
    
    // Basic health check
    return json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        hasSettings
      },
      env: {
        hasApiKey: !!process.env.SHOPIFY_API_KEY,
        hasApiSecret: !!process.env.SHOPIFY_API_SECRET,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        hasSessionSecret: !!process.env.SESSION_SECRET,
        hasAppUrl: !!process.env.SHOPIFY_APP_URL,
        nodeEnv: process.env.NODE_ENV
      }
    });
  } catch (error) {
    return json({ 
      status: "error", 
      database: {
        connected: false,
        error: (error as Error).message
      },
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
};
 
