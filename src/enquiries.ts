// What people contact an authority about, from its own records, and its own news page.
//
// The officer's browser reads the file and sends only counts, so names, addresses, emails and free text never reach
// Clarion. The tallies by category, by area and by route are kept apart, so that nothing here can be narrowed down to one
// person's contact, and an area with fewer than 10 contacts in a month isn't shown.
//
// A news page is read with plain code, not Claude. Only an authority's own site can be read, and only each post's title,
// link and date are kept, in memory.
//
// File, under ROOT_FOLDER: authorities/<code>/enquiries.json

import type { Member } from "./accounts";
import type { Config } from "./config";
import type { Pilot } from "./pilots";
import { UA, decode, tag } from "./signals";
import { savePretty, storageJson } from "./storage";
import { scrubContacts } from "./surveyai";
import { FriendlyError, cached, cleanText, fetchWithTimeout, londonToday, round, withLock } from "./util";

type Tally = Record<string, number>;
export type Month = { categories: Record<string, [number, number]>; areas: Tally; routes: Tally }; // a category holds [enquiries, complaints]
export type ImportNote = { id: string; file: string; months: string[]; rows: number; added: number; skipped: number; at: string; by: string };
export type Held = { months: Record<string, Month>; matches: Record<string, string>; imports: ImportNote[]; page: string };
export type Post = { title: string; url: string; date: string };

const MAX_MONTHS = 60;
const MAX_CATEGORIES = 150;
const MAX_AREAS = 1500;
const MAX_ROUTES = 25;
const MAX_IMPORTS = 24;
const LABEL_CHARS = 60;
const SHOW_FROM = 10; // an area with fewer contacts than this isn't shown
const TOP_AREAS = 12;
const QUARTER = 3;
const CHANGE = 0.2; // closer than this to the quarter before counts as steady
const NEWS_MS = 24 * 60 * 60 * 1000;
const MAX_PAGE_CHARS = 3000000;
const MAX_POSTS = 8;
// Councils' own sites. One on another address is listed against the authority, in pilots.ts
const OFFICIAL = [".gov.uk", ".gov.scot", ".gov.wales", ".llyw.cymru"];

const path = (c: Config, code: string) => `${c.root}authorities/${code}/enquiries.json`;
const empty = (): Held => ({ months: {}, matches: {}, imports: [], page: "" });

export async function loadEnquiries(c: Config, code: string): Promise<Held> {
  const held = await storageJson<Partial<Held>>(c, path(c, code), {});
  return { ...empty(), ...held };
}

// ----- bringing in counts

/** A category, area or route as sent. Anything long, or that looks like contact details, isn't a label and is left out. */
function readLabel(v: string): string {
  const label = cleanText(v, LABEL_CHARS + 1);
  if (!label || label.length > LABEL_CHARS || /^(__proto__|constructor|prototype)$/.test(label) || scrubContacts(label) !== label) return "";
  return label;
}
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10000000 ? (v as number) : 0);
const tooVaried = (distinct: number, rows: number) => rows > 50 && distinct > rows / 2;

/** The counts a browser sends, checked again here. A column with too many different values is free text, not a list. */
export function readImport(b: any, thisMonth: string): { months: Record<string, Month>; rows: number; skipped: number; added: number } {
  const sent = b?.months && typeof b.months === "object" ? Object.entries(b.months as Record<string, any>) : [];
  if (!sent.length) throw new FriendlyError("No rows had a date Clarion could read, so nothing was brought in.");
  if (sent.length > MAX_MONTHS) throw new FriendlyError(`Bring in up to ${MAX_MONTHS} months at a time.`);
  const rows = count(b?.rows), skipped = count(b?.skipped), months: Record<string, Month> = {};
  const seen = { categories: new Set<string>(), areas: new Set<string>(), routes: new Set<string>() };
  let added = 0;
  for (const [month, m] of sent) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > thisMonth) throw new FriendlyError("A month in that file is in the future or can't be read.");
    const out: Month = { categories: Object.create(null), areas: Object.create(null), routes: Object.create(null) };
    for (const [name, v] of Object.entries((m?.categories ?? {}) as Record<string, unknown>)) {
      const label = readLabel(name), pair = Array.isArray(v) ? v : [];
      if (!label) continue;
      const was = out.categories[label] ?? [0, 0];
      out.categories[label] = [was[0] + count(pair[0]), was[1] + count(pair[1])];
      seen.categories.add(label);
      added += count(pair[0]) + count(pair[1]);
    }
    for (const part of ["areas", "routes"] as const) for (const [name, v] of Object.entries((m?.[part] ?? {}) as Record<string, unknown>)) {
      const label = readLabel(name);
      if (!label || !count(v)) continue;
      out[part][label] = (out[part][label] ?? 0) + count(v);
      seen[part].add(label);
    }
    months[month] = { categories: { ...out.categories }, areas: { ...out.areas }, routes: { ...out.routes } };
  }
  if (!added) throw new FriendlyError("No rows had a category Clarion could use, so nothing was brought in.");
  const varied = Math.max(added, rows);
  if (seen.categories.size > MAX_CATEGORIES || tooVaried(seen.categories.size, varied)) throw new FriendlyError("There are too many different categories for that to be a list of categories. Check the column you chose.");
  if (seen.areas.size > MAX_AREAS || tooVaried(seen.areas.size, varied)) throw new FriendlyError("There are too many different areas for that to be a list of wards or roads. Check the column you chose.");
  if (seen.routes.size > MAX_ROUTES) throw new FriendlyError("There are too many different ways in for that to be a list of routes. Check the column you chose.");
  return { months, rows, skipped, added };
}

const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// A month in the file replaces what's held for that month, so bringing in a file twice doesn't count anything twice
export async function saveImport(c: Config, me: Member, p: Pilot, b: any): Promise<ImportNote> {
  const read = readImport(b, londonToday().slice(0, 7));
  return await withLock(path(c, p.code), async () => {
    const held = await loadEnquiries(c, p.code), months = Object.keys(read.months).sort();
    const note: ImportNote = { id: newId(), file: cleanText(b?.file, 120), months, rows: read.rows, added: read.added, skipped: read.skipped, at: new Date().toISOString(), by: me.name };
    const earlier = held.imports.map((x) => ({ ...x, months: x.months.filter((m) => !months.includes(m)) })).filter((x) => x.months.length);
    await savePretty(c, path(c, p.code), { ...held, months: { ...held.months, ...read.months }, imports: [note, ...earlier].slice(0, MAX_IMPORTS) });
    return note;
  });
}

export async function removeImport(c: Config, p: Pilot, id: unknown): Promise<void> {
  await withLock(path(c, p.code), async () => {
    const held = await loadEnquiries(c, p.code), gone = held.imports.find((x) => x.id === id);
    if (!gone) throw new FriendlyError("That import wasn't found.", 404);
    const months = Object.fromEntries(Object.entries(held.months).filter(([m]) => !gone.months.includes(m)));
    await savePretty(c, path(c, p.code), { ...held, months, imports: held.imports.filter((x) => x.id !== id) });
  });
}

export async function saveMatch(c: Config, p: Pilot, b: any, topics: string[]): Promise<void> {
  const category = readLabel(String(b?.category ?? "")), topic = cleanText(b?.topic, 80);
  if (!category) throw new FriendlyError("Choose a category.");
  if (topic && !topics.includes(topic)) throw new FriendlyError("Choose a topic.");
  await withLock(path(c, p.code), async () => {
    const held = await loadEnquiries(c, p.code);
    await savePretty(c, path(c, p.code), { ...held, matches: { ...held.matches, [category]: topic } });
  });
}

// ----- sorting into topics

// Each pair is how to recognise a shared topic's name, and the words that belong to it
const HINTS: [RegExp, RegExp][] = [
  [/pothole|road condition|road surface|carriageway/i, /pothole|carriageway|road defect|road surface|road repair|resurfac|highway defect/i],
  [/pavement|footway/i, /pavement|footway|footpath|dropped kerb/i],
  [/street ?light/i, /street ?light|lighting|lamp ?post|lantern/i],
  [/flood|drain/i, /flood|drain|gull(y|ies)|ditch/i],
  [/winter|grit/i, /grit|snow|\bice\b|\bsalt|winter/i],
  [/parking/i, /parking|permit/i],
  [/roadworks/i, /roadworks|street ?works|road clos|lane clos|temporary lights/i],
  [/safety|speed/i, /speed|road safety|collision|crossing/i],
  [/traffic|congestion/i, /traffic|congestion|signal/i],
  [/cycl|walking/i, /cycl|walking|rights? of way|bridleway/i],
  [/tree|verge/i, /\btrees?\b|verge|hedge|grass|vegetation|overgrown/i],
  [/\bbus|public transport/i, /\bbus(es)?\b|bus lane|public transport/i],
];
/** The shared topic something belongs to, by its words, or nothing. An officer can change this. */
export function topicFor(text: string, topics: string[]): string {
  for (const [name, words] of HINTS) {
    if (!words.test(text)) continue;
    const topic = topics.find((t) => name.test(t));
    if (topic) return topic;
  }
  return topics.find((t) => t.toLowerCase() === text.trim().toLowerCase()) ?? "";
}

/** The latest month against the three before it. Needs all four, and more than a few contacts. */
export function trendOf(latest: number, before: (number | undefined)[]): string {
  if (before.length < QUARTER || before.some((x) => x === undefined)) return "Not enough history";
  const base = (before as number[]).reduce((sum, n) => sum + n, 0) / QUARTER;
  if (latest < SHOW_FROM && base < SHOW_FROM) return "Too few to say";
  return latest >= base * (1 + CHANGE) ? "Rising" : latest <= base * (1 - CHANGE) ? "Falling" : "Steady";
}

const shift = (month: string, by: number) => { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1)); return d.toISOString().slice(0, 7); };

export function enquiriesView(held: Held, adults: number | null, topics: string[]) {
  const months = Object.keys(held.months).sort(), latest = months.at(-1) ?? "";
  if (!latest) return { ready: false as const };
  const topicOf = (name: string) => (name in held.matches ? held.matches[name] : topicFor(name, topics));
  const total = (m: Month | undefined, keep: (name: string) => boolean) => (m ? Object.entries(m.categories).filter(([name]) => keep(name)).reduce((sum, [, v]) => sum + v[0] + v[1], 0) : undefined);
  const now = held.months[latest], names = [...new Set(months.flatMap((m) => Object.keys(held.months[m].categories)))].sort();
  const perThousand = (n: number) => (adults ? round((n / adults) * 1000) : null);
  const rows = [...new Set(names.map(topicOf).filter(Boolean))].map((topic) => {
    const mine = names.filter((n) => topicOf(n) === topic), keep = (n: string) => mine.includes(n);
    const enquiries = mine.reduce((sum, n) => sum + (now.categories[n]?.[0] ?? 0), 0), complaints = mine.reduce((sum, n) => sum + (now.categories[n]?.[1] ?? 0), 0);
    return { topic, categories: mine, enquiries, complaints, perThousand: perThousand(enquiries + complaints), trend: trendOf(enquiries + complaints, [1, 2, 3].map((i) => total(held.months[shift(latest, -i)], keep))) };
  }).sort((a, b) => b.enquiries + b.complaints - a.enquiries - a.complaints || a.topic.localeCompare(b.topic));
  const left = names.filter((n) => !topicOf(n));
  const areas = Object.entries(now.areas).filter(([, n]) => n >= SHOW_FROM).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const routeTotal = Object.values(now.routes).reduce((sum, n) => sum + n, 0);
  return {
    ready: true as const, latest, monthsHeld: months.length, rows,
    unmatched: { categories: left, enquiries: left.reduce((sum, n) => sum + (now.categories[n]?.[0] ?? 0), 0), complaints: left.reduce((sum, n) => sum + (now.categories[n]?.[1] ?? 0), 0) },
    categories: names.map((name) => ({ name, topic: topicOf(name) })), areas: areas.slice(0, TOP_AREAS).map(([name, n]) => ({ name, n })), hiddenAreas: Object.keys(now.areas).length - areas.length,
    routes: Object.entries(now.routes).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, share: Math.round((n / (routeTotal || 1)) * 100) })),
  };
}

// ----- the council's own news page

/** An address is read only if it's the authority's own site, in full and over https. */
export function ownSite(address: string, p: Pick<Pilot, "ownSites">): boolean {
  let u: URL;
  try { u = new URL(address); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  return OFFICIAL.some((x) => host.endsWith(x)) || (p.ownSites ?? []).some((x) => host === x || host.endsWith(`.${x}`));
}

export async function savePage(c: Config, p: Pilot, url: unknown): Promise<void> {
  const address = String(url ?? "").trim().slice(0, 300);
  if (address && !ownSite(address, p)) throw new FriendlyError("Use your council's own news page: an https address ending .gov.uk, for example. If your news is on another site, ask the FHRG team to add it.");
  await withLock(path(c, p.code), async () => {
    const held = await loadEnquiries(c, p.code);
    await savePretty(c, path(c, p.code), { ...held, page: address });
  });
}

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const iso = (year: string, month: string, day: string) => {
  const m = MONTHS.split("|").findIndex((x) => x.startsWith(month.toLowerCase().slice(0, 3))) + 1;
  return m ? `${year}-${String(m).padStart(2, "0")}-${day.padStart(2, "0")}` : "";
};
function firstDate(html: string): string {
  const stamp = html.match(/<time[^>]*datetime\s*=\s*["'](\d{4}-\d{2}-\d{2})/i);
  if (stamp) return stamp[1];
  const text = html.replace(/<[^>]+>/g, " ");
  const uk = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\s+(\\d{4})\\b`, "i"));
  if (uk) return iso(uk[3], uk[2], uk[1]);
  const us = text.match(new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"));
  return us ? iso(us[3], us[1], us[2]) : "";
}
const dateInAddress = (p: string) => { const m = p.match(/\/(20\d{2})\/(\d{2})\/(\d{2})\//); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; };

/** Pulls posts out of a news page: links below it with a real title, and a date in the address or near the link. */
export function postsFromPage(html: string, address: string): Post[] {
  const base = new URL(address), root = base.pathname.replace(/\/+$/, ""), host = (h: string) => h.replace(/^www\./, "");
  const links = [...html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)], found = new Map<string, Post>();
  links.forEach((m, i) => {
    let u: URL;
    try { u = new URL(decode(m[1]), base); } catch { return; }
    const where = u.pathname.replace(/\/+$/, ""), last = where.split("/").pop() ?? "";
    if (u.protocol !== "https:" || host(u.hostname) !== host(base.hostname) || u.search || where === root || !where.startsWith(root)) return;
    if (!/[a-z0-9]-[a-z0-9]/i.test(last) || /\/(category|tag|author|page|feed|search|wp-[a-z]+)(\/|$)/i.test(where)) return;
    const title = cleanText(decode(m[2].replace(/<[^>]+>/g, " ")), 200);
    if (title.length < 15 || /^(read more|find out more|view all)/i.test(title)) return;
    const date = dateInAddress(`${where}/`) || firstDate(html.slice(m.index, links[i + 1]?.index ?? m.index + 800)) || firstDate(html.slice(Math.max(0, m.index - 300), m.index));
    const was = found.get(u.href);
    if (!was || title.length > was.title.length) found.set(u.href, { title, url: u.href, date: date || was?.date || "" });
  });
  const all = [...found.values()], dated = all.filter((x) => x.date);
  return dated.length >= 3 ? dated : all;
}

export function postsFromFeed(xml: string): Post[] {
  return [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].flatMap(([block]) => {
    const link = tag(block, "link") || (block.match(/<link[^>]*href\s*=\s*["']([^"']+)["']/i)?.[1] ?? "");
    const stamp = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated"), when = new Date(stamp);
    const title = cleanText(decode(tag(block, "title").replace(/<[^>]+>/g, " ")), 200);
    return title && /^https:\/\//i.test(link) ? [{ title, url: link, date: isNaN(when.getTime()) ? "" : when.toISOString().slice(0, 10) }] : [];
  });
}

async function fetchOwn(address: string, p: Pilot): Promise<string> {
  let at = address;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchWithTimeout(at, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8" } }, 12000);
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get("location") ?? "", at).href;
      if (!ownSite(next, p)) throw new Error("the news page moves to a site that isn't the council's own");
      at = next;
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(at).hostname} answered ${res.status}`);
    return (await res.text()).slice(0, MAX_PAGE_CHARS);
  }
  throw new Error("the news page moves too many times");
}

const ROAD_WORDS = /\b(roads?|highways?|traffic|transport|potholes?|gritt(ing|ers?)|roadworks|pavements?|footways?|cycling|parking|street ?lights?|buses|bus)\b/i;

/** Road posts from an authority's news page, newest first. A site's feed is used if it has one, as that's the tidier source. */
export async function readNews(p: Pilot, address: string, topics: string[]): Promise<(Post & { topic: string })[]> {
  const all = await cached(`news|${address}`, NEWS_MS, async () => {
    const html = await fetchOwn(address, p);
    const link = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((x) => /application\/(rss|atom)\+xml/i.test(x) && !/comments/i.test(x));
    const feed = link?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (feed) {
      try {
        const where = new URL(decode(feed), address).href, posts = ownSite(where, p) ? postsFromFeed(await fetchOwn(where, p)) : [];
        if (posts.length >= 3) return posts;
      } catch (e) { console.log(`[warn] news feed: ${(e as Error).message}`); }
    }
    return postsFromPage(html, address);
  });
  return all.map((x) => ({ ...x, topic: topicFor(x.title, topics) || (ROAD_WORDS.test(x.title) ? "Roads" : "") })).filter((x) => x.topic)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_POSTS);
}
