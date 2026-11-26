import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchProducts,
  listProducts,
  productData,
} from "../app/services/products.server";

test("published products without onlineStoreUrl remain selectable and verifiable", async () => {
  const product = {
    id: "gid://shopify/Product/1",
    title: "Published product",
    status: "ACTIVE",
    handle: "published-product",
    publishedAt: "2023-01-01T00:00:00Z",
    onlineStoreUrl: null,
    featuredMedia: {
      preview: { image: { url: "https://cdn.shopify.com/product.jpg" } },
    },
    variants: { nodes: [{ availableForSale: true }] },
  };
  const nodes = [
    product,
    { ...product, publishedAt: null },
    { ...product, publishedAt: "2999-01-01T00:00:00Z" },
    { ...product, onlineStoreUrl: "https://custom.example/products/original" },
  ];
  const pageInfo = { hasNextPage: true, endCursor: "next" };
  const admin = {
    graphql: async () =>
      Response.json({
        data: {
          shop: { primaryDomain: { url: "https://store.example" } },
          nodes: [...nodes, null],
          products: { nodes, pageInfo },
        },
      }),
  } as unknown as Parameters<typeof listProducts>[0];
  const list = await listProducts(admin, null);
  assert.deepEqual(list.pageInfo, pageInfo);
  assert.deepEqual(
    list.nodes.map((p) => p.onlineStoreUrl),
    [
      "https://store.example/products/published-product",
      null,
      null,
      "https://custom.example/products/original",
    ],
  );
  const verified = await fetchProducts(admin, [product.id]);
  assert.equal(
    productData(verified[0])?.productUrl,
    list.nodes[0].onlineStoreUrl,
  );
  assert.equal(productData(verified[1]), null);
  assert.equal(productData(verified[2]), null);
  assert.equal(verified[4], null);
  assert.equal(productData({ ...verified[0]!, status: "DRAFT" }), null);
  assert.equal(
    productData({
      ...verified[0]!,
      variants: { nodes: [{ availableForSale: false }] },
    }),
    null,
  );
  assert.equal(productData({ ...verified[0]!, featuredMedia: null }), null);
});

test("availability beyond the first 100 variants is checked until found", async () => {
  const calls: unknown[] = [];
  const admin = {
    graphql: async (_query: string, options: { variables: unknown }) => {
      calls.push(options.variables);
      const variants = {
        nodes: [{ availableForSale: calls.length === 3 }],
        pageInfo: { hasNextPage: true, endCursor: `page-${calls.length}` },
      };
      return Response.json({
        data:
          calls.length === 1
            ? { nodes: [{ id: "gid://shopify/Product/1", variants }] }
            : { product: { variants } },
      });
    },
  } as unknown as Parameters<typeof fetchProducts>[0];
  const products = await fetchProducts(admin, ["gid://shopify/Product/1"]);
  assert.equal(products[0]?.variants.nodes[0].availableForSale, true);
  assert.deepEqual(calls.slice(1), [
    { id: "gid://shopify/Product/1", after: "page-1" },
    { id: "gid://shopify/Product/1", after: "page-2" },
  ]);
});

test("a failed variants page rejects partial verification", async () => {
  let calls = 0;
  const admin = {
    graphql: async () =>
      Response.json(
        ++calls === 1
          ? {
              data: {
                nodes: [
                  {
                    id: "gid://shopify/Product/1",
                    variants: {
                      nodes: [{ availableForSale: false }],
                      pageInfo: { hasNextPage: true, endCursor: "next" },
                    },
                  },
                ],
              },
            }
          : { errors: [{ message: "unavailable" }] },
      ),
  } as unknown as Parameters<typeof fetchProducts>[0];
  await assert.rejects(
    fetchProducts(admin, ["gid://shopify/Product/1"]),
    /Variant verification unavailable/,
  );
});
