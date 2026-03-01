import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticateAdmin, bigcommerceApi } from "~/bigcommerce.server";
import { logger } from "~/utils/logger.server";

/**
 * GET  /api/webhooks-manage  — List all webhooks for this store
 * POST /api/webhooks-manage  — Reactivate inactive webhooks
 */

interface BCWebhook {
  id: number;
  scope: string;
  destination: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { storeHash } = await authenticateAdmin(request);
    if (!storeHash) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = await bigcommerceApi(storeHash, "/hooks", { method: "GET" });
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      logger.error("Failed to list webhooks", { storeHash, status: response.status, err });
      return json({ error: "Failed to fetch webhooks" }, { status: 500 });
    }

    const body = await response.json();
    const hooks: BCWebhook[] = body.data || body || [];

    return json({
      hooks: hooks.map((h: BCWebhook) => ({
        id: h.id,
        scope: h.scope,
        destination: h.destination,
        is_active: h.is_active,
        created_at: h.created_at,
        updated_at: h.updated_at,
      })),
    });
  } catch (error) {
    logger.error("Webhook list error", { error });
    return json({ error: "Internal error" }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { storeHash } = await authenticateAdmin(request);
    if (!storeHash) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const actionType = body.action;

    if (actionType === "reactivate_all") {
      // List hooks, reactivate any inactive ones
      const listRes = await bigcommerceApi(storeHash, "/hooks", { method: "GET" });
      if (!listRes.ok) {
        return json({ error: "Failed to list webhooks" }, { status: 500 });
      }

      const listBody = await listRes.json();
      const hooks: BCWebhook[] = listBody.data || listBody || [];
      const inactive = hooks.filter((h: BCWebhook) => !h.is_active);

      if (inactive.length === 0) {
        return json({ success: true, message: "All webhooks are already active", reactivated: 0 });
      }

      const results = [];
      for (const hook of inactive) {
        const putRes = await bigcommerceApi(storeHash, `/hooks/${hook.id}`, {
          method: "PUT",
          body: { is_active: true },
        });

        if (putRes.ok) {
          logger.info("Webhook reactivated", { storeHash, hookId: hook.id, scope: hook.scope });
          results.push({ id: hook.id, scope: hook.scope, status: "reactivated" });
        } else {
          const errText = await putRes.text().catch(() => "");
          logger.error("Failed to reactivate webhook", { storeHash, hookId: hook.id, error: errText });
          results.push({ id: hook.id, scope: hook.scope, status: "failed", error: errText });
        }
      }

      return json({ success: true, reactivated: results.filter(r => r.status === "reactivated").length, results });

    } else if (actionType === "reactivate" && body.hookId) {
      // Reactivate a specific hook
      const hookId = Number(body.hookId);
      const putRes = await bigcommerceApi(storeHash, `/hooks/${hookId}`, {
        method: "PUT",
        body: { is_active: true },
      });

      if (putRes.ok) {
        logger.info("Webhook reactivated", { storeHash, hookId });
        return json({ success: true, message: `Webhook ${hookId} reactivated` });
      } else {
        const errText = await putRes.text().catch(() => "");
        logger.error("Failed to reactivate webhook", { storeHash, hookId, error: errText });
        return json({ error: `Failed to reactivate: ${errText}` }, { status: 500 });
      }
    }

    return json({ error: "Invalid action. Use 'reactivate_all' or 'reactivate' with hookId." }, { status: 400 });
  } catch (error) {
    logger.error("Webhook manage action error", { error });
    return json({ error: "Internal error" }, { status: 500 });
  }
}
