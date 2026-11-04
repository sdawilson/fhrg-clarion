// Members sign in with their FHRG website account. Clarion reads the website's users and authorities with
// a read-only token and never changes them. Bunny Database speaks the libSQL remote protocol (Hrana over
// HTTP). Members can also arrive signed in from the website, with a two-minute, single-use pass.

import type { Config } from "./config";
import { missingSettings } from "./config";
import { storageDelete, storageJson, storagePut } from "./storage";
import { FriendlyError, cached, cleanText, delay, fetchWithTimeout, forget, json, readJsonBody, sameText, withLock } from "./util";

const SESSION_DAYS = 30;
const SESSION_HOURS = 12;
const PBKDF2_ROUNDS = 100_000;
const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
const SIGNIN_MAX_PER_EMAIL = 8;
const SIGNIN_MAX_PER_IP = 30;

type Val = string | number | boolean | null | undefined;
type Row = Record<string, any>;

function hranaArg(v: Val) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  return { type: "text", value: String(v) };
}
function hranaValue(v: any): any {
  switch (v?.type) {
    case "integer": return Number(v.value);
    case "float": return Number(v.value);
    case "text": return v.value;
    case "blob": return v.base64;
    default: return null;
  }
}

export async function websiteQ(c: Config, sql: string, ...args: Val[]): Promise<Row[]> {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("Clarion only reads the website's database.");
  const body = { requests: [{ type: "execute", stmt: { sql, args: args.map(hranaArg) } }, { type: "close" }] };
  let res: Response;
  try {
    res = await fetchWithTimeout(c.webDbUrl, { method: "POST", headers: { Authorization: `Bearer ${c.webDbToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }, 20000);
  } catch (e) {
    throw new FriendlyError(`The FHRG website's database could not be reached: ${(e as Error).message}`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new FriendlyError("The FHRG website's database rejected the access token. Check WEBSITE_DATABASE_AUTH_TOKEN.", 500);
  if (!res.ok) throw new FriendlyError(`The FHRG website's database returned status ${res.status}. Check WEBSITE_DATABASE_URL.`, 500);
  const j: any = await res.json().catch(() => null);
  const r = j?.results?.[0];
  if (!r || r.type !== "ok") throw new FriendlyError(`The FHRG website's database did not answer: ${r?.error?.message || "no result"}.`, 502);
  const result = r.response?.result || { cols: [], rows: [] };
  const cols: string[] = (result.cols || []).map((col: any) => col.name);
  return (result.rows || []).map((row: any[]) => Object.fromEntries(row.map((v, i) => [cols[i], hranaValue(v)])));
}

const ME_SQL = `SELECT u.id, u.email, u.name, u.title, u.role, u.status, u.site_admin, u.password_hash,
    a.id AS a_id, a.name AS a_name, a.status AS a_status
  FROM users u JOIN authorities a ON a.id = u.authority_id`;

// ---------------------------------------------------------------- crypto and sessions

const enc = new TextEncoder();
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
async function pbkdf2(secret: string, salt: Uint8Array, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: rounds }, key, 256);
  return new Uint8Array(bits);
}
async function checkSecret(secret: string, stored: string): Promise<boolean> {
  const [kind, rounds, salt, hash] = (stored || "").split("$");
  if (kind !== "pbkdf2" || !hash) return false;
  return sameText(b64url(await pbkdf2(secret, fromB64url(salt), Number(rounds) || PBKDF2_ROUNDS)), hash);
}
async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}
async function sha256(data: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data))));
}

type SessionData = { u: number; v: string; exp: number };
const COOKIE = "clarion_session";
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function makeSession(c: Config, userId: number, passwordHash: string, remember: boolean): Promise<string> {
  const exp = Date.now() + (remember ? SESSION_DAYS * 86400000 : SESSION_HOURS * 3600000);
  const payload = b64url(enc.encode(JSON.stringify({ u: userId, v: passwordHash.slice(-12), exp })));
  return `${payload}.${await hmac(c.sessionSecret, "session|" + payload)}`;
}
async function readSession(c: Config, token: string): Promise<SessionData | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !sameText(sig, await hmac(c.sessionSecret, "session|" + payload))) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return d && typeof d.u === "number" && typeof d.v === "string" && typeof d.exp === "number" && d.exp > Date.now() ? d : null;
  } catch {
    return null;
  }
}
function sessionCookie(token: string, remember: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${remember ? `; Max-Age=${SESSION_DAYS * 86400}` : ""}`;
}
function cookieValue(request: Request, name: string): string {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}
export function clientIp(request: Request): string {
  const h = request.headers;
  // bunny.net's CDN replaces X-Real-IP and X-Forwarded-For with the visitor's address, so a visitor can't set them
  return (h.get("x-real-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || "").trim();
}

// One person on a modern connection has a whole block of addresses, so limits count the block and not the address
export function networkOf(request: Request): string {
  const ip = clientIp(request).toLowerCase();
  if (!ip.includes(":")) return ip;
  if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // an ordinary address written the new way
  const [head, tail] = ip.split("::");
  const front = head ? head.split(":") : [], back = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...front, ...new Array<string>(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
}

export type Member = { id: number; email: string; name: string; title: string; role: string; siteAdmin: boolean; authorityId: number; authority: string };

function toMember(c: Config, u: Row): Member {
  return {
    id: Number(u.id), email: String(u.email), name: String(u.name || ""), title: String(u.title || ""), role: String(u.role || "member"),
    siteAdmin: u.site_admin === 1 || c.siteAdmins.includes(String(u.email).toLowerCase()),
    authorityId: Number(u.a_id), authority: String(u.a_name || ""),
  };
}

// Every request re-checks the website account (kept for a minute).
export async function signedIn(c: Config, request: Request): Promise<Member> {
  const missing = missingSettings(c);
  if (missing.length) throw new FriendlyError(`Clarion is not set up yet. Missing settings: ${missing.join(", ")}.`, 500);
  const token = (request.headers.get("x-session-token") ?? "").trim() || cookieValue(request, COOKIE);
  const data = token ? await readSession(c, token) : null;
  if (!data) throw new FriendlyError("Please sign in.", 401);
  const u = await cached(`member|${data.u}`, 60_000, async () => (await websiteQ(c, `${ME_SQL} WHERE u.id = ?`, data.u))[0] || null);
  if (!u || u.status !== "approved" || String(u.password_hash).slice(-12) !== data.v) throw new FriendlyError("Please sign in again.", 401);
  const m = toMember(c, u);
  if (u.a_status !== "approved" && !m.siteAdmin) throw new FriendlyError("Your authority's FHRG membership isn't active.", 401);
  return m;
}

function checkAccount(c: Config, u: Row): Member {
  const m = toMember(c, u);
  if (!m.siteAdmin && u.a_status !== "approved") throw new FriendlyError("Your authority's membership of the FHRG isn't active.", 403);
  if (u.status === "pending") throw new FriendlyError("Your FHRG website account is waiting for approval by your authority's lead.", 403);
  if (u.status !== "approved") throw new FriendlyError("This account has been switched off on the FHRG website.", 403);
  return m;
}

// Attempts are counted in memory the moment a request arrives, before anything has to wait, so that many
// tries sent at once all count. The container runs as one copy, so this is enough. The file for each email
// below keeps the count across a restart.
const attempts = new Map<string, number[]>();
function countAttempt(keys: [string, number][]): boolean {
  const now = Date.now();
  for (const [k, times] of attempts) {
    const live = times.filter((t) => now - t < SIGNIN_WINDOW_MS);
    if (live.length) attempts.set(k, live); else attempts.delete(k);
  }
  if (keys.some(([k, max]) => (attempts.get(k)?.length ?? 0) >= max)) return false;
  for (const [k] of keys) attempts.set(k, [...(attempts.get(k) ?? []), now]);
  return true;
}
function giveBack(keys: string[]): void {
  for (const k of keys) {
    const times = attempts.get(k);
    if (times) { times.pop(); if (!times.length) attempts.delete(k); }
  }
}

async function emailFails(c: Config, email: string): Promise<{ path: string; fails: string[] }> {
  const path = `${c.root}system/signin/${(await sha256("signin|" + email)).slice(0, 24)}.json`;
  const o = await storageJson<{ fails?: string[] }>(c, path, {});
  const fails = (Array.isArray(o.fails) ? o.fails : []).filter((t) => Date.now() - Date.parse(t) < SIGNIN_WINDOW_MS);
  return { path, fails };
}

export async function handleLogin(c: Config, request: Request): Promise<Response> {
  const b = await readJsonBody(request, 10_000);
  const email = cleanText(b.email, 200).toLowerCase();
  const password = typeof b.password === "string" ? b.password.slice(0, 500) : "";
  const remember = b.remember === true;
  if (!email || !password) throw new FriendlyError("Enter your email and password.");
  const tooMany = () => new FriendlyError("Too many unsuccessful sign-ins. Wait 15 minutes and try again. If you've forgotten your password, you can reset it on the FHRG website in the meantime.", 429);
  const ipKey = `ip|${clientIp(request) || "-"}`, emailKey = `email|${email}`;
  if (!countAttempt([[ipKey, SIGNIN_MAX_PER_IP], [emailKey, SIGNIN_MAX_PER_EMAIL]])) throw tooMany();
  let wrongPassword = false;
  try {
    const record = await emailFails(c, email);
    if (record.fails.length >= SIGNIN_MAX_PER_EMAIL) throw tooMany();
    const u = (await websiteQ(c, `${ME_SQL} WHERE u.email = ?`, email))[0];
    const ok = await checkSecret(password, u ? String(u.password_hash || "") : DUMMY_HASH);
    if (!u || !ok) {
      wrongPassword = true;
      try {
        await withLock(record.path, async () => {
          const latest = await emailFails(c, email);
          await storagePut(c, record.path, JSON.stringify({ fails: [...latest.fails, new Date().toISOString()] }));
        });
      } catch (e) { console.log(`[warn] Sign-in count not saved: ${(e as Error).message}`); }
      await delay(400);
      throw new FriendlyError("That email and password don't match an account on the FHRG website.", 401);
    }
    attempts.delete(emailKey);
    if (record.fails.length) await storageDelete(c, record.path).catch(() => {});
    checkAccount(c, u);
    forget(`member|${u.id}`);
    const token = await makeSession(c, Number(u.id), String(u.password_hash), remember);
    return json({ ok: true, token }, 200, { "set-cookie": sessionCookie(token, remember) });
  } finally {
    // only a wrong password counts, not a success or the database being down
    if (!wrongPassword) giveBack([ipKey, emailKey]);
  }
}

// ----- arriving from the FHRG website, already signed in there
// The website's /clarion link will send members to /sso#t=<pass>: a pass that lasts two minutes, works once,
// and is signed with the secret both share. The pass is in the address's #fragment, so it never reaches a
// server log; the page sends it here and gets a session, with the same checks as signing in.
const SSO_EXPIRED = "That sign-in link has expired or has already been used. Open Clarion from the FHRG website again, or sign in with your email and password.";
const usedPasses = new Map<string, number>(); // pass id -> expiry. The container runs as one copy, so this is enough.
let lastSsoWarning = 0;

export async function handleSso(c: Config, request: Request): Promise<Response> {
  if (!c.ssoSecret) throw new FriendlyError("Signing in from the FHRG website isn't set up yet. Sign in with your email and password.", 503);
  const b = await readJsonBody(request, 10_000);
  const pass = cleanText(b.token, 4000);
  const [payload, sig] = pass.split(".");
  if (!payload || !sig || !sameText(sig, await hmac(c.ssoSecret, payload))) {
    if (payload && sig && Date.now() - lastSsoWarning > 60_000) {
      lastSsoWarning = Date.now();
      console.log("[warn] A sign-in pass from the website didn't match SSO_SECRET. Check that the website's CLARION_SSO_SECRET has exactly the same value.");
    }
    throw new FriendlyError(SSO_EXPIRED, 401);
  }
  let claims: Record<string, any>;
  try { claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))); } catch { throw new FriendlyError(SSO_EXPIRED, 401); }
  const now = Date.now();
  if (claims.v !== 1 || claims.aud !== "clarion" || typeof claims.exp !== "number" || claims.exp < now || claims.exp > now + 5 * 60_000 || typeof claims.j !== "string" || !claims.j) throw new FriendlyError(SSO_EXPIRED, 401);
  for (const [k, exp] of usedPasses) if (exp < now) usedPasses.delete(k);
  if (usedPasses.has(claims.j)) throw new FriendlyError(SSO_EXPIRED, 401);
  usedPasses.set(claims.j, claims.exp);
  const u = (await websiteQ(c, `${ME_SQL} WHERE u.id = ?`, Number(claims.u)))[0];
  if (!u || String(u.email).toLowerCase() !== String(claims.e || "").toLowerCase()) throw new FriendlyError(SSO_EXPIRED, 401);
  checkAccount(c, u);
  forget(`member|${u.id}`);
  const token = await makeSession(c, Number(u.id), String(u.password_hash), false);
  return json({ ok: true, token }, 200, { "set-cookie": sessionCookie(token, false) });
}

export function handleLogout(): Response {
  return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
}
