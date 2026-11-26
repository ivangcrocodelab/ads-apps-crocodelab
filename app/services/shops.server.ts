import db from "../db.server";
import { grantWelcomeCredits } from "./credits.server";

export const NICHES = [
  "Fashion",
  "Beauty",
  "Home",
  "Pets",
  "Sports",
  "Electronics",
  "Kids",
  "Food",
  "Art & Gifts",
  "Other",
] as const;

export async function registerInstallation(profile: {
  id: string;
  domain: string;
  name: string;
}) {
  return db.$transaction(async (tx) => {
    // Serialize before a row exists; ON CONFLICT(id) alone cannot arbitrate
    // concurrent inserts against the separate unique domain index.
    for (const key of [
      `installation:id:${profile.id}`,
      `installation:domain:${profile.domain}`,
    ].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    }
    // Explicit PostgreSQL upsert: Prisma may emulate upsert with two unique keys.
    // ON CONFLICT acquires the row lock even for concurrent first installations.
    await tx.$executeRaw`
      INSERT INTO "Shop" ("id", "domain", "name", "updatedAt")
      VALUES (${profile.id}, ${profile.domain}, ${profile.name}, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET
        "domain" = EXCLUDED."domain", "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP
    `;
    const shop = await tx.shop.findUniqueOrThrow({ where: { id: profile.id } });
    if (shop.uninstalledAt)
      await tx.shop.update({
        where: { id: shop.id },
        data: {
          uninstalledAt: null,
          installedAt: new Date(),
          advertiserEnabled: false,
          publisherEnabled: false,
          catalogConsent: false,
        },
      });
    await grantWelcomeCredits(tx, shop.id);
    return tx.shop.findUniqueOrThrow({
      where: { id: shop.id },
      include: { account: true },
    });
  });
}

export async function getInstalledShop(domain: string) {
  const shop = await db.shop.findUnique({
    where: { domain },
    include: { account: true },
  });
  if (!shop || shop.uninstalledAt)
    throw new Response("Reopen the app after installation.", {
      status: 403,
    });
  return shop;
}

export async function saveSettings(domain: string, form: FormData) {
  const niche = form.get("niche");
  if (
    typeof niche !== "string" ||
    !NICHES.includes(niche as (typeof NICHES)[number])
  ) {
    return { error: "Select a primary niche from the list." };
  }
  const updated = await db.shop.updateMany({
    where: { domain, uninstalledAt: null, blocked: false },
    data: {
      niche,
      advertiserEnabled: form.get("advertiserEnabled") === "true",
      publisherEnabled: form.get("publisherEnabled") === "true",
      settingsVersion: { increment: 1 },
    },
  });
  if (!updated.count) return { error: "The store is disabled or blocked." };
  return { saved: true };
}

export async function uninstallShop(
  domain: string,
  receiptId?: string,
  triggeredAt?: Date,
) {
  await db.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { domain } });
    if (shop)
      await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${shop.id} FOR UPDATE`;
    if (receiptId) {
      if (await tx.webhookReceipt.findUnique({ where: { id: receiptId } }))
        return;
      await tx.webhookReceipt.create({
        data: { id: receiptId, topic: "app/uninstalled" },
      });
    }
    const current = shop
      ? await tx.shop.findUnique({ where: { id: shop.id } })
      : null;
    if (
      current &&
      triggeredAt &&
      Number.isFinite(triggeredAt.getTime()) &&
      triggeredAt < current.installedAt
    )
      return;
    await tx.shop.updateMany({
      where: { domain, uninstalledAt: null },
      data: {
        uninstalledAt: new Date(),
        advertiserEnabled: false,
        publisherEnabled: false,
        catalogConsent: false,
        settingsVersion: { increment: 1 },
      },
    });
    await tx.session.deleteMany({ where: { shop: domain } });
  });
}
