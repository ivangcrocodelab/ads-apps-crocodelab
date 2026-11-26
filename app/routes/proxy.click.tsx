import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { automaticRequest, countClick } from "../services/ads.server";
import { reportError } from "../services/diagnostics.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const unavailable = () =>
    new Response(
      "This ad is no longer available. Please return to the store.",
      {
        status: 410,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  try {
    const { session } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const timestamp = Number(url.searchParams.get("timestamp"));
    if (
      !session ||
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 300 ||
      automaticRequest(request) ||
      url.searchParams.get("gesture") !== "1" ||
      url.searchParams.get("consent") !== "1"
    )
      return unavailable();
    const result = await countClick(
      session.shop,
      url.searchParams.get("token") ?? "",
    );
    if (!result) return unavailable();
    return new Response(null, {
      status: 302,
      headers: {
        Location: result.url,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    reportError("CLICK_REQUEST_FAILED");
    return unavailable();
  }
}
