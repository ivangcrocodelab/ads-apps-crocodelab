import { createHmac, timingSafeEqual } from "node:crypto";
function secret() {
  const value = process.env.CLICK_TOKEN_SECRET;
  if (!value || value.length < 32)
    throw new Error("CLICK_TOKEN_SECRET must contain at least 32 characters");
  return value;
}
export function signClick(nonce: string, expiresAt: Date) {
  const payload = `${nonce}.${expiresAt.getTime()}`;
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("hex")}`;
}
export function verifyClick(token: string) {
  if (token.length > 200) return null;
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    !/^[a-f0-9]{48}$/.test(parts[0]) ||
    !/^\d{13}$/.test(parts[1]) ||
    !/^[a-f0-9]{64}$/.test(parts[2])
  )
    return null;
  const expected = createHmac("sha256", secret())
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(parts[2], "hex"))) return null;
  const expiresAt = Number(parts[1]);
  if (expiresAt <= Date.now()) return null;
  return { nonce: parts[0], expiresAt };
}
