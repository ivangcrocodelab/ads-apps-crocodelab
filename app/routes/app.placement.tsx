import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { merchantContext } from "../services/merchant.server";
import { changePartners, partnersPage } from "../services/partners.server";
import { Partners } from "../components/partners";
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await merchantContext(request);
  return partnersPage(
    session.shop,
    "publisher",
    new URL(request.url).searchParams.get("invite") ?? "",
  );
}
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await merchantContext(request);
  return changePartners(session.shop, "publisher", await request.formData());
}
export default function Page() {
  return (
    <Partners data={useLoaderData<typeof loader>()} partnerRole="publisher" />
  );
}
