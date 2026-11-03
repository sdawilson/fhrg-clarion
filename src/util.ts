// Small helpers used across Clarion.

export class FriendlyError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

export function sameText(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

// keeps line breaks
export function cleanLong(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

export function londonToday(date = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** A date some months after an ISO date. */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Strict tools don't guarantee the capitals in a listed value ("Highly Likely"), so match without them.
export function pickEnum<T extends string>(options: readonly T[], v: unknown): T | undefined {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return options.find((o) => o.toLowerCase() === s);
}

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s));

// A request's body, refused as soon as it passes the limit (so an outsized request can't fill memory)
async function readBodyBytes(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new FriendlyError("Request too large.", 413);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); throw new FriendlyError("Request too large.", 413); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

export async function readJsonBody(request: Request, limit = 100_000): Promise<Record<string, any>> {
  // the limit is in characters; UTF-8 takes up to three bytes for each
  const text = new TextDecoder().decode(await readBodyBytes(request, limit * 3));
  if (text.length > limit) throw new FriendlyError("Request too large.", 413);
  try {
    const body = JSON.parse(text || "{}");
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    throw new FriendlyError("Request was not valid JSON.", 400);
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

const memCache = new Map<string, { at: number; value: any }>();
export async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const value = await fn();
  memCache.set(key, { at: Date.now(), value });
  return value;
}
export function isCached(key: string, ms: number): boolean {
  const hit = memCache.get(key);
  return !!hit && Date.now() - hit.at < ms;
}
export function forget(prefix: string): void {
  for (const k of [...memCache.keys()]) if (k.startsWith(prefix)) memCache.delete(k);
}

// Something from outside that a page can do without. The page waits a moment and carries on without it, and the work
// keeps going so the next visitor gets what it found. If it failed, it's left alone for a few minutes rather than being
// tried again on every click, and whatever it did manage is used in the meantime.
const BRIEF_MS = 3000;
const REST_MS = 5 * 60 * 1000;
const underway = new Map<string, Promise<unknown>>();
const resting = new Map<string, { until: number; value: unknown }>();
export function briefly<T, F>(key: string, without: F, fn: () => Promise<T>, failed: (v: T) => boolean = () => false, ms = BRIEF_MS): Promise<T | F> {
  const rest = resting.get(key);
  if (rest && rest.until > Date.now()) return Promise.resolve(rest.value as T | F);
  let job = underway.get(key) as Promise<T | F> | undefined;
  if (!job) {
    const leave = (value: T | F) => { resting.set(key, { until: Date.now() + REST_MS, value }); };
    job = fn().then((v) => { if (failed(v)) leave(v); return v; }, () => { leave(without); return without; }).finally(() => { underway.delete(key); });
    underway.set(key, job);
  }
  const running = job;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(without), ms);
    running.then((v) => { clearTimeout(timer); resolve(v); });
  });
}

// One writer at a time for a shared file. The container runs as exactly one copy, so this is enough.
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const round = (n: number, places = 1) => { const f = 10 ** places; return Math.round(n * f) / f; };
