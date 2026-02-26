import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Form, useSearchParams } from "@remix-run/react";
import { getSession } from "~/utils/superadmin-session.server";
import { prisma } from "~/db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const session = await getSession(request.headers.get("Cookie"));
  
  if (!session.get("authenticated")) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/superadmin/login",
      },
    });
  }

  const url = new URL(request.url);
  const sortBy = url.searchParams.get("sortBy") || "shop";
  const sortOrder = url.searchParams.get("sortOrder") || "asc";

  try {
    // Get ALL unique shops that ever installed - query from Settings (persists after uninstall)
    const allSettings = await prisma.settings.findMany({
      select: {
        storeHash: true,
        createdAt: true,
        enableRecommendations: true,
        ownerEmail: true,
      },
    });

    // Get session data for shops that are still installed
    const allSessions = await prisma.session.findMany({
      select: {
        storeHash: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    // Create session map for quick lookup
    const sessionMap = new Map();
    allSessions.forEach(session => {
      if (!sessionMap.has(session.storeHash) || session.email) {
        sessionMap.set(session.storeHash, session);
      }
    });

    // Fetch real data for each unique shop
    const storeData = await Promise.all(
      allSettings.map(async (settings) => {
        const session = sessionMap.get(settings.storeHash);
        // Get subscription data
        const subscription = await prisma.subscription.findUnique({
          where: { storeHash: settings.storeHash },
          select: {
            planTier: true,
            planStatus: true,
            trialEndsAt: true,
            createdAt: true,
          },
        });

        const installDate = settings.createdAt || subscription?.createdAt || new Date();
        const daysSinceInstall = Math.floor((Date.now() - installDate.getTime()) / (1000 * 60 * 60 * 24));

        // Determine status - if no session, store is uninstalled
        const isUninstalled = !session;
        const billingStatus = isUninstalled ? "uninstalled" : (subscription?.planStatus || "active");

        // Use store hash directly as the store name
        const storeName = settings.storeHash || 'Unknown';

        return {
          storeHash: settings.storeHash,
          storeName,
          email: settings.ownerEmail || session?.email || "",
          ownerName: session?.firstName && session?.lastName
            ? `${session.firstName} ${session.lastName}`
            : session?.firstName || "",
          planType: subscription?.planTier || "starter",
          billingStatus: billingStatus,
          trialEndsAt: subscription?.trialEndsAt,
          installedAt: installDate,
          daysSinceInstall,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
          conversionRate: 0,
          ctr: 0,
          mlEnabled: settings.enableRecommendations || false,
        };
      })
    );

    // Sort the data
    const sortedData = storeData.sort((a, b) => {
      let aVal: string | number | boolean = a[sortBy as keyof typeof a];
      let bVal: string | number | boolean = b[sortBy as keyof typeof b];

      // Handle string comparisons
      if (typeof aVal === "string" && typeof bVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }

      if (sortOrder === "asc") {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    // Calculate totals
    const installedStores = storeData.filter(s => s.billingStatus !== "uninstalled");
    const totals = {
      stores: storeData.length,
      installedStores: installedStores.length,
      totalRevenue: installedStores.reduce((sum, s) => sum + s.revenue, 0),
      paidStores: installedStores.filter(s => s.billingStatus === "active").length,
      avgConversionRate: installedStores.length > 0
        ? installedStores.reduce((sum, s) => sum + s.conversionRate, 0) / installedStores.length
        : 0,
    };

    return json({ stores: sortedData, totals });
  } catch (error: unknown) {
    console.error("Super admin dashboard error:", error);
    // Return empty data if there's an error
    return json({
      stores: [],
      totals: { stores: 0, installedStores: 0, totalRevenue: 0, paidStores: 0, avgConversionRate: 0 }
    });
  }
};

const toCsvValue = (value: string | number | boolean | null | undefined) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const downloadCsv = (rows: Record<string, string | number | boolean | null | undefined>[], filename: string) => {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(header => toCsvValue(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export default function SuperAdminDashboard() {
  const { stores, totals } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const sortBy = searchParams.get("sortBy") || "shop";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return "↕️";
    return sortOrder === "asc" ? "↑" : "↓";
  };

  const getSortUrl = (column: string) => {
    const newOrder = sortBy === column && sortOrder === "asc" ? "desc" : "asc";
    return `?sortBy=${column}&sortOrder=${newOrder}`;
  };

  const handleExport = () => {
    const rows = stores.map(store => ({
      storeName: store.storeName,
      ownerName: store.ownerName || "",
      email: store.email || "",
      planType: store.planType,
      billingStatus: store.billingStatus,
      installedAt: new Date(store.installedAt).toISOString(),
      daysSinceInstall: store.daysSinceInstall,
      mlEnabled: store.mlEnabled ? "yes" : "no",
      storeHash: store.storeHash,
    }));
    downloadCsv(rows, "cart-uplift-superadmin.csv");
  };

  const surface = "#ffffff";
  const ink = "#0f172a";
  const muted = "#64748b";
  const border = "#e5e7eb";
  const soft = "#f8fafc";

  return (
    <div style={{ minHeight: "100vh", background: soft, padding: "24px", fontFamily: "'Manrope', 'Segoe UI', sans-serif", color: ink }}>
      <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "32px", fontWeight: "700", letterSpacing: "-0.02em", marginBottom: "6px" }}>
              Cart Uplift Super Admin
            </h1>
            <p style={{ color: muted, fontSize: "15px" }}>Monitor installs, billing status, and ML adoption</p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <button
              type="button"
              onClick={handleExport}
              style={{
                padding: "10px 16px",
                background: surface,
                color: ink,
                border: `1px solid ${border}`,
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600",
              }}
            >
              Export CSV
            </button>
            <Form method="post" action="/superadmin/logout">
              <button style={{
                padding: "10px 16px",
                background: ink,
                color: surface,
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600"
              }}>
                Logout
              </button>
            </Form>
          </div>
        </div>

        {/* Stats Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "32px" }}>
          <div style={{ background: surface, padding: "22px", borderRadius: "14px", border: `1px solid ${border}` }}>
            <p style={{ color: muted, fontSize: "12px", marginBottom: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Stores</p>
            <p style={{ fontSize: "32px", fontWeight: "700", color: ink }}>{totals.stores}</p>
            <p style={{ fontSize: "12px", color: muted, marginTop: "6px" }}>{totals.installedStores} active · {totals.stores - totals.installedStores} uninstalled</p>
          </div>
          <div style={{ background: surface, padding: "22px", borderRadius: "14px", border: `1px solid ${border}` }}>
            <p style={{ color: muted, fontSize: "12px", marginBottom: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.08em" }}>Paid Plans</p>
            <p style={{ fontSize: "32px", fontWeight: "700", color: ink }}>{totals.paidStores}</p>
            <p style={{ fontSize: "12px", color: muted, marginTop: "6px" }}>{totals.installedStores > 0 ? Math.round((totals.paidStores / totals.installedStores) * 100) : 0}% of active stores</p>
          </div>
          <div style={{ background: surface, padding: "22px", borderRadius: "14px", border: `1px solid ${border}` }}>
            <p style={{ color: muted, fontSize: "12px", marginBottom: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.08em" }}>Trial Stores</p>
            <p style={{ fontSize: "32px", fontWeight: "700", color: ink }}>{stores.filter(s => s.billingStatus === "trial").length}</p>
            <p style={{ fontSize: "12px", color: muted, marginTop: "6px" }}>Potential conversions</p>
          </div>
          <div style={{ background: surface, padding: "22px", borderRadius: "14px", border: `1px solid ${border}` }}>
            <p style={{ color: muted, fontSize: "12px", marginBottom: "10px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.08em" }}>ML Enabled</p>
            <p style={{ fontSize: "32px", fontWeight: "700", color: ink }}>{stores.filter(s => s.mlEnabled && s.billingStatus !== "uninstalled").length}</p>
            <p style={{ fontSize: "12px", color: muted, marginTop: "6px" }}>{totals.installedStores > 0 ? Math.round((stores.filter(s => s.mlEnabled && s.billingStatus !== "uninstalled").length / totals.installedStores) * 100) : 0}% adoption rate</p>
          </div>
        </div>

        {/* Table */}
        <div style={{ background: surface, borderRadius: "14px", border: `1px solid ${border}`, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: soft, borderBottom: `1px solid ${border}` }}>
                  <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <a href={getSortUrl("storeName")} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                      Store Name {getSortIcon("storeName")}
                    </a>
                  </th>
                  <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <a href={getSortUrl("email")} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                      Email {getSortIcon("email")}
                    </a>
                  </th>
                  <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <a href={getSortUrl("planType")} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                      Plan {getSortIcon("planType")}
                    </a>
                  </th>
                  <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <a href={getSortUrl("billingStatus")} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                      Status {getSortIcon("billingStatus")}
                    </a>
                  </th>
                  <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <a href={getSortUrl("daysSinceInstall")} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                      Installed {getSortIcon("daysSinceInstall")}
                    </a>
                  </th>
                  <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>ML</th>
                  <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: muted, fontSize: "12px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <a href={getSortUrl("shop")} style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "4px" }}>
                      Shop URL {getSortIcon("shop")}
                    </a>
                  </th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store, index) => (
                  <tr key={store.storeHash} style={{ borderBottom: `1px solid ${border}`, background: index % 2 === 0 ? surface : soft }}>
                    <td style={{ padding: "14px 16px" }}>
                      <div style={{ fontWeight: "600", marginBottom: "2px" }}>{store.storeName}</div>
                      {store.ownerName && (
                        <div style={{ fontSize: "12px", color: muted }}>{store.ownerName}</div>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", color: muted, fontSize: "13px" }}>
                      {store.email || <span style={{ color: "#cbd5e1", fontStyle: "italic" }}>No email</span>}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        background: soft,
                        color: ink,
                        border: `1px solid ${border}`,
                      }}>
                        {store.planType}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: "600",
                        textTransform: "uppercase",
                        background: soft,
                        color: ink,
                        border: `1px solid ${border}`,
                      }}>
                        {store.billingStatus}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", color: muted, fontSize: "13px" }}>
                      <div>{store.daysSinceInstall === 0 ? "Today" :
                       store.daysSinceInstall === 1 ? "Yesterday" :
                       `${store.daysSinceInstall}d ago`}</div>
                      {store.billingStatus === "trial" && store.trialEndsAt && (
                        <div style={{ fontSize: "11px", color: muted, marginTop: "2px" }}>
                          Trial ends {new Date(store.trialEndsAt).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "center" }}>
                      <span style={{ fontSize: "12px", fontWeight: "600", color: store.mlEnabled ? ink : muted }}>
                        {store.mlEnabled ? "Yes" : "No"}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <a href={`https://store-${store.storeHash}.mybigcommerce.com/manage`} target="_blank" rel="noopener noreferrer" style={{ color: ink, textDecoration: "none", fontSize: "12px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>
                        {store.storeHash}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {stores.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px", color: muted }}>
            <p style={{ fontSize: "18px" }}>No stores have installed the app yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
