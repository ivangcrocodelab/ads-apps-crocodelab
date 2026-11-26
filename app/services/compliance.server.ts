import db from "../db.server";
import { lockShops } from "./locks.server";
import { bonusHash } from "./identity.server";
export async function redactShop(
  domain: string,
  shopId: string,
  receiptId: string,
) {
  return db.$transaction(async (tx) => {
    await lockShops(tx, [shopId]);
    if (await tx.webhookReceipt.findUnique({ where: { id: receiptId } }))
      return;
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (shop && shop.domain !== domain)
      throw new Error("Shop identity mismatch");
    if (shop && !shop.uninstalledAt) {
      await tx.webhookReceipt.create({
        data: {
          id: receiptId,
          topic: "shop/redact:active-installation-skipped",
        },
      });
      return;
    }
    if (shop) {
      const welcome = await tx.creditOperation.findUnique({
        where: { idempotencyKey: `welcome:${shopId}` },
      });
      if (welcome)
        await tx.bonusReceipt.upsert({
          where: { shopHash: bonusHash(shopId) },
          create: { shopHash: bonusHash(shopId) },
          update: {},
        });
      await tx.clickToken.deleteMany({
        where: { OR: [{ advertiserId: shopId }, { publisherId: shopId }] },
      });
      await tx.countedClick.updateMany({
        where: { advertiserId: shopId },
        data: { advertiserId: null },
      });
      await tx.countedClick.updateMany({
        where: { publisherId: shopId },
        data: { publisherId: null },
      });
      await tx.countedClick.deleteMany({
        where: { advertiserId: null, publisherId: null },
      });
      const operations = await tx.creditEntry.findMany({
        where: { shopId },
        select: { operationId: true },
      });
      await tx.creditEntry.deleteMany({ where: { shopId } });
      await tx.creditOperation.deleteMany({
        where: {
          id: { in: operations.map((o) => o.operationId) },
          entries: { none: {} },
        },
      });
      await tx.creditAccount.deleteMany({ where: { shopId } });
      await tx.operatorAudit.deleteMany({ where: { shopId } });
      await tx.shop.delete({ where: { id: shopId } });
    }
    await tx.session.deleteMany({ where: { shop: domain } });
    await tx.webhookReceipt.create({
      data: { id: receiptId, topic: "shop/redact" },
    });
  });
}
export async function acknowledgeCustomerPrivacy(
  receiptId: string,
  topic: string,
) {
  // No customer data is stored. Never persist the webhook payload.
  await db.webhookReceipt.upsert({
    where: { id: receiptId },
    create: { id: receiptId, topic },
    update: {},
  });
}
