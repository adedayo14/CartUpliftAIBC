import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  return json({ ok: true, method: "GET", url: request.url, ts: new Date().toISOString() });
}

export async function action({ request }: ActionFunctionArgs) {
  return json({ ok: true, method: request.method, url: request.url, ts: new Date().toISOString() });
}
