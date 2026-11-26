import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { automaticRequest, issueAds } from "../services/ads.server";
import { reportError } from "../services/diagnostics.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  try {
    const { session } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const timestamp = Number(url.searchParams.get("timestamp"));
    if (
      !session ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 300 ||
      automaticRequest(request) ||
      url.searchParams.get("consent") !== "1"
    )
      return Response.json({ cards: [] }, { headers });
    const cards = await issueAds(session.shop);
    return Response.json({ cards, serverTime: Date.now() }, { headers });
  } catch {
    reportError("ADS_REQUEST_FAILED");
    return Response.json({ cards: [] }, { headers });
  }
}
