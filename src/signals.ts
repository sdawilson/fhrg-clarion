// Public signals of what people are doing and raising, each read from an open, official feed:
//   - FixMyStreet's public feed: reports by area. Only the category, date and a coarse map square are kept,
//     never the report's words or anyone's name.
//   - Parliament's petitions: signatures by constituency, on road topics.
//   - MPs' written questions on road topics, as public acts in their official role.
//   - GOV.UK search: recent announcements on roads, to choose from for an impact note.
//
// Clarion watches topics and places, never members of the public. A signal that can't be read says so and
// leaves the others standing. Results are cached, so these services are asked rarely and politely.

import type { Constituency, Pilot } from "./pilots";
import { addMonths, cached, cleanText, fetchWithTimeout, londonToday, round } from "./util";

const SIGNAL_MS = 6 * 60 * 60 * 1000;
export const UA = "FHRG-Clarion/1.0 (+https://clarion.fhrg.co.uk)";
const getText = async (url: string, ms = 15000) => {
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "*/*" } }, ms);
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return await res.text();
};
const getJson = async (url: string, ms = 15000): Promise<any> => JSON.parse(await getText(url, ms));

export type Signal<T> = { ok: boolean; data: T | null; note: string; source: string; url: string };
async function read<T>(source: string, url: string, fn: () => Promise<T>): Promise<Signal<T>> {
  try { return { ok: true, data: await fn(), note: "", source, url }; } catch (e) {
    console.log(`[warn] ${source}: ${(e as Error).message}`);
    return { ok: false, data: null, note: "This source couldn't be read just now.", source, url };
  }
}

// ----- FixMyStreet

export type FixMyStreet = { reports: number; from: string; to: string; perDay: number | null; categories: { name: string; count: number }[]; busiestSquare: number };

const RATE_MIN_DAYS = 7;
const codePoint = (n: number) => (n > 31 && n <= 0x10ffff ? String.fromCodePoint(n) : " ");
export const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d{1,7});/g, (_, n) => codePoint(Number(n))).replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => codePoint(parseInt(n, 16))).trim();
export const tag = (block: string, name: string) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")); return m ? decode(m[1]) : ""; };

// Reads the feed's latest reports. The feed shows only the most recent few, which is a sample, not a total,
// and a rate worked out over a few days means little: it's given only for a week or more.
export function readFixMyStreet(xml: string): FixMyStreet {
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  if (!items.length && !/<rss[\s>]/i.test(xml)) throw new Error("not a feed");
  const dates: number[] = [];
  const cats = new Map<string, number>();
  const squares = new Map<string, number>();
  for (const b of items) {
    const t = Date.parse(tag(b, "pubDate"));
    if (Number.isFinite(t)) dates.push(t);
    const cat = cleanText(tag(b, "category"), 80) || "Other";
    cats.set(cat, (cats.get(cat) || 0) + 1);
    const [lat, lon] = tag(b, "georss:point").split(/\s+/).map(Number);
    // two decimal places: a square about a kilometre across
    if (Number.isFinite(lat) && Number.isFinite(lon)) { const k = `${lat.toFixed(2)},${lon.toFixed(2)}`; squares.set(k, (squares.get(k) || 0) + 1); }
  }
  dates.sort((a, b) => a - b);
  const span = dates.length > 1 ? (dates.at(-1)! - dates[0]) / 86400000 : 0;
  return {
    reports: items.length,
    from: dates.length ? new Date(dates[0]).toISOString().slice(0, 10) : "",
    to: dates.length ? new Date(dates.at(-1)!).toISOString().slice(0, 10) : "",
    perDay: span >= RATE_MIN_DAYS ? round(items.length / span, 1) : null,
    categories: [...cats].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    busiestSquare: Math.max(0, ...squares.values()),
  };
}

export const fixMyStreetUrl = (p: Pilot) => `https://www.fixmystreet.com/rss/reports/${p.fixMyStreetArea}`;

function fixMyStreet(p: Pilot): Promise<Signal<FixMyStreet>> {
  const url = fixMyStreetUrl(p);
  return read("FixMyStreet public feed", url, () => cached(`fms|${p.code}`, SIGNAL_MS, async () => readFixMyStreet(await getText(url))));
}

// ----- petitions

export type Petition = { title: string; url: string; signatures: number; local: number; localShare: number; fairShare: number };
const PETITION_TERMS = ["pothole", "road", "highway", "speed limit", "roadworks"];
const NOT_ROADS = /\b(air traffic|internet traffic|web traffic|road to|road map|rail and road)\b/gi; // the same words used of something else
const onRoads = (text: string) => ROAD_TOPIC.test(text.replace(NOT_ROADS, " "));
const ROAD_TOPIC = /\b(pothole|potholes|road|roads|highway|highways|pavement|pavements|speed limit|speed limits|20 ?mph|roadworks|road works|traffic|motorist|motorists|cycle lane|cycle lanes)\b/i;
const CONSTITUENCIES = 650;

async function roadPetitions(): Promise<{ id: number; title: string; signatures: number }[]> {
  return await cached("petitions", SIGNAL_MS, async () => {
    const found = new Map<number, { id: number; title: string; signatures: number }>();
    for (const term of PETITION_TERMS) {
      const j = await getJson(`https://petition.parliament.uk/petitions.json?state=open&q=${encodeURIComponent(term)}`);
      for (const d of Array.isArray(j?.data) ? j.data : []) {
        const a = d?.attributes;
        if (!Number.isInteger(d?.id) || !a) continue;
        if (onRoads(`${a.action ?? ""} ${a.background ?? ""}`)) found.set(d.id, { id: d.id, title: cleanText(a.action, 200), signatures: Number(a.signature_count) || 0 });
      }
    }
    return [...found.values()].sort((a, b) => b.signatures - a.signatures).slice(0, 6);
  });
}

export function localSignatures(detail: any, constituencies: Constituency[]): number {
  const names = new Set(constituencies.map((x) => x.name.toLowerCase()));
  const list: any[] = detail?.data?.attributes?.signatures_by_constituency;
  return Array.isArray(list) ? list.filter((x) => names.has(String(x?.name).toLowerCase())).reduce((sum, x) => sum + (Number(x?.signature_count) || 0), 0) : 0;
}

function petitions(p: Pilot): Promise<Signal<Petition[]>> {
  return read("Parliament petitions", "https://petition.parliament.uk/", () => cached(`petitions|${p.code}`, SIGNAL_MS, async () => {
    const out: Petition[] = [];
    for (const x of await roadPetitions()) {
      const url = `https://petition.parliament.uk/petitions/${x.id}`;
      const detail = await cached(`petition|${x.id}`, SIGNAL_MS, () => getJson(`${url}.json`));
      const local = localSignatures(detail, p.constituencies);
      out.push({ title: x.title, url, signatures: x.signatures, local, localShare: x.signatures ? round((local / x.signatures) * 100) : 0, fairShare: round((p.constituencies.length / CONSTITUENCIES) * 100) });
    }
    return out;
  }));
}

// ----- MPs and their written questions

export type Question = { date: string; heading: string; member: string; text: string; url: string };
const QUESTIONS_PAGE = 100;
const QUESTIONS_MOST_PAGES = 8; // one busy MP can ask over 500 questions in six months

async function members(p: Pilot): Promise<Map<number, string>> {
  return await cached(`mps|${p.code}`, 24 * 60 * 60 * 1000, async () => {
    const out = new Map<number, string>();
    for (const x of p.constituencies) {
      const j = await getJson(`https://members-api.parliament.uk/api/Location/Constituency/Search?searchText=${encodeURIComponent(x.name)}&take=10`);
      const hit = (Array.isArray(j?.items) ? j.items : []).map((i: any) => i?.value).find((v: any) => String(v?.name).toLowerCase() === x.name.toLowerCase() && !v?.endDate);
      const m = hit?.currentRepresentation?.member?.value;
      if (Number.isInteger(m?.id)) out.set(m.id, `${cleanText(m.nameDisplayAs, 100)} (${x.name})`);
    }
    return out;
  });
}

function questions(p: Pilot): Promise<Signal<Question[]>> {
  return read("Parliament written questions", "https://questions-statements.parliament.uk/", () => cached(`questions|${p.code}`, SIGNAL_MS, async () => {
    const mps = await members(p);
    if (!mps.size) throw new Error("no MPs found");
    const from = addMonths(londonToday(), -6);
    const found = new Map<number, Question>();
    // Each MP in turn, then the road topics: searching by topic across all MPs would crowd these ones out.
    for (const [id, member] of mps) {
      for (let page = 0; page < QUESTIONS_MOST_PAGES; page++) {
        const j = await getJson(`https://questions-statements-api.parliament.uk/api/writtenquestions/questions?askingMemberId=${id}&tabledWhenFrom=${from}&skip=${page * QUESTIONS_PAGE}&take=${QUESTIONS_PAGE}`);
        const results: any[] = Array.isArray(j?.results) ? j.results : [];
        for (const r of results) {
          const v = r?.value;
          if (!Number.isInteger(v?.id) || v.askingMemberId !== id || !onRoads(`${v.heading ?? ""} ${v.questionText ?? ""}`)) continue;
          const date = String(v.dateTabled ?? "").slice(0, 10);
          found.set(v.id, {
            date, heading: cleanText(v.heading, 200), member, text: cleanText(v.questionText, 400),
            url: `https://questions-statements.parliament.uk/written-questions/detail/${date}/${encodeURIComponent(String(v.uin ?? ""))}`,
          });
        }
        if (results.length < QUESTIONS_PAGE) break;
      }
    }
    return [...found.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
  }));
}

// ----- GOV.UK announcements

export type Announcement = { title: string; url: string; date: string; summary: string };
const GOVUK_ORGS = ["department-for-transport", "ministry-of-housing-communities-local-government", "national-highways", "active-travel-england"];
const GOVUK_TOPIC = /\b(road|roads|highway|highways|pothole|potholes|street|streets|traffic|pavement|cycling|walking)\b/i;

export async function announcements(): Promise<Announcement[]> {
  return await cached("announcements", 60 * 60 * 1000, async () => {
    const found = new Map<string, Announcement>();
    for (const q of ["highways maintenance", "local roads"]) {
      const orgs = GOVUK_ORGS.map((o) => `filter_organisations=${o}`).join("&");
      const j = await getJson(`https://www.gov.uk/api/search.json?q=${encodeURIComponent(q)}&${orgs}&order=-public_timestamp&count=25&fields=title&fields=link&fields=public_timestamp&fields=description`);
      for (const r of Array.isArray(j?.results) ? j.results : []) {
        const title = cleanText(r?.title, 200), summary = cleanText(r?.description, 300), link = String(r?.link ?? "");
        if (!title || !link.startsWith("/") || !GOVUK_TOPIC.test(`${title} ${summary}`)) continue;
        found.set(link, { title, summary, url: `https://www.gov.uk${link}`, date: String(r.public_timestamp ?? "").slice(0, 10) });
      }
    }
    return [...found.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  });
}

export type Signals = { fixMyStreet: Signal<FixMyStreet>; petitions: Signal<Petition[]>; questions: Signal<Question[]> };

export async function loadSignals(p: Pilot): Promise<Signals> {
  const [a, b, c] = await Promise.all([fixMyStreet(p), petitions(p), questions(p)]);
  return { fixMyStreet: a, petitions: b, questions: c };
}
