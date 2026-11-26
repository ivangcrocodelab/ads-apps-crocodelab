import { createHash, randomBytes } from "node:crypto";
import db from "../db.server";
import { getInstalledShop, NICHES } from "./shops.server";
import { lockShops } from "./locks.server";

export const pairInclude = {
  advertiser: { include: { categories: true, account: true } },
  publisher: { include: { categories: true } },
} as const;
type Pair = Awaited<ReturnType<typeof getPair>>;
export function getPair(id: string) {
  return db.partnership.findUnique({ where: { id }, include: pairInclude });
}
export function pairReason(pair: Pair): string | null {
  if (!pair) return "Partner not selected";
  const { advertiser: a, publisher: b } = pair;
  if (
    a.id === b.id ||
    a.uninstalledAt ||
    b.uninstalledAt ||
    a.blocked ||
    b.blocked
  )
    return "Store unavailable";
  if (!a.advertiserEnabled || !b.publisherEnabled)
    return "Required role is disabled";
  if (
    !pair.selected ||
    !pair.approved ||
    pair.advertiserBlocked ||
    pair.publisherBlocked
  )
    return "Both stores must agree";
  if (
    !a.categories.some((c) => c.role === "advertiser" && c.niche === b.niche) ||
    !b.categories.some((c) => c.role === "publisher" && c.niche === a.niche)
  )
    return "Categories do not match";
  if (!a.account || a.account.balance <= 0) return "Advertiser has no credits";
  return null;
}
export async function invitationShop(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const row = await db.partnerInvitation.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    include: { shop: true },
  });
  return row &&
    row.expiresAt > new Date() &&
    !row.shop.uninstalledAt &&
    !row.shop.blocked
    ? row.shop
    : null;
}
export async function partnersPage(
  domain: string,
  role: "advertiser" | "publisher",
  invitation = "",
) {
  const shop = await getInstalledShop(domain);
  const invited = await invitationShop(invitation);
  const pairs = await db.partnership.findMany({
    where:
      role === "advertiser"
        ? { advertiserId: shop.id }
        : { publisherId: shop.id },
    include: pairInclude,
  });
  const catalogue = await db.shop.findMany({
    where: {
      id: { not: shop.id },
      uninstalledAt: null,
      blocked: false,
      OR: [{ catalogConsent: true }, ...(invited ? [{ id: invited.id }] : [])],
    },
    select: {
      id: true,
      name: true,
      niche: true,
      products: {
        where: {
          selected: true,
          active: true,
          hidden: false,
          verifiedAt: { not: null },
        },
        select: { id: true, title: true, imageUrl: true, productUrl: true },
        orderBy: { title: "asc" },
        take: 10,
      },
    },
    orderBy: { name: "asc" },
  });
  const categories = await db.shopCategoryPreference.findMany({
    where: { shopId: shop.id, role },
  });
  return {
    shop,
    catalogue,
    categories: categories.map((c) => c.niche),
    pairs: pairs.map((p) => ({
      id: p.id,
      partner: {
        id: role === "advertiser" ? p.publisher.id : p.advertiser.id,
        name: role === "advertiser" ? p.publisher.name : p.advertiser.name,
      },
      selected: p.selected,
      approved: p.approved,
      blocked: role === "advertiser" ? p.advertiserBlocked : p.publisherBlocked,
      reason: pairReason(p),
    })),
    niches: NICHES,
    invitation,
  };
}
export async function changePartners(
  domain: string,
  role: "advertiser" | "publisher",
  form: FormData,
) {
  const owner = await getInstalledShop(domain);
  if (owner.blocked) return { error: "Store blocked" };
  const intent = String(form.get("intent") ?? "");
  if (intent === "invite") {
    const token = randomBytes(24).toString("hex");
    await db.partnerInvitation.create({
      data: {
        shopId: owner.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      },
    });
    return { invitationUrl: `${process.env.SHOPIFY_APP_URL}/invite/${token}` };
  }
  if (intent === "categories" || intent === "catalogue") {
    const niches = [...new Set(form.getAll("niches").map(String))];
    if (niches.some((n) => !NICHES.includes(n as (typeof NICHES)[number])))
      return { error: "Invalid category" };
    return db.$transaction(async (tx) => {
      await lockShops(tx, [owner.id]);
      const current = await tx.shop.findUniqueOrThrow({
        where: { id: owner.id },
      });
      if (current.blocked || current.uninstalledAt)
        return { error: "Store unavailable" };
      if (intent === "catalogue")
        await tx.shop.update({
          where: { id: owner.id },
          data: { catalogConsent: form.get("consent") === "true" },
        });
      else {
        await tx.shopCategoryPreference.deleteMany({
          where: { shopId: owner.id, role },
        });
        await tx.shopCategoryPreference.createMany({
          data: niches.map((niche) => ({ shopId: owner.id, role, niche })),
        });
        await tx.shop.update({
          where: { id: owner.id },
          data: { settingsVersion: { increment: 1 } },
        });
      }
      return { saved: true };
    });
  }
  if (!["agree", "revoke", "block", "unblock"].includes(intent))
    return { error: "Unknown action" };
  const partnerId = String(form.get("partnerId") ?? "");
  if (partnerId === owner.id)
    return { error: "You cannot select your own store" };
  const invited = await invitationShop(String(form.get("invitation") ?? ""));
  const advertiserId = role === "advertiser" ? owner.id : partnerId;
  const publisherId = role === "publisher" ? owner.id : partnerId;
  return db.$transaction(async (tx) => {
    await lockShops(tx, [advertiserId, publisherId]);
    const [current, partner] = await Promise.all([
      tx.shop.findUnique({ where: { id: owner.id } }),
      tx.shop.findUnique({ where: { id: partnerId } }),
    ]);
    if (
      !current ||
      current.uninstalledAt ||
      current.blocked ||
      !partner ||
      partner.uninstalledAt ||
      partner.blocked
    )
      return { error: "Store unavailable" };
    const key = { advertiserId_publisherId: { advertiserId, publisherId } };
    const existing = await tx.partnership.findUnique({ where: key });
    if (!existing && !partner.catalogConsent && invited?.id !== partner.id)
      return { error: "Store is not in the catalogue" };
    const data =
      role === "advertiser"
        ? intent === "agree" || intent === "revoke"
          ? { selected: intent === "agree" }
          : { advertiserBlocked: intent === "block" }
        : intent === "agree" || intent === "revoke"
          ? { approved: intent === "agree" }
          : { publisherBlocked: intent === "block" };
    await tx.partnership.upsert({
      where: key,
      create: { advertiserId, publisherId, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    return { saved: true };
  });
}
