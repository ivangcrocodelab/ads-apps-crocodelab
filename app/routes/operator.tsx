import { randomUUID } from "node:crypto";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import {
  authenticateOperator,
  operatorChange,
  operatorCsrf,
  verifyOperatorPost,
} from "../services/operator.server";
export const headers: HeadersFunction = () => ({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
});
export async function loader({ request }: LoaderFunctionArgs) {
  authenticateOperator(request);
  return {
    csrf: operatorCsrf(),
    key: randomUUID(),
    shops: await db.shop.findMany({
      include: { account: true, products: true },
      orderBy: { name: "asc" },
    }),
    operations: await db.creditOperation.findMany({
      include: {
        entries: {
          include: {
            account: { include: { shop: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  authenticateOperator(request);
  const form = await request.formData();
  verifyOperatorPost(request, form);
  return operatorChange(form);
}
export default function Operator() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const fields = (shopId: string, intent: string) => (
    <>
      <input type="hidden" name="csrf" value={data.csrf} />
      <input type="hidden" name="shopId" value={shopId} />
      <input type="hidden" name="intent" value={intent} />
    </>
  );
  return (
    <main
      style={{ maxWidth: 960, padding: 24, margin: "auto", lineHeight: 1.6 }}
    >
      <h1>Partner ads — operator</h1>
      {result && (
        <p role="status">{"error" in result ? result.error : "Saved"}</p>
      )}
      {!data.shops.length && <p>No stores installed.</p>}
      {data.shops.map((shop) => (
        <section
          key={shop.id}
          style={{ borderBottom: "1px solid #ccc", padding: "1rem 0" }}
        >
          <h2>{shop.name}</h2>
          <p>
            {shop.domain} ·{" "}
            {shop.uninstalledAt
              ? "Uninstalled"
              : shop.blocked
                ? "Blocked"
                : "Approved automatically"}{" "}
            · {shop.account?.balance ?? 0} credits
          </p>
          {!shop.uninstalledAt && (
            <>
              <Form method="post">
                {fields(shop.id, shop.blocked ? "approve" : "block")}
                <button type="submit">
                  {shop.blocked ? "Approve / unblock" : "Block store"}
                </button>
              </Form>
              <Form method="post">
                {fields(shop.id, "promo")}
                <input type="hidden" name="key" value={data.key} />
                <label>
                  Promo credits{" "}
                  <input
                    type="number"
                    name="amount"
                    min="1"
                    max="1000000"
                    required
                  />
                </label>
                <label>
                  Reason <input name="reason" maxLength={500} required />
                </label>
                <button type="submit">Grant credits</button>
              </Form>
              {shop.products.map((p) => (
                <Form method="post" key={p.id}>
                  {fields(shop.id, p.hidden ? "show" : "hide")}
                  <input type="hidden" name="productId" value={p.id} />
                  <span>
                    {p.title} {p.selected ? "" : "(not selected)"}{" "}
                  </span>
                  <button type="submit">
                    {p.hidden ? "Allow product" : "Hide product"}
                  </button>
                </Form>
              ))}
            </>
          )}
        </section>
      ))}
      <h2>Last 100 credit operations</h2>
      {data.operations.map((op) => (
        <section key={op.id}>
          <p>
            {new Date(op.createdAt).toISOString()} · {op.kind} · {op.reason}
          </p>
          <ul>
            {op.entries.map((e) => (
              <li key={e.id}>
                {e.account.shop.name}: {e.amount > 0 ? "+" : ""}
                {e.amount}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
