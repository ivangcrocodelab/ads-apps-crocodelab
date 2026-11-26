import { createHmac } from "node:crypto";
export function bonusHash(shopId: string) {
  const secret = process.env.BONUS_RETENTION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error(
      "BONUS_RETENTION_SECRET must contain at least 32 characters",
    );
  return createHmac("sha256", secret).update(shopId).digest("hex");
}
