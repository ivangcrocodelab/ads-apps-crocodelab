import type { LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";
export async function loader({ request }: LoaderFunctionArgs) {
  if (new URL(request.url).searchParams.has("shop")) await login(request);
  return null;
}
export default function Auth() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Open the app from Shopify</h1>
      <p>
        Installation and sign-in start in Shopify. Choose this app in your
        store&apos;s Apps menu.
      </p>
      <a href="https://admin.shopify.com/">Open Shopify admin</a>
    </main>
  );
}
