// Survey sites: where to stand. An authority usually runs a directed survey at a handful of places, about 30 people
// at each, that together stand for the whole authority. Clarion proposes the sites first, and the officer changes
// them on a map.
//
// The proposal is a calculation on published figures, not Claude's opinion:
//   - each neighbourhood is stood for by its nearest site;
//   - the authority's largest town is always included, because people expect to see it and it draws people in;
//   - the others are chosen so that the sites together look like the authority on age, car ownership, travel to work
//     and deprivation, each site looks like the area it stands for, people live near a site, and a site is normally
//     the main town in its area.
// Town size stands in for footfall, as there's no open footfall figure. The neighbourhood figures come from the
// reference library (tables neighbourhoods, towns and neighbourhood_shapes).

import type { Config } from "./config";
import { refQuery } from "./library";
import type { Pilot } from "./pilots";
import { cached } from "./util";

export const MEASURES = [
  "Aged 16 to 34", "Aged 65 and over", "Households with no car", "Drive to work", "Walk or cycle to work", "Bus or train to work", "Living in England's most deprived 20%",
];
const YOUNG = 0, OLD = 1;
export const SITE_COUNTS = [3, 4, 5, 6];
const DAY_MS = 24 * 60 * 60 * 1000;
const TOWN_MIN = 7000; // a town smaller than this rarely has the footfall for 30 interviews
const SMALL_TOWN_MIN = 3000;
const MIN_TOWNS = 6;
const SPACING_KM = 4; // the proposal takes one town from any close group
const SATELLITE_PEOPLE = 10000; // a small place on the edge of a large town is really part of it
const LARGE_TOWN = 50000;
const SATELLITE_KM = 8;
const MAX_PROPOSABLE = 14;
const MAX_TOWNS = 30;
const BIG_TOWN_SHARE = 0.6; // past this, one town is most of the authority, so its neighbourhoods are offered too
const OUTSIDE_KM = 6;

/** A neighbourhood's share of adults, in thousandths, its position and its figures, ready for the page. */
export type Hood = { lat: number; lng: number; share: number; adults: number; rural: number; figures: number[]; town: string; label: string };
// A place is a named town, or a neighbourhood offered because one town is most of the authority
export type Town = { name: string; lat: number; lng: number; people: number; local: number[]; neighbourhood?: boolean };
export type SitesPack = {
  ready: true; name: string; adults: number; rural: number; measures: string[]; auth: number[]; spread: number[];
  hoods: number[][]; shapes: number[][][][]; towns: Town[]; proposals: Record<string, number[]>; tiles: boolean;
};
export type SitesMissing = { ready: false; why: string };

const tenth = (n: number) => Math.round(n * 10) / 10;

/** Distance in km, near enough at the scale of one authority. */
export function km(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  return 6371 * Math.sqrt(x * x + ((lat2 - lat1) * rad) ** 2);
}

const pct = (part: unknown, whole: unknown) => (Number(whole) ? (Number(part) / Number(whole)) * 100 : 0);

export function hoodFrom(r: Record<string, any>): Omit<Hood, "share"> {
  return {
    lat: r.lat === null ? NaN : Number(r.lat), lng: r.lng === null ? NaN : Number(r.lng), rural: Number(r.rural) ? 1 : 0, adults: Number(r.adults) || 0, town: String(r.town_code ?? ""), label: String(r.place_name || r.msoa_name || ""),
    figures: [
      pct(r.aged_16_34, r.adults), pct(r.aged_65_plus, r.adults), pct(r.households_no_car, r.households), pct(r.drive, r.workers), pct(r.walk_cycle, r.workers), pct(r.bus_train, r.workers),
      pct(r.people_most_deprived_20pct, r.imd_people),
    ],
  };
}

function blend(hoods: Hood[], picks: number[]): number[] {
  const weight = picks.reduce((sum, i) => sum + hoods[i].share, 0) || 1;
  return MEASURES.map((_, f) => picks.reduce((sum, i) => sum + hoods[i].share * hoods[i].figures[f], 0) / weight);
}

/** The towns to offer: named towns, or, where one town is most of the authority, its neighbourhoods as well. */
export function townsFrom(rows: Record<string, any>[], hoods: Hood[]): Town[] {
  const big = rows.filter((t) => Number(t.people) >= TOWN_MIN);
  const names = new Set<string>();
  const chosen = (big.length >= MIN_TOWNS ? big : rows.filter((t) => Number(t.people) >= SMALL_TOWN_MIN)).filter((t) => { const fresh = !names.has(String(t.town_name)); names.add(String(t.town_name)); return fresh; }).slice(0, MAX_TOWNS);
  const nearest = (lng: number, lat: number) => hoods.reduce((best, h, i) => { const d = km(lng, lat, h.lng, h.lat); return d < best.d ? { d, i } : best; }, { d: Infinity, i: 0 });
  const towns: Town[] = chosen.map((t) => {
    const own = hoods.flatMap((h, i) => (h.town === String(t.town_code) ? [i] : []));
    const near = nearest(Number(t.lng), Number(t.lat));
    const list = own.length ? own : [near.i];
    const weight = list.reduce((sum, i) => sum + hoods[i].share, 0) || 1;
    // a town spilling over the boundary has its centre outside: stand in the part that's inside
    const outside = near.d > OUTSIDE_KM && own.length > 0;
    return {
      name: String(t.town_name), people: Number(t.people), local: blend(hoods, list),
      lat: outside ? list.reduce((sum, i) => sum + hoods[i].lat * hoods[i].share, 0) / weight : Number(t.lat),
      lng: outside ? list.reduce((sum, i) => sum + hoods[i].lng * hoods[i].share, 0) / weight : Number(t.lng),
    };
  });
  const total = hoods.reduce((sum, h) => sum + h.share, 0) || 1;
  const biggest = rows[0] ? hoods.filter((h) => h.town === String(rows[0].town_code)).reduce((sum, h) => sum + h.share, 0) / total : 1;
  if (towns.length >= MIN_TOWNS && biggest <= BIG_TOWN_SHARE) return towns;
  // Spread out over the authority: each pick is the neighbourhood furthest from those already taken
  const taken = towns.map((t) => [t.lng, t.lat]);
  if (!taken.length && hoods.length) taken.push([hoods[0].lng, hoods[0].lat]);
  const used = new Set(towns.map((t) => t.name));
  while (towns.length < MAX_PROPOSABLE && towns.length < hoods.length) {
    let best = -1, far = -1;
    hoods.forEach((h, i) => {
      if (!h.label || used.has(h.label)) return;
      const d = Math.min(...taken.map(([x, y]) => km(h.lng, h.lat, x, y)));
      if (d > far) { far = d; best = i; }
    });
    if (best < 0) break;
    const h = hoods[best];
    used.add(h.label);
    taken.push([h.lng, h.lat]);
    towns.push({ name: h.label, people: h.adults, lat: h.lat, lng: h.lng, local: h.figures, neighbourhood: true });
  }
  return towns;
}

/** Which towns a proposal can use: biggest first, one from each close group, no satellites of a large town. */
function proposable(towns: Town[]): number[] {
  const keep: number[] = [];
  towns.forEach((t, i) => {
    if (keep.length >= MAX_PROPOSABLE) return;
    const satellite = !t.neighbourhood && t.people < SATELLITE_PEOPLE && keep.some((k) => towns[k].people >= LARGE_TOWN && km(t.lng, t.lat, towns[k].lng, towns[k].lat) < SATELLITE_KM);
    if (!satellite && keep.every((k) => km(t.lng, t.lat, towns[k].lng, towns[k].lat) >= SPACING_KM)) keep.push(i);
  });
  return keep;
}

export type Fit = { score: number; shares: number[]; mix: number[]; near: number[] };

/** How well a set of towns stands for the authority. Lower is better. */
export function fitOf(hoods: Hood[], towns: Town[], auth: number[], spread: number[], picks: number[], reach: number): Fit | null {
  const total = hoods.reduce((sum, h) => sum + h.share, 0) || 1;
  const near = hoods.map((h) => { let best = 0, far = Infinity; picks.forEach((t, j) => { const d = km(h.lng, h.lat, towns[t].lng, towns[t].lat); if (d < far) { far = d; best = j; } }); return best; });
  const shares = picks.map((_, j) => hoods.reduce((sum, h, i) => sum + (near[i] === j ? h.share : 0), 0) / total);
  if (shares.some((x) => x === 0)) return null;
  const gap = (a: number[], b: number[]) => a.reduce((sum, x, f) => sum + Math.abs(x - b[f]) / (spread[f] || 1), 0) / a.length;
  const mix = MEASURES.map((_, f) => picks.reduce((sum, t, j) => sum + shares[j] * towns[t].local[f], 0));
  let standsFor = 0, mainTown = 0, travel = 0;
  picks.forEach((t, j) => {
    const area = hoods.flatMap((h, i) => (near[i] === j ? [i] : []));
    standsFor += shares[j] * gap(towns[t].local, blend(hoods, area));
    const bigger = Math.max(towns[t].people, ...towns.filter((x) => { let best = 0, far = Infinity; picks.forEach((p, q) => { const d = km(x.lng, x.lat, towns[p].lng, towns[p].lat); if (d < far) { far = d; best = q; } }); return best === j; }).map((x) => x.people));
    mainTown += shares[j] * (1 - towns[t].people / bigger);
  });
  hoods.forEach((h, i) => { travel += (h.share / total) * km(h.lng, h.lat, towns[picks[near[i]]].lng, towns[picks[near[i]]].lat); });
  return { score: gap(mix, auth) + 0.5 * standsFor + 0.5 * (travel / (reach || 1)) + mainTown, shares, mix, near };
}

function choose<T>(list: T[], size: number): T[][] {
  if (size === 0) return [[]];
  return list.flatMap((x, i) => choose(list.slice(i + 1), size - 1).map((rest) => [x, ...rest]));
}

/** The best set of each size. The largest town is always in. */
export function propose(hoods: Hood[], towns: Town[], auth: number[], spread: number[]): Record<string, number[]> {
  const total = hoods.reduce((sum, h) => sum + h.share, 0) || 1;
  const midLat = hoods.reduce((sum, h) => sum + h.lat * h.share, 0) / total, midLng = hoods.reduce((sum, h) => sum + h.lng * h.share, 0) / total;
  const reach = hoods.reduce((sum, h) => sum + (h.share / total) * km(h.lng, h.lat, midLng, midLat), 0);
  const pool = proposable(towns);
  const out: Record<string, number[]> = {};
  for (const size of SITE_COUNTS) {
    if (!pool.length) break;
    let best: number[] | null = null, bestScore = Infinity;
    if (size > pool.length) break;
    for (const rest of choose(pool.slice(1), size - 1)) {
      const picks = [pool[0], ...rest];
      const fit = fitOf(hoods, towns, auth, spread, picks, reach);
      if (fit && fit.score < bestScore) { bestScore = fit.score; best = picks; }
    }
    if (best) out[size] = best;
  }
  // A very small authority may not have three places to choose from
  if (!Object.keys(out).length && pool.length) out[pool.length] = pool;
  return out;
}

export function packFrom(name: string, hoodRows: Record<string, any>[], townRows: Record<string, any>[], shapeRows: { key: string; rings: number[][][] }[], tiles: boolean): SitesPack {
  const read = hoodRows.map((r) => ({ ...hoodFrom(r), key: String(r.msoa_code) })).filter((h) => Number.isFinite(h.lat) && h.adults > 0);
  const adults = read.reduce((sum, h) => sum + h.adults, 0);
  const hoods: Hood[] = read.map((h) => ({ ...h, share: (h.adults / adults) * 1000 }));
  const auth = MEASURES.map((_, f) => hoods.reduce((sum, h) => sum + (h.share / 1000) * h.figures[f], 0));
  const spread = auth.map((mean, f) => Math.sqrt(hoods.reduce((sum, h) => sum + (h.share / 1000) * (h.figures[f] - mean) ** 2, 0)));
  const towns = townsFrom(townRows, hoods);
  const outline = new Map(shapeRows.map((s) => [s.key, s.rings]));
  return {
    ready: true, name, adults, rural: Math.round(hoods.reduce((sum, h) => sum + (h.share / 10) * h.rural, 0)), measures: MEASURES, auth: auth.map(tenth), spread: spread.map((x) => Math.round(x * 100) / 100),
    hoods: hoods.map((h) => [h.lng, h.lat, tenth(h.share), h.rural, ...h.figures.map(tenth)]),
    shapes: read.map((h) => outline.get(h.key) ?? []),
    towns: towns.map((t) => ({ ...t, local: t.local.map(tenth), lat: Math.round(t.lat * 10000) / 10000, lng: Math.round(t.lng * 10000) / 10000 })),
    proposals: propose(hoods, towns, auth, spread), tiles,
  };
}

export async function loadSites(c: Config, p: Pilot): Promise<SitesPack | SitesMissing> {
  try {
    return await cached(`sites|${p.code}`, DAY_MS, async () => {
      const [hoods, towns, shapes] = await Promise.all([
        refQuery(c, "SELECT msoa_code, msoa_name, place_name, lat, lng, rural, adults, aged_16_34, aged_65_plus, households, households_no_car, workers, drive, walk_cycle, bus_train, imd_people, people_most_deprived_20pct, town_code FROM neighbourhoods WHERE la_code = ?", [p.code]),
        refQuery(c, "SELECT town_code, town_name, lat, lng, people FROM towns WHERE la_code = ? ORDER BY people DESC, town_name LIMIT 100", [p.code]),
        refQuery(c, "SELECT msoa_code, rings FROM neighbourhood_shapes WHERE la_code = ?", [p.code]),
      ]);
      if (!hoods.rows.length) throw new Error("no neighbourhoods for this authority");
      const outlines = shapes.rows.map((r) => { let rings: number[][][] = []; try { rings = JSON.parse(String(r.rings)); } catch { rings = []; } return { key: String(r.msoa_code), rings }; });
      return packFrom(p.name, hoods.rows, towns.rows, outlines, true);
    });
  } catch (e) {
    console.log(`[warn] Survey sites for ${p.code}: ${(e as Error).message}`);
    return { ready: false, why: "The neighbourhood figures aren't in the data library yet, so you can add sites by hand for now." };
  }
}

/** Age targets for a site: how many in each of three age groups, from the area it stands for. */
export function ageTargets(young: number, old: number, people: number): number[] {
  const shares = [young / 100, 1 - young / 100 - old / 100, old / 100];
  const raw = shares.map((x) => x * people);
  const out = raw.map(Math.floor);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]);
  let left = people - out.reduce((sum, x) => sum + x, 0);
  for (let i = 0; left > 0; i++, left--) out[order[i % 3][1]] += 1;
  return out;
}

/** What a set of towns stands for: the share of adults nearest each, and its age targets. */
export function standFor(pack: Pick<SitesPack, "hoods" | "towns">, picks: number[], people: number): { town: Town; share: number; ages: number[] }[] {
  const near = pack.hoods.map((m) => { let best = 0, far = Infinity; picks.forEach((t, j) => { const d = km(m[0], m[1], pack.towns[t].lng, pack.towns[t].lat); if (d < far) { far = d; best = j; } }); return best; });
  const total = pack.hoods.reduce((sum, m) => sum + m[2], 0) || 1;
  return picks.map((t, j) => {
    const area = pack.hoods.filter((_, i) => near[i] === j);
    const weight = area.reduce((sum, m) => sum + m[2], 0) || 1;
    const figure = (f: number) => area.reduce((sum, m) => sum + m[2] * m[4 + f], 0) / weight;
    return { town: pack.towns[t], share: tenth((weight / total) * 100), ages: ageTargets(figure(YOUNG), figure(OLD), people) };
  });
}
