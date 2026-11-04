// The officers' briefing: one page before a meeting. Everything in it is put together by plain code from what Clarion
// already holds, and it carries Clarion's latest mood reading in the reading's own words, so it adds no new judgement
// and costs nothing to write. It stays in Clarion unless an officer takes it out as a Word file. Campaigns, actions and
// key messages follow the election setting. Money isn't in it, so it can be read by anyone who can read the map. This
// isn't a councillor briefing: nothing here goes to members.

import type { Campaign, Issue } from "./campaign";
import { type Block, wordFile } from "./docx";
import type { buildMap } from "./mood";
import type { Reading } from "./reading";

type MapPage = ReturnType<typeof buildMap>;
export type OfficerPart = { heading: string; paras: string[]; bullets: string[] };
export type OfficersBriefing = { title: string; parts: OfficerPart[]; written: string };

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export function officersBriefing(map: MapPage, issues: Issue[], campaigns: Campaign[], reading: Reading | null, signs: string[], today: string): OfficersBriefing {
  const month = map.months.find((x) => x.id === map.month)?.label ?? map.month, service = map.services.find((x) => x.id === map.service)?.label ?? "Highways", root = map.tree.mood;
  const where = [root.v === null ? "There isn't enough yet to give a mood for this month." : `Mood is ${root.word}, at ${root.txt}. ${map.direction.word}. ${map.direction.note}`];
  if (map.street) where.push(`Street survey: ${map.street.satisfied === null ? "–" : Math.round(map.street.satisfied)}% satisfied, from ${map.street.responses.toLocaleString("en-GB")} replies. Indicative: a street sample isn't random.`);
  if (reading) where.push(`Clarion's latest reading, written on ${day(reading.created)}: ${reading.headline} How sure: ${reading.confidenceReason}`);
  const held = map.election, ahead = map.planned.filter((x) => x.date >= today).sort((x, y) => x.date.localeCompare(y.date)), coming = ahead.slice(0, 6);
  const none = (list: unknown[], words: string) => (list.length ? [] : [words]);
  const onIssue = (i: Issue) => {
    const t = map.topics.find((x) => x.topic === i.topic), planned = map.planned.filter((x) => x.topics.includes(i.topic) && x.date >= today).length;
    const sign = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}`, mood = t && t.mood !== null ? `: mood ${sign(t.mood)} (${sign(t.raw ?? 0)} before weighting)` : "", asked = t?.enquiries ? `, ${t.enquiries.toLocaleString("en-GB")} ${t.enquiries === 1 ? "enquiry" : "enquiries"}` : "";
    return `${i.topic}${mood}${asked}, ${planned} planned${i.key && !campaigns.some((c) => c.topic === i.topic) ? `. Key message: ${i.key}` : ""}`;
  };
  const running = campaigns.filter((x) => x.ongoing || x.end >= today).sort((x, y) => x.start.localeCompare(y.start));
  const onCampaign = (x: Campaign) => `${x.name}, on ${x.topic.toLowerCase()}: ${x.ongoing ? "ongoing" : `${day(x.start)} to ${day(x.end)}`}${x.messages.length ? `. Key messages: ${x.messages.join(" ")}` : ""}`;
  return {
    title: `${service}: officers' briefing, ${month}`, written: today,
    parts: [
      { heading: "Where we are", paras: where, bullets: [] },
      { heading: "High-impact issues", paras: none(issues, "None confirmed yet."), bullets: issues.map(onIssue) },
      { heading: "Campaigns", paras: held ? ["Held back by the election setting."] : none(running, "None running."), bullets: running.map(onCampaign) },
      { heading: "Early signs to check", paras: none(signs, "None this month."), bullets: signs.map((t) => `${t}: a pointer to check, not a finding.`) },
      { heading: "Coming up", paras: held ? ["Held back by the election setting."] : ahead.length > 6 ? [`The next 6 of ${ahead.length}.`] : none(coming, "Nothing planned yet."), bullets: coming.map((x) => `${day(x.date)}: ${x.title} (${x.channel})`) },
      { heading: "Bear in mind for campaigns", paras: none(map.considerations, "Nothing to note this month."), bullets: map.considerations.map((x) => `${x.title}${x.sub ? `. ${x.sub}` : ""}`) },
      { heading: "What's missing", paras: reading?.gaps.length ? [] : ["A mood reading lists what's missing. Write one on the Dashboard."], bullets: [...(reading?.gaps ?? []), ...map.unread.map((x) => `${x}: couldn't be read just now`)] },
    ],
  };
}

export function officersWord(b: OfficersBriefing): { name: string; file: string } {
  const blocks: Block[] = [{ kind: "title", text: b.title }, { kind: "note", text: `For officers. Put together by Clarion on ${day(b.written)}.` }];
  for (const p of b.parts) blocks.push({ kind: "heading", text: p.heading }, ...p.paras.map((text) => ({ kind: "text" as const, text })), ...p.bullets.map((text) => ({ kind: "bullet" as const, text })));
  return { name: `${b.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.docx`, file: Buffer.from(wordFile(blocks)).toString("base64") };
}
