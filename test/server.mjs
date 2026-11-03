// The real server (src/server.ts) over HTTP: health, the page, sign-in and cookies, and signing in from the
// FHRG website.
import { addUser, users, env as simEnv } from "./sim.mjs";
import { SSO_SECRET, makePass } from "./sso.mjs";
process.env.SSO_SECRET = SSO_SECRET;
process.env.CLAUDE_MODEL = ""; // an empty setting means the default
const logs = [];
const log0 = console.log;
console.log = (...a) => { logs.push(a.join(" ")); };
const { startServer } = await import("./.build/server.mjs");
const server = startServer(0, new URL("../public/index.html", import.meta.url).pathname);
await new Promise((r) => server.once("listening", r));
console.log = log0;
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "pending@westsussex.gov.uk", "Pat Pending", 30, "member");
users.find((u) => u.id === 2).status = "pending";
const post = (path, body, headers = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

ok(logs.some((l) => /settings received: .*ANTHROPIC_API_KEY.*SSO_SECRET/.test(l)) && logs.some((l) => /signing in from the website: on/.test(l)) && logs.some((l) => /all required settings are present/.test(l)), "the start-up log lists the settings that arrived");
ok(!logs.join("\n").includes(simEnv.SESSION_SECRET) && !logs.join("\n").includes(SSO_SECRET) && !logs.join("\n").includes(simEnv.FHRG_REF_KEY), "and never their values");

let r = await fetch(`${base}/health`);
ok(r.status === 200 && (await r.json()).ok === true, "/health answers");
// the tablet page, with no account
r = await fetch(`${base}/s/ABCD2345`);
const tabletPage = await r.text();
ok(r.status === 200 && /One question|Street survey/.test(tabletPage) && /noindex/.test(r.headers.get("x-robots-tag") || "") && r.headers.get("referrer-policy") === "no-referrer", "the tablet page opens without an account, hidden from search engines and with its code kept out of referrers");
ok((await (await fetch(`${base}/s`)).text()).includes("Survey code"), "and at the plain address, for typing a code in");
r = await fetch(`${base}/s/sw.js`);
ok(r.status === 200 && /javascript/.test(r.headers.get("content-type")) && /clarion-survey/.test(await r.text()), "its helper for working without a signal is served");
r = await post("/api/s/get", {});
ok(r.status === 404, "the tablet's route answers without an account");
r = await fetch(`${base}/`);
const html = await r.text();
const csp = r.headers.get("content-security-policy") || "";
ok(r.status === 200 && /text\/html/.test(r.headers.get("content-type")) && /<title>Clarion<\/title>/.test(html) && /frame-ancestors 'none'/.test(csp), "the page is served, with a content security policy");
r = await fetch(`${base}/sso`);
ok(r.status === 200 && (await r.text()) === html, "/sso serves the page too");
r = await fetch(`${base}/robots.txt`);
ok(/Disallow: \//.test(await r.text()), "search engines are told to stay away");

r = await post("/api/login", { email: "lead@westsussex.gov.uk", password: "pw" });
const login = await r.json();
ok(r.status === 200 && login.token && /^clarion_session=/.test(r.headers.getSetCookie()[0] || "") && /HttpOnly; Secure; SameSite=Strict/.test(r.headers.getSetCookie()[0]), "signing in returns a token and a safe session cookie");
r = await post("/api/status", {}, { "x-session-token": login.token });
ok(r.status === 200 && (await r.json()).user.name === "Lee Lead", "the token works for the API");
r = await post("/api/status", {}, { cookie: `clarion_session=${login.token}` });
ok(r.status === 200, "so does the cookie");
r = await post("/api/nowhere", {});
ok(r.status === 404, "unknown routes say so");

// ---- signing in from the FHRG website
const pass = await makePass({ u: 1, e: "lead@westsussex.gov.uk", n: "Lee Lead" });
r = await post("/api/sso", { token: pass });
const sso = await r.json();
ok(r.status === 200 && sso.token, "a pass from the website signs the member in");
r = await post("/api/sso", { token: pass });
ok(r.status === 401 && /already been used/.test((await r.json()).error), "a pass works only once");
r = await post("/api/sso", { token: await makePass({ u: 1, e: "lead@westsussex.gov.uk", exp: Date.now() - 1000 }) });
ok(r.status === 401, "an expired pass is refused");
r = await post("/api/sso", { token: await makePass({ u: 1, e: "lead@westsussex.gov.uk", exp: Date.now() + 3600_000 }) });
ok(r.status === 401, "a pass that claims too long a life is refused");
r = await post("/api/sso", { token: await makePass({ u: 1, e: "lead@westsussex.gov.uk" }, "the-wrong-secret") });
ok(r.status === 401, "a pass signed with the wrong secret is refused");
r = await post("/api/sso", { token: await makePass({ u: 1, e: "lead@westsussex.gov.uk", aud: "knowledgebase" }) });
ok(r.status === 401, "a pass meant for another service is refused");
r = await post("/api/sso", { token: await makePass({ u: 1, e: "someone.else@westsussex.gov.uk" }) });
ok(r.status === 401, "a pass whose email doesn't match the account is refused");
r = await post("/api/sso", { token: await makePass({ u: 2, e: "pending@westsussex.gov.uk" }) });
ok(r.status === 403, "the usual account checks still apply");
r = await post("/api/sso", { token: "rubbish" });
ok(r.status === 401, "nonsense is refused");

// ---- limits
r = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json", "content-length": String(100 * 1024 * 1024) }, body: "x" }).catch(() => ({ status: "closed" }));
ok(r.status === 413 || r.status === "closed", "a request declaring 100 MB is refused before it's read");
const big = new ReadableStream({ start(ctl) { for (let i = 0; i < 20; i++) ctl.enqueue(new Uint8Array(50_000).fill(65)); ctl.close(); } });
r = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: big, duplex: "half" });
ok(r.status === 413, "an oversized body without a declared size is stopped");
let last = 0;
for (let i = 0; i < 31; i++) last = (await post("/api/login", { email: `nobody${i}@nowhere.test`, password: "wrong" }, { "x-real-ip": "203.0.113.9" })).status;
ok(last === 429, "31 failed sign-ins from one address are stopped");
for (let i = 0; i < 9; i++) last = (await post("/api/login", { email: "lead@westsussex.gov.uk", password: "wrong" }, { "x-real-ip": `198.51.100.${i}` })).status;
ok(last === 429, "so are repeated failures on one account from many addresses");

// a scan may be larger than anything else
const bulky = "x".repeat(3 * 1024 * 1024);
r = await post("/api/survey/get", bulky).catch(() => ({ status: "closed" }));
ok(r.status === 413 || r.status === "closed", "an oversized request is refused");
r = await post("/api/survey/scan", JSON.stringify({ code: "E10000032", id: "20261102120000000-abcd1234", data: bulky }), { "x-session-token": login.token });
ok(r.status === 404, "but a scan of that size is read");
r = await post("/api/survey/scan", "x".repeat(12 * 1024 * 1024)).catch(() => ({ status: "closed" }));
ok(r.status === 413 || r.status === "closed", "and it has a limit too");

server.close();
console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
