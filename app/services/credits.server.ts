import type { Prisma } from "@prisma/client";
import { bonusHash } from "./identity.server";

// Caller holds the Shop row lock; the unique key protects transaction retries.
export async function grantWelcomeCredits(
  tx: Prisma.TransactionClient,
  shopId: string,
) {
  const idempotencyKey = `welcome:${shopId}`;
  await tx.creditAccount.upsert({
    where: { shopId },
    create: { shopId },
    update: {},
  });
  const shopHash = bonusHash(shopId);
  if (await tx.creditOperation.findUnique({ where: { idempotencyKey } })) {
    await tx.bonusReceipt.upsert({
      where: { shopHash },
      create: { shopHash },
      update: {},
    });
    return;
  }
  if (await tx.bonusReceipt.findUnique({ where: { shopHash } })) return;
  await tx.bonusReceipt.create({ data: { shopHash } });
  await tx.creditOperation.create({
    data: {
      idempotencyKey,
      kind: "WELCOME",
      reason: "One-time startup credits",
      entries: { create: { shopId, amount: 20 } },
    },
  });
  await tx.creditAccount.update({
    where: { shopId },
    data: { balance: { increment: 20 } },
  });
}
