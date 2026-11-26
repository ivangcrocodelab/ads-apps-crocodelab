import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { merchantContext } from "../services/merchant.server";
import { setupStatus } from "../services/setup.server";
import { statistics } from "../services/statistics.server";
import {
  getInstalledShop,
  NICHES,
  saveSettings,
} from "../services/shops.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await merchantContext(request);
  const shop = await getInstalledShop(session.shop);
  return {
    shop: { ...shop, updatedAt: shop.updatedAt.toISOString() },
    niches: NICHES,
    status: await setupStatus(shop.id),
    stats: await statistics(shop.id),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await merchantContext(request);
  if (request.method !== "POST") throw new Response(null, { status: 405 });
  return saveSettings(session.shop, await request.formData());
};

export default function Index() {
  const { shop, niches, status, stats } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const form = useRef<HTMLFormElement>(null);
  const [editedVersion, setEditedVersion] = useState<string | null>(null);
  const dirty = editedVersion === shop.updatedAt;

  // Listen to the custom elements' native form-change events.
  useEffect(() => {
    const element = form.current;
    const changed = () => setEditedVersion(shop.updatedAt);
    element?.addEventListener("change", changed);
    return () => element?.removeEventListener("change", changed);
  }, [shop.updatedAt]);

  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="Affiliate advertising">
      <s-section heading={shop.name}>
        <s-paragraph>Balance: {shop.account?.balance ?? 0} credits</s-paragraph>
        {shop.blocked && (
          <s-banner tone="critical">
            The store has been blocked by the operator. Advertising has been
            stopped.
          </s-banner>
        )}
      </s-section>

      <s-section heading="Store settings">
        <form
          ref={form}
          onSubmit={(event) => {
            event.preventDefault();
            fetcher.submit(new FormData(event.currentTarget), {
              method: "POST",
            });
          }}
        >
          <s-stack direction="block" gap="base">
            <s-select
              key={`niche-${shop.updatedAt}`}
              label="Primary niche"
              name="niche"
              value={shop.niche ?? ""}
              required
              disabled={shop.blocked || busy}
            >
              <s-option value="">Choose a niche</s-option>
              {niches.map((niche) => (
                <s-option key={niche} value={niche}>
                  {niche}
                </s-option>
              ))}
            </s-select>
            <s-switch
              key={`advertiser-${shop.updatedAt}`}
              label="Advertise my products"
              name="advertiserEnabled"
              value="true"
              checked={shop.advertiserEnabled}
              disabled={shop.blocked || busy}
            />
            <s-switch
              key={`publisher-${shop.updatedAt}`}
              label="Display partners on your site"
              name="publisherEnabled"
              value="true"
              checked={shop.publisherEnabled}
              disabled={shop.blocked || busy}
            />
            <s-paragraph>
              The roles are independent. You do not need to include an affiliate
              block to advertise your own products.
            </s-paragraph>
            <s-button
              type="submit"
              variant="primary"
              disabled={shop.blocked || busy || !dirty}
            >
              Save
            </s-button>
            {fetcher.data && "error" in fetcher.data && (
              <s-banner tone="critical">{fetcher.data.error}</s-banner>
            )}
            {fetcher.data && "saved" in fetcher.data && !dirty && (
              <s-paragraph>Settings saved.</s-paragraph>
            )}
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Setup status">
        {status.map((message) => (
          <s-paragraph key={message}>{message}</s-paragraph>
        ))}
      </s-section>

      <s-section heading="Activity summary">
        <s-paragraph>
          Spent: {stats.spent} credits. Earned from clicks: {stats.earned}{" "}
          credits.
        </s-paragraph>
        <s-paragraph>
          Block loads: {stats.loads}. Counted incoming clicks: {stats.incoming}.
          Counted outgoing clicks: {stats.outgoing}.
        </s-paragraph>
        <s-paragraph>Block loads are not guaranteed views.</s-paragraph>
        <s-link href="/app/balance">Balance and statistics</s-link>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (args) => boundary.headers(args);