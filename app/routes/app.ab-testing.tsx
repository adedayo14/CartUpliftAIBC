import { useEffect, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import appBridgeUtils from "@shopify/app-bridge-utils";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  Modal,
  TextField,
  InlineStack,
  BlockStack,
  Text,
  Badge,
  EmptyState,
  Banner,
  Divider,
  Select,
  ButtonGroup,
  Checkbox,
} from "@shopify/polaris";
import type { BadgeProps } from "@shopify/polaris";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type {
  AttributionWindow,
  AttributionWindowDB,
  ValueFormat,
  ExperimentType,
  ExtendedShopifySession,
  ExtendedExperiment,
  ExtendedVariant,
} from "~/types/common";

type LoaderVariant = {
  id: number;
  name: string;
  isControl: boolean;
  value: number;
  valueFormat: ValueFormat;
  trafficPct: number;
};

type LoaderExperiment = {
  id: number;
  name: string;
  type: ExperimentType;
  status: string;
  startDate: string | null;
  endDate: string | null;
  attribution: AttributionWindowDB;
  createdAt: string;
  updatedAt: string;
  activeVariantId: number | null;
  variants: LoaderVariant[];
};

type ResultsVariant = {
  variantId: number;
  variantName: string;
  isControl: boolean;
  value: number;
  valueFormat: ValueFormat;
  trafficPct: number;
  visitors: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
  revenuePerVisitor: number;
};

type ResultsPayload = {
  experiment: {
    id: number;
    name: string;
    metric: string;
  };
  start: string;
  end: string;
  results: ResultsVariant[];
  leader: number | null;
};

const toNumber = (value: Prisma.Decimal | number | string | null | undefined): number => {
  if (typeof value === "number") return value;
  if (!value) return 0;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value) || 0;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
    const [experiments] = await Promise.all([
      prisma.experiment.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        variants: {
          orderBy: [{ isControl: "desc" }, { id: "asc" }],
        },
      },
      }),
    ]);

  const serialized: LoaderExperiment[] = experiments.map((exp): LoaderExperiment => {
      const extExp = exp as unknown as ExtendedExperiment;
      return {
        id: exp.id,
        name: exp.name,
        type: (extExp.type as ExperimentType) || "discount", // Type field exists in schema, TS cache issue
        status: exp.status,
        startDate: exp.startDate ? exp.startDate.toISOString() : null,
        endDate: exp.endDate ? exp.endDate.toISOString() : null,
        attribution: exp.attribution as AttributionWindowDB,
        createdAt: exp.createdAt.toISOString(),
        updatedAt: exp.updatedAt.toISOString(),
        activeVariantId: exp.activeVariantId ?? null,
        variants: exp.variants.map((variant): LoaderVariant => {
          const extVariant = variant as unknown as ExtendedVariant;
          return {
            id: variant.id,
            name: variant.name,
            isControl: variant.isControl,
            value: toNumber(extVariant.value || extVariant.discountPct || 0), // Support both old and new schema
            valueFormat: (extVariant.valueFormat as ValueFormat) || 'percent', // Default to percent for legacy
            trafficPct: toNumber(variant.trafficPct),
          };
        }),
      };
    });

  // Try to infer currency from session or shop data
  // Shopify session may not include a currency; fall back to Settings if available later
  const extSession = session as unknown as ExtendedShopifySession;
  const currencyCode = extSession?.currency || 'USD';
  return json({ experiments: serialized, currencyCode });
  } catch (err: unknown) {
    console.error("[app.ab-testing] Failed to load experiments. If you recently changed the Prisma schema, run migrations.", err);
    // Fail-open: return an empty list so the page renders with an EmptyState instead of 500
    return json({ experiments: [] as LoaderExperiment[] });
  }
};

export default function ABTestingPage() {
  const data = useLoaderData<{ experiments: LoaderExperiment[]; currencyCode?: string | undefined }>();
  const [experiments, setExperiments] = useState<LoaderExperiment[]>(data.experiments);
  // Guard loader sync with a pause window to avoid overwriting optimistic updates
  const [syncPauseUntil, setSyncPauseUntil] = useState<number>(0);
  useEffect(() => {
    if (Date.now() >= syncPauseUntil) {
      setExperiments(data.experiments);
    }
  }, [data.experiments, syncPauseUntil]);
  const storeCurrency = data.currencyCode || 'USD';
  const revalidator = useRevalidator();
  const app = useAppBridge();
  // Remove navigate usage
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: storeCurrency || "USD" });

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  
  // Control variant settings
  const [controlType, setControlType] = useState<"discount"|"bundle"|"shipping"|"upsell">("shipping");
  const [controlFormat, setControlFormat] = useState<"percent"|"currency"|"number">("currency");
  const [controlDiscount, setControlDiscount] = useState("50");
  
  // Challenger variant settings
  const [challengerType, setChallengerType] = useState<"discount"|"bundle"|"shipping"|"upsell">("discount");
  const [challengerFormat, setChallengerFormat] = useState<"percent"|"currency"|"number">("percent");
  const [variantDiscount, setVariantDiscount] = useState("10");
  const [variantName, setVariantName] = useState("10% Off");
  
  const [attributionWindow, setAttributionWindow] = useState<"session"|"24h"|"7d">("session");
  const [activateNow, setActivateNow] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Edit state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingExperiment, setEditingExperiment] = useState<LoaderExperiment | null>(null);

  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [selectedExperiment, setSelectedExperiment] = useState<LoaderExperiment | null>(null);
  const [resultsPayload, setResultsPayload] = useState<ResultsPayload | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  
  // Auto-apply discount codes setting
  const [autoApplyABDiscounts, setAutoApplyABDiscounts] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Save auto-apply setting
  const handleSaveAutoApply = async (newValue: boolean) => {
    setSettingsSaving(true);
    try {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
      let sessionToken = '';
      try {
        if (app) {
          sessionToken = await appBridgeUtils.getSessionToken(app);
        }
      } catch (_e) {
        // ignore
      }
      if (!sessionToken) sessionToken = params.get('id_token') || '';

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          shop: params.get('shop') || '',
          sessionToken,
          settings: { autoApplyABDiscounts: newValue }
        }),
      });

      const data = await response.json();
      if (data.success) {
        setAutoApplyABDiscounts(newValue);
        setSuccessBanner('Auto-apply setting saved successfully');
      } else {
        setErrorBanner(data.error || 'Failed to save setting');
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save setting';
      setErrorBanner(errorMessage);
    } finally {
      setSettingsSaving(false);
    }
  };

  // Toggle running/paused
  const handleToggleStatus = async (experiment: LoaderExperiment) => {
    try {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
      let sessionToken = '';
      try {
        if (app) {
          sessionToken = await appBridgeUtils.getSessionToken(app);
        }
      } catch (_e) {
        // ignore token fetch error
      }
      if (!sessionToken) sessionToken = params.get('id_token') || '';

      const next = experiment.status === 'running' ? 'paused' : 'running';
      const response = await fetch(`/api/ab-testing-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          action: 'update',
          experimentId: experiment.id,
          experiment: { status: next },
        }),
      });
      if (!response.ok) {
        const msg = await extractErrorMessage(response);
        throw new Error(msg || 'Failed to toggle status');
      }
      // Optimistic update
      setExperiments((prev) => prev.map((e) => (e.id === experiment.id ? { ...e, status: next } : e)));
      setSuccessBanner(next === 'running' ? 'Experiment resumed' : 'Experiment paused');
      setTimeout(() => revalidator.revalidate(), 400);
    } catch (err: unknown) {
      console.error('[ABTesting] Toggle status error', err);
      const errorMessage = err instanceof Error ? err.message : 'Could not change status. Try again.';
      setErrorBanner(errorMessage);
    }
  };

  // Small child card that fetches and shows a compact results summary for each experiment
  function ExperimentSummary({ experiment }: { experiment: LoaderExperiment }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [summary, setSummary] = useState<ResultsPayload | null>(null);

    useEffect(() => {
      let active = true;
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
          let sessionToken = '';
          try {
            if (app) {
              sessionToken = await appBridgeUtils.getSessionToken(app);
            }
          } catch (_e) {
            // ignore token fetch error
          }
          if (!sessionToken) sessionToken = params.get('id_token') || '';
          const res = await fetch(`/api/ab-results?experimentId=${experiment.id}&period=7d`, {
            headers: { ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
          });
          if (!res.ok) {
            const msg = await res.text();
            throw new Error(msg || `Failed to load results (${res.status})`);
          }
          const data: ResultsPayload = await res.json();
          if (!active) return;
          setSummary(data);
        } catch (e: unknown) {
          if (!active) return;
          const errorMessage = e instanceof Error ? e.message : 'No recent results';
          setError(errorMessage);
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [experiment.id]);

    if (loading) return <Text as="p" tone="subdued">Loading last 7 days…</Text>;
    if (error || !summary) return <Text as="p" tone="subdued">{error || 'No recent data'}</Text>;

    const moneyLocal = new Intl.NumberFormat(undefined, { style: 'currency', currency: storeCurrency || 'USD' });
    const [a, b] = summary.results.sort((x, y) => (x.isControl === y.isControl ? 0 : x.isControl ? -1 : 1));
    const control = a;
    const _challenger = b;
    const leaderId = summary.leader;
    const leader = summary.results.find(r => r.variantId === leaderId) || null;
    const days = Math.max(1, Math.round((new Date(summary.end).getTime() - new Date(summary.start).getTime()) / (24*60*60*1000)));
    const totalVisitors = summary.results.reduce((acc, v) => acc + (v.visitors || 0), 0);
    const totalConversions = summary.results.reduce((acc, v) => acc + (v.conversions || 0), 0);
    const dailyVisitors = totalVisitors / days;
    const rpvControl = control?.revenuePerVisitor || 0;
    const rpvLeader = leader?.revenuePerVisitor || 0;
    const rpvLiftPct = rpvControl > 0 ? ((rpvLeader - rpvControl) / rpvControl) * 100 : null;
    const revenueDelta = control && leader ? (leader.revenue - control.revenue) : 0;
    const costOfDelay = Math.max(0, (rpvLeader - rpvControl) * dailyVisitors);
    const split = `${experiment.variants.find(v => v.isControl)?.trafficPct ?? 50}% / ${experiment.variants.find(v => !v.isControl)?.trafficPct ?? 50}%`;

    const rolloutLeader = async () => {
      if (!leader) return;
      try {
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
        let sessionToken = '';
        try { if (app) { sessionToken = await appBridgeUtils.getSessionToken(app); } } catch (_e) { /* ignore */ }
        if (!sessionToken) sessionToken = params.get('id_token') || '';
        const res = await fetch('/api/ab-rollout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}) },
          body: JSON.stringify({ experimentId: experiment.id, winnerVariantId: leader.variantId }),
        });
        if (!res.ok) {
          const msg = await extractErrorMessage(res);
          throw new Error(msg || 'Could not roll out');
        }
        setSuccessBanner('Rolled out the winner. New visitors will see it going forward.');
        setTimeout(() => revalidator.revalidate(), 400);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Could not roll out';
        setErrorBanner(errorMessage);
      }
    };

    if (totalVisitors === 0) {
      return (
        <BlockStack gap="200">
          <Text as="p" tone="subdued">No traffic yet. We’ll show metrics once visitors arrive.</Text>
          <InlineStack align="space-between">
            <Text as="p" tone="subdued">Window: {new Date(summary.start).toLocaleDateString()} - {new Date(summary.end).toLocaleDateString()}</Text>
            <Text as="p" tone="subdued">Split: {split}</Text>
          </InlineStack>
        </BlockStack>
      );
    }

    return (
      <BlockStack gap="400">
        <InlineStack gap="400" wrap>
          <Card background="bg-surface-secondary" padding="400">
            <BlockStack gap="150">
              <Text as="p" tone="subdued">Last 7 days</Text>
              <Text variant="headingLg" as="h3">{`${revenueDelta >= 0 ? '+' : '-'}${moneyLocal.format(Math.abs(revenueDelta))} vs control`}</Text>
              <InlineStack gap="400" wrap>
                <Text as="p" tone="subdued">Orders: <Text as="span" tone="inherit" fontWeight="bold">{leader?.conversions ?? '—'}</Text></Text>
                <Text as="p" tone="subdued">AOV: <Text as="span" tone="inherit" fontWeight="bold">{leader && leader.conversions > 0 ? moneyLocal.format(leader.revenue / leader.conversions) : '—'}</Text></Text>
                <Text as="p" tone="subdued">$/visitor: <Text as="span" tone="inherit" fontWeight="bold">{rpvLeader > 0 ? moneyLocal.format(rpvLeader) : '—'}</Text></Text>
              </InlineStack>
              {costOfDelay > 0 && (
                <Badge tone="attention">{`Cost of delay: ${moneyLocal.format(costOfDelay)}/day`}</Badge>
              )}
            </BlockStack>
          </Card>

          <Card background="bg-surface-secondary" padding="400">
            <BlockStack gap="150">
              {leader && !leader.isControl && totalVisitors >= 100 && totalConversions >= 20 && (
                <InlineStack>
                  <Button variant="primary" onClick={rolloutLeader}>{`Roll out ${leader.variantName}`}</Button>
                </InlineStack>
              )}
              <BlockStack gap="100">
                <Text as="p" tone="subdued">Threshold progress</Text>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Exposures</Text>
                  <Text as="p" tone="subdued">{totalVisitors} / 100</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="p" tone="subdued">Conversions</Text>
                  <Text as="p" tone="subdued">{(leader?.conversions ?? 0) + (control?.conversions ?? 0)} / 20</Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineStack>

        {rpvLiftPct !== null && (
          <Text as="p">{`Lift (RPV): ${rpvLiftPct >= 0 ? '+' : ''}${rpvLiftPct.toFixed(1)}%`}</Text>
        )}
        <InlineStack align="space-between">
          <InlineStack gap="200" align="center">
            <Text as="p" tone="subdued">Leader:</Text>
            <Badge tone="success">{leader?.variantName || '—'}</Badge>
            <Text as="p" tone="subdued">• Split: {split}</Text>
          </InlineStack>
          <Text as="p" tone="subdued">Window: {new Date(summary.start).toLocaleDateString()} - {new Date(summary.end).toLocaleDateString()}</Text>
        </InlineStack>
      </BlockStack>
    );
  }

  // Helper to surface backend error details in UI
  const extractErrorMessage = async (response: Response) => {
    try {
      const json = await response.clone().json();
      if (json?.error) return String(json.error);
      if (json?.message) return String(json.message);
    } catch {
      // ignore JSON parse errors
    }
    try {
      return await response.text();
    } catch {
      // ignore text read errors
    }
    return "An unknown error occurred";
  };

  const resetCreateForm = () => {
    setNewName("");
    setControlType("shipping");
    setControlFormat("currency");
    setControlDiscount("50");
    setChallengerType("discount");
    setChallengerFormat("percent");
    setVariantDiscount("10");
    setVariantName("10% Off");
    setAttributionWindow("session");
    setActivateNow(true);
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    resetCreateForm();
  };

  const openEditModal = (experiment: LoaderExperiment) => {
    setEditingExperiment(experiment);
    setNewName(experiment.name);
    // Map DB attribution format to UI format
    const mapAttrToUI = (attr: AttributionWindowDB): AttributionWindow => {
      switch (attr) {
        case 'hours24': return '24h';
        case 'days7': return '7d';
        case 'session':
        default: return 'session';
      }
    };
    setAttributionWindow(mapAttrToUI(experiment.attribution));

    const control = experiment.variants.find(v => v.isControl);
    const challenger = experiment.variants.find(v => !v.isControl);

    if (control) {
      setControlType(experiment.type);
      setControlFormat(control.valueFormat);
      setControlDiscount(String(control.value));
    }
    if (challenger) {
      setChallengerType(experiment.type);
      setChallengerFormat(challenger.valueFormat);
      setVariantDiscount(String(challenger.value));
      setVariantName(challenger.name);
    }

    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingExperiment(null);
    resetCreateForm();
  };

  const handleCreate = async () => {
    setErrorBanner(null);
    setSuccessBanner(null);

    if (!newName.trim()) {
      setErrorBanner("Give your experiment a name so the team knows what you're testing.");
      return;
    }

    const controlVal = Number(controlDiscount);
    const challengerVal = Number(variantDiscount);

    if (Number.isNaN(controlVal) || Number.isNaN(challengerVal)) {
      setErrorBanner("Values must be numbers.");
      return;
    }

    if (controlVal < 0 || challengerVal < 0) {
      setErrorBanner("Values must be positive.");
      return;
    }

    setIsSaving(true);

    try {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
      let sessionToken = '';
      try {
        if (app) {
          sessionToken = await appBridgeUtils.getSessionToken(app);
        }
      } catch (_e) {
        // ignore and fallback to id_token
      }
      if (!sessionToken) sessionToken = params.get('id_token') || '';

      const payload = {
        action: "create",
        experiment: {
          name: newName.trim(),
          type: controlType,
          status: activateNow ? "running" : "paused",
          startDate: activateNow ? new Date().toISOString() : null,
          endDate: null,
          attributionWindow,
        },
        variants: [
          {
            name: "Control",
            isControl: true,
            trafficPct: 50,
            value: controlVal,
            valueFormat: controlFormat,
          },
          {
            name: variantName.trim() || "Variant",
            isControl: false,
            trafficPct: 50,
            value: challengerVal,
            valueFormat: challengerFormat,
          },
        ],
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`/api/ab-testing-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const msg = await extractErrorMessage(response);
        console.error("[ABTesting] Create failed:", msg);
        throw new Error(msg || "Server error while creating experiment");
      }

      const result = await response.json();
      setSuccessBanner(
        activateNow
          ? "Experiment launched. Give it a few minutes to start collecting assignments."
          : "Saved as paused. Start it from the list when you're ready."
      );
      try {
        const nowIso = new Date().toISOString();
        const mapAttr = (w: AttributionWindow): AttributionWindowDB => {
          switch (w) {
            case '24h': return 'hours24';
            case '7d': return 'days7';
            case 'session':
            default: return 'session';
          }
        };
        const newExp: LoaderExperiment = {
          id: Number(result?.experimentId) || Math.floor(Math.random() * -1000000),
          name: newName.trim(),
          type: controlType,
          status: activateNow ? 'running' : 'paused',
          startDate: activateNow ? nowIso : null,
          endDate: null,
          attribution: mapAttr(attributionWindow),
          createdAt: nowIso,
          updatedAt: nowIso,
          activeVariantId: null,
          variants: [
            {
              id: Math.floor(Math.random() * -1000000),
              name: 'Control',
              isControl: true,
              value: Number(controlDiscount),
              valueFormat: controlFormat,
              trafficPct: 50,
            },
            {
              id: Math.floor(Math.random() * -1000000),
              name: variantName.trim() || 'Variant',
              isControl: false,
              value: Number(variantDiscount),
              valueFormat: challengerFormat,
              trafficPct: 50,
            },
          ],
        };
        setExperiments((prev) => [newExp, ...prev]);
      } catch (_) {
        // ignore optimistic failures
      }
      closeCreateModal();
      setSyncPauseUntil(Date.now() + 2000);
      setTimeout(() => revalidator.revalidate(), 600);
    } catch (error: unknown) {
      console.error("[ABTesting] Create error", error);
      const errorMessage = error instanceof Error ? error.message : "We couldn't create that experiment. Try again in a moment.";
      setErrorBanner(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (experimentId: number) => {
    const confirmation = typeof window !== "undefined" ? window.confirm("Delete this experiment? This will permanently delete all experiment data including results. This action cannot be undone.") : false;
    if (!confirmation) return;

    setErrorBanner(null);
    setSuccessBanner(null);

    try {
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
      // Prefer App Bridge session token; fallback to id_token in URL if present
      let sessionToken = '';
      try {
        if (app) {
          sessionToken = await appBridgeUtils.getSessionToken(app);
        }
      } catch (_e) {
        // ignore and fallback
      }
      if (!sessionToken) {
        sessionToken = params.get('id_token') || '';
      }

      const response = await fetch(`/api/ab-testing-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ action: "delete", experimentId }),
      });

      if (!response.ok) {
        const msg = await extractErrorMessage(response);
        console.error("[ABTesting] Delete failed:", msg);
        throw new Error(msg || "Delete request failed");
      }

  setSuccessBanner("Experiment deleted");
  // Optimistically remove from list
  setExperiments((prev) => prev.filter((e) => e.id !== experimentId));
  // Pause loader sync briefly, then revalidate
  setSyncPauseUntil(Date.now() + 2000);
  setTimeout(() => revalidator.revalidate(), 600);
    } catch (error: unknown) {
      console.error("[ABTesting] Delete error", error);
      const errorMessage = error instanceof Error ? error.message : "We couldn't delete that experiment. Refresh and try again.";
      setErrorBanner(errorMessage);
    }
  };

  const openResultsModal = async (experiment: LoaderExperiment) => {
    setSelectedExperiment(experiment);
    setResultsPayload(null);
    setResultsError(null);
    setResultsLoading(true);
    setResultsModalOpen(true);

    try {
      // Include App Bridge session token for authenticated request
      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
      let sessionToken = '';
      try {
        if (app) {
          sessionToken = await appBridgeUtils.getSessionToken(app);
        }
      } catch (_e) {
        // ignore
      }
      if (!sessionToken) sessionToken = params.get('id_token') || '';

      const response = await fetch(`/api/ab-results?experimentId=${experiment.id}&period=7d`, {
        headers: {
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
      });
      if (!response.ok) {
        const msg = await extractErrorMessage(response);
        throw new Error(msg || `Failed to load results (${response.status})`);
      }
      const data: ResultsPayload = await response.json();
      setResultsPayload(data);
    } catch (error: unknown) {
      console.error("[ABTesting] Results error", error);
      const msg = error instanceof Error ? error.message : '';
      // Provide clear, actionable error messages
      if (msg.includes('404') || msg.includes('not found')) {
        setResultsError("This experiment wasn't found. It may have been deleted.");
      } else if (msg.includes('Failed to compute') || msg.includes('500')) {
        setResultsError("We couldn't calculate results right now. This usually means there's no data yet or there was a temporary issue. Please try again in a few minutes.");
      } else if (msg) {
        setResultsError(msg);
      } else {
        setResultsError("Unable to load results. Make sure your experiment is running and has received some traffic.");
      }
    } finally {
      setResultsLoading(false);
    }
  };

  const closeResultsModal = () => {
    setResultsModalOpen(false);
    setResultsPayload(null);
    setResultsError(null);
    setSelectedExperiment(null);
  };

  const renderExperimentCard = (experiment: LoaderExperiment) => {
    const statusTone: BadgeProps["tone"] = experiment.status === "running"
      ? "success"
      : experiment.status === "completed"
        ? "attention"
        : "critical";
    const typeLabel = `${experiment.type?.slice(0,1).toUpperCase()}${experiment.type?.slice(1)}`;
    const prettyAttribution = (key: string | null | undefined) => {
      switch (key) {
        case 'hours24':
        case '24h':
          return '24 hours';
        case 'days7':
        case '7d':
          return '7 days';
        case 'session':
        default:
          return 'Same session';
      }
    };
    
    // Helper to format value based on valueFormat
    const formatValue = (value: number, valueFormat: ValueFormat): string => {
      switch(valueFormat) {
        case 'percent':
          return `${value}%`;
        case 'currency':
          return money.format(value);
        case 'number':
          return String(value);
        default:
          return String(value);
      }
    };
    
    const control = experiment.variants.find((variant) => variant.isControl);
    const challenger = experiment.variants.find((variant) => !variant.isControl);

    return (
      <Card key={experiment.id} padding="400">
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <BlockStack gap="200">
              <Text variant="headingMd" as="h2">{experiment.name}</Text>
              <InlineStack gap="200">
                <Badge>{typeLabel}</Badge>
                <Badge tone={statusTone}>{experiment.status}</Badge>
                <Badge tone="info">{`Attribution: ${prettyAttribution(experiment.attribution)}`}</Badge>
                {experiment.startDate && (
                  <Badge tone="attention">{`Started ${new Date(experiment.startDate).toLocaleDateString()}`}</Badge>
                )}
              </InlineStack>
            </BlockStack>
            <ButtonGroup>
              <Button onClick={() => openResultsModal(experiment)}>View results</Button>
              <Button onClick={() => openEditModal(experiment)}>Edit</Button>
              <Button onClick={() => handleToggleStatus(experiment)}>
                {experiment.status === 'running' ? 'Pause' : 'Resume'}
              </Button>
              <Button tone="critical" onClick={() => handleDelete(experiment.id)}>
                Delete
              </Button>
            </ButtonGroup>
          </InlineStack>

          <InlineStack gap="400" wrap>
            {control && (
              <Card key={`${experiment.id}-control`} background="bg-surface-secondary" padding="400">
                <BlockStack gap="150">
                  <Text variant="headingSm" as="h3">Control</Text>
                  <Text as="p" tone="subdued">Value: {formatValue(control.value, control.valueFormat)}</Text>
                  <Text as="p" tone="subdued">Traffic: {control.trafficPct}%</Text>
                </BlockStack>
              </Card>
            )}
            {challenger && (
              <Card key={`${experiment.id}-challenger`} background="bg-surface-secondary" padding="400">
                <BlockStack gap="150">
                  <Text variant="headingSm" as="h3">{challenger.name}</Text>
                  <Text as="p" tone="subdued">Value: {formatValue(challenger.value, challenger.valueFormat)}</Text>
                  <Text as="p" tone="subdued">Traffic: {challenger.trafficPct}%</Text>
                </BlockStack>
              </Card>
            )}
          </InlineStack>

          {/* Compact last-7-days summary */}
          <ExperimentSummary experiment={experiment} />
        </BlockStack>
      </Card>
    );
  };

  const renderResults = () => {
    if (resultsLoading) {
      return <Text as="p">Crunching numbers…</Text>;
    }

    if (resultsError) {
      return (
        <BlockStack gap="300">
          <Banner tone="warning" title="Unable to show results">
            <Text as="p">{resultsError}</Text>
          </Banner>
          <Text as="p" tone="subdued">Common reasons:</Text>
          <BlockStack gap="100">
            <Text as="p" tone="subdued">• Your experiment just started and hasn't collected data yet</Text>
            <Text as="p" tone="subdued">• The experiment isn't receiving traffic (check it's published and active)</Text>
            <Text as="p" tone="subdued">• Events aren't being tracked properly</Text>
          </BlockStack>
        </BlockStack>
      );
    }

    if (!resultsPayload) {
      return <Text as="p">No data yet.</Text>;
    }

    const { results, leader, start, end } = resultsPayload;

    // Check if there's any actual data
    const hasData = results.some(v => v.visitors > 0);
    
    if (!hasData) {
      return (
        <BlockStack gap="300">
          <Banner tone="info" title="Not enough data yet">
            <Text as="p">Your experiment is running, but we haven't collected enough traffic yet.</Text>
            <Text as="p">Check back in a few hours once visitors start seeing your variants.</Text>
          </Banner>
          <Text as="p" tone="subdued">
            Window: {new Date(start).toLocaleDateString()} - {new Date(end).toLocaleDateString()}
          </Text>
        </BlockStack>
      );
    }

    return (
      <BlockStack gap="400">
        <Text as="p" tone="subdued">
          Window: {new Date(start).toLocaleDateString()} - {new Date(end).toLocaleDateString()}
        </Text>
        {results.map((variant: ResultsVariant) => {
          const isLeader = leader === variant.variantId;
          return (
            <Card key={variant.variantId} padding="400">
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <InlineStack gap="200" align="center">
                      <Text variant="headingSm" as="h3">{variant.variantName}</Text>
                      {isLeader && <Badge tone="success">Recommended</Badge>}
                    </InlineStack>
                    <InlineStack gap="400">
                      <Text as="p" tone="subdued">Visitors: {variant.visitors}</Text>
                      <Text as="p" tone="subdued">Orders: {variant.conversions}</Text>
                      <Text as="p" tone="subdued">Revenue: {money.format(variant.revenue)}</Text>
                    </InlineStack>
                  </BlockStack>
                  <BlockStack gap="150" align="end">
                    <Text as="p">Revenue / visitor: {money.format(variant.revenuePerVisitor)}</Text>
                    <Text as="p">Conversion rate: {(variant.conversionRate * 100).toFixed(2)}%</Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          );
        })}
        {leader && selectedExperiment && (
          <InlineStack align="end">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  // Include App Bridge session token for rollout request
                  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
                  let sessionToken = '';
                  try {
                    if (app) {
                      sessionToken = await appBridgeUtils.getSessionToken(app);
                    }
                  } catch (_e) {
                    // ignore
                  }
                  if (!sessionToken) sessionToken = params.get('id_token') || '';

                  const res = await fetch("/api/ab-rollout", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
                    },
                    body: JSON.stringify({ experimentId: selectedExperiment.id, winnerVariantId: leader }),
                  });
                  if (res.ok) {
                    setSuccessBanner("Rolled out the winner. New visitors will see it going forward.");
                    setResultsModalOpen(false);
                    revalidator.revalidate();
                  } else {
                    const msg = await extractErrorMessage(res);
                    setResultsError(msg || "Couldn't roll out just now. Try again.");
                  }
                } catch (e: unknown) {
                  const errorMessage = e instanceof Error ? e.message : "Couldn't roll out just now. Try again.";
                  setResultsError(errorMessage);
                }
              }}
            >
              Roll out winner
            </Button>
          </InlineStack>
        )}
      </BlockStack>
    );
  };

  return (
    <Page
      title="A/B Experiments"
      primaryAction={{
        content: "New experiment",
        onAction: () => setCreateModalOpen(true),
      }}
    >
      <Layout>
        <Layout.Section>
          {errorBanner && (
            <Banner tone="critical" title="Something went wrong" onDismiss={() => setErrorBanner(null)}>
              {errorBanner}
            </Banner>
          )}
          {successBanner && (
            <Banner tone="success" title="All set" onDismiss={() => setSuccessBanner(null)}>
              {successBanner}
            </Banner>
          )}
        </Layout.Section>

        {/* A/B Testing Settings */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">⚙️ A/B Testing Settings</Text>
              <Checkbox
                label="Auto-apply A/B discount codes"
                helpText="When an A/B test assigns a discount code, automatically apply it to the cart if none is present"
                checked={autoApplyABDiscounts}
                onChange={handleSaveAutoApply}
                disabled={settingsSaving}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {experiments.length === 0 ? (
            <Card padding="400">
              <EmptyState
                heading="Launch your first test"
                action={{ content: "Create experiment", onAction: () => setCreateModalOpen(true) }}
                image="https://cdn.shopify.com/s/files/1/0780/2207/collections/empty-state.svg"
              >
                Try a simple price incentive: keep one drawer as-is, and offer a sweeter discount to half of shoppers.
              </EmptyState>
            </Card>
          ) : (
            <BlockStack gap="400">
              {experiments.map((experiment) => renderExperimentCard(experiment))}
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>

      <Modal
        open={createModalOpen}
        onClose={closeCreateModal}
  title="Start a new test"
        primaryAction={{
          content: isSaving ? "Saving…" : "Launch experiment",
          onAction: handleCreate,
          disabled: isSaving,
        }}
        secondaryActions={[{ content: "Cancel", onAction: closeCreateModal }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Experiment name"
              value={newName}
              placeholder="e.g., Free Shipping vs 10% Off"
              onChange={setNewName}
              autoComplete="off"
            />

            <BlockStack gap="150">
              <Text as="p">How long should we count orders for this test?</Text>
              <Select
                label="Attribution window"
                labelHidden
                value={attributionWindow}
                onChange={(value) => setAttributionWindow(value as "session"|"24h"|"7d")}
                options={[
                  { label: "Same session only", value: "session" },
                  { label: "Orders placed within 24 hours", value: "24h" },
                  { label: "Orders placed within 7 days", value: "7d" },
                ]}
              />
            </BlockStack>

            <BlockStack gap="150">
              <Text as="p">Start test immediately?</Text>
              <Select
                label="Start test immediately?"
                labelHidden
                value={activateNow ? "yes" : "no"}
                onChange={(value) => setActivateNow(value === "yes")}
                options={[
                  { label: "Yes, start now", value: "yes" },
                  { label: "No, save as draft", value: "no" },
                ]}
              />
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">Control (Current Offer)</Text>
              <Select
                label="Control type"
                value={controlType}
                onChange={(value) => setControlType(value as "discount"|"bundle"|"shipping"|"upsell")}
                options={[
                  { label: "Discount offer", value: "discount" },
                  { label: "Bundle deal", value: "bundle" },
                  { label: "Shipping threshold", value: "shipping" },
                  { label: "Upsell", value: "upsell" },
                ]}
              />
              <Select
                label="Control format"
                value={controlFormat}
                onChange={(value) => setControlFormat(value as "percent"|"currency"|"number")}
                options={[
                  { label: "Percentage (e.g., 10%)", value: "percent" },
                  { label: "Currency (e.g., $50)", value: "currency" },
                  { label: "Number (e.g., 2 items)", value: "number" },
                ]}
              />
              <TextField
                label="Control value"
                value={controlDiscount}
                onChange={setControlDiscount}
                type="number"
                suffix={controlFormat === 'percent' ? '%' : controlFormat === 'currency' ? storeCurrency : ''}
                min="0"
                autoComplete="off"
                helpText={
                  controlFormat === 'percent' ? 'Enter percentage (e.g., 5 for 5% off)' :
                  controlFormat === 'currency' ? 'Enter dollar amount (e.g., 50 for $50)' :
                  'Enter numeric value'
                }
              />
            </BlockStack>

            <Divider />

            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">Challenger (New Offer)</Text>
              <TextField
                label="Challenger name"
                value={variantName}
                onChange={setVariantName}
                placeholder="e.g., 10% Off"
                autoComplete="off"
              />
              <Select
                label="Challenger type"
                value={challengerType}
                onChange={(value) => setChallengerType(value as "discount"|"bundle"|"shipping"|"upsell")}
                options={[
                  { label: "Discount offer", value: "discount" },
                  { label: "Bundle deal", value: "bundle" },
                  { label: "Shipping threshold", value: "shipping" },
                  { label: "Upsell", value: "upsell" },
                ]}
              />
              <Select
                label="Challenger format"
                value={challengerFormat}
                onChange={(value) => setChallengerFormat(value as "percent"|"currency"|"number")}
                options={[
                  { label: "Percentage (e.g., 10%)", value: "percent" },
                  { label: "Currency (e.g., $100)", value: "currency" },
                  { label: "Number (e.g., 3 items)", value: "number" },
                ]}
              />
              <TextField
                label="Challenger value"
                value={variantDiscount}
                onChange={setVariantDiscount}
                type="number"
                suffix={challengerFormat === 'percent' ? '%' : challengerFormat === 'currency' ? storeCurrency : ''}
                min="0"
                autoComplete="off"
                helpText={
                  challengerFormat === 'percent' ? 'Enter percentage (e.g., 10 for 10% off)' :
                  challengerFormat === 'currency' ? 'Enter dollar amount (e.g., 100 for $100)' :
                  'Enter numeric value'
                }
              />
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={resultsModalOpen}
        onClose={closeResultsModal}
        title={selectedExperiment ? `${selectedExperiment.name} results` : "Experiment results"}
      >
        <Modal.Section>
          {renderResults()}
        </Modal.Section>
      </Modal>

      {/* Edit Modal - reuses same form state as create */
      }
      <Modal
        open={editModalOpen}
        onClose={closeEditModal}
        title="Edit Experiment"
        primaryAction={{
          content: "Save Changes",
          onAction: async () => {
            if (!editingExperiment) return;
            setIsSaving(true);
            try {
              const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
              // Prefer App Bridge session token; fallback to id_token in URL if present
              let sessionToken = '';
              try {
                if (app) {
                  sessionToken = await appBridgeUtils.getSessionToken(app);
                }
              } catch (_e) {
                // ignore
              }
              if (!sessionToken) {
                sessionToken = params.get('id_token') || '';
              }

              const controlVal = Number(controlDiscount);
              const challengerVal = Number(variantDiscount);

              const control = editingExperiment.variants.find(v => v.isControl);
              const challenger = editingExperiment.variants.find(v => !v.isControl);

              const payload = {
                action: "update",
                experimentId: editingExperiment.id,
                experiment: {
                  name: newName.trim(),
                  type: controlType, // Use control type as the experiment type
                  attributionWindow: attributionWindow,
                },
                variants: [
                  {
                    id: control?.id,
                    name: "Control",
                    isControl: true,
                    value: controlVal,
                    valueFormat: controlFormat,
                    trafficPct: 50,
                  },
                  {
                    id: challenger?.id,
                    name: variantName.trim() || "Variant",
                    isControl: false,
                    value: challengerVal,
                    valueFormat: challengerFormat,
                    trafficPct: 50,
                  },
                ],
              };

              const response = await fetch(`/api/ab-testing-admin`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-Requested-With": "XMLHttpRequest",
                  ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
                },
                body: JSON.stringify(payload),
              });

              if (!response.ok) {
                const msg = await extractErrorMessage(response);
                throw new Error(msg || "Failed to update experiment");
              }

              setSuccessBanner("Experiment updated successfully!");
              // Optimistically update the list
              try {
                const mapAttr = (w: AttributionWindow): AttributionWindowDB => {
                  switch (w) {
                    case '24h': return 'hours24';
                    case '7d': return 'days7';
                    case 'session':
                    default: return 'session';
                  }
                };
                setExperiments((prev) => prev.map((e) => {
                  if (e.id !== editingExperiment.id) return e;
                  const controlExisting = e.variants.find(v => v.isControl);
                  const challengerExisting = e.variants.find(v => !v.isControl);
                  return {
                    ...e,
                    name: newName.trim(),
                    type: controlType,
                    attribution: mapAttr(attributionWindow),
                    updatedAt: new Date().toISOString(),
                    variants: [
                      controlExisting ? { ...controlExisting, name: 'Control', value: Number(controlDiscount), valueFormat: controlFormat, trafficPct: 50 } : {
                        id: Math.floor(Math.random() * -1000000), name: 'Control', isControl: true, value: Number(controlDiscount), valueFormat: controlFormat, trafficPct: 50
                      },
                      challengerExisting ? { ...challengerExisting, name: variantName.trim() || 'Variant', value: Number(variantDiscount), valueFormat: challengerFormat, trafficPct: 50 } : {
                        id: Math.floor(Math.random() * -1000000), name: variantName.trim() || 'Variant', isControl: false, value: Number(variantDiscount), valueFormat: challengerFormat, trafficPct: 50
                      },
                    ],
                  };
                }));
              } catch (_) {
                // ignore optimistic failures
              }
              closeEditModal();
              // Pause loader sync briefly, then revalidate
              setSyncPauseUntil(Date.now() + 2000);
              setTimeout(() => revalidator.revalidate(), 600);
            } catch (error: unknown) {
              console.error("[ABTesting] Update error", error);
              const errorMessage = error instanceof Error ? error.message : "Failed to update experiment. Try again.";
              setErrorBanner(errorMessage);
            } finally {
              setIsSaving(false);
            }
          },
          disabled: isSaving,
          loading: isSaving,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: closeEditModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Banner tone="info">
              <Text as="p">Only the experiment name can be edited. To change variants, values, or traffic allocation, you'll need to create a new experiment.</Text>
            </Banner>
            <TextField
              label="Experiment Name"
              value={newName}
              onChange={setNewName}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
