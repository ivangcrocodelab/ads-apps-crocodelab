import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import styles from "./styles.module.css";
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.get("shop"))
    throw redirect(`/app?${url.searchParams.toString()}`);
  return null;
}
export default function Index() {
  return (
    <main className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Affiliate advertising</h1>
        <p>Exchange advertising clicks with approved Shopify partners.</p>
        <p>
          Install this app from Shopify, then open it in your Shopify admin.
        </p>
        <a href="https://admin.shopify.com/">Open Shopify admin</a>
      </div>
    </main>
  );
}
