import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getInstalledShop, registerInstallation } from "./shops.server";

export async function merchantContext(request: Request) {
  const context = await authenticate.admin(request);
  // Recover if OAuth saved its session but profile creation was interrupted.
  // Never reactivate an uninstalled profile from a route request.
  if (
    !(await db.shop.findUnique({ where: { domain: context.session.shop } }))
  ) {
    const result = await (
      await context.admin.graphql(`#graphql
      query InstallationShop { shop { id name myshopifyDomain } }
    `)
    ).json();
    const profile = result.data?.shop;
    if (!profile || profile.myshopifyDomain !== context.session.shop)
      throw new Response("Store verification unavailable. Please retry.", {
        status: 503,
      });
    await registerInstallation({
      id: profile.id,
      domain: context.session.shop,
      name: profile.name,
    });
  }
  await getInstalledShop(context.session.shop);
  return context;
}
