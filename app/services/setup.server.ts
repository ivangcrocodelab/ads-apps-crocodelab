import db from "../db.server";
import { pairInclude, pairReason } from "./partners.server";
export async function setupStatus(shopId: string) {
  const shop = await db.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { categories: true, account: true },
  });
  const messages: string[] = [];
  if (shop.blocked)
    return ["The operator has stopped this store's advertising."];
  if (!shop.niche) messages.push("Select your primary niche.");
  if (!shop.advertiserEnabled && !shop.publisherEnabled)
    messages.push("Enable one or both roles to get started.");
  if (shop.advertiserEnabled) {
    if (!shop.account?.balance)
      messages.push("Your ads are paused because your balance is zero.");
    if (!shop.categories.some((c) => c.role === "advertiser"))
      messages.push("Choose publisher categories in Partners.");
    if (
      !(await db.productAd.count({
        where: { shopId, selected: true, active: true, hidden: false },
      }))
    )
      messages.push(
        "Select and verify at least one available product in My products.",
      );
    const pairs = await db.partnership.findMany({
      where: { advertiserId: shopId },
      include: pairInclude,
    });
    if (!pairs.some((p) => !pairReason(p)))
      messages.push(
        "No eligible publisher: both stores must agree, enable their roles and select matching categories. Check Partners for each direction's status.",
      );
    else
      messages.push(
        "Partner permissions are ready. Your products are verified again before every new offer.",
      );
  }
  if (shop.publisherEnabled) {
    if (!shop.categories.some((c) => c.role === "publisher"))
      messages.push("Choose advertiser categories in Display partners.");
    const pairs = await db.partnership.findMany({
      where: { publisherId: shopId },
      include: pairInclude,
    });
    const eligible = pairs.filter((p) => !pairReason(p));
    if (!eligible.length)
      messages.push(
        "No eligible advertiser: check mutual permissions, categories and advertiser balances in Display partners.",
      );
    else if (
      !(await db.productAd.count({
        where: {
          shopId: { in: eligible.map((p) => p.advertiserId) },
          selected: true,
          active: true,
          hidden: false,
        },
      }))
    )
      messages.push(
        "Your approved advertisers have no verified available products.",
      );
    if (!(await db.blockLoad.findFirst({ where: { publisherId: shopId } })))
      messages.push(
        "No block loads recorded yet. Add Partner ads through Theme Editor and save. Privacy permission is required before offers load.",
      );
    messages.push(
      "The block stays hidden when there are no eligible offers or privacy permission is unavailable.",
    );
  }
  return messages;
}
