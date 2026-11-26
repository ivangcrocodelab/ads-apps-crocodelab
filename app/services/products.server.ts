import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { lockShops } from "./locks.server";
import { getInstalledShop } from "./shops.server";
import { reportError } from "./diagnostics.server";

type Admin = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];
export const PRODUCT_QUERY = `#graphql
  query AdvertisingProducts($ids: [ID!]!) {
    shop { primaryDomain { url } }
    nodes(ids: $ids) { ... on Product {
      id title status handle publishedAt onlineStoreUrl featuredMedia { preview { image { url } } }
      variants(first: 100) {
        nodes { availableForSale }
        pageInfo { hasNextPage endCursor }
      }
    } }
  }`;
export const PRODUCT_VARIANTS_QUERY = `#graphql
  query AdvertisingProductVariants($id: ID!, $after: String!) {
    product(id: $id) {
      variants(first: 100, after: $after) {
        nodes { availableForSale }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
export const PRODUCT_LIST = `#graphql
  query AdvertisingProductList($after: String) {
    shop { primaryDomain { url } }
    products(first: 25, after: $after, query: "status:active") {
      nodes { id title handle publishedAt onlineStoreUrl }
      pageInfo { hasNextPage endCursor }
    }
  }`;
type Product = {
  id: string;
  title: string;
  status: string;
  onlineStoreUrl: string | null;
  handle: string;
  publishedAt: string | null;
  featuredMedia?: {
    preview?: { image?: { url: string } | null } | null;
  } | null;
  variants: {
    nodes: { availableForSale: boolean }[];
    pageInfo?: { hasNextPage: boolean; endCursor: string | null };
  };
};
function httpsUrl(value: string | null | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
// Shopify can omit onlineStoreUrl even for published products (e.g. dev stores).
// Only build a fallback URL when publication to Online Store is confirmed.
function withStoreUrl<
  T extends Pick<Product, "onlineStoreUrl" | "handle" | "publishedAt">,
>(product: T, domain: string | null | undefined): T {
  if (product.onlineStoreUrl) return product;
  const base = httpsUrl(domain);
  if (
    !base ||
    !product.handle ||
    !product.publishedAt ||
    !(Date.parse(product.publishedAt) <= Date.now())
  )
    return product;
  return {
    ...product,
    onlineStoreUrl: new URL(
      `/products/${encodeURIComponent(product.handle)}`,
      base,
    ).toString(),
  };
}
export function productData(product: Product | null) {
  if (!product) return null;
  const productUrl = httpsUrl(product.onlineStoreUrl);
  const imageUrl = httpsUrl(product.featuredMedia?.preview?.image?.url);
  if (
    product.status !== "ACTIVE" ||
    !productUrl ||
    !imageUrl ||
    !product.variants.nodes.some((v) => v.availableForSale)
  )
    return null;
  return {
    title: product.title,
    productUrl,
    imageUrl,
    active: true,
    verifiedAt: new Date(),
  };
}
export async function fetchProducts(admin: Admin, ids: string[]) {
  const result = await (
    await admin.graphql(PRODUCT_QUERY, { variables: { ids } })
  ).json();
  if (
    ("errors" in result &&
      Array.isArray(result.errors) &&
      result.errors.length) ||
    !result.data?.nodes
  )
    throw new Error("Product verification unavailable");
  for (const product of result.data.nodes as (Product | null)[]) {
    if (!product) continue;
    const cursors = new Set<string>();
    while (
      !product.variants.nodes.some((v) => v.availableForSale) &&
      product.variants.pageInfo?.hasNextPage
    ) {
      const after = product.variants.pageInfo.endCursor;
      if (!after || cursors.has(after))
        throw new Error("Invalid variant pagination");
      cursors.add(after);
      const page = await (
        await admin.graphql(PRODUCT_VARIANTS_QUERY, {
          variables: { id: product.id, after },
        })
      ).json();
      if (
        ("errors" in page &&
          Array.isArray(page.errors) &&
          page.errors.length) ||
        !page.data?.product?.variants?.pageInfo
      )
        throw new Error("Variant verification unavailable");
      product.variants = page.data.product.variants;
    }
  }
  return (result.data.nodes as (Product | null)[]).map((product) =>
    product
      ? withStoreUrl(product, result.data?.shop?.primaryDomain?.url)
      : null,
  );
}
export async function listProducts(admin: Admin, after: string | null) {
  const result = await (
    await admin.graphql(PRODUCT_LIST, { variables: { after } })
  ).json();
  if (!result.data?.products) throw new Error("Product list unavailable");
  const products = result.data.products as {
    nodes: Pick<
      Product,
      "id" | "title" | "onlineStoreUrl" | "handle" | "publishedAt"
    >[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  return {
    ...products,
    nodes: products.nodes.map((product) =>
      withStoreUrl(product, result.data?.shop?.primaryDomain?.url),
    ),
  };
}
export async function addProducts(
  domain: string,
  admin: Admin,
  ids: string[],
  rights: boolean,
) {
  const shop = await getInstalledShop(domain);
  const unique = [...new Set(ids)];
  if (!rights)
    return { error: "Confirm your rights to the images and content." };
  if (
    !unique.length ||
    unique.length > 10 ||
    unique.some((id) => !/^gid:\/\/shopify\/Product\/\d+$/.test(id))
  )
    return { error: "Select between 1 and 10 products." };
  let products: (Product | null)[];
  try {
    products = await fetchProducts(admin, unique);
  } catch {
    return { error: "Shopify could not verify these products. Try again." };
  }
  if (
    products.some((p) => !productData(p)) ||
    products.length !== unique.length
  )
    return {
      error:
        "Only published, available products with an image can be advertised.",
    };
  return db.$transaction(async (tx) => {
    await lockShops(tx, [shop.id]);
    const current = await tx.shop.findUniqueOrThrow({ where: { id: shop.id } });
    if (current.uninstalledAt || current.blocked)
      return { error: "Store unavailable" };
    const existing = await tx.productAd.findMany({
      where: { shopId: shop.id, selected: true },
    });
    if (new Set([...existing.map((p) => p.productId), ...unique]).size > 10)
      return {
        error: "Remove a product first. Maximum: 10 selected products.",
      };
    for (const product of products) {
      if (!product || !unique.includes(product.id))
        throw new Error("Unexpected product response");
      const data = productData(product)!;
      await tx.productAd.upsert({
        where: { shopId_productId: { shopId: shop.id, productId: product.id } },
        create: {
          shopId: shop.id,
          productId: product.id,
          ...data,
          rightsConfirmedAt: new Date(),
        },
        update: {
          ...data,
          selected: true,
          rightsConfirmedAt: new Date(),
          revision: { increment: 1 },
        },
      });
    }
    return { saved: true };
  });
}
export async function removeProduct(domain: string, id: string) {
  const shop = await getInstalledShop(domain);
  await db.$transaction(async (tx) => {
    await lockShops(tx, [shop.id]);
    await tx.productAd.updateMany({
      where: { id, shopId: shop.id },
      data: {
        selected: false,
        active: false,
        verifiedAt: null,
        revision: { increment: 1 },
      },
    });
  });
}
// Called before every issuance and paid click. A failed API check always hides the ad.
export async function refreshProducts(domain: string) {
  const shop = await getInstalledShop(domain);
  if (shop.blocked) return false;
  const records = await db.productAd.findMany({
    where: { shopId: shop.id, selected: true },
  });
  if (!records.length) return true;
  let products: (Product | null)[] = [];
  let verified = false;
  try {
    const { admin } = await unauthenticated.admin(domain);
    products = await fetchProducts(
      admin,
      records.map((p) => p.productId),
    );
    verified = true;
  } catch {
    reportError("PRODUCT_VERIFICATION_FAILED");
  }
  await db.$transaction(async (tx) => {
    await lockShops(tx, [shop.id]);
    for (const record of records) {
      const data = productData(
        products.find((p) => p?.id === record.productId) ?? null,
      );
      const changed =
        data &&
        (record.title !== data.title ||
          record.productUrl !== data.productUrl ||
          record.imageUrl !== data.imageUrl);
      // A concurrent webhook increments revision: an older API response cannot undo it.
      await tx.productAd.updateMany({
        where: { id: record.id, revision: record.revision },
        data: data
          ? { ...data, ...(changed ? { revision: { increment: 1 } } : {}) }
          : { active: false, verifiedAt: null, revision: { increment: 1 } },
      });
    }
  });
  return verified;
}
export async function productWebhook(
  domain: string,
  productId: string,
  receipt: string,
  deleted: boolean,
) {
  await db.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { domain } });
    if (!shop) return;
    await lockShops(tx, [shop.id]);
    if (await tx.webhookReceipt.findUnique({ where: { id: receipt } })) return;
    await tx.webhookReceipt.create({
      data: {
        id: receipt,
        topic: deleted ? "products/delete" : "products/update",
      },
    });
    await tx.productAd.updateMany({
      where: { shopId: shop.id, productId },
      data: { active: false, verifiedAt: null, revision: { increment: 1 } },
    });
  });
}
