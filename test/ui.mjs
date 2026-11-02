// The page in a simulated browser (jsdom), talking to the real app.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { addUser, claude, assessment, change, until } from "./sim.mjs";
const { handleRequest } = await import("./.build/app.mjs");

let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
await addUser(1, "lead@westsussex.gov.uk", "Lee Lead", 30, "lead");
await addUser(2, "other@northlincs.gov.uk", "Nell Other", 40, "member");
await addUser(3, "boss@fhrg.test", "Bo Boss", 99, "member");
const api = async (path, body, token) => (await handleRequest(new Request("https://clarion.test" + path, { method: "POST", headers: { "content-type": "application/json", "x-session-token": token || "" }, body: JSON.stringify(body) }))).json();
const lead = (await api("/api/login", { email: "lead@westsussex.gov.uk", password: "pw" })).token;
const other = (await api("/api/login", { email: "other@northlincs.gov.uk", password: "pw" })).token;
const boss = (await api("/api/login", { email: "boss@fhrg.test", password: "pw" })).token;

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function open(token, hash = "") {
  const dom = new JSDOM(html, {
    url: `https://clarion.test/${hash}`, runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      if (token) w.localStorage.setItem("clarion_token", token);
      w.scrollTo = () => {};
      w.print = () => { w.printed = true; };
      w.fetch = async (url, opts = {}) => {
        const res = await handleRequest(new Request(new URL(url, "https://clarion.test").href, opts));
        const text = await res.text();
        return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
      };
    },
  });
  await until(() => dom.window.document.querySelector("#app > *"), "the page to start");
  return dom;
}
const text = (el) => el.textContent.replace(/\s+/g, " ");

// ---- signing in
let dom = await open("");
let d = dom.window.document;
await until(() => d.querySelector("#si-email"), "the sign-in form");
ok(/Clarion/.test(text(d.querySelector("h1"))), "someone not signed in sees the sign-in screen");
d.querySelector("#si-email").value = "lead@westsussex.gov.uk";
d.querySelector("#si-pw").value = "wrong";
d.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true, bubbles: true }));
await until(() => d.querySelector(".err"), "the error");
ok(/don't match/.test(text(d.querySelector(".err"))), "a wrong password is explained");

// ---- outside the pilots
dom = await open(other); d = dom.window.document;
await until(() => d.querySelector(".main h1"), "the page");
ok(/being trialled/.test(text(d.querySelector(".main"))), "a member outside the pilots is told why there's nothing to see");

// ---- a pilot's page
dom = await open(lead); d = dom.window.document; let w = dom.window;
await until(() => [...d.querySelectorAll("h2")].some((x) => x.textContent === "Published data"), "the evidence");
const page = text(d.querySelector(".main"));
ok(d.querySelector("h1").textContent === "West Sussex", "a lead goes straight to their authority");
ok(/£28\.303m/.test(page) && /Overall: Amber/.test(page), "funding route and DfT rating are shown");
ok(/Condition of highways/.test(page) && /24 \/ 100/.test(page), "survey results are shown");
ok(/Road length/.test(page) && /4,000 km/.test(page) && /Region \(median\)/.test(page), "published data is compared");
ok(/4 reports on FixMyStreet/.test(page) && /one small area/.test(page) && !/Jane/.test(page), "public reports are summarised, with bunching flagged");
ok(/sample, not a total/.test(page) && !/a day/.test(page.split("What's missing")[0].split("Public fault reports")[1]), "the feed is called a sample, with no rate for a few days' reports");
ok(/leave out residents' names/.test(page), "officers are asked to keep residents' names out of their notes");
ok(/Fix the nation's potholes/.test(page) && /MP for Horsham/.test(page), "petitions and MPs' questions are shown");
ok(/What's missing/.test(page) && /Fault report counts/.test(page), "gaps are listed");
ok([...d.querySelectorAll("summary")].some((x) => /Add a survey result/.test(x.textContent)) && [...d.querySelectorAll("h2")].some((x) => x.textContent === "Officer notes"), "a lead can add results and notes");

// write the first reading
w.eval("App.pollMs = 20");
const write = [...d.querySelectorAll("button")].find((b) => b.textContent === "Write the first reading");
ok(write, "there's a button to write the first reading");
write.click();
await until(() => /Direction: Not yet known/.test(text(d.querySelector(".main"))), "the reading");
ok(/rate road condition poorly/.test(text(d.querySelector(".main"))) && /Written by Clarion with AI/.test(text(d.querySelector(".main"))), "the reading appears, labelled as AI-written");
ok([...d.querySelectorAll("button")].some((b) => b.textContent === "Write a new reading"), "and the button now offers a new reading");

// ---- a note, with hostile content from outside
claude.script.submit_change = (body) => (body.messages.length === 1 ? ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", usage: {}, content: [
  { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: "javascript:alert(1)", title: "Bad" }] },
  { type: "tool_use", id: "t", name: "submit_change", input: change({ title: '<img src=x onerror="window.hacked=1">Funding news', sources: [{ url: "javascript:alert(1)", title: "Click me", kind: "Other" }] }) },
] }) : null);
w.location.hash = "#notes/E10000032";
await until(() => d.querySelector("textarea[placeholder]") && [...d.querySelectorAll("select option")].some((o) => /Record funding/.test(o.textContent)), "the notes page");
ok(![...d.querySelectorAll("select option")].some((o) => /organisational charts/.test(o.textContent)), "the announcement list leaves out what isn't about roads");
ok(/No notes yet/.test(text(d.querySelector(".main"))), "no notes so far");
ok(/doesn't use the web when you paste text/.test(text(d.querySelector(".main"))), "the page explains that pasted text stays away from the web");
d.querySelector("select").value = "https://www.gov.uk/government/news/record";
d.querySelector(".card form").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
await until(() => [...d.querySelectorAll("h2")].some((x) => x.textContent === "Likely impacts here"), "the finished note");
const nt = text(d.querySelector(".main"));
ok(/£0\.95m may rest on evidence/.test(nt) && /Sources disagree/.test(nt), "the note shows its headline and where sources disagree");
ok(/Likely effect on public mood/.test(nt) && /Expectation gap: Large/.test(nt) && /a theory being tested/.test(nt), "the mood forecast is shown, and labelled as a theory");
ok(/Removed on challenge \(1\)/.test(nt) && /On challenge:/.test(nt), "what the challenge changed is shown");
ok(/An officer should check this/.test(nt), "the note says it needs checking");
ok(/Authorities and schemes named in the sources \(2\)/.test(nt), "the names found in the sources can be read");
ok(!d.querySelector(".main img") && w.hacked === undefined && /<img src=x/.test(nt), "hostile text from a web page is shown as text, never run");
ok(![...d.querySelectorAll("a")].some((a) => /^javascript:/i.test(a.getAttribute("href") || "")), "a javascript: link is never made clickable");
[...d.querySelectorAll("button")].find((b) => /Print or save/.test(b.textContent)).click();
ok(w.printed === true, "the note can be printed");
delete claude.script.submit_change;
w.location.hash = "#notes/E10000032";
await until(() => /Notes so far/.test(text(d.querySelector(".main"))) && d.querySelector(".note-row"), "the list");
ok(d.querySelector(".note-row a").getAttribute("href").startsWith("#note/E10000032/"), "the note is in the list");

// ---- several authorities
dom = await open(boss); d = dom.window.document;
await until(() => d.querySelectorAll(".nav button").length === 3, "the side rail");
ok(/Choose an authority/.test(text(d.querySelector(".main"))), "a site administrator chooses an authority");
ok(/of \$40/.test(text(d.querySelector(".rail"))), "and sees the month's spend");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
