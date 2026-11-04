// Bunny Storage: Clarion's own zone. Everything Clarion keeps is a JSON file under ROOT_FOLDER:
//   system/signin/<hash>.json                  failed sign-ins for an address, for the 15 minutes they count
//   usage/<yyyy-mm>.json                       the month's estimated Claude spend
//   authorities/<code>/facts.json              survey results and notes added by officers
//   authorities/<code>/readings/<id>.json      mood readings
//   authorities/<code>/notes/<id>.json         impact notes
//   authorities/<code>/forecasts.json          every forecast made, with its check date
//   authorities/<code>/surveys/ and survey-*/  street surveys and their answers (see surveys.ts)
//   authorities/<code>/sources.json            the sources an authority follows (see coverage.ts)
//   authorities/<code>/assessments.json        its officers' assessments of what they've found
//   authorities/<code>/setup.json              functions, key partners and campaign channels (see setup.ts)
//   authorities/<code>/campaign.json           high-impact issues and the campaign calendar (see campaign.ts)
//   authorities/<code>/monthly.json            fault reports and petitions, kept by month for the map
//   system/survey-codes/<code>.json            which survey an access code opens
//   system/mood-weights.json                   what each branch of the map counts for in the mood

import type { Config } from "./config";
import { fetchWithTimeout } from "./util";

const STORAGE_MS = 30_000;

function storageUrl(c: Config, path: string): string {
  const p = path.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `https://${c.storageHost}/${encodeURIComponent(c.storageZone)}/${p}`;
}

export async function storageGet(c: Config, path: string): Promise<string | null> {
  const res = await fetchWithTimeout(storageUrl(c, path), { headers: { AccessKey: c.storageKey } }, STORAGE_MS);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage returned ${res.status} for ${path}. Check STORAGE_ZONE, STORAGE_HOST and STORAGE_ACCESS_KEY.`);
  return await res.text();
}

export async function storagePut(c: Config, path: string, body: string, contentType = "application/json"): Promise<void> {
  const res = await fetchWithTimeout(storageUrl(c, path), { method: "PUT", headers: { AccessKey: c.storageKey, "Content-Type": contentType }, body }, STORAGE_MS);
  if (!res.ok) throw new Error(`Storage refused to save ${path} (status ${res.status}). The storage password may be the read-only one.`);
}

export async function storageDelete(c: Config, path: string): Promise<void> {
  const res = await fetchWithTimeout(storageUrl(c, path), { method: "DELETE", headers: { AccessKey: c.storageKey } }, STORAGE_MS);
  if (!res.ok && res.status !== 404) throw new Error(`Storage refused to delete ${path} (status ${res.status}).`);
}

export async function storageJson<T>(c: Config, path: string, fallback: T): Promise<T> {
  const t = await storageGet(c, path);
  if (t === null) return fallback;
  try { return JSON.parse(t) as T; } catch { return fallback; }
}

export const savePretty = (c: Config, path: string, value: unknown) => storagePut(c, path, JSON.stringify(value, null, 2));

// The names of the files in a storage folder (not its sub-folders).
export async function storageList(c: Config, folderPath: string): Promise<string[]> {
  const res = await fetchWithTimeout(storageUrl(c, folderPath.replace(/\/?$/, "/")), { headers: { AccessKey: c.storageKey, Accept: "application/json" } }, STORAGE_MS);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Storage returned ${res.status} listing ${folderPath}.`);
  const list: any = await res.json().catch(() => []);
  return Array.isArray(list) ? list.filter((o) => o && !o.IsDirectory && typeof o.ObjectName === "string").map((o) => String(o.ObjectName)) : [];
}
