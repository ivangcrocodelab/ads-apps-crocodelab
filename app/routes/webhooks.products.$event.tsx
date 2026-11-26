import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { productWebhook } from "../services/products.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, topic, webhookId } =
    await authenticate.webhook(request);
  if (topic !== "PRODUCTS_UPDATE" && topic !== "PRODUCTS_DELETE")
    return new Response(null, { status: 400 });
  const id =
    payload.admin_graphql_api_id ?? `gid://shopify/Product/${payload.id}`;
  if (typeof id !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(id))
    return new Response(null, { status: 400 });
  await productWebhook(shop, id, webhookId, topic === "PRODUCTS_DELETE");
  return new Response(null, { status: 200 });
}
