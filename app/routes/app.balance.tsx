import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { merchantContext } from "../services/merchant.server";
import { getInstalledShop } from "../services/shops.server";
import { statistics } from "../services/statistics.server";
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await merchantContext(request);
  return statistics((await getInstalledShop(session.shop)).id);
}
export default function Balance() {
  const data = useLoaderData<typeof loader>();
  return (
    <s-page heading="Balance and statistics">
      <s-section heading="Credits">
        <s-paragraph>
          Current balance: {data.balance} · Spent: {data.spent} · Earned from
          partner clicks: {data.earned}
        </s-paragraph>
        <s-paragraph>
          1 counted click = 1 credit. Starter and promotional credits are not
          click earnings.
        </s-paragraph>
      </s-section>
      <s-section heading="Activity">
        <s-paragraph>Block loads: {data.loads}</s-paragraph>
        <s-paragraph>
          Counted incoming clicks to your products: {data.incoming}
        </s-paragraph>
        <s-paragraph>
          Counted outgoing clicks from your store: {data.outgoing}
        </s-paragraph>
        <s-paragraph>
          Block loads are requests for offers, not guaranteed views. Loads and
          clicks are counted separately. No orders or revenue are tracked.
        </s-paragraph>
      </s-section>
      <s-section heading="Last 50 credit operations">
        {!data.operations.length && (
          <s-paragraph>No credit operations yet.</s-paragraph>
        )}
        {data.operations.map((e) => (
          <s-box padding="base" key={e.id}>
            <s-paragraph>
              {new Date(e.operation.createdAt).toISOString()} ·{" "}
              {e.amount > 0 ? "+" : ""}
              {e.amount} · {e.operation.reason}
            </s-paragraph>
          </s-box>
        ))}
      </s-section>
    </s-page>
  );
}
