import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import db from "../app/db.server";
import { bonusHash } from "../app/services/identity.server";
import {
  getInstalledShop,
  registerInstallation,
  saveSettings,
  uninstallShop,
} from "../app/services/shops.server";
import { action as uninstallWebhook } from "../app/routes/webhooks.app.uninstalled";
import {
  action as settingsAction,
  loader as dashboardLoader,
} from "../app/routes/app._index";

function routeArgs(request: Request) {
  return {
    request,
    params: {},
    context: {},
    url: new URL(request.url),
    pattern: request.url,
  };
}

const suffix = randomUUID();
const profile = {
  id: `test:${suffix}`,
  domain: `test-${suffix}.myshopify.com`,
  name: "Test shop",
};
const installationProfiles = [
  profile,
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `${profile.id}:${i}`,
    domain: `test-${suffix}-${i}.myshopify.com`,
    name: "Concurrent installation",
  })),
];

after(async () => {
  // Only delete this run's generated fixture, never clear entire tables.
  for (const profile of installationProfiles) {
    await db.creditEntry.deleteMany({ where: { shopId: profile.id } });
    await db.creditOperation.deleteMany({
      where: { idempotencyKey: `welcome:${profile.id}` },
    });
    await db.creditAccount.deleteMany({ where: { shopId: profile.id } });
    await db.session.deleteMany({ where: { shop: profile.domain } });
    await db.shop.deleteMany({ where: { id: profile.id } });
    await db.bonusReceipt.deleteMany({
      where: { shopHash: bonusHash(profile.id) },
    });
  }
  await db.$disconnect();
});

test("installation lifecycle and credit invariants", async (t) => {
  await t.test("concurrent callbacks issue one bonus", async () => {
    for (const profile of installationProfiles) {
      await Promise.all(
        Array.from({ length: 8 }, () => registerInstallation(profile)),
      );
      const shop = await getInstalledShop(profile.domain);
      assert.equal(shop.account?.balance, 20);
      assert.equal(shop.advertiserEnabled, false);
      assert.equal(shop.publisherEnabled, false);
      assert.equal(shop.blocked, false);
      assert.equal(shop.catalogConsent, false);
      assert.equal(
        await db.creditEntry.count({ where: { shopId: profile.id } }),
        1,
      );
    }
  });
  await t.test(
    "roles are independent and invalid niche cannot change settings",
    async () => {
      for (const [advertiser, publisher] of [
        [true, false],
        [false, true],
        [true, true],
        [false, false],
      ]) {
        const form = new FormData();
        form.set("niche", "Pets");
        if (advertiser) form.set("advertiserEnabled", "true");
        if (publisher) form.set("publisherEnabled", "true");
        assert.deepEqual(await saveSettings(profile.domain, form), {
          saved: true,
        });
        const shop = await getInstalledShop(profile.domain);
        assert.equal(shop.advertiserEnabled, advertiser);
        assert.equal(shop.publisherEnabled, publisher);
      }
      const invalid = new FormData();
      invalid.set("niche", "Invented category");
      assert.ok("error" in (await saveSettings(profile.domain, invalid)));
      assert.equal((await getInstalledShop(profile.domain)).niche, "Pets");
    },
  );
  await t.test(
    "database rejects negative balance and transaction rolls back",
    async () => {
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.shop.update({
            where: { id: profile.id },
            data: { name: "Must rollback" },
          });
          await tx.creditAccount.update({
            where: { shopId: profile.id },
            data: { balance: -1 },
          });
        }),
      );
      const shop = await getInstalledShop(profile.domain);
      assert.equal(shop.name, profile.name);
      assert.equal(shop.account?.balance, 20);
    },
  );
  await t.test(
    "unsigned webhook and forged admin requests cannot change the shop",
    async () => {
      const body = JSON.stringify({ id: profile.id });
      await assert.rejects(
        uninstallWebhook(
          routeArgs(
            new Request("https://example.test/webhooks/app/uninstalled", {
              method: "POST",
              body,
              headers: {
                "X-Shopify-Shop-Domain": profile.domain,
                "X-Shopify-Topic": "app/uninstalled",
                "X-Shopify-Hmac-Sha256": "invalid",
              },
            }),
          ),
        ),
        (error: unknown) => error instanceof Response && error.status === 401,
      );
      const rejected = (error: unknown) =>
        error instanceof Response && error.status === 401;
      await assert.rejects(
        dashboardLoader(
          routeArgs(
            new Request(`https://example.test/app?shop=${profile.domain}`, {
              headers: { Authorization: "Bearer forged-session-token" },
            }),
          ),
        ),
        rejected,
      );
      const form = new FormData();
      form.set("niche", "Home");
      form.set("advertiserEnabled", "true");
      await assert.rejects(
        settingsAction(
          routeArgs(
            new Request(`https://example.test/app?shop=${profile.domain}`, {
              method: "POST",
              body: form,
              headers: { Authorization: "Bearer forged-session-token" },
            }),
          ),
        ),
        rejected,
      );
      const shop = await getInstalledShop(profile.domain);
      assert.equal(shop.niche, "Pets");
      assert.equal(shop.advertiserEnabled, false);
      assert.equal(shop.account?.balance, 20);
    },
  );
  await t.test(
    "uninstall revokes sessions and settings; reinstall never reissues bonus",
    async () => {
      await db.session.create({
        data: {
          id: `offline_${profile.domain}`,
          shop: profile.domain,
          state: "",
          accessToken: "test-only",
        },
      });
      await db.shop.update({
        where: { id: profile.id },
        data: { advertiserEnabled: true, publisherEnabled: true },
      });
      const body = JSON.stringify({ id: profile.id });
      const hmac = createHmac("sha256", process.env.SHOPIFY_API_SECRET!)
        .update(body)
        .digest("base64");
      const response = await uninstallWebhook(
        routeArgs(
          new Request("https://example.test/webhooks/app/uninstalled", {
            method: "POST",
            body,
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Shop-Domain": profile.domain,
              "X-Shopify-Topic": "app/uninstalled",
              "X-Shopify-Hmac-Sha256": hmac,
              "X-Shopify-API-Version": "2026-10",
              "X-Shopify-Webhook-Id": randomUUID(),
            },
          }),
        ),
      );
      assert.equal(response.status, 200);
      await uninstallShop(profile.domain);
      await assert.rejects(
        getInstalledShop(profile.domain),
        (error: unknown) => error instanceof Response && error.status === 403,
      );
      const form = new FormData();
      form.set("niche", "Home");
      assert.ok("error" in (await saveSettings(profile.domain, form)));
      assert.equal(
        await db.session.count({ where: { shop: profile.domain } }),
        0,
      );
      const shop = await registerInstallation(profile);
      assert.equal(shop.account?.balance, 20);
      assert.equal(shop.advertiserEnabled, false);
      assert.equal(shop.publisherEnabled, false);
      assert.equal(
        await db.creditEntry.count({ where: { shopId: profile.id } }),
        1,
      );
    },
  );
  await t.test("operator block survives reinstallation", async () => {
    await db.shop.update({
      where: { id: profile.id },
      data: { blocked: true },
    });
    await uninstallShop(profile.domain);
    assert.equal((await registerInstallation(profile)).blocked, true);
    const form = new FormData();
    form.set("niche", "Home");
    assert.ok("error" in (await saveSettings(profile.domain, form)));
  });
});
