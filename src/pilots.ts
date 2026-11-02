// The pilot authorities and what is already known about each, checked against published sources on
// 2 November 2026. Officers add survey results and notes through the page (see facts.ts in evidence.ts).
//
// Who can see what: members see their own authority if it is a pilot; site administrators see all of them.

import type { Member } from "./accounts";

export type SurveyResult = { year: number; measure: string; score: number; outOf: number; responses?: number; source: string; url?: string };
export type Constituency = { name: string; shared?: string };

export type Pilot = {
  code: string; // ONS code, as used across the reference library
  name: string;
  kind: string;
  strategicAuthority: string;
  fundingRoute: string;
  rating: { overall: string; condition: string; spend: string; bestPractice: string; published: string; url: string };
  fixMyStreetArea: string; // the area name in FixMyStreet's public feed address
  reportingRoute: string;
  constituencies: Constituency[];
  surveys: SurveyResult[];
  surveyNote: string;
  needed: string[];
};

const RATINGS_URL = "https://www.gov.uk/government/publications/local-road-maintenance-ratings/local-road-maintenance-ratings-2025-to-2026";
const ALLOCATIONS_URL = "https://www.gov.uk/government/publications/highways-maintenance-funding-allocations/highways-maintenance-block-formula-allocations-2026-to-2030";
const WSX_2025 = "https://www.westsussex.gov.uk/media/t25hyhph/nht_survey_results_summary_overview.pdf";
const WSX_2022 = "https://www.westsussex.gov.uk/media/18821/nht_results_summary.pdf";

export { ALLOCATIONS_URL };

export const PILOTS: Pilot[] = [
  {
    code: "E10000019", name: "Lincolnshire", kind: "County council", strategicAuthority: "Greater Lincolnshire Combined Authority",
    fundingRoute: "DfT's highways maintenance money is paid through the combined authority, not directly to the county council.",
    rating: { overall: "Amber", condition: "Amber", spend: "Amber", bestPractice: "Amber", published: "January 2026", url: RATINGS_URL },
    fixMyStreetArea: "Lincolnshire", reportingRoute: "FixMyStreet is the council's own reporting system, so its public feed shows most reports.",
    constituencies: [
      { name: "Boston and Skegness" }, { name: "Gainsborough" }, { name: "Grantham and Bourne" }, { name: "Lincoln" }, { name: "Louth and Horncastle" },
      { name: "Rutland and Stamford", shared: "also covers Rutland and part of Leicestershire" }, { name: "Sleaford and North Hykeham" }, { name: "South Holland and The Deepings" },
    ],
    surveys: [],
    surveyNote: "The council ran the NHT survey in 2025, and surveyed councillors and parish councils separately. Clarion doesn't hold the results yet.",
    needed: ["The 2025 NHT survey report"],
  },
  {
    code: "E08000034", name: "Kirklees", kind: "Metropolitan borough", strategicAuthority: "West Yorkshire Combined Authority",
    fundingRoute: "DfT's highways maintenance money is paid through West Yorkshire Combined Authority's settlement, not directly to Kirklees.",
    rating: { overall: "Amber", condition: "Amber", spend: "Green", bestPractice: "Amber", published: "January 2026", url: RATINGS_URL },
    fixMyStreetArea: "Kirklees", reportingRoute: "Few reports reach FixMyStreet's public feed, so its counts aren't a good signal here. Clarion needs the council's own fault report counts.",
    constituencies: [
      { name: "Colne Valley" }, { name: "Dewsbury and Batley" }, { name: "Huddersfield" }, { name: "Spen Valley" },
      { name: "Ossett and Denby Dale", shared: "also covers part of Wakefield" },
    ],
    surveys: [],
    surveyNote: "No NHT or residents' survey results have been found yet.",
    needed: ["Any NHT or residents' survey results", "Fault report counts by category and month"],
  },
  {
    code: "E10000032", name: "West Sussex", kind: "County council", strategicAuthority: "",
    fundingRoute: "DfT pays West Sussex directly: £28.303m for 2026/27, of which £7.583m is incentive funding.",
    rating: { overall: "Amber", condition: "Amber", spend: "Green", bestPractice: "Amber", published: "January 2026", url: RATINGS_URL },
    fixMyStreetArea: "West+Sussex", reportingRoute: "The main reporting route is Love West Sussex, so FixMyStreet's public feed shows only part of the picture. Clarion needs the council's own fault report counts.",
    constituencies: [
      { name: "Arundel and South Downs" }, { name: "Bognor Regis and Littlehampton" }, { name: "Chichester" }, { name: "Crawley" },
      { name: "East Grinstead and Uckfield", shared: "also covers part of East Sussex" }, { name: "East Worthing and Shoreham" }, { name: "Horsham" }, { name: "Mid Sussex" }, { name: "Worthing West" },
    ],
    surveys: [
      { year: 2025, measure: "Condition of highways", score: 24, outOf: 100, responses: 749, source: "NHT survey 2025", url: WSX_2025 },
      { year: 2025, measure: "Overall satisfaction (local)", score: 51, outOf: 100, responses: 749, source: "NHT survey 2025", url: WSX_2025 },
      { year: 2022, measure: "Condition of highways", score: 27, outOf: 100, source: "NHT survey 2022", url: WSX_2022 },
      { year: 2022, measure: "Overall satisfaction (local)", score: 48, outOf: 100, source: "NHT survey 2022", url: WSX_2022 },
    ],
    surveyNote: "",
    needed: ["Fault report counts by category and month"],
  },
];

export const pilotByCode = (code: unknown): Pilot | undefined => PILOTS.find((p) => p.code === code);

// "West Sussex County Council" and "West Sussex", "Kirklees Council" and "Kirklees"
const NAME_NOISE = new Set(["council", "county", "city", "borough", "metropolitan", "district", "royal", "of", "the", "unitary", "authority"]);
export function normAuthority(s: string): string {
  return String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !NAME_NOISE.has(w)).join(" ");
}

export function pilotsFor(me: Member): Pilot[] {
  if (me.siteAdmin) return PILOTS;
  return PILOTS.filter((p) => normAuthority(p.name) === normAuthority(me.authority));
}

export const canSee = (me: Member, p: Pilot) => pilotsFor(me).includes(p);
// Officers' own survey results and notes: their authority's leads, and site administrators
export const canEdit = (me: Member, p: Pilot) => me.siteAdmin || (me.role === "lead" && canSee(me, p));
