import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { validateCorsOrigin, getCorsHeaders } from "../services/security.server";
import prisma from "../db.server";

/**
 * Database health check endpoint
 * GET /api/db-health
 * Returns status of critical tables and DB connectivity
 * SECURITY: Requires admin authentication
 */

// Type definitions
interface TableStatus {
  exists: boolean;
  count?: number;
  error?: string;
}

interface HealthCheckResult {
  connected: boolean;
  timestamp: string;
  tables: Record<string, TableStatus>;
  errors: string[];
  healthy?: boolean;
  remedy?: string;
  error?: string;
}
export async function loader({ request }: LoaderFunctionArgs) {
  // SECURITY: Require admin authentication for health check endpoint
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = await validateCorsOrigin(origin, shop);
  const baseHeaders = {
    'Cache-Control': 'no-store',
    ...getCorsHeaders(allowedOrigin),
  };

  const results: HealthCheckResult = {
    connected: false,
    timestamp: new Date().toISOString(),
    tables: {},
    errors: []
  };

  try {
    // Test basic connectivity
    await prisma.$connect();
    results.connected = true;

    // Check for Session table
    try {
      const sessionCount = await prisma.session.count();
      results.tables.Session = { exists: true, count: sessionCount };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      results.tables.Session = { exists: false, error: errorMessage };
      results.errors.push(`Session table: ${errorMessage}`);
    }

    // Check for Settings table
    try {
      const settingsCount = await prisma.settings.count();
      results.tables.Settings = { exists: true, count: settingsCount };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      results.tables.Settings = { exists: false, error: errorMessage };
      results.errors.push(`Settings table: ${errorMessage}`);
    }

    // Check for TrackingEvent table
    try {
      const trackingCount = await prisma.trackingEvent.count();
      results.tables.TrackingEvent = { exists: true, count: trackingCount };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      results.tables.TrackingEvent = { exists: false, error: errorMessage };
      results.errors.push(`TrackingEvent table: ${errorMessage}`);
    }

    // Check for RecommendationAttribution table
    try {
      const attrCount = await prisma.recommendationAttribution.count();
      results.tables.RecommendationAttribution = { exists: true, count: attrCount };
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      results.tables.RecommendationAttribution = { exists: false, error: errorMessage };
      results.errors.push(`RecommendationAttribution table: ${errorMessage}`);
    }

    await prisma.$disconnect();

    const allTablesExist = Object.values(results.tables).every((t: TableStatus) => t.exists);
    results.healthy = allTablesExist && results.errors.length === 0;

    if (!allTablesExist) {
      results.remedy = 'Run: npx prisma db push --accept-data-loss';
    }

    return json(results, {
      headers: baseHeaders,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    results.errors.push(errorMessage);
    return json({
      ...results,
      healthy: false,
      error: errorMessage
    }, {
      status: 500,
      headers: baseHeaders,
    });
  }
}
