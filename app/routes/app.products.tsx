import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { merchantContext } from "../services/merchant.server";
import db from "../db.server";
import { getInstalledShop } from "../services/shops.server";
import {
  addProducts,
  listProducts,
  refreshProducts,
  removeProduct,
} from "../services/products.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await merchantContext(request);
  const shop = await getInstalledShop(session.shop);
  let available = null;
  try {
    available = await listProducts(
      admin,
      new URL(request.url).searchParams.get("after"),
    );
  } catch {
    /* UI shows retry. */
  }
  return {
    selected: await db.productAd.findMany({
      where: { shopId: shop.id, selected: true },
      orderBy: { title: "asc" },
    }),
    available,
    name: shop.name,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await merchantContext(request);
  const form = await request.formData();
  if (form.get("intent") === "remove") {
    await removeProduct(session.shop, String(form.get("id")));
    return { saved: true };
  }
  if (form.get("intent") === "refresh") {
    await refreshProducts(session.shop);
    return { saved: true };
  }
  return addProducts(
    session.shop,
    admin,
    form.getAll("products").map(String),
    form.get("rights") === "true",
  );
}

const paginationLinkStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "8px 16px",
  border: "1px solid #ccc",
  borderRadius: 8,
  textDecoration: "none",
  color: "inherit",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
};

export default function Products() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";

  return (
    <s-page heading="My products">
      {fetcher.data && "error" in fetcher.data && (
        <s-banner tone="critical">{fetcher.data.error}</s-banner>
      )}

      <s-section heading={`Selected products (${data.selected.length}/10)`}>
        {!data.selected.length && (
          <s-paragraph>
            Select published products below to start setting up your ads.
          </s-paragraph>
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            marginBottom: 16,
          }}
        >
          {data.selected.map((p) => (
            <div key={p.id} style={cardStyle}>
              <s-box padding="base" border="base" borderRadius="base">
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ width: 160, flexShrink: 0 }}>
                    <s-image
                      src={p.imageUrl}
                      alt={p.title}
                      aspectRatio="4/3"
                      objectFit="contain"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <s-stack direction="block" gap="small">
                      <s-heading>{p.title}</s-heading>
                      <s-paragraph>
                        {data.name} ·{" "}
                        {p.hidden
                          ? "Hidden by operator"
                          : p.active && p.verifiedAt
                            ? "Verified; checked again before serving"
                            : "Unavailable or awaiting verification"}
                      </s-paragraph>
                      <div
                        style={{
                          display: "flex",
                          gap: 16,
                          alignItems: "center",
                        }}
                      >
                        <s-link href={p.productUrl} target="_blank">
                          Original product
                        </s-link>
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="remove" />
                          <input type="hidden" name="id" value={p.id} />
                          <s-button type="submit" disabled={busy}>
                            Remove
                          </s-button>
                        </fetcher.Form>
                      </div>
                    </s-stack>
                  </div>
                </div>
              </s-box>
            </div>
          ))}
        </div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="refresh" />
          <s-button type="submit" disabled={busy}>
            Verify selected products
          </s-button>
        </fetcher.Form>
      </s-section>
      <s-section heading="Choose products">
        {!data.available && (
          <s-banner tone="warning">
            Shopify products could not be loaded. Reload to try again.
          </s-banner>
        )}
        {data.available && (
          <fetcher.Form method="post">
            <div
              style={{
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <s-checkbox
                name="rights"
                value="true"
                label="I have the rights so use the selected product images and content in partner advertising."
                required
              />
            </div>
            <s-stack direction="block" gap="base">
              {data.available.nodes
                .filter((p) => p.onlineStoreUrl)
                .map((p) => (
                  <s-checkbox
                    key={p.id}
                    label={p.title}
                    name="products"
                    value={p.id}
                    disabled={data.selected.some((s) => s.productId === p.id)}
                  />
                ))}
              {!data.available.nodes.some((p) => p.onlineStoreUrl) && (
                <s-paragraph>No published products on this page.</s-paragraph>
              )}
              <s-button type="submit" disabled={busy}>
                Add selected products 
              </s-button>
            </s-stack>
          </fetcher.Form>
        )}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginTop: 16,
          }}
        >
          {data.available?.pageInfo.hasNextPage && (
            <Link
              to={`?after=${encodeURIComponent(data.available.pageInfo.endCursor ?? "")}`}
              style={paginationLinkStyle}
            >
              Next page
            </Link>
          )}
          <Link to="/app/products" style={paginationLinkStyle}>
            First page
          </Link>
        </div>
      </s-section>
    </s-page>
  );
}