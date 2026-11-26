import db from "../db.server";
export async function statistics(shopId: string) {
  const [account, spent, earned, loads, incoming, outgoing, operations] =
    await Promise.all([
      db.creditAccount.findUnique({ where: { shopId } }),
      db.creditEntry.aggregate({
        where: { shopId, amount: { lt: 0 } },
        _sum: { amount: true },
      }),
      db.creditEntry.aggregate({
        where: { shopId, amount: { gt: 0 }, operation: { kind: "CLICK" } },
        _sum: { amount: true },
      }),
      db.blockLoad.count({ where: { publisherId: shopId } }),
      db.countedClick.count({ where: { advertiserId: shopId } }),
      db.countedClick.count({ where: { publisherId: shopId } }),
      db.creditEntry.findMany({
        where: { shopId },
        include: { operation: true },
        orderBy: { operation: { createdAt: "desc" } },
        take: 50,
      }),
    ]);
  return {
    balance: account?.balance ?? 0,
    spent: -(spent._sum.amount ?? 0),
    earned: earned._sum.amount ?? 0,
    loads,
    incoming,
    outgoing,
    operations,
  };
}
