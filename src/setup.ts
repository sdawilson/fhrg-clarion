// What each authority sets up for itself: the functions of each service, its key partners and its campaign channels.
// FHRG sets a standard list of functions, and each authority's lead can rename, take out or add to it. A renamed
// function keeps its id, so it stays linked to the Climate Toolkit. FHRG also sets the weights that blend the parts of
// the map into one mood, so that mood means the same everywhere.
//
// Files, under ROOT_FOLDER:
//   authorities/<code>/setup.json   functions, partners and channels
//   system/mood-weights.json        the weights for each branch of the map

import type { Config } from "./config";
import { savePretty, storageJson } from "./storage";
import { FriendlyError, cleanText, londonToday, withLock } from "./util";

export const SERVICES = [
  { id: "highways", label: "Highways" }, { id: "waste", label: "Waste and recycling" }, { id: "parks", label: "Parks and green spaces" },
  { id: "libraries", label: "Libraries and culture" }, { id: "planning", label: "Planning" }, { id: "housing", label: "Housing" },
] as const;
export const DEFAULT_SERVICE = "highways";
export const serviceId = (v: unknown) => SERVICES.find((s) => s.id === v)?.id ?? DEFAULT_SERVICE;

// The Climate Toolkit's highways functions, so the two tools can be read together
export const FUNCTIONS = [
  ["cw", "Carriageways"], ["fw", "Footways & cycleways"], ["dr", "Drainage & flooding"], ["st", "Bridges & structures"], ["ew", "Earthworks & geotechnical"], ["sl", "Street lighting"],
  ["ts", "Traffic signals & ITS"], ["sg", "Signs, lines & barriers"], ["tr", "Trees & soft estate"], ["ws", "Winter service"], ["nm", "Network management & incidents"], ["pw", "Public rights of way"], ["cl", "Claims & liability"],
] as const;
const STANDARD: Record<string, readonly (readonly [string, string])[]> = {
  highways: FUNCTIONS,
  waste: [["bc", "Bin collections"], ["rc", "Recycling"], ["sc", "Street cleansing"], ["ft", "Fly-tipping"]],
  parks: [["pk", "Parks"], ["pl", "Play areas"], ["gs", "Grass cutting"], ["cm", "Cemeteries"]],
};

export type Fn = { id: string; name: string; orig: string }; // orig is the standard name, and blank for one the authority added
export type Partner = { id: string; name: string; role: string };
export type Channel = { id: string; name: string; node: string }; // node: where its planned events show on the map
export type Setup = { functions: Record<string, Fn[]>; partners: Partner[]; channels: Channel[]; updated: string; by: string };

const MAX_FUNCTIONS = 40;
const MAX_PARTNERS = 12;
const MAX_CHANNELS = 16;
const NAME_CHARS = 80;
export const CHANNEL_NODES = ["press", "socialm", "meetings", "radio", "tv", "street", "video"] as const;

export const standardFunctions = (service: string): Fn[] => (STANDARD[service] ?? []).map(([id, name]) => ({ id, name, orig: name }));
const startChannels = (): Channel[] => [
  { id: "press", name: "Press announcement", node: "press" }, { id: "social", name: "Social media post", node: "socialm" },
  { id: "liaison", name: "Community liaison meeting", node: "meetings" }, { id: "radio", name: "Radio interview", node: "radio" }, { id: "survey", name: "Street survey", node: "street" },
];
const blank = (): Setup => ({ functions: Object.fromEntries(SERVICES.map((s) => [s.id, standardFunctions(s.id)])), partners: [], channels: startChannels(), updated: "", by: "" });
const setupPath = (c: Config, code: string) => `${c.root}authorities/${code}/setup.json`;
const newId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function loadSetup(c: Config, code: string): Promise<Setup> {
  const held = await storageJson<Partial<Setup>>(c, setupPath(c, code), {});
  const base = blank();
  return { ...base, ...held, functions: { ...base.functions, ...(held.functions ?? {}) } };
}

/** A list as an officer left it. Rows keep their ids, a new row gets one, and two rows can't share a name. */
function readRows<T extends { id: string; name: string }>(v: unknown, max: number, what: string, make: (row: any, name: string, id: string) => T): T[] {
  if (!Array.isArray(v)) throw new FriendlyError("That list wasn't readable. Please try again.");
  if (v.length > max) throw new FriendlyError(`Keep the list of ${what} to ${max}.`);
  const out: T[] = [], names = new Set<string>();
  for (const row of v) {
    const name = cleanText(row?.name, NAME_CHARS);
    if (!name) throw new FriendlyError(`Each of the ${what} needs a name.`);
    if (names.has(name.toLowerCase())) throw new FriendlyError(`${name} is in the list twice.`);
    names.add(name.toLowerCase());
    out.push(make(row, name, typeof row?.id === "string" && /^[a-z0-9]{1,24}$/i.test(row.id) ? row.id : newId()));
  }
  return out;
}
export const readFunctions = (v: unknown, service: string): Fn[] => {
  const std = standardFunctions(service);
  return readRows(v, MAX_FUNCTIONS, "functions", (_row, name, id) => ({ id, name, orig: std.find((f) => f.id === id)?.orig ?? "" }));
};
export const readPartners = (v: unknown): Partner[] => readRows(v, MAX_PARTNERS, "partners", (row, name, id) => ({ id, name, role: cleanText(row?.role, NAME_CHARS) }));
export const readChannels = (v: unknown): Channel[] => readRows(v, MAX_CHANNELS, "channels", (row, name, id) => ({ id, name, node: (CHANNEL_NODES as readonly string[]).includes(row?.node) ? row.node : "" }));

export async function saveSetup(c: Config, code: string, b: any, by: string): Promise<Setup> {
  return await withLock(setupPath(c, code), async () => {
    const held = await loadSetup(c, code);
    if (b?.part === "functions") { const service = serviceId(b.service); held.functions[service] = readFunctions(b.list, service); }
    else if (b?.part === "partners") held.partners = readPartners(b.list);
    else if (b?.part === "channels") held.channels = readChannels(b.list);
    else throw new FriendlyError("That isn't something that can be set up.");
    held.updated = londonToday(); held.by = by;
    await savePretty(c, setupPath(c, code), held);
    return held;
  });
}

// ----- the weights

export const WEIGHTS = { surveys: 40, contact: 20, print: 15, broadcast: 10, social: 10, events: 5 };
export type Weights = typeof WEIGHTS;
const weightsPath = (c: Config) => `${c.root}system/mood-weights.json`;

export async function loadWeights(c: Config): Promise<Weights> {
  return { ...WEIGHTS, ...(await storageJson<Partial<Weights>>(c, weightsPath(c), {})) };
}
export async function saveWeights(c: Config, b: any): Promise<Weights> {
  const out = { ...WEIGHTS };
  for (const key of Object.keys(WEIGHTS) as (keyof Weights)[]) {
    const n = Number(b?.[key]);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new FriendlyError("Give each weight as a whole number from 0 to 100.");
    out[key] = n;
  }
  if (!Object.values(out).some((n) => n > 0)) throw new FriendlyError("At least one weight must be above nothing.");
  await savePretty(c, weightsPath(c), out);
  return out;
}
