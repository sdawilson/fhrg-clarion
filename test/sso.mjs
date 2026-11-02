// Makes sign-in passes the way the FHRG website's /clarion route does (see its Edge Script).
import { webcrypto as crypto } from "node:crypto";
const enc = new TextEncoder();
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const SSO_SECRET = "sso-shared-secret-for-tests-only-0123456789";
export async function makePass(claims, secret = SSO_SECRET) {
  const full = { v: 1, aud: "clarion", exp: Date.now() + 120_000, j: b64url(crypto.getRandomValues(new Uint8Array(16))), ...claims };
  const payload = b64url(enc.encode(JSON.stringify(full)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))))}`;
}
