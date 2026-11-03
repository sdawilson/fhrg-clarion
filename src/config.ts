// Clarion's settings. They are environment variables set in Magic Containers: Container settings >
// Environment variables. Type the names by hand (a pasted name can carry an invisible character); the
// server logs which names arrived, never their values.
//   Secrets:   ANTHROPIC_API_KEY             a Claude API key
//              STORAGE_ACCESS_KEY            the fhrg-clarion storage zone's password (not the read-only one)
//              WEBSITE_DATABASE_URL          the FHRG website's database: its URL from Database > Access, and
//              WEBSITE_DATABASE_AUTH_TOKEN     a READ-ONLY token from Generate Tokens there
//              SESSION_SECRET                long random text used to sign sign-ins
//              SSO_SECRET                    optional; shared with the website's Edge Script (its
//                                              CLARION_SSO_SECRET), so members can arrive signed in
//              FHRG_REF_KEY                  a key for the FHRG reference library (App Builder > Admin >
//                                              Reference data > Keys for outside services)
//              SEARCH_KEY                    optional; a Brave Search API key, for checking whether a keyword turns
//                                              up for a publication. Without it, officers find pieces themselves
//   Variables: STORAGE_ZONE (required), STORAGE_HOST (default storage.bunnycdn.com),
//              ROOT_FOLDER (default clarion), WEBSITE_URL (default https://fhrg.co.uk),
//              SITE_ADMINS (emails, separated by commas; the website's site administrators count too),
//              CLAUDE_MODEL (default claude-sonnet-5-5), CLAUDE_EFFORT (default medium),
//              FHRG_REF_URL (default https://builder.fhrg.co.uk), MONTHLY_CAP_USD (default 40: Clarion stops
//              starting new work once a month's estimated Claude spend reaches this),
//              WEB_SEARCH_MAX (default 4: searches in each step of reading an announcement, of which there
//              are at most 5), DATA_QUERIES_MAX (default 8: library queries per impact note),
//              DAILY_JOBS_MAX (default 20: readings and notes per authority per day; site administrators
//              aren't limited), DEMO (on, the default, or off: the Northbridge demonstration at /demo)

import process from "node:process";

export type Config = {
  apiKey: string;
  model: string;
  effort: string;
  storageKey: string;
  storageZone: string;
  storageHost: string;
  root: string;
  webDbUrl: string;
  webDbToken: string;
  websiteUrl: string;
  siteAdmins: string[];
  sessionSecret: string;
  ssoSecret: string;
  refUrl: string;
  refKey: string;
  searchKey: string;
  monthlyCapUsd: number;
  webMax: number;
  dataMax: number;
  dailyJobsMax: number;
  demo: boolean;
};

// Settings are pasted in by hand, so be forgiving: ignore stray spaces, invisible characters and
// wrapping quotes, in names as well as values.
const ODD_CHARS = /[\u0000-\u001F\u007F ​-‍⁠﻿]/g;
function tidy(v: string): string {
  let t = String(v).replace(ODD_CHARS, " ").trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.endsWith(t[0])) t = t.slice(1, -1).trim();
  return t;
}
function env(name: string, fallback = "", keepEmpty = false): string {
  const exact = process.env[name];
  if (exact !== undefined && tidy(exact) !== "") return tidy(exact);
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== name && tidy(k).toUpperCase() === name && tidy(v) !== "") return tidy(v);
  return exact !== undefined && keepEmpty ? "" : fallback;
}

// For the start-up log: which settings arrived (names only, never values)
const SECRET_SETTINGS = ["ANTHROPIC_API_KEY", "STORAGE_ACCESS_KEY", "WEBSITE_DATABASE_URL", "WEBSITE_DATABASE_AUTH_TOKEN", "SESSION_SECRET", "SSO_SECRET", "FHRG_REF_KEY", "SEARCH_KEY"];
const VARIABLE_SETTINGS = ["STORAGE_ZONE", "STORAGE_HOST", "ROOT_FOLDER", "WEBSITE_URL", "SITE_ADMINS", "CLAUDE_MODEL", "CLAUDE_EFFORT", "FHRG_REF_URL", "DEMO", "MONTHLY_CAP_USD", "WEB_SEARCH_MAX", "DATA_QUERIES_MAX", "DAILY_JOBS_MAX"];

function folder(name: string, fallback: string): string {
  const f = env(name, fallback, true).replace(/^\/+|\/+$/g, "");
  return f ? f + "/" : "";
}

function pipelineUrl(v: string): string {
  const u = v.replace(/^libsql:\/\//i, "https://").replace(/\/+$/, "");
  return u && !/\/v2\/pipeline$/.test(u) ? u + "/v2/pipeline" : u;
}

const num = (name: string, fallback: number, min: number, max: number) => Math.max(min, Math.min(max, Number(env(name, String(fallback))) || fallback));

export function getConfig(): Config {
  return {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("CLAUDE_MODEL", "claude-sonnet-5-5"),
    effort: env("CLAUDE_EFFORT", "medium").toLowerCase(),
    storageKey: env("STORAGE_ACCESS_KEY"),
    storageZone: env("STORAGE_ZONE"),
    storageHost: env("STORAGE_HOST", "storage.bunnycdn.com").replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    root: folder("ROOT_FOLDER", "clarion"),
    webDbUrl: pipelineUrl(env("WEBSITE_DATABASE_URL")),
    webDbToken: env("WEBSITE_DATABASE_AUTH_TOKEN"),
    websiteUrl: (env("WEBSITE_URL") || "https://fhrg.co.uk").replace(/\/+$/, ""),
    siteAdmins: env("SITE_ADMINS").split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
    sessionSecret: env("SESSION_SECRET"),
    ssoSecret: env("SSO_SECRET"),
    refUrl: (env("FHRG_REF_URL") || "https://builder.fhrg.co.uk").replace(/\/+$/, ""),
    refKey: env("FHRG_REF_KEY"),
    searchKey: env("SEARCH_KEY"),
    monthlyCapUsd: num("MONTHLY_CAP_USD", 40, 1, 2000),
    webMax: num("WEB_SEARCH_MAX", 4, 1, 10),
    dataMax: num("DATA_QUERIES_MAX", 8, 1, 20),
    dailyJobsMax: num("DAILY_JOBS_MAX", 20, 1, 500),
    demo: !/^(0|no|false|off)$/i.test(env("DEMO", "on")),
  };
}

export function missingSettings(c: Config): string[] {
  const m: string[] = [];
  if (!c.apiKey) m.push("ANTHROPIC_API_KEY");
  if (!c.storageKey) m.push("STORAGE_ACCESS_KEY");
  if (!c.storageZone) m.push("STORAGE_ZONE");
  if (!c.webDbUrl) m.push("WEBSITE_DATABASE_URL");
  if (!c.webDbToken) m.push("WEBSITE_DATABASE_AUTH_TOKEN");
  if (!c.sessionSecret) m.push("SESSION_SECRET");
  if (!c.refKey) m.push("FHRG_REF_KEY");
  return m;
}

export function settingsReport(): string[] {
  const c = getConfig();
  const lines = [
    `[info] settings received: ${[...SECRET_SETTINGS, ...VARIABLE_SETTINGS].filter((n) => env(n) !== "").join(", ") || "none"}`,
    `[info] not set (defaults or off): ${[...SECRET_SETTINGS, ...VARIABLE_SETTINGS].filter((n) => env(n) === "").join(", ") || "none"}`,
  ];
  const missing = missingSettings(c);
  lines.push(missing.length ? `[error] required settings missing: ${missing.join(", ")}` : "[info] all required settings are present");
  lines.push(`[info] signing in from the website: ${c.ssoSecret ? "on" : "off (add SSO_SECRET)"}; monthly Claude cap: $${c.monthlyCapUsd}`);
  return lines;
}

// The sources Claude may search and read when pinning down an announcement. A domain also covers its
// subdomains. It's the knowledgebase's trusted list: government, legislation and statistics; standards
// bodies; professional, representative and research bodies; and the main sector publications.
export const TRUSTED_DOMAINS = [
  "gov.uk", "legislation.gov.uk", "parliament.uk", "nao.org.uk", "gov.wales", "transport.gov.scot", "nidirect.gov.uk", "tfl.gov.uk",
  "nationalhighways.co.uk", "standardsforhighways.co.uk", "bsigroup.com", "caselaw.nationalarchives.gov.uk",
  "ciht.org.uk", "ice.org.uk", "theihe.org", "istructe.org", "theilp.org.uk", "theiam.org", "ciwem.org", "ciria.org", "susdrain.org",
  "adeptnet.org.uk", "local.gov.uk", "lgo.org.uk", "ico.org.uk", "cipfa.org", "apse.org.uk", "nhtnetwork.co.uk", "fhrg.co.uk", "mhaplus.org.uk",
  "trl.co.uk", "britpave.org.uk", "mineralproducts.org", "eurobitume.eu", "rsta-uk.org", "asphaltindustryalliance.com", "lcrig.org.uk",
  "hauc-uk.org.uk", "geoplace.co.uk", "neccontract.com", "lantra.co.uk", "localgovernmentlawyer.co.uk",
  "highwaysmagazine.co.uk", "newcivilengineer.com", "transportxtra.com", "localgov.co.uk", "highwaysindustry.com",
  "theccc.org.uk", "ukgbc.org", "carbontrust.com", "bre.co.uk", "wrap.org.uk",
  "rospa.com", "roadsafetygb.org.uk", "pacts.org.uk", "racfoundation.org", "livingstreets.org.uk", "sustrans.org.uk", "cyclinguk.org",
];

export function trustedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return TRUSTED_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}
