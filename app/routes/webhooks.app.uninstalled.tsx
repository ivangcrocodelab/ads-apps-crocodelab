import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { uninstallShop } from "../services/shops.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, webhookId } = await authenticate.webhook(request);
  const triggered = request.headers.get("x-shopify-triggered-at");
  await uninstallShop(
    shop,
    webhookId,
    triggered ? new Date(triggered) : undefined,
  );
  return new Response(null, { status: 200 });
};
