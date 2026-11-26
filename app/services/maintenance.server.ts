import db from "../db.server";
import { refreshProducts } from "./products.server";
export async function maintenance() {
  const stores = await db.shop.findMany({
    where: {
      uninstalledAt: null,
      blocked: false,
      products: { some: { selected: true } },
    },
    select: { domain: true },
  });
  let failed = 0;
  for (const shop of stores) {
    try {
      if (!await refreshProducts(shop.domain)) failed += 1;
    } catch {
      failed += 1;
    }
  }
  const now = new Date();
  await db.clickToken.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.partnerInvitation.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.webhookReceipt.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 30 * 86400000) } },
  });
  return { checked: stores.length, failed };
}
