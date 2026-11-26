import type { Prisma } from "@prisma/client";
export async function lockShops(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${id} FOR UPDATE`;
  }
}
