import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Remove stored shop data for hygiene (settings and optional analytics)
  try {
    await db.settings.deleteMany({ where: { shop } });
  await (db as Record<string, { deleteMany?: (args: { where: { shop: string } }) => Promise<unknown> }>).cartEvent?.deleteMany?.({ where: { shop } }).catch((_e: unknown) => { /* ignore to ensure webhook 200s */ });
  } catch (_e) {
    // ignore to ensure webhook 200s
  }

  return new Response();
};
