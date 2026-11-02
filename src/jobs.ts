// Readings and notes take minutes, longer than a web request should wait, so they run as background jobs.
// Each is a JSON file that the job updates as it goes, and the page checks it until it's finished. A
// container restart can leave a job unfinished: anything silent for 15 minutes counts as stopped.

import type { Config } from "./config";
import { storageJson, storageList, savePretty } from "./storage";
import { FriendlyError } from "./util";

const STALE_MS = 15 * 60 * 1000;
const MAX_RUNNING = 3;

export type JobBase = { id: string; code: string; status: "working" | "ready" | "failed"; stage: string; created: string; updated: string; by: string; error?: string };

let running = 0;

export function newJobId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 17);
  return `${stamp}-${crypto.randomUUID().slice(0, 8)}`;
}

// Saves the job before returning, so the page can always find it, then carries on in the background.
export async function startJob<T extends JobBase>(c: Config, path: string, job: T, work: (save: (changes: Partial<T>) => Promise<void>) => Promise<void>): Promise<void> {
  if (running >= MAX_RUNNING) throw new FriendlyError("Clarion is busy with other work. Try again in a few minutes.", 429);
  running++;
  try { await savePretty(c, path, job); } catch (e) { running--; throw e; }
  const save = async (changes: Partial<T>) => {
    Object.assign(job, changes, { updated: new Date().toISOString() });
    await savePretty(c, path, job);
  };
  (async () => {
    try {
      await work(save);
    } catch (e) {
      console.log(`[error] job ${job.id}: ${(e as Error)?.stack ?? e}`);
      const message = e instanceof FriendlyError ? e.message : "Something went wrong. Please try again.";
      await save({ status: "failed", stage: "Stopped", error: message } as Partial<T>).catch(() => {});
    } finally {
      running--;
    }
  })();
}

export async function loadJob<T extends JobBase>(c: Config, path: string): Promise<T | null> {
  const job = await storageJson<T | null>(c, path, null);
  if (job?.status === "working" && Date.now() - Date.parse(job.updated) > STALE_MS) {
    return { ...job, status: "failed", stage: "Stopped", error: "This was interrupted before it finished. Please start it again." };
  }
  return job;
}

// The newest first
export async function listJobs<T extends JobBase>(c: Config, folder: string, max = 30): Promise<T[]> {
  const names = (await storageList(c, folder)).filter((n) => n.endsWith(".json")).sort().reverse().slice(0, max);
  const jobs = await Promise.all(names.map((n) => loadJob<T>(c, `${folder}${n}`)));
  return jobs.filter((j): j is NonNullable<typeof j> => !!j) as T[];
}

// Keeps one authority from using up the month's budget. Job ids start with the date, so names are enough.
export async function checkDailyLimit(c: Config, siteAdmin: boolean, code: string, name: string): Promise<void> {
  if (siteAdmin) return;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const [readings, notes] = await Promise.all(["readings", "notes"].map((f) => storageList(c, `${c.root}authorities/${code}/${f}/`)));
  const count = [...readings, ...notes].filter((n) => n.startsWith(today)).length;
  if (count >= c.dailyJobsMax) throw new FriendlyError(`${name} has reached today's limit of ${c.dailyJobsMax} readings and notes. Try again tomorrow, or ask the FHRG team if you need more.`, 429);
}

export const validId = (id: unknown): id is string => typeof id === "string" && /^\d{17}-[0-9a-f]{8}$/.test(id);
