import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../app/db.server";
import {
  registerInstallation,
  uninstallShop,
} from "../app/services/shops.server";
import {
  changePartners,
  getPair,
  invitationShop,
  pairReason,
  partnersPage,
} from "../app/services/partners.server";
import {
  addProducts,
  productWebhook,
  removeProduct,
} from "../app/services/products.server";
import { countClick, issueAds, takeQuota } from "../app/services/ads.server";
import {
  authenticateOperator,
  operatorChange,
  operatorCsrf,
  verifyOperatorPost,
} from "../app/services/operator.server";
import { redactShop } from "../app/services/compliance.server";
import { bonusHash } from "../app/services/identity.server";
import { statistics } from "../app/services/statistics.server";
import { signClick } from "../app/services/tokens.server";

const run = Date.now();
const profiles = [1, 2, 3].map((n) => ({
  id: `gid://shopify/Shop/${run}${n}`,
  domain: `mvp-${run}-${n}.myshopify.com`,
  name: `MVP ${n}`,
}));
const [a, b, c] = profiles;
const productId = `gid://shopify/Product/${run}`;
const form = (values: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values))
    for (const item of Array.isArray(value) ? value : [value])
      data.append(key, item);
  return data;
};
const admin = {
  graphql: async (_query: string, options: { variables: { ids: string[] } }) =>
    Response.json({
      data: {
        nodes: options.variables.ids.map((id) => ({
          id,
          title: "Pet bowl",
          status: "ACTIVE",
          onlineStoreUrl: `https://${a.domain}/products/bowl`,
          featuredMedia: {
            preview: { image: { url: "https://cdn.shopify.com/bowl.jpg" } },
          },
          variants: { nodes: [{ availableForSale: true }] },
        })),
      },
    }),
} as unknown as Parameters<typeof addProducts>[1];
const verified = async (domain: string) => {
  const shop = await db.shop.findUniqueOrThrow({ where: { domain } });
  await db.productAd.updateMany({
    where: { shopId: shop.id },
    data: { verifiedAt: new Date() },
  });
};
async function age(token: string) {
  await db.clickToken.update({
    where: { nonce: token.split(".")[0] },
    data: { createdAt: new Date(Date.now() - 1000) },
  });
}
const receiptIds: string[] = [];
after(async () => {
  for (const profile of profiles) {
    await uninstallShop(profile.domain);
    const receipt = randomUUID();
    receiptIds.push(receipt);
    await redactShop(profile.domain, profile.id, receipt);
    await db.bonusReceipt.deleteMany({
      where: { shopHash: bonusHash(profile.id) },
    });
  }
  await db.webhookReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await db.$disconnect();
});

test("MVP A/B/C acceptance and security", async (t) => {
  for (const p of profiles) await registerInstallation(p);
  await db.shop.update({
    where: { id: a.id },
    data: { niche: "Pets", advertiserEnabled: true, catalogConsent: true },
  });
  await db.shop.update({
    where: { id: b.id },
    data: { niche: "Home", publisherEnabled: true },
  });
  await db.shop.update({
    where: { id: c.id },
    data: {
      niche: "Electronics",
      publisherEnabled: true,
      catalogConsent: true,
    },
  });
  await t.test(
    "catalogue consent, matching categories and bilateral direction",
    async () => {
      assert.ok(
        "error" in
          (await changePartners(
            a.domain,
            "advertiser",
            form({ intent: "agree", partnerId: b.id }),
          )),
      );
      await changePartners(
        b.domain,
        "publisher",
        form({ intent: "catalogue", consent: "true" }),
      );
      await changePartners(
        a.domain,
        "advertiser",
        form({ intent: "agree", partnerId: b.id }),
      );
      await changePartners(
        b.domain,
        "publisher",
        form({ intent: "agree", partnerId: a.id }),
      );
      const pair = await db.partnership.findUniqueOrThrow({
        where: {
          advertiserId_publisherId: { advertiserId: a.id, publisherId: b.id },
        },
      });
      assert.equal(
        pairReason(await getPair(pair.id)),
        "Categories do not match",
      );
      await changePartners(
        a.domain,
        "advertiser",
        form({ intent: "categories", niches: ["Home"] }),
      );
      await changePartners(
        b.domain,
        "publisher",
        form({ intent: "categories", niches: ["Pets"] }),
      );
      assert.equal(pairReason(await getPair(pair.id)), null);
      assert.equal(
        await db.partnership.count({
          where: { advertiserId: b.id, publisherId: a.id },
        }),
        0,
      );
      assert.ok(
        "error" in
          (await changePartners(
            a.domain,
            "advertiser",
            form({ intent: "agree", partnerId: a.id }),
          )),
      );
      const invitation = await changePartners(
        a.domain,
        "advertiser",
        form({ intent: "invite" }),
      );
      assert.ok("invitationUrl" in invitation);
      assert.equal(
        (await invitationShop(invitation.invitationUrl!.split("/").at(-1)!))
          ?.id,
        a.id,
      );
    },
  );
  await t.test("product rights, maximum ten and empty block", async () => {
    assert.equal((await issueAds(b.domain, verified)).length, 0);
    assert.ok(
      "error" in (await addProducts(a.domain, admin, [productId], false)),
    );
    assert.ok(
      "error" in
        (await addProducts(
          a.domain,
          admin,
          Array.from(
            { length: 11 },
            (_, i) => `gid://shopify/Product/${i + 1}`,
          ),
          true,
        )),
    );
    assert.deepEqual(await addProducts(a.domain, admin, [productId], true), {
      saved: true,
    });
  });
  await t.test(
    "all ten selected products participate in rotation",
    async () => {
      const extraIds = Array.from(
        { length: 9 },
        (_, i) => `gid://shopify/Product/${run}9${i}`,
      );
      assert.deepEqual(await addProducts(a.domain, admin, extraIds, true), {
        saved: true,
      });
      const now = Date.now;
      const base = now();
      const seen = new Set<string>();
      try {
        for (let i = 0; i < 10; i++) {
          Date.now = () => base + i * 1000;
          const cards = await issueAds(b.domain, verified);
          assert.equal(cards.length, 3);
          for (const card of cards) {
            const token = await db.clickToken.findUniqueOrThrow({
              where: { nonce: card.token.split(".")[0] },
            });
            seen.add(token.productAdId);
            assert.equal(card.expiresAt, token.expiresAt.getTime());
          }
        }
        assert.equal(seen.size, 10);
      } finally {
        Date.now = now;
        await db.productAd.deleteMany({
          where: { shopId: a.id, productId: { in: extraIds } },
        });
      }
    },
  );
  await t.test(
    "ten advertisers rotate all ten products over 100 seconds",
    async () => {
      const advertisers = Array.from({ length: 10 }, (_, i) => ({
        id: `rotation:${run}:${i}`,
        domain: `rotation-${run}-${i}.myshopify.com`,
        name: `Rotation ${i}`,
      }));
      const publisher = {
        id: `rotation:${run}:publisher`,
        domain: `rotation-${run}-publisher.myshopify.com`,
        name: "Rotation publisher",
      };
      profiles.push(...advertisers, publisher);
      for (const profile of [...advertisers, publisher]) {
        await registerInstallation(profile);
        await db.shop.update({
          where: { id: profile.id },
          data: {
            niche: "Pets",
            advertiserEnabled: true,
            publisherEnabled: true,
            catalogConsent: true,
            categories: {
              create: [
                { role: "advertiser", niche: "Pets" },
                { role: "publisher", niche: "Pets" },
              ],
            },
          },
        });
      }
      for (const advertiser of advertisers) {
        await db.partnership.create({
          data: {
            advertiserId: advertiser.id,
            publisherId: publisher.id,
            selected: true,
            approved: true,
          },
        });
        await db.productAd.createMany({
          data: Array.from({ length: 10 }, (_, i) => ({
            shopId: advertiser.id,
            productId: `product:${i}`,
            title: `Product ${i}`,
            imageUrl: "https://cdn.shopify.com/bowl.jpg",
            productUrl: `https://${advertiser.domain}/products/${i}`,
            active: true,
            selected: true,
            rightsConfirmedAt: new Date(),
            verifiedAt: new Date(),
          })),
        });
      }
      const now = Date.now;
      const base = now();
      const seen = new Map(advertisers.map((p) => [p.name, new Set<string>()]));
      try {
        for (let second = 0; second < 100; second++) {
          Date.now = () => base + second * 1000;
          const cards = await issueAds(publisher.domain, async (domain) => {
            await db.productAd.updateMany({
              where: { shop: { domain } },
              data: { verifiedAt: new Date(Date.now()) },
            });
          });
          assert.equal(cards.length, 3);
          for (const card of cards) seen.get(card.seller)!.add(card.productUrl);
        }
        for (const [seller, products] of seen)
          assert.equal(products.size, 10, seller);
      } finally {
        Date.now = now;
      }
    },
  );
  await t.test("refresh errors emit only a safe diagnostic code", async () => {
    const error = console.error;
    const logs: string[] = [];
    console.error = (value: string) => logs.push(value);
    try {
      const cards = await issueAds(b.domain, async () => {
        throw new Error("secret-token and personal@example.com");
      });
      assert.deepEqual(cards, []);
      assert.deepEqual(
        logs.map((line) => JSON.parse(line)),
        [{ event: "partner_ads_error", code: "ADS_REFRESH_FAILED" }],
      );
    } finally {
      console.error = error;
    }
  });
  await t.test(
    "catalogue shows only eligible products belonging to each partner",
    async () => {
      for (const role of ["advertiser", "publisher"] as const) {
        const page = await partnersPage(b.domain, role);
        const partner = page.catalogue.find((s) => s.id === a.id)!;
        assert.equal(partner.products.length, 1);
        assert.equal(partner.products[0].title, "Pet bowl");
        assert.equal(
          partner.products[0].productUrl,
          `https://${a.domain}/products/bowl`,
        );
        assert.deepEqual(
          page.catalogue.find((s) => s.id === c.id)!.products,
          [],
        );
        assert.ok(!page.catalogue.some((s) => s.id === b.id));
      }
      for (const data of [
        { hidden: true },
        { selected: false },
        { active: false },
        { verifiedAt: null },
      ]) {
        await db.productAd.updateMany({ where: { shopId: a.id }, data });
        const page = await partnersPage(b.domain, "publisher");
        assert.deepEqual(
          page.catalogue.find((s) => s.id === a.id)!.products,
          [],
        );
        await db.productAd.updateMany({
          where: { shopId: a.id },
          data: {
            hidden: false,
            selected: true,
            active: true,
            verifiedAt: new Date(),
          },
        });
      }
    },
  );
  await t.test(
    "one signed click transfers once under concurrent replay",
    async () => {
      const cards = await issueAds(b.domain, verified);
      assert.equal(cards.length, 1);
      assert.equal(
        (await db.shop.findUniqueOrThrow({ where: { id: a.id } }))
          .publisherEnabled,
        false,
      );
      const token = cards[0].token;
      await age(token);
      assert.equal(await countClick(c.domain, token, verified), null);
      assert.equal(
        await countClick(b.domain, token.slice(0, -2) + "xx", verified),
        null,
      );
      const results = await Promise.all(
        Array.from({ length: 8 }, () => countClick(b.domain, token, verified)),
      );
      assert.equal(results.filter((r) => r?.counted).length, 1);
      assert.equal((await statistics(a.id)).balance, 19);
      assert.equal((await statistics(b.id)).balance, 21);
      assert.equal((await statistics(a.id)).incoming, 1);
      assert.equal((await statistics(b.id)).outgoing, 1);
      const operation = await db.creditOperation.findUniqueOrThrow({
        where: { idempotencyKey: `click:${token.split(".")[0]}` },
        include: { entries: true },
      });
      assert.equal(
        operation.entries.reduce((sum, entry) => sum + entry.amount, 0),
        0,
      );
    },
  );
  await t.test("revocation and moderation invalidate old tokens", async () => {
    const token = (await issueAds(b.domain, verified))[0].token;
    await age(token);
    await changePartners(
      b.domain,
      "publisher",
      form({ intent: "revoke", partnerId: a.id }),
    );
    assert.equal((await issueAds(b.domain, verified)).length, 0);
    assert.equal(await countClick(b.domain, token, verified), null);
    await changePartners(
      b.domain,
      "publisher",
      form({ intent: "agree", partnerId: a.id }),
    );
    assert.equal(await countClick(b.domain, token, verified), null);
    const product = await db.productAd.findUniqueOrThrow({
      where: { shopId_productId: { shopId: a.id, productId } },
    });
    await operatorChange(
      form({ intent: "hide", shopId: a.id, productId: product.id }),
    );
    await removeProduct(a.domain, product.id);
    await addProducts(a.domain, admin, [productId], true);
    assert.equal((await issueAds(b.domain, verified)).length, 0);
    await operatorChange(
      form({ intent: "show", shopId: a.id, productId: product.id }),
    );
    const receipt = randomUUID();
    receiptIds.push(receipt);
    await productWebhook(a.domain, productId, receipt, false);
    await productWebhook(a.domain, productId, receipt, false);
    assert.equal((await issueAds(b.domain, async () => {})).length, 0);
    await addProducts(a.domain, admin, [productId], true);
  });
  await t.test(
    "last credit cannot be spent twice and expired tokens are rejected",
    async () => {
      await db.creditAccount.update({
        where: { shopId: a.id },
        data: { balance: 1 },
      });
      const cards = [
        ...(await issueAds(b.domain, verified)),
        ...(await issueAds(b.domain, verified)),
      ];
      for (const card of cards) await age(card.token);
      const results = await Promise.all(
        cards.map((card) => countClick(b.domain, card.token, verified)),
      );
      assert.equal(results.filter((r) => r?.counted).length, 1);
      assert.equal((await statistics(a.id)).balance, 0);
      assert.equal((await issueAds(b.domain, verified)).length, 0);
      assert.equal(
        await countClick(
          b.domain,
          signClick(cards[0].token.split(".")[0], new Date(Date.now() - 1000)),
          verified,
        ),
        null,
      );
    },
  );
  await t.test(
    "publisher can spend earned credits in independent store C",
    async () => {
      await db.shop.update({
        where: { id: b.id },
        data: { advertiserEnabled: true },
      });
      await changePartners(
        b.domain,
        "advertiser",
        form({ intent: "categories", niches: ["Electronics"] }),
      );
      await changePartners(
        c.domain,
        "publisher",
        form({ intent: "categories", niches: ["Home"] }),
      );
      await changePartners(
        b.domain,
        "advertiser",
        form({ intent: "agree", partnerId: c.id }),
      );
      await changePartners(
        c.domain,
        "publisher",
        form({ intent: "agree", partnerId: b.id }),
      );
      await addProducts(b.domain, admin, [productId], true);
      const before = (await statistics(b.id)).balance;
      const token = (await issueAds(c.domain, verified))[0].token;
      await age(token);
      assert.equal(
        (await countClick(c.domain, token, verified))?.counted,
        true,
      );
      assert.equal((await statistics(b.id)).balance, before - 1);
    },
  );
  await t.test(
    "promocredits require a reason and are idempotent; limits apply",
    async () => {
      const key = randomUUID();
      assert.ok(
        "error" in
          (await operatorChange(
            form({ intent: "promo", shopId: a.id, key, amount: "5" }),
          )),
      );
      const request = form({
        intent: "promo",
        shopId: a.id,
        key,
        amount: "5",
        reason: "Test promotion",
      });
      await Promise.all([operatorChange(request), operatorChange(request)]);
      assert.equal((await statistics(a.id)).balance, 5);
      assert.equal((await statistics(a.id)).earned, 0);
      const bucket = randomUUID();
      for (let i = 0; i < 3; i++)
        assert.equal(
          await db.$transaction((tx) => takeQuota(tx, bucket, 2)),
          i < 2,
        );
    },
  );
  await t.test("operator authentication and CSRF are required", () => {
    assert.throws(
      () => authenticateOperator(new Request("https://example.test/operator")),
      (error: unknown) => error instanceof Response && error.status === 401,
    );
    const authorization = `Basic ${Buffer.from(`${process.env.OPERATOR_USER}:${process.env.OPERATOR_PASSWORD}`).toString("base64")}`;
    const data = form({ csrf: operatorCsrf() });
    assert.throws(
      () =>
        verifyOperatorPost(
          new Request("https://example.test/operator", {
            method: "POST",
            headers: { authorization, origin: "https://attacker.test" },
          }),
          data,
        ),
      (error: unknown) => error instanceof Response && error.status === 403,
    );
    verifyOperatorPost(
      new Request("https://example.test/operator", {
        method: "POST",
        headers: { authorization, origin: "https://example.test" },
      }),
      data,
    );
  });
  await t.test(
    "late uninstall webhooks cannot disable a newer installation",
    async () => {
      const receipt = randomUUID();
      receiptIds.push(receipt);
      await uninstallShop(c.domain, receipt);
      await registerInstallation(c);
      await uninstallShop(c.domain, receipt);
      assert.equal(
        (await db.shop.findUniqueOrThrow({ where: { id: c.id } }))
          .uninstalledAt,
        null,
      );
      const old = randomUUID();
      receiptIds.push(old);
      await uninstallShop(c.domain, old, new Date(0));
      assert.equal(
        (await db.shop.findUniqueOrThrow({ where: { id: c.id } }))
          .uninstalledAt,
        null,
      );
    },
  );
  await t.test(
    "uninstall and redact stop ads and preserve only the bonus marker",
    async () => {
      const token = (await issueAds(b.domain, verified))[0].token;
      await age(token);
      await uninstallShop(a.domain);
      assert.equal((await issueAds(b.domain, verified)).length, 0);
      assert.equal(await countClick(b.domain, token, verified), null);
      const receipt = randomUUID();
      receiptIds.push(receipt);
      await redactShop(a.domain, a.id, receipt);
      await redactShop(a.domain, a.id, receipt);
      assert.equal(await db.shop.findUnique({ where: { id: a.id } }), null);
      assert.equal(await db.productAd.count({ where: { shopId: a.id } }), 0);
      assert.equal(await db.creditEntry.count({ where: { shopId: a.id } }), 0);
      assert.ok(
        await db.bonusReceipt.findUnique({
          where: { shopHash: bonusHash(a.id) },
        }),
      );
      assert.equal((await registerInstallation(a)).account?.balance, 0);
    },
  );
});
