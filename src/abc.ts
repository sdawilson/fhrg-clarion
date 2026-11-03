// ABC's register of regional titles, as an FHRG administrator pastes it from ABC's site, so an officer adding a source
// can take its reach from there. ABC's figures are its own: they're kept in Clarion's storage, not in the code or the
// shared reference library, and an officer sees only the titles that match what they've typed, always credited to ABC.
//
// File, under ROOT_FOLDER: reference/abc-titles.json

import type { Member } from "./accounts";
import type { Config } from "./config";
import { savePretty, storageJson } from "./storage";
import { FriendlyError, cached, cleanText, forget } from "./util";

export type Title = { name: string; owner: string; period: string; total: number };
type Held = { titles: Title[]; at: string; by: string };

const MAX_TITLES = 5000;
const MATCHES = 6;
const HOUR_MS = 60 * 60 * 1000;
const NO_WORDS = new Set(["the", "and", "of", "a", "news", "series"]);

const path = (c: Config) => `${c.root}reference/abc-titles.json`;
const words = (s: string) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !NO_WORDS.has(w));

/**
 * The table as it's copied from ABC's page: period, title, owner, sector, total and metric, with a tab between each.
 * Headings and anything else that isn't a row are passed over. A spreadsheet can turn "Dec 2025" into "Dec-25".
 */
export function readTable(text: unknown): Title[] {
  const found = new Map<string, Title>();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const cells = line.split("\t").map((x) => cleanText(x, 120));
    if (cells.length < 5 || !cells[0] || !cells[1]) continue;
    const total = Number(cells[4].replace(/[,\s]/g, ""));
    if (!Number.isInteger(total) || total <= 0 || (cells[5] && !/^circulation/i.test(cells[5]))) continue;
    const period = cells[0].replace(/^([A-Z][a-z]{2})-(\d{2})$/, "$1 20$2");
    found.set(`${cells[1]}|${cells[2]}`.toLowerCase(), { name: cells[1], owner: cells[2], period, total });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function load(c: Config): Promise<Held | null> {
  return await cached("abc-titles", HOUR_MS, () => storageJson<Held | null>(c, path(c), null));
}

export async function saveTitles(c: Config, me: Member, text: unknown): Promise<{ count: number; at: string; by: string }> {
  const titles = readTable(text);
  if (!titles.length) throw new FriendlyError("No titles were found in that. Copy the rows from ABC's table, with their columns, and paste them here.");
  if (titles.length > MAX_TITLES) throw new FriendlyError(`That's more than ${MAX_TITLES.toLocaleString("en-GB")} titles. Paste the regional publications only.`);
  const held = { titles, at: new Date().toISOString(), by: me.name };
  await savePretty(c, path(c), held);
  forget("abc-titles");
  return { count: titles.length, at: held.at, by: held.by };
}

export async function titlesHeld(c: Config): Promise<{ count: number; at: string; by: string }> {
  const held = await load(c);
  return { count: held?.titles.length ?? 0, at: held?.at ?? "", by: held?.by ?? "" };
}

/** Titles with every word typed in their name, closest first. Only these go to the page, never the whole list. */
export function closest(titles: Title[], typed: unknown): Title[] {
  const asked = words(cleanText(typed, 100));
  if (!asked.length || asked.join("").length < 3) return [];
  return titles.map((t) => ({ t, have: words(t.name) })).filter(({ have }) => asked.every((w) => have.some((x) => x.startsWith(w))))
    .sort((a, b) => a.have.length - b.have.length || a.t.name.localeCompare(b.t.name)).slice(0, MATCHES).map(({ t }) => t);
}

export async function findTitles(c: Config, typed: unknown): Promise<Title[]> {
  return closest((await load(c))?.titles ?? [], typed);
}
