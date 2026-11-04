// The FHRG's position across every authority, for site administrators, and the one figure each authority can compare
// itself with. Figures and topic counts only: residents' comments and officers' notes stay with each authority.
// Authorities are listed in alphabetical order, never ranked, because a difference may be a local choice.

import type { Config } from "./config";
import { monthSpend } from "./claude";
import { loadComparison } from "./comparison";
import { loadMapData } from "./mapdata";
import { buildMap, readFilters } from "./mood";
import { PILOTS, type Pilot } from "./pilots";
import { latestReadings } from "./reading";
import { storageJson, storageList } from "./storage";
import { interviewedOnly, listSurveys, streetSummaries, type StreetSummary } from "./surveys";
import { cached, median } from "./util";

const BENCHMARK_MIN = 5; // fewer, and the middle figure could give away an authority's own result
const TOP_TOPICS = 3;

type Row = {
  code: string; name: string; region: string; kind: string; direction: string; readingOn: string; surveysRun: number; reported: number; replies: number; street: StreetSummary | null;
  readingsThisMonth: number; notesThisMonth: number; forecastsDue: number; early: string[] | null; mood: string; pieces: number | null; enquiries: number | null;
};

const month = () => new Date().toISOString().slice(0, 7).replace("-", "");

async function authorityRow(c: Config, p: Pilot): Promise<Row> {
  const [readings, surveys, streets, readingNames, noteNames, forecasts, comparison] = await Promise.all([
    latestReadings(c, p.code), listSurveys(c, p.code), streetSummaries(c, p.code),
    storageList(c, `${c.root}authorities/${p.code}/readings/`), storageList(c, `${c.root}authorities/${p.code}/notes/`),
    storageJson<unknown[]>(c, `${c.root}authorities/${p.code}/forecasts.json`, []), loadComparison(c, p).catch((e) => { console.log(`[warn] comparison for ${p.code}: ${(e as Error).message}`); return null; }),
  ]);
  const map = await loadMapData(c, p).then((data) => ({ data, page: buildMap(data, readFilters({}, data.today, data.topics)) })).catch((e) => { console.log(`[warn] mood for ${p.code}: ${(e as Error).message}`); return null; });
  const latest = readings.find((r) => r.status === "ready"), reported = interviewedOnly(streets);
  const today = new Date().toISOString().slice(0, 10);
  return {
    code: p.code, name: p.name, region: p.region, kind: p.kind, direction: latest?.direction ?? "", readingOn: latest?.created.slice(0, 10) ?? "",
    surveysRun: surveys.filter((s) => s.status !== "draft").length, reported: reported.length, replies: reported.reduce((n, x) => n + x.responses, 0), street: reported[0] ?? null,
    readingsThisMonth: readingNames.filter((n) => n.startsWith(month())).length, notesThisMonth: noteNames.filter((n) => n.startsWith(month())).length,
    forecastsDue: (Array.isArray(forecasts) ? forecasts : []).filter((f: any) => typeof f?.checkDate === "string" && f.checkDate <= today && !f.outcome).length,
    early: comparison === null ? null : comparison.ready ? comparison.earlySigns.map((x) => x.topic) : [],
    mood: map ? map.page.tree.mood.txt : "", pieces: map ? map.page.pieces.length : null, enquiries: map ? map.data.enquiries[map.page.month]?.total ?? null : null,
  };
}

// Topics that are an early sign in more than one authority, as a count: no authority is named
function sharedSigns(rows: Row[]): { topic: string; authorities: number }[] {
  return [...new Set(rows.flatMap((r) => r.early ?? []))].sort().map((topic) => ({ topic, authorities: rows.filter((r) => r.early?.includes(topic)).length })).filter((x) => x.authorities > 1);
}

export async function adminOverview(c: Config) {
  const rows = (await Promise.all(PILOTS.map((p) => authorityRow(c, p)))).sort((a, b) => a.name.localeCompare(b.name)); // each row's street survey is its latest
  const withStreet = rows.filter((r) => r.street);
  const satisfied = withStreet.map((r) => r.street?.satisfied).filter((x): x is number => typeof x === "number");
  const directions: Record<string, number> = {};
  for (const r of rows) if (r.direction) directions[r.direction] = (directions[r.direction] || 0) + 1;
  const regions = [...new Set(rows.map((r) => r.region))].sort().map((name) => ({ name, authorities: rows.filter((r) => r.region === name).length }));
  const topics = [...new Set(withStreet.flatMap((r) => r.street?.topics.slice(0, TOP_TOPICS).map((t) => t.topic) ?? []))].sort().map((topic) => ({
    topic,
    regions: regions.map((g) => rows.filter((r) => r.region === g.name && r.street?.topics.slice(0, TOP_TOPICS).some((t) => t.topic === topic)).length),
  }));
  return {
    authorities: rows.map(({ early: _early, ...row }) => row), regions, topics, directions, earlySigns: sharedSigns(rows), earlySignsMissing: rows.some((r) => r.early === null),
    totals: {
      using: rows.filter((r) => r.direction || r.surveysRun || r.notesThisMonth).length, authorities: rows.length, withSurvey: withStreet.length, surveys: rows.reduce((n, r) => n + r.reported, 0),
      replies: rows.reduce((n, r) => n + r.replies, 0), middle: median(satisfied), lowest: satisfied.length ? Math.min(...satisfied) : null, highest: satisfied.length ? Math.max(...satisfied) : null,
    },
    use: { readings: rows.reduce((n, r) => n + r.readingsThisMonth, 0), notes: rows.reduce((n, r) => n + r.notesThisMonth, 0), forecastsDue: rows.reduce((n, r) => n + r.forecastsDue, 0), spend: await monthSpend(c), cap: c.monthlyCapUsd },
  };
}

// What an authority sees of everyone else: one middle figure, with nobody named, once enough have results. Each
// figure needs enough authorities of its own, or a middle figure could be one authority's result.
export function middleFigure(latest: Pick<StreetSummary, "satisfied" | "worse">[]): { authorities: number; satisfied: number | null; worse: number | null } | null {
  if (latest.length < BENCHMARK_MIN) return null;
  const worse = latest.map((x) => x.worse).filter((x): x is number => typeof x === "number");
  return { authorities: latest.length, satisfied: median(latest.map((x) => x.satisfied as number)), worse: worse.length >= BENCHMARK_MIN ? median(worse) : null };
}

export const benchmarkFrom = (authorities: StreetSummary[][]) => middleFigure(authorities.map((x) => interviewedOnly(x).find((y) => y.current)).filter((x): x is StreetSummary => !!x));
export const benchmark = (c: Config) => cached("benchmark", 10 * 60 * 1000, async () => benchmarkFrom(await Promise.all(PILOTS.map((p) => streetSummaries(c, p.code)))));
