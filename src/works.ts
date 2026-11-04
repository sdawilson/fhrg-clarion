// Works and weather: what happened on the network, beside what people said about it. It reads an authority's records
// and weather from the Climate Toolkit's storage zone with that zone's read-only password, and changes nothing there.
//
// A lead of the authority turns this on, which records the authority's id on the website, as that names its folder in
// the Toolkit. Turning it off removes everything held here. Only weekly totals by function and source, ward totals and
// weather events are kept: street names, job references, costs and everything else in a record are never read into
// anything that's saved. Works and weather explain a change in mood. Jobs reported by the public are the exception, as
// they're the public speaking, so they can count as a kind of signal.
//
// File, under ROOT_FOLDER: authorities/<code>/works.json

import type { Member } from "./accounts";
import type { Config } from "./config";
import { FUNCTIONS, loadAssessments, roadsOnly } from "./coverage";
import { looksPersonal } from "./enquiries";
import { canEdit, isOwnLead, sameAuthority, type Pilot } from "./pilots";
import { latestReadings } from "./reading";
import { savePretty, storageJson } from "./storage";
import { interviewedOnly, streetSummaries } from "./surveys";
import { FriendlyError, cleanText, fetchWithTimeout, londonToday, withLock } from "./util";

type Tally = Record<string, number>;
export type Week = { week: string; public: number; inspection: number; other: number; fns: Tally };
export type Weather = { start: string; tmax: (number | null)[]; tmin: (number | null)[]; rain: (number | null)[]; gust: (number | null)[]; snow: (number | null)[]; thunder?: (number | null)[]; updated?: string };
export type Event = { type: string; label: string; start: string; end: string; severity: number; detail: string };
export type Held = {
  on: boolean; toolkitId: number; toolkitName: string; by: string; at: string; checked: string; uploaded: string; from: string; to: string; weatherTo: string;
  weeks: Week[]; wards: Tally; events: Event[]; problem: string;
};

const WEEKS_KEPT = 70;
const CHART_WEEKS = 26;
const BASE_WEEKS = 8; // the weeks before an event, as the usual level
const AFTER_WEEKS = 2;
const EVENTS_SHOWN = 8;
const TOP_WARDS = 12;
const SHOW_FROM = 10; // a ward with fewer jobs than this isn't kept by name
const WARD_CHARS = 60;
const MOOD_DAYS = 28;
const MIN_PUBLIC = 5; // reports a week before an event, to compare with
const MIN_PRESS = 1; // press items a week
const DAY_MS = 24 * 60 * 60 * 1000;
const RECORDS_MS = 120000;
const EVENT_NAMES: Record<string, string> = { storm: "Gale", rain: "Heavy rain", cold: "Cold spell or snow", freezethaw: "Freeze and thaw", heat: "Heatwave" };
// The Toolkit's own starting rules. An authority's own settings there replace them
const RULES = { heavyRain: 20, veryHeavyRain: 30, rain3: 40, gale: 50, severeGale: 60, hot: 25, heatwaveDays: 3, coldSpellTmin: -2, coldSpellDays: 3, ftCluster: 8 };

const path = (c: Config, code: string) => `${c.root}authorities/${code}/works.json`;
const blank = (): Held => ({ on: false, toolkitId: 0, toolkitName: "", by: "", at: "", checked: "", uploaded: "", from: "", to: "", weatherTo: "", weeks: [], wards: {}, events: [], problem: "" });
export const toolkitReady = (c: Config) => !!(c.toolkitKey && c.toolkitZone);
// The Toolkit holds every authority's records, so this has to be the very authority, not one with a similar name
const FN_IDS = new Set<string>(FUNCTIONS.map((f) => f[0]));

export async function loadWorks(c: Config, code: string): Promise<Held> {
  return { ...blank(), ...(await storageJson<Partial<Held>>(c, path(c, code), {})) };
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / DAY_MS);
const isoOf = (n: number) => new Date(n * DAY_MS + DAY_MS / 2).toISOString().slice(0, 10);
export const mondayOf = (iso: string) => { const n = dayNumber(iso); return isoOf(n - ((n + 3) % 7)); }; // day 0 was a Thursday

/** Who found a job: the public, an inspection, or something else, as the Toolkit sorts them. */
export function sourceOf(text: string): "public" | "inspection" | "other" {
  const s = text.toLowerCase();
  if (/inspect|survey|patrol|safety/.test(s)) return "inspection";
  if (/public|online|phone|web|app|email|councillor|member|resident|customer|report it|fixmystreet/.test(s)) return "public";
  return "other";
}

/** Reads the Toolkit's records file, a row at a time, keeping only four columns' worth of totals. Nothing else is held. */
export async function tallyRecords(body: ReadableStream<Uint8Array>, since: string): Promise<{ weeks: Week[]; wards: Tally; from: string; to: string }> {
  const weeks = new Map<string, Week>(), wards = new Map<string, number>();
  let header = true, col = 0, quoted = false, cell = "", from = "", to = "", want: string[] = [], row: Record<string, string> = {};
  const endCell = () => { if (header) want.push(cell.trim()); else if (want[col]) row[want[col]] = cell; cell = ""; col++; };
  const endRow = () => {
    endCell();
    if (header) { want = want.map((name) => (["logged", "fn", "src", "ward"].includes(name) ? name : "")); header = false; }
    else {
      const date = String(row.logged ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        if (!from || date < from) from = date;
        if (date > to) to = date;
        const monday = mondayOf(date);
        if (monday >= since) {
          const w = weeks.get(monday) ?? { week: monday, public: 0, inspection: 0, other: 0, fns: {} };
          w[sourceOf(row.src ?? "")]++;
          if (FN_IDS.has(row.fn)) w.fns[row.fn] = (w.fns[row.fn] ?? 0) + 1;
          weeks.set(monday, w);
          const ward = cleanText(row.ward, WARD_CHARS + 1);
          if (ward && ward.length <= WARD_CHARS && !looksPersonal(ward)) wards.set(ward, (wards.get(ward) ?? 0) + 1);
        }
      }
    }
    row = {}; col = 0;
  };
  const text = body.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>);
  let last = "";
  for await (const chunk of text as unknown as AsyncIterable<string>) {
    for (const ch of chunk) {
      if (quoted) { if (ch === '"') quoted = false; else if (header || want[col]) cell += ch; } // a doubled quote comes back in, which no column here needs
      else if (ch === '"') quoted = true;
      else if (ch === ",") endCell();
      else if (ch === "\n") { if (last !== "\r" || cell || col) endRow(); }
      else if (ch === "\r") endRow();
      else if (header || want[col]) cell += ch;
      last = ch;
    }
  }
  if (cell || col) endRow();
  return { weeks: [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)), wards: Object.fromEntries([...wards].filter(([, n]) => n >= SHOW_FROM)), from, to };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function groups(hit: (i: number) => boolean, n: number, gap: number) {
  const out: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null, last = -99;
  for (let i = 0; i < n; i++) {
    if (!hit(i)) continue;
    if (cur && i - last <= gap + 1) cur.end = i;
    else { cur = { start: i, end: i }; out.push(cur); }
    last = i;
  }
  return out;
}

/** Gaps of up to 3 days in the temperatures are filled in a straight line, as the Toolkit does. */
function fillShortGaps(list: (number | null)[], most = 3): (number | null)[] {
  const a = [...list];
  for (let i = 0; i < a.length;) {
    if (isNum(a[i])) { i++; continue; }
    let j = i;
    while (j < a.length && !isNum(a[j])) j++;
    if (i > 0 && j < a.length && j - i <= most) for (let t = i; t < j; t++) a[t] = (a[i - 1] as number) + (((a[j] as number) - (a[i - 1] as number)) * (t - i + 1)) / (j - i + 1);
    i = j;
  }
  return a;
}

/** The Toolkit's rules for storms, heavy rain, cold, freeze and thaw and heatwaves. Long wet and dry spells need its normals, so they aren't here. */
export function weatherEvents(raw: Weather, rules: Partial<typeof RULES> = {}): Event[] {
  const w = { ...raw, tmax: fillShortGaps(raw.tmax), tmin: fillShortGaps(raw.tmin) };
  const th = { ...RULES, ...rules }, n = w.rain.length, first = dayNumber(w.start), day = (i: number) => isoOf(first + i), ev: Event[] = [];
  const rain3 = (i: number) => (i >= 2 ? [0, 1, 2].reduce((sum, k) => sum + (isNum(w.rain[i - k]) ? (w.rain[i - k] as number) : 0), 0) : 0);
  const add = (type: string, start: number, end: number, severity: number, detail: string) => ev.push({ type, label: EVENT_NAMES[type], start: day(Math.max(0, start)), end: day(end), severity, detail });
  for (const g of groups((i) => isNum(w.gust[i]) && (w.gust[i] as number) >= th.gale, n, 1)) {
    let top = 0;
    for (let i = g.start; i <= g.end; i++) top = Math.max(top, w.gust[i] ?? 0);
    add("storm", g.start, g.end, top >= 70 ? 3 : top >= th.severeGale ? 2 : 1, `Peak gust ${Math.round(top)} mph`);
  }
  for (const g of groups((i) => (isNum(w.rain[i]) && (w.rain[i] as number) >= th.heavyRain) || rain3(i) >= th.rain3, n, 1)) {
    let wettest = 0, most = 0;
    for (let i = g.start; i <= g.end; i++) { wettest = Math.max(wettest, w.rain[i] ?? 0); most = Math.max(most, rain3(i)); }
    add("rain", g.start - ((w.rain[g.start] ?? 0) >= th.heavyRain ? 0 : 2), g.end, wettest >= 40 || most >= 70 ? 3 : wettest >= th.veryHeavyRain || most >= 55 ? 2 : 1, `Wettest day ${Math.round(wettest)} mm`);
  }
  const snowy = (i: number) => isNum(w.snow[i]) && (w.snow[i] as number) > 0;
  for (const g of groups((i) => (isNum(w.tmin[i]) && (w.tmin[i] as number) <= th.coldSpellTmin) || snowy(i), n, 1)) {
    let snowDays = 0, coldDays = 0, low = Infinity;
    for (let i = g.start; i <= g.end; i++) { if (snowy(i)) snowDays++; if (isNum(w.tmin[i])) { if ((w.tmin[i] as number) <= th.coldSpellTmin) coldDays++; low = Math.min(low, w.tmin[i] as number); } }
    if (coldDays < th.coldSpellDays && snowDays < 2 && !(low <= -6)) continue;
    add("cold", g.start, g.end, low <= -8 || snowDays >= 4 ? 3 : low <= -5 || snowDays >= 2 ? 2 : 1, `Lowest ${Math.round(low * 10) / 10}°C`);
  }
  const thawDay = (i: number) => (i >= 0 && isNum(w.tmin[i]) && isNum(w.tmax[i]) && (w.tmin[i] as number) < 0 && (w.tmax[i] as number) > 0 ? 1 : 0);
  const inFortnight = (i: number) => { let s = 0; for (let k = 0; k < 14; k++) s += thawDay(i - k); return s; };
  for (const g of groups((i) => inFortnight(i) >= th.ftCluster, n, 3)) {
    let count = 0;
    const from = Math.max(0, g.start - 13);
    for (let i = from; i <= g.end; i++) count += thawDay(i);
    add("freezethaw", from, g.end, count >= 20 ? 3 : count >= 13 ? 2 : 1, `${count} freeze and thaw days`);
  }
  for (const g of groups((i) => isNum(w.tmax[i]) && (w.tmax[i] as number) >= th.hot, n, 0)) {
    if (g.end - g.start + 1 < th.heatwaveDays) continue;
    let top = -Infinity;
    for (let i = g.start; i <= g.end; i++) top = Math.max(top, w.tmax[i] ?? top);
    add("heat", g.start, g.end, top >= 33 ? 3 : top >= 30 ? 2 : 1, `Highest ${Math.round(top * 10) / 10}°C`);
  }
  return ev.sort((a, b) => a.start.localeCompare(b.start) || a.type.localeCompare(b.type));
}

// ----- reading the Toolkit

const toolkitUrl = (c: Config, id: number, file: string) => `https://${c.toolkitHost}/${encodeURIComponent(c.toolkitZone)}/${c.toolkitRoot}authorities/${id}/${file}`;
// A redirect is refused, as following one would hand the password to wherever it led
const fromToolkit = (c: Config, id: number, file: string, ms = 20000) => fetchWithTimeout(toolkitUrl(c, id, file), { redirect: "error", headers: { AccessKey: c.toolkitKey, Accept: "*/*" } }, ms);
async function toolkitJson<T>(c: Config, id: number, file: string): Promise<T | null> {
  const res = await fromToolkit(c, id, file);
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new FriendlyError("The Climate Toolkit refused Clarion's password. Check TOOLKIT_STORAGE_KEY.", 502);
  if (!res.ok) throw new Error(`the Climate Toolkit's storage answered ${res.status}`);
  return (await res.json()) as T;
}

/** Brings the totals up to date, at most once a day. Records are read again only if they've changed. */
export async function refreshWorks(c: Config, p: Pilot): Promise<Held> {
  const held = await loadWorks(c, p.code);
  if (!held.on || !toolkitReady(c) || held.checked.slice(0, 10) === londonToday()) return held;
  if (!sameAuthority(held.toolkitName, p)) {
    const stopped = { ...blank(), problem: "This link needs turning on again by your authority's lead." };
    await withLock(path(c, p.code), () => savePretty(c, path(c, p.code), stopped));
    return stopped;
  }
  const next: Held = { ...held, checked: new Date().toISOString(), problem: "" };
  try {
    const meta = await toolkitJson<{ uploaded?: string }>(c, held.toolkitId, "data/meta.json");
    if (!meta?.uploaded) Object.assign(next, { problem: "No records have been uploaded to the Climate Toolkit yet.", weeks: [], wards: {}, from: "", to: "", uploaded: "" });
    else if (meta.uploaded !== held.uploaded) {
      const res = await fromToolkit(c, held.toolkitId, "data/records.csv.gz", RECORDS_MS);
      if (!res.ok || !res.body) throw new Error(`the records answered ${res.status}`);
      const since = isoOf(dayNumber(mondayOf(londonToday())) - WEEKS_KEPT * 7);
      Object.assign(next, await tallyRecords(res.body, since), { uploaded: meta.uploaded });
    }
    const settings = await toolkitJson<{ weatherSource?: string; thresholds?: Partial<typeof RULES> }>(c, held.toolkitId, "settings.json");
    const own = settings?.weatherSource === "upload" ? await toolkitJson<Weather>(c, held.toolkitId, "weather/imported.json") : null;
    const weather = own ?? (await toolkitJson<Weather>(c, held.toolkitId, "weather/era5.json"));
    if (weather?.start && Array.isArray(weather.rain)) {
      const rules = Object.fromEntries(Object.entries(settings?.thresholds ?? {}).filter(([k, v]) => k in RULES && isNum(v)));
      const cutoff = isoOf(dayNumber(londonToday()) - WEEKS_KEPT * 7);
      next.events = weatherEvents(weather, rules).filter((e) => e.end >= cutoff);
      let last = weather.rain.length - 1;
      while (last > 0 && !isNum(weather.rain[last])) last--;
      next.weatherTo = isoOf(dayNumber(weather.start) + last);
    }
  } catch (e) {
    next.checked = held.checked; // so that it's tried again, once briefly's rest is over
    if (e instanceof FriendlyError) next.problem = e.message;
    else { console.log(`[warn] works for ${p.code}: ${(e as Error).message}`); next.problem = "The Climate Toolkit couldn't be read just now."; }
  }
  await withLock(path(c, p.code), async () => { const now = await loadWorks(c, p.code); if (now.on && now.at === held.at) await savePretty(c, path(c, p.code), next); }); // not if it's been turned off, or off and on, meanwhile
  return next;
}

const canTurnOn = isOwnLead;

export async function turnOn(c: Config, me: Member, p: Pilot): Promise<void> {
  if (!toolkitReady(c)) throw new FriendlyError("Clarion isn't connected to the Climate Toolkit yet. Ask the FHRG team.");
  if (!canTurnOn(me, p)) throw new FriendlyError("Only your authority's own FHRG lead can turn this on.", 403);
  await withLock(path(c, p.code), () => savePretty(c, path(c, p.code), { ...blank(), on: true, toolkitId: me.authorityId, toolkitName: me.authority, by: me.name, at: new Date().toISOString() }));
}

export async function turnOff(c: Config, p: Pilot): Promise<void> {
  await withLock(path(c, p.code), () => savePretty(c, path(c, p.code), blank()));
}

// ----- what's shown

const fifths = (n: number) => Math.round(n * 10) / 10;
const change = (after: number, base: number, least: number) => (base >= least ? Math.round(((after - base) / base) * 100) : null); // a rise from next to nothing means little
const mean = (list: number[]) => (list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : 0);

export function worksFigures(held: Held, pressByWeek: Tally, readings: { created: string; direction: string }[], surveys: { ran: string; satisfied: number | null }[], today: string, names: Record<string, string>) {
  const thisWeek = mondayOf(today), byWeek = new Map(held.weeks.map((w) => [w.week, w]));
  const weekAt = (offset: number, from = thisWeek) => isoOf(dayNumber(from) + offset * 7);
  const weeks = Array.from({ length: CHART_WEEKS }, (_, i) => { const week = weekAt(i - CHART_WEEKS), w = byWeek.get(week); return { week, public: w?.public ?? 0, inspection: w?.inspection ?? 0, press: pressByWeek[week] ?? 0 }; });
  const first = weeks[0].week, ending = isoOf(dayNumber(thisWeek) - 1), firstPress = Object.keys(pressByWeek).sort()[0] ?? "";
  const around = (e: Event) => {
    const start = mondayOf(e.start), end = mondayOf(e.end);
    const before = Array.from({ length: BASE_WEEKS }, (_, i) => weekAt(-i - 1, start)), after = Array.from({ length: AFTER_WEEKS }, (_, i) => weekAt(i, end)).filter((x) => x < thisWeek);
    const pub = (list: string[]) => mean(list.map((x) => byWeek.get(x)?.public ?? 0)), press = (list: string[]) => mean(list.map((x) => pressByWeek[x] ?? 0));
    // A week outside what's held isn't a week with nothing in it
    const covered = (list: string[]) => !!held.from && !!held.to && list.every((x) => x >= mondayOf(held.from) && x <= mondayOf(held.to)), pressCovered = (list: string[]) => !!firstPress && list.every((x) => x >= firstPress);
    const fnRise = Object.keys(Object.assign({}, ...[...before, ...after].map((x) => byWeek.get(x)?.fns ?? {})) as Tally).map((fn) => ({ fn, rise: mean(after.map((x) => byWeek.get(x)?.fns[fn] ?? 0)) - mean(before.map((x) => byWeek.get(x)?.fns[fn] ?? 0)) }));
    const reading = readings.find((r) => { const d = dayNumber(r.created.slice(0, 10)); return r.direction && d >= dayNumber(e.end) && d <= dayNumber(e.end) + MOOD_DAYS; });
    return {
      label: e.label, start: e.start, end: e.end, detail: e.detail, publicChange: after.length && covered([...before, ...after]) ? change(pub(after), pub(before), MIN_PUBLIC) : null, pressChange: after.length && pressCovered([...before, ...after]) ? change(press(after), press(before), MIN_PRESS) : null,
      functions: fnRise.filter((x) => x.rise > 0).sort((a, b) => b.rise - a.rise).slice(0, 2).map((x) => names[x.fn] ?? x.fn), mood: reading?.direction ?? "",
    };
  };
  return {
    weeks, events: held.events.filter((e) => e.end >= first && e.start <= ending),
    marks: [...surveys.filter((s) => s.ran >= first && s.ran <= ending).map((s) => ({ date: s.ran, label: `Survey${s.satisfied === null ? "" : `: ${fifths(s.satisfied)}% satisfied, indicative`}` })), ...readings.filter((r) => r.created.slice(0, 10) >= first && r.created.slice(0, 10) <= ending).slice(0, 2).map((r) => ({ date: r.created.slice(0, 10), label: `Reading: ${(r.direction || "not yet known").toLowerCase()}` }))],
    after: held.events.filter((e) => e.end < ending).slice(-EVENTS_SHOWN).reverse().map(around),
    wards: Object.entries(held.wards).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_WARDS).map(([name, n]) => ({ name, n })),
  };
}

export async function worksPage(c: Config, me: Member, p: Pilot, held: Held, names: Record<string, string>) {
  const [assessments, readings, streets] = await Promise.all([loadAssessments(c, p.code).then(roadsOnly), latestReadings(c, p.code), streetSummaries(c, p.code).then(interviewedOnly)]);
  const press: Tally = {};
  for (const a of assessments) if (a.relevance !== "None") press[mondayOf(a.date)] = (press[mondayOf(a.date)] ?? 0) + 1;
  return {
    ready: toolkitReady(c), on: held.on, by: held.by, at: held.at, checked: held.checked, uploaded: held.uploaded, from: held.from, to: held.to, weatherTo: held.weatherTo, problem: held.problem,
    canTurnOn: canTurnOn(me, p), canTurnOff: canEdit(me, p),
    figures: held.on && held.weeks.length ? worksFigures(held, press, readings.filter((r) => r.status === "ready"), streets, londonToday(), names) : null,
  };
}

/** Public reports in the last four full weeks, for a mood reading. Figures only. */
export function publicJobs(held: Held, today: string): number {
  const end = mondayOf(today), start = isoOf(dayNumber(end) - 28);
  return held.on ? held.weeks.filter((w) => w.week >= start && w.week < end).reduce((sum, w) => sum + w.public, 0) : 0;
}
