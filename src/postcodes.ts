// The optional first half of a postcode on a self-completed survey. It answers one question: does this person live in
// the authority? Only that goes on the reply. The area itself goes into a separate tally, with no link to anyone's
// answers, and the rest of a postcode is thrown away on arrival. postcodes.io is asked once for each area, and it's sent
// the first half only, by the server, so it learns nothing about who typed it.

import type { Config } from "./config";
import type { Pilot } from "./pilots";
import { storageJson, storagePut } from "./storage";
import { fetchWithTimeout } from "./util";

export type Where = "here" | "elsewhere" | "unknown";
type Area = { districts: string[]; counties: string[] };

const LOOKUP_MS = 3000;
const OUTCODE = /^[A-Z]{1,2}[0-9][0-9A-Z]?$/;
const held = new Map<string, Area>();
const filePath = (c: Config, outcode: string) => `${c.root}reference/outcodes/${outcode}.json`;
const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The first half of whatever was typed, or null if it isn't one. A whole postcode loses its second half here. */
export function outcodeOf(v: unknown): string | null {
  const typed = String(v ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim();
  const first = typed.includes(" ") ? typed.split(/\s+/)[0] : typed.length > 4 ? typed.slice(0, -3) : typed;
  return OUTCODE.test(first) ? first : null;
}

export async function areaOf(c: Config, outcode: string): Promise<Area | null> {
  const known = held.get(outcode);
  if (known) return known;
  try {
    let area = await storageJson<Area | null>(c, filePath(c, outcode), null);
    if (!area) {
      const res = await fetchWithTimeout(`https://api.postcodes.io/outcodes/${outcode}`, {}, LOOKUP_MS);
      if (!res.ok) return null;
      const { result } = (await res.json()) as { result?: { admin_district?: unknown; admin_county?: unknown } };
      if (!result) return null;
      area = { districts: names(result.admin_district), counties: names(result.admin_county) };
      await storagePut(c, filePath(c, outcode), JSON.stringify(area));
    }
    held.set(outcode, area);
    return area;
  } catch (e) {
    console.log(`[warn] postcode area: ${(e as Error).message}`); // a reply must never be lost to this
    return null;
  }
}

// An area can cross a boundary, so this means "may live here". Better to keep a neighbour in than leave a resident out
export function whereIs(p: Pilot, area: Area | null): Where {
  if (!area) return "unknown";
  const name = p.name.toLowerCase();
  return [...area.districts, ...area.counties].some((x) => x.toLowerCase() === name) ? "here" : "elsewhere";
}
