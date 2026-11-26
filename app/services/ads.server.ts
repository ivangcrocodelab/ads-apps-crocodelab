import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { isbot } from "isbot";
import db from "../db.server";
import { lockShops } from "./locks.server";
import { pairInclude, pairReason } from "./partners.server";
import { refreshProducts } from "./products.server";
import { signClick, verifyClick } from "./tokens.server";
import { reportError } from "./diagnostics.server";

const TOKEN_TTL = 5 * 60 * 1000;
const VERIFIED_TTL = 30 * 1000;
export function automaticRequest(request: Request) {
  const ua = request.headers.get("user-agent");
  return (
    !ua ||
    isbot(ua) ||
    /prefetch|prerender/i.test(
      `${request.headers.get("purpose") ?? ""} ${request.headers.get("sec-purpose") ?? ""}`,
    )
  );
}
export async function takeQuota(
  tx: Prisma.TransactionClient,
  identity: string,
  limit: number,
) {
  const bucket = Math.floor(Date.now() / 60000);
  const key = createHash("sha256")
    .update(`${identity}:${bucket}`)
    .digest("hex");
  const row = await tx.rateLimit.upsert({
    where: { key },
    create: { key, expiresAt: new Date((bucket + 2) * 60000) },
    update: { count: { increment: 1 } },
  });
  return row.count <= limit;
}
export async function issueAds(
  domain: string,
  refresh: (domain: string) => Promise<unknown> = refreshProducts,
) {
  const publisher = await db.shop.findUnique({ where: { domain } });
  if (
    !publisher ||
    publisher.uninstalledAt ||
    publisher.blocked ||
    !publisher.publisherEnabled
  )
    return [];
  if (
    !(await db.$transaction((tx) =>
      takeQuota(tx, `loads:${publisher.id}`, 120),
    ))
  )
    return [];
  await db.blockLoad.create({ data: { publisherId: publisher.id } });
  const candidates = (
    await db.partnership.findMany({
      where: { publisherId: publisher.id, selected: true, approved: true },
      include: pairInclude,
      orderBy: { id: "asc" },
    })
  ).filter((p) => !pairReason(p));
  const cards: {
    title: string;
    imageUrl: string;
    seller: string;
    productUrl: string;
    token: string;
    expiresAt: number;
  }[] = [];
  // Rotate the first partner without ranks, targeting or visitor profiles.
  const second = Math.floor(Date.now() / 1000);
  const offset = candidates.length ? second % candidates.length : 0;
  const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];
  for (const candidate of ordered) {
    if (cards.length >= 3) break;
    try {
      await refresh(candidate.advertiser.domain);
    } catch {
      reportError("ADS_REFRESH_FAILED");
      continue;
    }
    const issued = await db.$transaction(async (tx) => {
      await lockShops(tx, [candidate.advertiserId, publisher.id]);
      const pair = await tx.partnership.findUnique({
        where: { id: candidate.id },
        include: pairInclude,
      });
      if (pairReason(pair) || !pair) return [];
      const products = await tx.productAd.findMany({
        where: {
          shopId: pair.advertiserId,
          selected: true,
          active: true,
          hidden: false,
          verifiedAt: { gte: new Date(Date.now() - VERIFIED_TTL) },
        },
        orderBy: { id: "asc" },
      });
      // Advance products once per partner cycle so equal partner/product
      // counts cannot pin each advertiser to the same subset of products.
      const productOffset = products.length
        ? Math.floor(second / candidates.length) % products.length
        : 0;
      const rotated = [
        ...products.slice(productOffset),
        ...products.slice(0, productOffset),
      ];
      const result = [];
      for (const product of rotated.slice(0, 3 - cards.length)) {
        const nonce = randomBytes(24).toString("hex");
        const expiresAt = new Date(Date.now() + TOKEN_TTL);
        await tx.clickToken.create({
          data: {
            nonce,
            expiresAt,
            advertiserId: pair.advertiserId,
            publisherId: publisher.id,
            productAdId: product.id,
            pairId: pair.id,
            pairVersion: pair.version,
            productRevision: product.revision,
            advertiserVersion: pair.advertiser.settingsVersion,
            publisherVersion: pair.publisher.settingsVersion,
          },
        });
        result.push({
          title: product.title,
          imageUrl: product.imageUrl,
          seller: pair.advertiser.name,
          productUrl: product.productUrl,
          token: signClick(nonce, expiresAt),
          expiresAt: expiresAt.getTime(),
        });
      }
      return result;
    });
    cards.push(...issued);
  }
  return cards;
}
export async function countClick(
  domain: string,
  token: string,
  refresh: (domain: string) => Promise<unknown> = refreshProducts,
) {
  const signed = verifyClick(token);
  if (!signed) return null;
  const issued = await db.clickToken.findUnique({
    where: { nonce: signed.nonce },
  });
  if (
    !issued ||
    issued.expiresAt.getTime() !== signed.expiresAt ||
    Date.now() - issued.createdAt.getTime() < 300
  )
    return null;
  const advertiser = await db.shop.findUnique({
    where: { id: issued.advertiserId },
  });
  if (!advertiser) return null;
  try {
    await refresh(advertiser.domain);
  } catch {
    reportError("CLICK_REFRESH_FAILED");
    return null;
  }
  return db.$transaction(async (tx) => {
    await lockShops(tx, [issued.advertiserId, issued.publisherId]);
    const publisher = await tx.shop.findUnique({
      where: { id: issued.publisherId },
    });
    if (
      !publisher ||
      publisher.domain !== domain ||
      publisher.uninstalledAt ||
      publisher.blocked
    )
      return null;
    const current = await tx.clickToken.findUnique({
      where: { nonce: issued.nonce },
    });
    if (!current || current.expiresAt <= new Date()) return null;
    const product = await tx.productAd.findUnique({
      where: { id: current.productAdId },
    });
    if (
      !product ||
      !product.active ||
      !product.selected ||
      product.hidden ||
      !product.verifiedAt ||
      product.verifiedAt.getTime() < Date.now() - VERIFIED_TTL
    )
      return null;
    const pair = await tx.partnership.findUnique({
      where: { id: current.pairId },
      include: pairInclude,
    });
    if (!pair || pair.advertiser.uninstalledAt || pair.advertiser.blocked)
      return null;
    if (current.consumedAt) return { url: product.productUrl, counted: false };
    if (
      pairReason(pair) ||
      pair.version !== current.pairVersion ||
      product.revision !== current.productRevision ||
      pair.advertiser.settingsVersion !== current.advertiserVersion ||
      publisher.settingsVersion !== current.publisherVersion
    )
      return null;
    if (!(await takeQuota(tx, `clicks:${publisher.id}`, 30))) {
      await tx.clickToken.update({
        where: { nonce: current.nonce },
        data: { consumedAt: new Date() },
      });
      return { url: product.productUrl, counted: false };
    }
    const debit = await tx.creditAccount.updateMany({
      where: { shopId: current.advertiserId, balance: { gte: 1 } },
      data: { balance: { decrement: 1 } },
    });
    if (debit.count !== 1) return null;
    await tx.creditAccount.update({
      where: { shopId: current.publisherId },
      data: { balance: { increment: 1 } },
    });
    await tx.creditOperation.create({
      data: {
        idempotencyKey: `click:${current.nonce}`,
        kind: "CLICK",
        reason: "Partner ad click",
        entries: {
          create: [
            { shopId: current.advertiserId, amount: -1 },
            { shopId: current.publisherId, amount: 1 },
          ],
        },
      },
    });
    await tx.clickToken.update({
      where: { nonce: current.nonce },
      data: { consumedAt: new Date() },
    });
    await tx.countedClick.create({
      data: {
        nonce: current.nonce,
        advertiserId: current.advertiserId,
        publisherId: current.publisherId,
      },
    });
    return { url: product.productUrl, counted: true };
  });
}
