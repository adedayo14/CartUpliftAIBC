import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticateWebhook } from "../bigcommerce.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { storeHash, payload } = await authenticateWebhook(request);
    console.log(`Received scopes_update webhook for ${storeHash}`);

    const current = payload.current as string[];
    const session = await db.session.findFirst({ where: { storeHash } });
    if (session) {
        await db.session.update({
            where: {
                id: session.id
            },
            data: {
                scope: current.toString(),
            },
        });
    }
    return new Response();
};
