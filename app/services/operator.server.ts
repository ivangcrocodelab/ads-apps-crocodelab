import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import db from "../db.server";
import { lockShops } from "./locks.server";
function equal(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function authenticateOperator(request: Request) {
  const user = process.env.OPERATOR_USER;
  const password = process.env.OPERATOR_PASSWORD;
  if (!user || !password || password.length < 32)
    throw new Response("Operator access is not configured", { status: 503 });
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.SHOPIFY_APP_URL?.startsWith("https://")
  )
    throw new Response(null, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  const decoded = header.startsWith("Basic ")
    ? Buffer.from(header.slice(6), "base64").toString("utf8")
    : "";
  if (!equal(decoded, `${user}:${password}`))
    throw new Response("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate":
          'Basic realm="Partner ads operator", charset="UTF-8"',
        "Cache-Control": "no-store",
      },
    });
}
export function operatorCsrf() {
  const value = `${Date.now() + 3600000}.${randomBytes(16).toString("hex")}`;
  return `${value}.${createHmac("sha256", process.env.OPERATOR_PASSWORD!).update(value).digest("hex")}`;
}
export function verifyOperatorPost(request: Request, form: FormData) {
  authenticateOperator(request);
  if (
    request.method !== "POST" ||
    request.headers.get("origin") !==
      new URL(process.env.SHOPIFY_APP_URL!).origin
  )
    throw new Response("Invalid origin", { status: 403 });
  const token = String(form.get("csrf") ?? "");
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    !Number.isSafeInteger(Number(parts[0])) ||
    Number(parts[0]) < Date.now() ||
    !equal(
      parts[2],
      createHmac("sha256", process.env.OPERATOR_PASSWORD!)
        .update(`${parts[0]}.${parts[1]}`)
        .digest("hex"),
    )
  )
    throw new Response("Invalid form token", { status: 403 });
}
export async function operatorChange(form: FormData) {
  const shopId = String(form.get("shopId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!["block", "approve", "hide", "show", "promo"].includes(intent))
    return { error: "Unknown action" };
  if (intent === "promo" && (!reason || reason.length > 500))
    return { error: "Enter a reason (1–500 characters)." };
  return db.$transaction(async (tx) => {
    await lockShops(tx, [shopId]);
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.uninstalledAt) return { error: "Store is not installed" };
    if (intent === "block" || intent === "approve")
      await tx.shop.update({
        where: { id: shopId },
        data: {
          blocked: intent === "block",
          settingsVersion: { increment: 1 },
        },
      });
    if (intent === "hide" || intent === "show") {
      const result = await tx.productAd.updateMany({
        where: { id: String(form.get("productId")), shopId },
        data: { hidden: intent === "hide", revision: { increment: 1 } },
      });
      if (!result.count) return { error: "Product not found" };
    }
    if (intent === "promo") {
      const amount = Number(form.get("amount"));
      const key = String(form.get("key"));
      if (
        !Number.isSafeInteger(amount) ||
        amount < 1 ||
        amount > 1000000 ||
        !/^[a-f0-9-]{36}$/.test(key)
      )
        return { error: "Invalid amount or operation key" };
      const idempotencyKey = `promo:${key}`;
      if (await tx.creditOperation.findUnique({ where: { idempotencyKey } }))
        return { saved: true };
      await tx.creditAccount.update({
        where: { shopId },
        data: { balance: { increment: amount } },
      });
      await tx.creditOperation.create({
        data: {
          idempotencyKey,
          kind: "PROMO",
          reason,
          entries: { create: { shopId, amount } },
        },
      });
    }
    await tx.operatorAudit.create({
      data: { shopId, action: intent, reason: reason || intent },
    });
    return { saved: true };
  });
}
