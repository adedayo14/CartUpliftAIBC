import { type ActionFunctionArgs } from "@remix-run/node";
import { getSession, destroySession } from "~/utils/superadmin-session.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await getSession(request.headers.get("Cookie"));
  
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": await destroySession(session),
      Location: "/superadmin/login",
    },
  });
};
