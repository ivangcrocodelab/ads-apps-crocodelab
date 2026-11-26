import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { invitationShop } from "../services/partners.server";
export async function loader({ params }: LoaderFunctionArgs) {
  const shop = await invitationShop(params.token ?? "");
  if (!shop)
    throw new Response("Invitation expired or unavailable", { status: 404 });
  const installUrl = process.env.SHOPIFY_APP_STORE_URL;
  if (installUrl) {
    const url = new URL(installUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "apps.shopify.com" ||
      url.username ||
      url.password
    )
      throw new Error(
        "SHOPIFY_APP_STORE_URL must be a Shopify App Store listing URL",
      );
  }
  return { name: shop.name, token: params.token, installUrl };
}
export default function Invite() {
  const data = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: 24 }}>
      <h1>Partner invitation from {data.name}</h1>
      <h2>1. Install or open the app</h2>
      {data.installUrl ? (
        <a href={data.installUrl} target="_blank" rel="noreferrer">
          Continue to installation in Shopify
        </a>
      ) : (
        <p>
          Installation is not available yet. If you already installed the app,
          open it in your Shopify admin.
        </p>
      )}
      {data.installUrl && (
        <p>
          Shopify opens in a new tab. Complete installation there, then return
          to this invitation tab to copy your code. Keep this page open until
          you finish.
        </p>
      )}
      <h2>2. Connect with your partner</h2>
      <p>
        Open this app in your Shopify admin, go to Partners or Display partners,
        and paste this invitation code:
      </p>
      <code>{data.token}</code>
      <p>
        An invitation does not approve advertising: both stores must choose
        matching categories and grant permission.
      </p>
    </main>
  );
}
