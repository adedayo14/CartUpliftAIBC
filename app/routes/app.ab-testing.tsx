import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import {
  Box,
  Flex,
  Panel,
  Text,
  H1,
  H2,
  H3,
  Small,
  Button,
  Badge,
  HR,
  Modal,
  Input,
  Select,
  Checkbox,
} from "@bigcommerce/big-design";
import { CloseIcon } from "@bigcommerce/big-design-icons";
import { Prisma } from "@prisma/client";
import { authenticateAdmin } from "../bigcommerce.server";
import prisma from "../db.server";
import type {
  AttributionWindow,
  AttributionWindowDB,
  ValueFormat,
  ExperimentType,
  ExtendedSession,
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
  const { session, storeHash } = await authenticateAdmin(request);

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
  // Session may not include a currency; fall back to Settings if available later
  const extSession = session as unknown as ExtendedSession;
  const currencyCode = extSession?.currency || 'USD';
  return json({ experiments: serialized, currencyCode });
  } catch (err: unknown) {
    console.error("[app.ab-testing] Failed to load experiments. If you recently changed the Prisma schema, run migrations.", err);
    // Fail-open: return an empty list so the page renders with an EmptyState instead of 500
    return json({ experiments: [] as LoaderExperiment[] });
  }
};

// Helper to map badge tone strings to BigDesign Badge variant
function mapBadgeVariant(tone?: string): "danger" | "secondary" | "success" | "warning" | "primary" {
  switch (tone) {
    case "success": return "success";
    case "warning": return "warning";
    case "attention": return "warning";
    case "critical": return "danger";
    case "info": return "primary";
    case "new": return "primary";
    default: return "secondary";
  }
}

// Helper to map banner tone to border/background colors
function mapBannerColors(tone?: string): { border: string; background: string } {
  switch (tone) {
    case "success": return { border: "#2e7d32", background: "#e8f5e9" };
    case "warning": return { border: "#ed6c02", background: "#fff3e0" };
    case "critical": return { border: "#c62828", background: "#ffebee" };
    case "info":
    default: return { border: "#1565c0", background: "#e3f2fd" };
  }
}

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
  // Cookie-based auth: no App Bridge needed
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
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
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
      const next = experiment.status === 'running' ? 'paused' : 'running';
      const response = await fetch(`/api/ab-testing-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        credentials: 'include',
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
          const res = await fetch(`/api/ab-results?experimentId=${experiment.id}&period=7d`, {
            credentials: 'include',
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

    if (loading) return <Text color="secondary">Loading last 7 days…</Text>;
    if (error || !summary) return <Text color="secondary">{error || 'No recent data'}</Text>;

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
        const res = await fetch('/api/ab-rollout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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
        <Flex flexDirection="column" flexGap="0.5rem">
          <Text color="secondary">No traffic yet. We'll show metrics once visitors arrive.</Text>
          <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text color="secondary">Window: {new Date(summary.start).toLocaleDateString()} - {new Date(summary.end).toLocaleDateString()}</Text>
            <Text color="secondary">Split: {split}</Text>
          </Flex>
        </Flex>
      );
    }

    return (
      <Flex flexDirection="column" flexGap="1rem">
        <Flex flexDirection="row" flexGap="1rem" flexWrap="wrap">
          <Panel>
            <Box style={{ padding: "1rem", borderRadius: "6px" }} backgroundColor="secondary10">
              <Flex flexDirection="column" flexGap="0.375rem">
                <Text color="secondary">Last 7 days</Text>
                <H2>{`${revenueDelta >= 0 ? '+' : '-'}${moneyLocal.format(Math.abs(revenueDelta))} vs control`}</H2>
                <Flex flexDirection="row" flexGap="1rem" flexWrap="wrap" alignItems="center">
                  <Text color="secondary">Orders: <span style={{ fontWeight: "bold" }}>{leader?.conversions ?? '—'}</span></Text>
                  <Text color="secondary">AOV: <span style={{ fontWeight: "bold" }}>{leader && leader.conversions > 0 ? moneyLocal.format(leader.revenue / leader.conversions) : '—'}</span></Text>
                  <Text color="secondary">$/visitor: <span style={{ fontWeight: "bold" }}>{rpvLeader > 0 ? moneyLocal.format(rpvLeader) : '—'}</span></Text>
                </Flex>
                {costOfDelay > 0 && (
                  <Badge label={`Cost of delay: ${moneyLocal.format(costOfDelay)}/day`} variant="warning" />
                )}
              </Flex>
            </Box>
          </Panel>

          <Panel>
            <Box style={{ padding: "1rem", borderRadius: "6px" }} backgroundColor="secondary10">
              <Flex flexDirection="column" flexGap="0.375rem">
                {leader && !leader.isControl && totalVisitors >= 100 && totalConversions >= 20 && (
                  <Flex flexDirection="row">
                    <Button variant="primary" onClick={rolloutLeader}>{`Roll out ${leader.variantName}`}</Button>
                  </Flex>
                )}
                <Flex flexDirection="column" flexGap="0.25rem">
                  <Text color="secondary">Threshold progress</Text>
                  <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
                    <Text color="secondary">Exposures</Text>
                    <Text color="secondary">{totalVisitors} / 100</Text>
                  </Flex>
                  <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
                    <Text color="secondary">Conversions</Text>
                    <Text color="secondary">{(leader?.conversions ?? 0) + (control?.conversions ?? 0)} / 20</Text>
                  </Flex>
                </Flex>
              </Flex>
            </Box>
          </Panel>
        </Flex>

        {rpvLiftPct !== null && (
          <Text>{`Lift (RPV): ${rpvLiftPct >= 0 ? '+' : ''}${rpvLiftPct.toFixed(1)}%`}</Text>
        )}
        <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
          <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
            <Text color="secondary">Leader:</Text>
            <Badge label={leader?.variantName || '—'} variant="success" />
            <Text color="secondary">• Split: {split}</Text>
          </Flex>
          <Text color="secondary">Window: {new Date(summary.start).toLocaleDateString()} - {new Date(summary.end).toLocaleDateString()}</Text>
        </Flex>
      </Flex>
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
        },
        credentials: 'include',
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
      const response = await fetch(`/api/ab-testing-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: 'include',
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
      const response = await fetch(`/api/ab-results?experimentId=${experiment.id}&period=7d`, {
        credentials: 'include',
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
    const statusBadgeVariant = experiment.status === "running"
      ? "success"
      : experiment.status === "completed"
        ? "warning"
        : "danger";
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
      <Panel key={experiment.id}>
        <Box style={{ padding: "1rem" }}>
          <Flex flexDirection="column" flexGap="1rem">
            <Flex flexDirection="row" justifyContent="space-between" alignItems="center">
              <Flex flexDirection="column" flexGap="0.5rem">
                <H2>{experiment.name}</H2>
                <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
                  <Badge label={typeLabel} variant="secondary" />
                  <Badge label={experiment.status} variant={statusBadgeVariant as "success" | "warning" | "danger"} />
                  <Badge label={`Attribution: ${prettyAttribution(experiment.attribution)}`} variant="primary" />
                  {experiment.startDate && (
                    <Badge label={`Started ${new Date(experiment.startDate).toLocaleDateString()}`} variant="warning" />
                  )}
                </Flex>
              </Flex>
              <Flex flexDirection="row" flexGap="0.5rem" flexWrap="wrap">
                <Button variant="secondary" onClick={() => openResultsModal(experiment)}>View results</Button>
                <Button variant="secondary" onClick={() => openEditModal(experiment)}>Edit</Button>
                <Button variant="secondary" onClick={() => handleToggleStatus(experiment)}>
                  {experiment.status === 'running' ? 'Pause' : 'Resume'}
                </Button>
                <Button variant="secondary" onClick={() => handleDelete(experiment.id)}>
                  Delete
                </Button>
              </Flex>
            </Flex>

            <Flex flexDirection="row" flexGap="1rem" flexWrap="wrap">
              {control && (
                <Panel key={`${experiment.id}-control`}>
                  <Box style={{ padding: "1rem", borderRadius: "6px" }} backgroundColor="secondary10">
                    <Flex flexDirection="column" flexGap="0.375rem">
                      <H3>Control</H3>
                      <Text color="secondary">Value: {formatValue(control.value, control.valueFormat)}</Text>
                      <Text color="secondary">Traffic: {control.trafficPct}%</Text>
                    </Flex>
                  </Box>
                </Panel>
              )}
              {challenger && (
                <Panel key={`${experiment.id}-challenger`}>
                  <Box style={{ padding: "1rem", borderRadius: "6px" }} backgroundColor="secondary10">
                    <Flex flexDirection="column" flexGap="0.375rem">
                      <H3>{challenger.name}</H3>
                      <Text color="secondary">Value: {formatValue(challenger.value, challenger.valueFormat)}</Text>
                      <Text color="secondary">Traffic: {challenger.trafficPct}%</Text>
                    </Flex>
                  </Box>
                </Panel>
              )}
            </Flex>

            {/* Compact last-7-days summary */}
            <ExperimentSummary experiment={experiment} />
          </Flex>
        </Box>
      </Panel>
    );
  };

  const renderResults = () => {
    if (resultsLoading) {
      return <Text>Crunching numbers…</Text>;
    }

    if (resultsError) {
      return (
        <Flex flexDirection="column" flexGap="0.75rem">
          <Box style={{ borderLeft: "4px solid #ed6c02", backgroundColor: "#fff3e0", padding: "1rem", borderRadius: "6px" }}>
            <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexGap="1rem">
              <Box>
                <H3>Unable to show results</H3>
                <Text>{resultsError}</Text>
              </Box>
            </Flex>
          </Box>
          <Text color="secondary">Common reasons:</Text>
          <Flex flexDirection="column" flexGap="0.25rem">
            <Text color="secondary">• Your experiment just started and hasn't collected data yet</Text>
            <Text color="secondary">• The experiment isn't receiving traffic (check it's published and active)</Text>
            <Text color="secondary">• Events aren't being tracked properly</Text>
          </Flex>
        </Flex>
      );
    }

    if (!resultsPayload) {
      return <Text>No data yet.</Text>;
    }

    const { results, leader, start, end } = resultsPayload;

    // Check if there's any actual data
    const hasData = results.some(v => v.visitors > 0);

    if (!hasData) {
      return (
        <Flex flexDirection="column" flexGap="0.75rem">
          <Box style={{ borderLeft: "4px solid #1565c0", backgroundColor: "#e3f2fd", padding: "1rem", borderRadius: "6px" }}>
            <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexGap="1rem">
              <Box>
                <H3>Not enough data yet</H3>
                <Text>Your experiment is running, but we haven't collected enough traffic yet.</Text>
                <Text>Check back in a few hours once visitors start seeing your variants.</Text>
              </Box>
            </Flex>
          </Box>
          <Text color="secondary">
            Window: {new Date(start).toLocaleDateString()} - {new Date(end).toLocaleDateString()}
          </Text>
        </Flex>
      );
    }

    return (
      <Flex flexDirection="column" flexGap="1rem">
        <Text color="secondary">
          Window: {new Date(start).toLocaleDateString()} - {new Date(end).toLocaleDateString()}
        </Text>
        {results.map((variant: ResultsVariant) => {
          const isLeader = leader === variant.variantId;
          return (
            <Panel key={variant.variantId}>
              <Box style={{ padding: "1rem" }}>
                <Flex flexDirection="column" flexGap="0.5rem">
                  <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start">
                    <Flex flexDirection="column" flexGap="0.25rem">
                      <Flex flexDirection="row" flexGap="0.5rem" alignItems="center">
                        <H3>{variant.variantName}</H3>
                        {isLeader && <Badge label="Recommended" variant="success" />}
                      </Flex>
                      <Flex flexDirection="row" flexGap="1rem" alignItems="center">
                        <Text color="secondary">Visitors: {variant.visitors}</Text>
                        <Text color="secondary">Orders: {variant.conversions}</Text>
                        <Text color="secondary">Revenue: {money.format(variant.revenue)}</Text>
                      </Flex>
                    </Flex>
                    <Flex flexDirection="column" flexGap="0.375rem" alignItems="flex-end">
                      <Text>Revenue / visitor: {money.format(variant.revenuePerVisitor)}</Text>
                      <Text>Conversion rate: {(variant.conversionRate * 100).toFixed(2)}%</Text>
                    </Flex>
                  </Flex>
                </Flex>
              </Box>
            </Panel>
          );
        })}
        {leader && selectedExperiment && (
          <Flex flexDirection="row" justifyContent="flex-end">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const res = await fetch("/api/ab-rollout", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    credentials: 'include',
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
          </Flex>
        )}
      </Flex>
    );
  };

  // Build modal actions for create modal
  const createModalActions = [
    {
      text: "Cancel",
      variant: "subtle" as const,
      onClick: closeCreateModal,
    },
    {
      text: isSaving ? "Saving…" : "Launch experiment",
      variant: "primary" as any,
      onClick: handleCreate,
      disabled: isSaving,
    },
  ];

  // Build modal actions for edit modal
  const editModalSaveHandler = async () => {
    if (!editingExperiment) return;
    setIsSaving(true);
    try {
      const controlVal = Number(controlDiscount);
      const challengerVal = Number(variantDiscount);

      const control = editingExperiment.variants.find(v => v.isControl);
      const challenger = editingExperiment.variants.find(v => !v.isControl);

      const payload = {
        action: "update",
        experimentId: editingExperiment.id,
        experiment: {
          name: newName.trim(),
          type: controlType,
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
        },
        credentials: 'include',
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
  };

  const editModalActions = [
    {
      text: "Cancel",
      variant: "subtle" as const,
      onClick: closeEditModal,
    },
    {
      text: "Save Changes",
      variant: "primary" as any,
      onClick: editModalSaveHandler,
      disabled: isSaving,
      isLoading: isSaving,
    },
  ];

  return (
    <Box padding="medium" style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <Flex flexDirection="column" flexGap="0.5rem" marginBottom="medium">
        <H1>A/B Experiments</H1>
        <Flex flexDirection="row" flexGap="0.5rem" flexWrap="wrap">
          <Button variant="primary" onClick={() => setCreateModalOpen(true)}>New experiment</Button>
        </Flex>
      </Flex>

      <Flex flexDirection="column" flexGap="1.5rem">
        <Box>
          {errorBanner && (
            <Box style={{ borderLeft: "4px solid #c62828", backgroundColor: "#ffebee", padding: "1rem", borderRadius: "6px" }}>
              <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexGap="1rem">
                <Box>
                  <H3>Something went wrong</H3>
                  <Text>{errorBanner}</Text>
                </Box>
                <Button variant="subtle" iconOnly={<CloseIcon />} onClick={() => setErrorBanner(null)} />
              </Flex>
            </Box>
          )}
          {successBanner && (
            <Box style={{ borderLeft: "4px solid #2e7d32", backgroundColor: "#e8f5e9", padding: "1rem", borderRadius: "6px" }}>
              <Flex flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexGap="1rem">
                <Box>
                  <H3>All set</H3>
                  <Text>{successBanner}</Text>
                </Box>
                <Button variant="subtle" iconOnly={<CloseIcon />} onClick={() => setSuccessBanner(null)} />
              </Flex>
            </Box>
          )}
        </Box>

        {/* A/B Testing Settings */}
        <Box>
          <Panel>
            <Box style={{ padding: "1rem" }}>
              <Flex flexDirection="column" flexGap="1rem">
                <H2>A/B Testing Settings</H2>
                <Checkbox
                  label="Auto-apply A/B discount codes"
                  description="When an A/B test assigns a discount code, automatically apply it to the cart if none is present"
                  checked={autoApplyABDiscounts}
                  onChange={(event) => handleSaveAutoApply(event.target.checked)}
                  disabled={settingsSaving}
                />
              </Flex>
            </Box>
          </Panel>
        </Box>

        <Box>
          {experiments.length === 0 ? (
            <Panel>
              <Box style={{ padding: "1rem" }}>
                <Box style={{ textAlign: "center", padding: "2rem" }}>
                  <H2>Launch your first test</H2>
                  <Text color="secondary">Try a simple price incentive: keep one drawer as-is, and offer a sweeter discount to half of shoppers.</Text>
                  <Box marginTop="medium">
                    <Button variant="primary" onClick={() => setCreateModalOpen(true)}>Create experiment</Button>
                  </Box>
                </Box>
              </Box>
            </Panel>
          ) : (
            <Flex flexDirection="column" flexGap="1rem">
              {experiments.map((experiment) => renderExperimentCard(experiment))}
            </Flex>
          )}
        </Box>
      </Flex>

      <Modal
        isOpen={createModalOpen}
        onClose={closeCreateModal}
        header="Start a new test"
        actions={createModalActions}
      >
        <Box padding="medium">
          <Flex flexDirection="column" flexGap="1rem">
            <Input
              label="Experiment name"
              value={newName}
              placeholder="e.g., Free Shipping vs 10% Off"
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="off"
            />

            <Flex flexDirection="column" flexGap="0.375rem">
              <Text>How long should we count orders for this test?</Text>
              <Select
                label="Attribution window"
                value={attributionWindow}
                onOptionChange={(value) => setAttributionWindow(value as "session"|"24h"|"7d")}
                options={[
                  { content: "Same session only", value: "session" },
                  { content: "Orders placed within 24 hours", value: "24h" },
                  { content: "Orders placed within 7 days", value: "7d" },
                ]}
              />
            </Flex>

            <Flex flexDirection="column" flexGap="0.375rem">
              <Text>Start test immediately?</Text>
              <Select
                label="Start test immediately?"
                value={activateNow ? "yes" : "no"}
                onOptionChange={(value) => setActivateNow(value === "yes")}
                options={[
                  { content: "Yes, start now", value: "yes" },
                  { content: "No, save as draft", value: "no" },
                ]}
              />
            </Flex>

            <HR />

            <Flex flexDirection="column" flexGap="0.75rem">
              <H2>Control (Current Offer)</H2>
              <Select
                label="Control type"
                value={controlType}
                onOptionChange={(value) => setControlType(value as "discount"|"bundle"|"shipping"|"upsell")}
                options={[
                  { content: "Discount offer", value: "discount" },
                  { content: "Bundle deal", value: "bundle" },
                  { content: "Shipping threshold", value: "shipping" },
                  { content: "Upsell", value: "upsell" },
                ]}
              />
              <Select
                label="Control format"
                value={controlFormat}
                onOptionChange={(value) => setControlFormat(value as "percent"|"currency"|"number")}
                options={[
                  { content: "Percentage (e.g., 10%)", value: "percent" },
                  { content: "Currency (e.g., $50)", value: "currency" },
                  { content: "Number (e.g., 2 items)", value: "number" },
                ]}
              />
              <Input
                label="Control value"
                value={controlDiscount}
                onChange={(e) => setControlDiscount(e.target.value)}
                type="number"
                iconRight={controlFormat === 'percent' ? <Small>%</Small> : controlFormat === 'currency' ? <Small>{storeCurrency}</Small> : undefined}
                description={
                  controlFormat === 'percent' ? 'Enter percentage (e.g., 5 for 5% off)' :
                  controlFormat === 'currency' ? 'Enter dollar amount (e.g., 50 for $50)' :
                  'Enter numeric value'
                }
                autoComplete="off"
              />
            </Flex>

            <HR />

            <Flex flexDirection="column" flexGap="0.75rem">
              <H2>Challenger (New Offer)</H2>
              <Input
                label="Challenger name"
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="e.g., 10% Off"
                autoComplete="off"
              />
              <Select
                label="Challenger type"
                value={challengerType}
                onOptionChange={(value) => setChallengerType(value as "discount"|"bundle"|"shipping"|"upsell")}
                options={[
                  { content: "Discount offer", value: "discount" },
                  { content: "Bundle deal", value: "bundle" },
                  { content: "Shipping threshold", value: "shipping" },
                  { content: "Upsell", value: "upsell" },
                ]}
              />
              <Select
                label="Challenger format"
                value={challengerFormat}
                onOptionChange={(value) => setChallengerFormat(value as "percent"|"currency"|"number")}
                options={[
                  { content: "Percentage (e.g., 10%)", value: "percent" },
                  { content: "Currency (e.g., $100)", value: "currency" },
                  { content: "Number (e.g., 3 items)", value: "number" },
                ]}
              />
              <Input
                label="Challenger value"
                value={variantDiscount}
                onChange={(e) => setVariantDiscount(e.target.value)}
                type="number"
                iconRight={challengerFormat === 'percent' ? <Small>%</Small> : challengerFormat === 'currency' ? <Small>{storeCurrency}</Small> : undefined}
                description={
                  challengerFormat === 'percent' ? 'Enter percentage (e.g., 10 for 10% off)' :
                  challengerFormat === 'currency' ? 'Enter dollar amount (e.g., 100 for $100)' :
                  'Enter numeric value'
                }
                autoComplete="off"
              />
            </Flex>
          </Flex>
        </Box>
      </Modal>

      <Modal
        isOpen={resultsModalOpen}
        onClose={closeResultsModal}
        header={selectedExperiment ? `${selectedExperiment.name} results` : "Experiment results"}
      >
        <Box padding="medium">
          {renderResults()}
        </Box>
      </Modal>

      {/* Edit Modal - reuses same form state as create */}
      <Modal
        isOpen={editModalOpen}
        onClose={closeEditModal}
        header="Edit Experiment"
        actions={editModalActions}
      >
        <Box padding="medium">
          <Flex flexDirection="column" flexGap="1rem">
            <Box style={{ borderLeft: "4px solid #1565c0", backgroundColor: "#e3f2fd", padding: "1rem", borderRadius: "6px" }}>
              <Text>Only the experiment name can be edited. To change variants, values, or traffic allocation, you'll need to create a new experiment.</Text>
            </Box>
            <Input
              label="Experiment Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="off"
            />
          </Flex>
        </Box>
      </Modal>
    </Box>
  );
}
