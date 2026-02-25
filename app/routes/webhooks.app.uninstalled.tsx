import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook, cleanupStorefrontScripts } from "../bigcommerce.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { storeHash, payload } = await authenticateWebhook(request);

  console.log(`Received uninstalled webhook for ${storeHash}`);

  await cleanupStorefrontScripts(storeHash);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  const session = await db.session.findFirst({ where: { storeHash } });
  if (session) {
    await db.session.deleteMany({ where: { storeHash } });
  }

  await db.storeUser.deleteMany({ where: { storeHash } });

  // Remove stored shop data for hygiene (settings and optional analytics)
  try {
    await db.settings.deleteMany({ where: { storeHash } });
  await (db as Record<string, { deleteMany?: (args: { where: { storeHash: string } }) => Promise<unknown> }>).cartEvent?.deleteMany?.({ where: { storeHash } }).catch((_e: unknown) => { /* ignore to ensure webhook 200s */ });
  } catch (_e) {
    // ignore to ensure webhook 200s
  }

  return new Response();
};
