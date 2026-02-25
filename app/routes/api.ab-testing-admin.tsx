import { json, type ActionFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { authenticateAdmin } from "../bigcommerce.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";
import prisma from "../db.server";

// Request/Response types
interface ABTestingActionRequest {
  action?: string;
  experiment?: ExperimentData;
  variants?: VariantData[];
  experimentId?: number | string;
}

interface ExperimentData {
  name?: string;
  type?: string;
  status?: string;
  startDate?: string | null;
  endDate?: string | null;
  attributionWindow?: '24h' | '7d' | 'session';
  activeVariantId?: number | null;
}

interface VariantData {
  id?: number;
  name?: string;
  isControl?: boolean;
  value?: number;
  discountPct?: number;
  valueFormat?: string;
  trafficPct?: number;
  trafficPercentage?: number;
}

export async function action({ request }: ActionFunctionArgs) {
  console.log("[api.ab-testing-admin] === ACTION STARTED ===");
  console.log("[api.ab-testing-admin] Method:", request.method);
  console.log("[api.ab-testing-admin] URL:", request.url);
  console.log("[api.ab-testing-admin] Content-Type:", request.headers.get('content-type'));
  
  try {
    const { session, storeHash } = await authenticateAdmin(request);

    // SECURITY: Rate limiting - 20 requests per minute (A/B test management)
    const rateLimitResult = await rateLimitRequest(request, storeHash, {
      maxRequests: 20,
      windowMs: 60000,
      burstMax: 10,
      burstWindowMs: 10000,
    });

    if (!rateLimitResult.allowed) {
      return json(
        { error: "Rate limit exceeded", retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter || 60) } }
      );
    }
    const jsonData = await request.json().catch(() => ({})) as ABTestingActionRequest;
    console.log("[api.ab-testing-admin] Authenticated storeHash:", storeHash);
    console.log("[api.ab-testing-admin] Full JSON payload:", jsonData);

    // Handle actions
    const action = jsonData?.action;
    console.log("[api.ab-testing-admin] Action:", action);
    
    if (action === 'create') {
      console.log("[api.ab-testing-admin] Creating experiment (rich payload)");
      const exp = jsonData.experiment;
      const variants = jsonData.variants || [];

      if (!exp || !variants || variants.length < 2) {
        return json({ success: false, error: 'Invalid payload: experiment and 2 variants required' }, { status: 400 });
      }

      // Validate variant traffic sums to 100 (accept both trafficPct and legacy trafficPercentage)
      const sumPct = variants.reduce((acc, v) => acc + Number((v.trafficPct ?? v.trafficPercentage) ?? 0), 0);
      if (Math.abs(sumPct - 100) > 0.001) {
        return json({ success: false, error: 'Variant traffic must sum to 100' }, { status: 400 });
      }

      const attr = exp.attributionWindow === '24h' ? 'hours24' : exp.attributionWindow === '7d' ? 'days7' : 'session';
      const expType = exp.type || 'discount'; // default to discount if not specified
      const created = await prisma.experiment.create({
        data: {
          shopId: storeHash,
          name: String(exp.name ?? 'Untitled Experiment'),
          type: expType,
          status: exp.status ?? 'running',
          startDate: exp.startDate ? new Date(exp.startDate) : new Date(),
          endDate: exp.endDate ? new Date(exp.endDate) : null,
          attribution: attr,
        },
      });

      await prisma.variant.createMany({
        data: variants.map((v, idx: number) => ({
          experimentId: created.id,
          name: String(v.name ?? (idx === 0 ? 'Control' : `Variant ${idx}`)),
          isControl: Boolean(v.isControl ?? idx === 0),
          value: new Prisma.Decimal(v.value ?? v.discountPct ?? 0), // Support both value (new) and discountPct (legacy)
          valueFormat: String(v.valueFormat ?? 'percent'), // Default to percent for legacy
          trafficPct: new Prisma.Decimal((v.trafficPct ?? v.trafficPercentage) ?? 0),
        })) as unknown as Prisma.VariantCreateManyInput[], // Cast - valueFormat field exists, TS cache issue
      });

      console.log("[api.ab-testing-admin] Experiment created successfully:", created.id);
      return json({ success: true, experimentId: created.id });
    }
    
    if (action === 'delete') {
      const experimentId = Number(jsonData.experimentId);
      console.log("[api.ab-testing-admin] Deleting experiment:", experimentId);
      
      await prisma.experiment.delete({
        where: { id: experimentId }
      });
      
      console.log("[api.ab-testing-admin] Experiment deleted successfully");
      return json({ success: true, message: "Experiment deleted" });
    }

    if (action === 'update') {
      const experimentId = Number(jsonData.experimentId);
      const exp = jsonData.experiment || {};
      const variants = jsonData.variants || [];
      console.log("[api.ab-testing-admin] Updating experiment:", experimentId);

      if (!experimentId) {
        return json({ success: false, error: 'experimentId is required' }, { status: 400 });
      }

      if (variants && variants.length > 0) {
        const sumPct = variants.reduce((acc, v) => acc + Number((v.trafficPct ?? v.trafficPercentage) || 0), 0);
        if (sumPct !== 100) {
          return json({ success: false, error: 'Variant traffic must sum to 100' }, { status: 400 });
        }
      }

      // Update experiment metadata (only fields that exist on lean schema)
      const expData: Record<string, unknown> = {};
      if (typeof exp.name === 'string') expData.name = exp.name;
      if (typeof exp.status === 'string') expData.status = exp.status;
      if (typeof exp.startDate !== 'undefined') expData.startDate = exp.startDate ? new Date(exp.startDate) : null;
      if (typeof exp.endDate !== 'undefined') expData.endDate = exp.endDate ? new Date(exp.endDate) : null;
      if (typeof exp.attributionWindow === 'string') {
        expData.attribution = exp.attributionWindow === '24h' ? 'hours24' : exp.attributionWindow === '7d' ? 'days7' : 'session';
      }
      if (typeof exp.activeVariantId !== 'undefined') expData.activeVariantId = exp.activeVariantId ?? null;

      if (Object.keys(expData).length > 0) {
        await prisma.experiment.update({
          where: { id: experimentId },
          data: expData,
        });
      }

      // Update variants if provided
      if (Array.isArray(variants) && variants.length > 0) {
        for (const v of variants) {
          if (!v.id) continue;
          const data: Record<string, unknown> = {};
          if (typeof v.name === 'string') data.name = v.name;
          if (typeof v.isControl !== 'undefined') data.isControl = !!v.isControl;
          if (typeof v.trafficPct !== 'undefined') data.trafficPct = new Prisma.Decimal(v.trafficPct);
          else if (typeof v.trafficPercentage !== 'undefined') data.trafficPct = new Prisma.Decimal(v.trafficPercentage);
          // Support both old and new schema
          if (typeof v.value !== 'undefined') data.value = new Prisma.Decimal(v.value);
          else if (typeof v.discountPct !== 'undefined') data.value = new Prisma.Decimal(v.discountPct);
          if (typeof v.valueFormat === 'string') data.valueFormat = v.valueFormat;

          if (Object.keys(data).length > 0) {
            await prisma.variant.update({
              where: { id: Number(v.id) },
              data: data as unknown as Prisma.VariantUpdateInput, // Cast for valueFormat field
            });
          }
        }
      }

      console.log("[api.ab-testing-admin] Experiment updated successfully");
      return json({ success: true, message: 'Experiment updated' });
    }

    return json({ success: false, error: "Invalid action" }, { status: 400 });

  } catch (error: unknown) {
    // If BigCommerce auth throws a Response (redirect/401), return it as-is
    if (error instanceof Response) {
      console.warn("[api.ab-testing-admin] Returning thrown Response from authenticateAdmin:", error.status);
      return error;
    }
    console.error("[api.ab-testing-admin] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return json({ success: false, error: message }, { status: 500 });
  }
}
