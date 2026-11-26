import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  acknowledgeCustomerPrivacy,
  redactShop,
} from "../services/compliance.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload, webhookId } =
    await authenticate.webhook(request);
  if (topic === "SHOP_REDACT") {
    const id = String(payload.shop_id ?? "");
    if (!/^\d+$/.test(id)) return new Response(null, { status: 400 });
    await redactShop(shop, `gid://shopify/Shop/${id}`, webhookId);
  } else if (
    topic === "CUSTOMERS_DATA_REQUEST" ||
    topic === "CUSTOMERS_REDACT"
  ) {
    await acknowledgeCustomerPrivacy(webhookId, topic);
  } else return new Response(null, { status: 400 });
  return new Response(null, { status: 200 });
}
