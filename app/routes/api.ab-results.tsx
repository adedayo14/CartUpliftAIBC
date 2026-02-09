import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { rateLimitRequest } from "../utils/rateLimiter.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const experimentIdParam = url.searchParams.get("experimentId");
    const period = url.searchParams.get("period") || "30d"; // today|7d|30d|90d or ISO start/end
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");

    if (!experimentIdParam) {
      return json({ error: "Missing experimentId" }, { status: 400 });
    }
    const experimentId = parseInt(experimentIdParam, 10);
    if (Number.isNaN(experimentId)) {
      return json({ error: "Invalid experimentId" }, { status: 400 });
    }

  const { session } = await authenticate.admin(request);
  const shop = session.shop as string;

    // Load experiment and variants
    const experiment = await prisma.experiment.findFirst({
      where: { id: experimentId, shopId: shop },
      include: { variants: { orderBy: { id: "asc" } } },
    });
    if (!experiment) {
      return json({ error: "Experiment not found" }, { status: 404 });
    }

    // Compute date range
    const { start, end } = resolveRange(period, startParam, endParam);

    // Aggregate assignment events (visitors) within time window
    const assignments = await prisma.event.groupBy({
      by: ["variantId"],
      where: {
        experimentId,
        type: "assignment",
        occurredAt: { gte: start, lte: end },
      },
      _count: { _all: true },
    });
    const visitorsByVariant: Record<number, number> = {};
    assignments.forEach((a: { variantId: number | null; _count: { _all: number } }) => {
      if (!a.variantId) return;
      visitorsByVariant[a.variantId] = a._count?._all ?? 0;
    });

    // Aggregate conversion events for revenue + conversion counts
    const conversions = await prisma.event.groupBy({
      by: ["variantId"],
      where: {
        experimentId,
        type: "conversion",
        occurredAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const conversionsByVariant: Record<number, number> = {};
    const revenueByVariant: Record<number, number> = {};
    conversions.forEach((c: { variantId: number | null; _count: { _all: number }; _sum: { amount: Prisma.Decimal | null } }) => {
      if (!c.variantId) return;
      conversionsByVariant[c.variantId] = c._count?._all ?? 0;
      const amt = c._sum?.amount;
      revenueByVariant[c.variantId] = amt ? Number(amt) : 0;
    });

    // Build results per variant
    type VariantResult = {
      variantId: number;
      variantName: string;
      isControl: boolean;
      value: number;
      valueFormat: string;
      trafficPct: number;
      visitors: number;
      conversions: number;
      revenue: number;
      conversionRate: number;
      revenuePerVisitor: number;
    };

    const results: VariantResult[] = experiment.variants.map<VariantResult>((v) => {
      const visitors = visitorsByVariant[v.id] || 0;
      const conversions = conversionsByVariant[v.id] || 0;
      const revenue = revenueByVariant[v.id] || 0;
      const cr = visitors > 0 ? (conversions / visitors) : 0;
      const rpv = visitors > 0 ? (revenue / visitors) : 0;
      return {
        variantId: v.id,
        variantName: v.name,
        isControl: v.isControl,
        value: Number((v as Record<string, unknown>).value || (v as Record<string, unknown>).discountPct || 0), // Support both schemas
        valueFormat: (v as Record<string, unknown>).valueFormat || 'percent',
        trafficPct: Number(v.trafficPct),
        visitors,
        conversions,
        revenue,
        conversionRate: cr,
        revenuePerVisitor: rpv,
      };
    });

    // Decide leader defaulting to revenue per visitor
    const metric = 'revenue_per_visitor';
    let leader: number | null = null;
    if (results.length) {
      const pick = results.reduce<VariantResult>((best, current) => (
        current.revenuePerVisitor >= best.revenuePerVisitor ? current : best
      ), results[0]);
      leader = pick.variantId;
    }

    return json({
      experiment: { id: experiment.id, name: experiment.name, metric },
      start: start.toISOString(),
      end: end.toISOString(),
      results,
      leader,
    });
  } catch (error) {
    console.error('[api.ab-results] error:', error);
    return json({ error: 'Failed to compute results' }, { status: 500 });
  }
}

function resolveRange(period: string, start?: string | null, end?: string | null) {
  const now = new Date();
  const to = end ? new Date(end) : now;
  const p = (period || '').toLowerCase();
  if (start && end) return { start: new Date(start), end: to };
  if (p === 'today') {
    const from = new Date();
    from.setHours(0,0,0,0);
    return { start: from, end: to };
  }
  const days = p === '7d' ? 7 : p === '90d' ? 90 : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: from, end: to };
}
