// Clarion as a Demonstrator: when the FHRG website marks it so, the page opens in the Northbridge demonstration, and
// only Proving Services, site administrators and the authorities chosen on the website can sign in to use their own
// data (signing in, arriving from the website and every request after).
import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import { addUser, tools, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(3, "kirk@kirklees.gov.uk", "Kay Lead", 20, "lead");
await addUser(5, "staff@fhrg.test", "Sol Staff", 99, "member");
await addUser(6, "admin@kirklees.gov.uk", "Ada Admin", 20, "member", 1);
const api = async (path, body, token) => { const r = await handleRequest(new Request("https://clarion.test" + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-session-token": token } : {}) }, body: JSON.stringify(body ?? {}) })); return { status: r.status, ...(await r.json()) }; };
const login = (email) => api("/api/login", { email, password: "pw" });
// each change uses a fresh short name, as Clarion keeps what it read for a minute
let n = 0;
const set = (status, own_data = "demo-only", own_data_authorities = "") => {
  const key = `clarion-${++n}`;
  process.env.WEBSITE_TOOL = key;
  tools.length = 0;
  if (status) tools.push({ app_key: key, status, own_data, own_data_authorities });
};

// ---- without the setting, or before the website has it: as before
set("demonstrator");
delete process.env.WEBSITE_TOOL;
ok((await api("/api/config")).demoFirst === false && !!(await login("kirk@kirklees.gov.uk")).token, "without WEBSITE_TOOL, Clarion works as before");
set(null);
ok((await api("/api/config")).demoFirst === false && !!(await login("kirk@kirklees.gov.uk")).token, "with no settings for it on the website, as before");
set("production");
ok((await api("/api/config")).demoFirst === false && !!(await login("kirk@kirklees.gov.uk")).token, "a tool that isn't a Demonstrator keeps the access it had");

// ---- a Demonstrator
set("demonstrator");
ok((await api("/api/config")).demoFirst === true, "as a Demonstrator, the page opens in the demonstration");
let r = await login("kirk@kirklees.gov.uk");
ok(r.status === 403 && r.demoOnly === true && !r.token && /demonstration/.test(r.error), "an authority that hasn't been chosen can't sign in, and is told about the demonstration");
ok(!!(await login("staff@fhrg.test")).token && !!(await login("admin@kirklees.gov.uk")).token, "Proving Services and site administrators can");
set("demonstrator", "chosen", ",30,");
ok(!!(await login("lead@westsussex.gov.uk")).token && (await login("kirk@kirklees.gov.uk")).status === 403, "with chosen authorities, only those can");
set("demonstrator", "chosen", ",3,");
ok((await login("lead@westsussex.gov.uk")).status === 403, "an authority is matched by its whole id (3 isn't 30)");
set("demonstrator", "all-authorities");
const token = (await login("kirk@kirklees.gov.uk")).token;
ok(!!token && (await api("/api/status", {}, token)).status === 200, "with all authorities, any approved authority can");
set("demonstrator", "chosen", ",30,");
r = await api("/api/status", {}, token);
ok(r.status === 403 && r.demoOnly === true, "taking an authority off ends what its sessions can do");

// ---- the page
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
// jsdom doesn't move between pages: it reports an attempt instead, which is how leaving for /demo is seen
async function open(address) {
  const vc = new VirtualConsole();
  let left = false;
  vc.on("jsdomError", (e) => { if (/navigation/i.test(e.message)) left = true; });
  const dom = new JSDOM(html, {
    url: `https://clarion.test${address}`, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.fetch = async (url, opts = {}) => {
        const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts));
        const body = await res.text();
        return { ok: res.ok, status: res.status, json: async () => JSON.parse(body) };
      };
    },
  });
  Object.defineProperty(dom.window, "replaced", { get: () => left });
  return dom;
}
set("demonstrator");
let dom = await open("/");
await until(() => dom.window.replaced || dom.window.document.querySelector("#si-email"), "the page to start");
ok(dom.window.replaced && !dom.window.document.querySelector("#si-email"), "a Demonstrator's page goes straight to the demonstration");
dom = await open("/signin");
await until(() => dom.window.document.querySelector("#si-email"), "the sign-in form");
ok(!dom.window.replaced, "/signin shows the sign-in form");
set("production");
dom = await open("/");
await until(() => dom.window.document.querySelector("#si-email"), "the sign-in form");
ok(!dom.window.replaced, "a tool that isn't a Demonstrator opens on sign-in as before");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
