import { FEED, refused } from "./sim.mjs";
const t = await import("./.build/internals.mjs");
let failures = 0;
const ok = (cond, what) => { console.log(`${cond ? "PASS" : "FAIL"}  ${what}`); if (!cond) failures++; };
const throws = (fn) => { try { fn(); return ""; } catch (e) { return e.message; } };

// ---- the calculator Claude uses for its sums
ok(t.calculate("7583000 * 0.125") === 947875, "works out the worked example's sum");
ok(t.calculate("(2 + 3) * 4 - 6 / 2") === 17, "follows the order of operations");
ok(t.calculate("-3 + 5") === 2, "copes with a negative number");
ok(t.calculate("£1,000 * 2") === 2000, "ignores pound signs and commas");
ok(/numbers/.test(throws(() => t.calculate("process.exit(1)"))), "refuses anything that isn't arithmetic");
ok(/zero/.test(throws(() => t.calculate("1/0"))), "refuses dividing by zero");
ok(throws(() => t.calculate("(1+2")) !== "", "refuses an unmatched bracket");

// ---- the two-signal rule
const held = ["survey", "actions", "representatives"];
ok(t.settleDirection("Worsening", ["survey", "actions"], false, held).direction === "Not yet known", "a first reading can't report a change");
ok(t.settleDirection("Worsening", ["actions"], true, held).direction === "Not yet known", "one kind of signal isn't enough");
ok(t.settleDirection("Worsening", ["actions", "actions"], true, held).direction === "Not yet known", "the same kind twice isn't two kinds");
ok(t.settleDirection("Worsening", ["actions", "representatives"], true, held).direction === "Worsening", "two kinds that agree are reported");
ok(t.settleDirection("Worsening", ["actions", "open talk"], true, held).direction === "Not yet known", "a kind Clarion doesn't hold can't be the second signal");
ok(t.settleDirection("Steady", [], true, held).direction === "Steady", "no change needs no second signal");
ok(t.settleDirection("Rubbish", ["actions", "survey"], true, held).direction === "Not yet known", "an unknown direction isn't accepted");
const sig = (ok, data) => ({ ok, data });
ok(t.kindsHeld({ surveys: [{}], signals: { fixMyStreet: sig(true, { reports: 3 }), petitions: sig(true, []), questions: sig(true, [{}]) } }).join() === "survey,actions,representatives", "counts the kinds of signal really held");
ok(t.kindsHeld({ surveys: [], signals: { fixMyStreet: sig(false, null), petitions: sig(true, []), questions: sig(false, null) } }).length === 0, "a source that's down or empty isn't a signal");

// ---- the challenge step
const impact = (statement, confidence = "High") => ({ statement, confidence });
let r = t.applyReview([impact("a"), impact("b"), impact("c", "Low")], [{ index: 1, verdict: "keep" }, { index: 2, verdict: "cut", reason: "No" }, { index: 3, verdict: "reduce", reason: "Too sure" }]);
ok(r.kept.length === 2 && r.cut.length === 1 && r.cut[0].statement === "b", "cut claims are removed and recorded");
ok(r.kept[1].confidence === "Low" && r.kept[1].challenge === "Too sure", "confidence can't go below low");
r = t.applyReview([impact("a")], [{ index: 1, verdict: "reduce", reason: "x" }]);
ok(r.kept[0].confidence === "Moderate", "reducing lowers confidence one step");
r = t.applyReview([impact("a"), impact("b")], [{ index: 1, verdict: "keep", reason: "Fine" }]);
ok(r.kept.length === 2 && !r.kept[0].unchecked && r.kept[1].unchecked === true, "an impact with no verdict is kept, and flagged as not challenged");
r = t.applyReview([impact("a")], "nonsense");
ok(r.kept.length === 1 && r.kept[0].unchecked === true, "a garbled review keeps the draft rather than losing it");

// ---- reading what Claude hands in
const c = t.readChange({ title: "T", sources: [{ url: "https://www.gov.uk/x", title: "X", kind: "Primary" }, { url: "https://made.up/y", title: "Y" }, { url: "https://www.gov.uk/given", title: "G" }] }, [{ url: "https://www.gov.uk/x", title: "X" }], "https://www.gov.uk/given");
ok(c.sources.length === 2 && !c.sources.some((s) => s.url.includes("made.up")), "a source Claude never read is dropped");
ok(t.readChange({ announced: "last week" }, [], "").announced === "", "a date that isn't one is dropped");
let i = t.readImpact({ statement: "x", route: "Made up", likelihood: "Maybe", when: "Now", check_date: "2020-01-01" }, "2026-11-02");
ok(i.route === "Governance" && i.likelihood === "Realistic possibility" && i.confidence === "Low", "unknown ratings fall back to cautious ones");
ok(i.checkDate === "2026-12-02", "a past check date is replaced");
ok(t.readImpact({ statement: " " }, "2026-11-02") === null, "an empty impact is ignored");

// ---- what officers can give
ok(t.readInput({ url: "https://www.gov.uk/government/news/x" }).url.includes("gov.uk"), "a GOV.UK link is accepted");
ok(t.readInput({ text: "Some announcement" }).text === "Some announcement", "pasted text is accepted");
ok(/isn't on Clarion's list/.test(throws(() => t.readInput({ url: "https://evil.example/x" }))), "a link to an untrusted site is refused");
ok(/https/.test(throws(() => t.readInput({ url: "http://www.gov.uk/x" }))), "a plain http link is refused");
ok(throws(() => t.readInput({})) !== "", "nothing at all is refused");
ok(!t.trustedHost("gov.uk.evil.example") && !t.trustedHost("notgov.uk") && t.trustedHost("www.westsussex.gov.uk"), "trusted sites are matched properly");

// ---- FixMyStreet: never the words or the names
const fms = t.readFixMyStreet(FEED);
ok(fms.reports === 4 && fms.from === "2026-10-29" && fms.to === "2026-11-01", "counts the feed's reports and dates");
ok(fms.perDay === null, "gives no rate for a feed covering under a week");
const longFeed = FEED.replace("Thu, 29 Oct 2026", "Thu, 22 Oct 2026");
ok(t.readFixMyStreet(longFeed).perDay === 0.4, "gives a rate once it covers a week or more");
ok(fms.categories[0].name === "Potholes" && fms.categories[0].count === 3, "tallies categories");
ok(fms.busiestSquare === 3, "spots reports bunched in one small area");
ok(!/Jane|Smith|Acacia|hole outside/.test(JSON.stringify(fms)), "keeps no words or names from reports");
ok(/not a feed/.test(throws(() => t.readFixMyStreet("<html>Sorry</html>"))), "a page that isn't a feed is an error, not an empty result");

// ---- petitions
const detail = { data: { attributes: { signatures_by_constituency: [{ name: "Horsham", signature_count: 300 }, { name: "HUDDERSFIELD", signature_count: 50 }, { name: "Bath", signature_count: 500 }] } } };
ok(t.localSignatures(detail, [{ name: "Horsham" }, { name: "Huddersfield" }]) === 350, "adds up signatures from the authority's constituencies");
ok(t.localSignatures({}, [{ name: "Horsham" }]) === 0, "a petition without the breakdown counts as none");

// ---- who sees what
const member = (authority, siteAdmin = false) => ({ authority, siteAdmin });
ok(t.pilotsFor(member("West Sussex County Council")).map((p) => p.name).join() === "West Sussex", "a member sees their own pilot");
ok(t.pilotsFor(member("Kirklees Council")).map((p) => p.name).join() === "Kirklees", "matches Kirklees Council");
ok(t.pilotsFor(member("North Lincolnshire Council")).length === 0, "North Lincolnshire isn't mistaken for Lincolnshire");
ok(t.pilotsFor(member("FHRG", true)).length === 3, "a site administrator sees all three");
ok(t.PILOTS.find((p) => p.name === "West Sussex").constituencies.length === 9 && t.PILOTS.find((p) => p.name === "Kirklees").constituencies.length === 5 && t.PILOTS.find((p) => p.name === "Lincolnshire").constituencies.length === 8, "each pilot lists its constituencies");

// ---- what the Claude API will accept
const strict = t.strictTool({ name: "x", input_schema: { type: "object", properties: { a: { type: "array", items: { type: "object", properties: { b: { type: "string", enum: ["p", "q"] } }, required: ["b"] } } }, required: ["a"] } });
ok(strict.strict === true && strict.input_schema.additionalProperties === false && strict.input_schema.properties.a.items.additionalProperties === false, "a strict tool closes every object in its schema");
ok(strict.input_schema.properties.a.items.properties.b.enum.join() === "p,q", "and leaves the rest alone");
ok(/not supported/.test(refused({ tool_choice: { type: "tool", name: "x" } })) && /additionalProperties/.test(refused({ tools: [{ name: "x", strict: true, input_schema: { type: "object", properties: {} } }] })), "the simulator refuses what the real service refuses");

// ---- collisions stay as totals
const cfg = t.getConfig();
const refusedSql = async (sql) => { try { await t.refQuery(cfg, sql); return ""; } catch (e) { return e.message; } };
ok(await refusedSql("SELECT collision_year, COUNT(*) AS n FROM collisions GROUP BY collision_year") === "", "totals by year are allowed");
ok(await refusedSql("SELECT c.la_code, SUM(k.casualty_severity = 1) AS deaths FROM collisions c JOIN collision_casualties k ON c.collision_index = k.collision_index GROUP BY c.la_code") === "", "so are totals joined across the collision tables");
ok(/individual collisions/.test(await refusedSql("SELECT substr(date_iso, 1, 10) AS d, COUNT(*) AS n FROM collisions GROUP BY d")), "a date under another name is refused");
ok(/individual collisions/.test(await refusedSql("WITH x AS (SELECT latitude AS a, longitude AS b FROM collisions) SELECT a, b, COUNT(*) AS n FROM x GROUP BY a, b")), "and so are places inside a sub-query");
ok(/totals/.test(await refusedSql("SELECT *, COUNT(*) AS n FROM collisions GROUP BY la_code")), "every column can't be asked for");
ok(/totals/.test(await refusedSql("SELECT collision_year FROM collisions")), "and it has to be a count or a sum");
ok(await refusedSql("SELECT collision_year, COUNT(*) AS n FROM collisions WHERE la_code = 'date_iso' GROUP BY collision_year") === "", "words inside quotes don't count as columns");
ok(await refusedSql("SELECT la_name, kind FROM authorities") === "", "other tables aren't affected");

// ---- small helpers
let order = [];
await Promise.all([t.withLock("k", async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); }), t.withLock("k", async () => { order.push(2); })]);
ok(order.join() === "1,2", "the lock runs one writer at a time");
await t.withLock("k", async () => { throw new Error("x"); }).catch(() => {});
ok(await t.withLock("k", async () => "still works") === "still works", "a failure doesn't jam the lock");
ok(t.median([3, 1, 2]) === 2 && t.median([1, 2]) === 1.5 && t.median([]) === null && t.median([1, NaN]) === 1, "medians");
ok(t.addMonths("2026-11-02", 3) === "2027-02-02", "adds months");

console.log(failures ? `\n${failures} FAILED` : "\nAll passed");
process.exit(failures ? 1 : 0);
