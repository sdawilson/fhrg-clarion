// Talking to Claude. Each job runs a loop of calls until Claude hands in its work through a "finish" tool,
// whose input is checked against a schema: that gives Clarion structured results it can validate.
//
// Spending: every call's tokens are priced and added to the month's total, and new work is refused once
// that reaches MONTHLY_CAP_USD. A job already running can finish a little over the cap.

import type { Config } from "./config";
import { storageJson, savePretty } from "./storage";
import { FriendlyError, delay, withLock } from "./util";

// dollars per million tokens: input, output, cache read
const PRICES: Record<string, [number, number, number]> = {
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-opus-5-5": [4, 20, 0.4],
};
const SEARCH_USD = 0.01;

export type Usage = { input: number; output: number; cached: number; searches: number; fetches: number; usd: number };
export const newUsage = (): Usage => ({ input: 0, output: 0, cached: 0, searches: 0, fetches: 0, usd: 0 });

function addUsage(u: Usage, model: string, r: any): void {
  const [inp, out, cache] = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  const i = r?.input_tokens ?? 0, o = r?.output_tokens ?? 0, h = r?.cache_read_input_tokens ?? 0;
  const s = r?.server_tool_use?.web_search_requests ?? 0, f = r?.server_tool_use?.web_fetch_requests ?? 0;
  u.input += i; u.output += o; u.cached += h; u.searches += s; u.fetches += f;
  u.usd += (i * inp + o * out + h * cache) / 1e6 + s * SEARCH_USD;
}

const monthPath = (c: Config) => `${c.root}usage/${new Date().toISOString().slice(0, 7)}.json`;

export async function monthSpend(c: Config): Promise<number> {
  const m = await storageJson<{ usd?: number }>(c, monthPath(c), {});
  return Number(m.usd) || 0;
}

export async function checkCap(c: Config): Promise<void> {
  if ((await monthSpend(c)) >= c.monthlyCapUsd) throw new FriendlyError(`Clarion has reached this month's spending limit ($${c.monthlyCapUsd}). Ask the FHRG team to raise MONTHLY_CAP_USD, or try again next month.`, 429);
}

export async function recordSpend(c: Config, u: Usage): Promise<void> {
  await withLock("usage", async () => {
    const m = await storageJson<{ usd?: number; jobs?: number }>(c, monthPath(c), {});
    await savePretty(c, monthPath(c), { usd: (Number(m.usd) || 0) + u.usd, jobs: (Number(m.jobs) || 0) + 1 });
  });
}

async function callClaude(c: Config, body: Record<string, unknown>, usage: Usage, timeoutMs = 180_000): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (attempt < 3) { await delay(2000); continue; }
      throw new FriendlyError(`Claude didn't respond: ${(e as Error).message}`, 502);
    }
    const data: any = await res.json().catch(() => null);
    if (res.ok) { addUsage(usage, c.model, data?.usage); return data; }
    const detail = data?.error?.message ?? res.statusText;
    console.log(`[error] Claude API ${res.status}: ${detail}`);
    if ([429, 500, 529].includes(res.status) && attempt < 3) { await delay(2500 * attempt); continue; }
    if (res.status === 401) throw new FriendlyError("Clarion's Claude API key isn't working. Check ANTHROPIC_API_KEY.", 502);
    if (res.status === 400 && /web.?(search|fetch)/i.test(String(detail))) throw new FriendlyError("Web search or fetch isn't available on this Claude account. Turn them on in the Claude Console's organisation settings.", 502);
    if (res.status === 404 || (res.status === 400 && /model/i.test(String(detail)))) throw new FriendlyError(`Claude doesn't recognise the model "${String(body.model)}". Check CLAUDE_MODEL.`, 502);
    if (res.status === 429 || res.status === 529) throw new FriendlyError("Claude is busy. Please try again in a few minutes.", 503);
    throw new FriendlyError("Claude couldn't do that just now. Please try again.", 502);
  }
  throw new FriendlyError("Claude couldn't do that just now. Please try again.", 502);
}

export type WebSource = { url: string; title: string };
export type ToolHandler = (input: Record<string, any>) => Promise<unknown>;

type RunOptions = {
  system: string;
  prompt: string;
  tools: any[]; // the finish tool, any tools Clarion answers, and any of Anthropic's server tools
  finish: string; // the tool that hands in the result
  handlers?: Record<string, ToolHandler>;
  maxSteps: number;
  usage: Usage;
  maxTokens?: number;
};

// The pages Claude actually searched or read. Web content never reaches this code as instructions: only
// these addresses and titles are kept, for the sources list.
function collectSources(content: any[], seen: Map<string, string>): void {
  for (const b of content) {
    if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r?.type === "web_search_result" && typeof r.url === "string") seen.set(r.url, String(r.title || r.url).slice(0, 300));
    }
    if (b?.type === "web_fetch_tool_result" && b.content?.type === "web_fetch_result" && typeof b.content.url === "string") {
      seen.set(b.content.url, String(b.content.content?.title || b.content.url).slice(0, 300));
    }
  }
}

export async function runClaude(c: Config, o: RunOptions): Promise<{ result: Record<string, any>; web: WebSource[] }> {
  const messages: any[] = [{ role: "user", content: o.prompt }];
  const seen = new Map<string, string>();
  const handlers = o.handlers ?? {};
  let force = false;
  for (let step = 1; step <= o.maxSteps; step++) {
    const body: Record<string, unknown> = { model: c.model, max_tokens: o.maxTokens ?? 6000, system: o.system, messages, tools: o.tools };
    if (["low", "medium", "high", "xhigh", "max"].includes(c.effort)) body.output_config = { effort: c.effort };
    if (force || step === o.maxSteps) body.tool_choice = { type: "tool", name: o.finish };
    const resp = await callClaude(c, body, o.usage);
    const content: any[] = Array.isArray(resp?.content) ? resp.content : [];
    collectSources(content, seen);
    if (resp?.stop_reason === "refusal") throw new FriendlyError("Claude declined to do this. Try rewording it, or pasting different text.", 422);
    const done = content.find((b) => b?.type === "tool_use" && b.name === o.finish);
    if (done) return { result: done.input ?? {}, web: [...seen].map(([url, title]) => ({ url, title })) };
    messages.push({ role: "assistant", content });
    if (resp?.stop_reason === "pause_turn") continue; // a long run of searches: carry on from where it stopped
    if (resp?.stop_reason === "tool_use") {
      const results: any[] = [];
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        try {
          const fn = handlers[b.name];
          if (!fn) throw new Error(`Unknown tool ${b.name}.`);
          results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify((await fn(b.input ?? {})) ?? { ok: true }) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: (e as Error).message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    // finished talking without handing in the work
    messages.push({ role: "user", content: `Now hand in your result with the ${o.finish} tool.` });
    force = true;
  }
  throw new FriendlyError("Claude didn't finish this job. Please try again.", 502);
}
