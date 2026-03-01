import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticateAdmin } from "../bigcommerce.server";
import { getChannels, getSites } from "../services/bigcommerce-api.server";
import { saveSettings, getSettings } from "../models/settings.server";

/**
 * Multi-Storefront Channels API
 *
 * GET: List all channels for the store with their site URLs
 * POST: Set the active channel ID
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { storeHash } = await authenticateAdmin(request);

  try {
    const channels = await getChannels(storeHash);
    const settings = await getSettings(storeHash);

    // Enrich channels with site URLs
    const enriched = await Promise.all(
      channels.map(async (channel) => {
        let siteUrl = "";
        try {
          const sites = await getSites(storeHash, channel.id);
          if (sites.length > 0) {
            siteUrl = sites[0].urls?.primary || sites[0].url || "";
          }
        } catch {
          // Some channels (e.g. POS) don't have sites
        }

        return {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          platform: channel.platform,
          status: channel.status,
          siteUrl,
          isActive: channel.id === (settings as Record<string, unknown>).activeChannelId,
        };
      })
    );

    return json({
      channels: enriched,
      activeChannelId: (settings as Record<string, unknown>).activeChannelId || null,
    });
  } catch (error) {
    return json(
      { error: "Failed to fetch channels", details: (error as Error).message },
      { status: 500 }
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const { storeHash } = await authenticateAdmin(request);

  try {
    const body = await request.json();
    const { activeChannelId } = body;

    if (activeChannelId !== null && typeof activeChannelId !== "number") {
      return json({ error: "activeChannelId must be a number or null" }, { status: 400 });
    }

    // Fetch all channels and store their IDs
    const channels = await getChannels(storeHash);
    const channelIds = JSON.stringify(channels.map((c) => c.id));

    await saveSettings(storeHash, {
      activeChannelId,
      channelIds,
    });

    return json({ success: true, activeChannelId, channelIds });
  } catch (error) {
    return json(
      { error: "Failed to update channel", details: (error as Error).message },
      { status: 500 }
    );
  }
};
