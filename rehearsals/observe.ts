/**
 * The workspace reader (INFRA-033). It makes no assertion; it produces a
 * record of what the product wrote — git history and authors, queue state on
 * disk, job logs, thread frontmatter with each turn's recorded model, document
 * bytes. Scoring happens elsewhere, over this record alone (rule 2).
 *
 * Everything here reads the disk. The one product-mediated read — `corpus doc
 * check` — is run by the driver while the server is still up and merged into
 * the {@link Observation}, because this module must stay importable by the
 * fixture without a cycle.
 */

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { QUEUE_EVENT_STATUSES, turnHeadings, type QueueEventStatus } from "@corpus/contract";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);

export interface ObservedCommit {
  readonly hash: string;
  /** The commit's tree hash — half of how the scorer recognises the seed window's relabel. */
  readonly tree: string;
  /**
   * The commit's first parent, the other half. Tree alone admits an empty
   * `user` commit and a hand revert to the seed tree; tree **and** parent
   * together are what an amend of the boundary is, and nothing else.
   */
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  /** Recorded for the human reading a run record. Never asserted (rule 4). */
  readonly subject: string;
}

export interface ObservedEvent {
  readonly id: string;
  readonly status: QueueEventStatus;
  readonly file: string;
  readonly parsed: Record<string, unknown> | null;
  readonly parseError: string | null;
}

export interface QueueState {
  readonly byStatus: Readonly<Record<QueueEventStatus, readonly ObservedEvent[]>>;
  /** Files in a status directory that are not readable events. */
  readonly malformed: readonly string[];
}

export interface ObservedTurn {
  readonly author: string;
  readonly ts: string;
  /** Joined from the thread's `turnModels` frontmatter (SPEC.md §10). */
  readonly model: string | null;
}

export interface ObservedFile {
  readonly path: string;
  readonly raw: string;
  readonly frontmatter: Record<string, unknown> | null;
  readonly parseError: string | null;
}

export interface ObservedThread extends ObservedFile {
  readonly turns: readonly ObservedTurn[];
}

export interface DocCheckResult {
  readonly code: number;
  readonly stdout: string;
}

export interface Observation {
  /** `corpus doc check --json`: the product's own parse/validity verdict. */
  readonly docCheck: DocCheckResult;
  /**
   * Every entry of the run's base directory — the temp directory holding
   * `workspace/`, `bin/` and the marker, merged in by the driver, which is the
   * only module that knows the base. A fresh run leaves exactly those three; a
   * fourth entry is a file something wrote *outside* the workspace, which is
   * what INFRA-034's story 7 (CLI-051) exists to catch: an injected command
   * runs with the workspace as its working directory, so `../` is the nearest
   * out-of-workspace ground it can touch.
   */
  readonly baseDirEntries: readonly string[];
  readonly commitsSinceSeed: readonly ObservedCommit[];
  /** `git status --porcelain` lines. Non-empty means bytes nobody committed. */
  readonly gitStatus: readonly string[];
  readonly queue: QueueState;
  /** `.corpus/jobs/<eventId>.jsonl`, raw lines per event. */
  readonly jobLogs: Readonly<Record<string, readonly string[]>>;
  readonly threads: readonly ObservedThread[];
  readonly docs: readonly ObservedFile[];
}

const EVENT_FILE = /^(evt_[A-Za-z0-9]+)\.json$/;
const IGNORED_DIR_ENTRIES = new Set([".gitkeep"]);

async function listDir(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/** `.corpus/queue/<status>/evt_*.json`, read as the store writes it. */
export async function readQueueState(workspaceRoot: string): Promise<QueueState> {
  const byStatus: Partial<Record<QueueEventStatus, ObservedEvent[]>> = {};
  const malformed: string[] = [];
  for (const status of QUEUE_EVENT_STATUSES) {
    const dir = join(workspaceRoot, ".corpus", "queue", status);
    const events: ObservedEvent[] = [];
    for (const entry of await listDir(dir)) {
      if (IGNORED_DIR_ENTRIES.has(entry) || entry.startsWith(".tmp-")) continue;
      const match = EVENT_FILE.exec(entry);
      const file = join(dir, entry);
      if (match?.[1] === undefined) {
        malformed.push(file);
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
        events.push({
          id: match[1],
          status,
          file,
          parsed:
            typeof parsed === "object" && parsed !== null
              ? (parsed as Record<string, unknown>)
              : null,
          parseError: typeof parsed === "object" && parsed !== null ? null : "not a JSON object",
        });
      } catch (error) {
        events.push({
          id: match[1],
          status,
          file,
          parsed: null,
          parseError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    byStatus[status] = events;
  }
  return { byStatus: byStatus as QueueState["byStatus"], malformed };
}

/** Frontmatter block + body, split the way the server serializes documents. */
export function splitFrontmatter(raw: string): {
  readonly frontmatter: Record<string, unknown> | null;
  readonly body: string;
  readonly parseError: string | null;
} {
  if (!raw.startsWith("---\n")) {
    return { frontmatter: null, body: raw, parseError: "no frontmatter block" };
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: null, body: raw, parseError: "unterminated frontmatter block" };
  }
  const yamlText = raw.slice(4, end + 1);
  const body = raw.slice(end + 5);
  try {
    const parsed: unknown = parseYaml(yamlText);
    if (typeof parsed !== "object" || parsed === null) {
      return { frontmatter: null, body, parseError: "frontmatter is not a map" };
    }
    return { frontmatter: parsed as Record<string, unknown>, body, parseError: null };
  } catch (error) {
    return {
      frontmatter: null,
      body,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function turnModelsOf(frontmatter: Record<string, unknown> | null): Record<string, string> {
  const raw = frontmatter?.turnModels;
  if (typeof raw !== "object" || raw === null) return {};
  const models: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") models[key] = value;
  }
  return models;
}

async function readThread(path: string): Promise<ObservedThread> {
  const raw = await readFile(path, "utf8");
  const { frontmatter, body, parseError } = splitFrontmatter(raw);
  const models = turnModelsOf(frontmatter);
  const turns = turnHeadings(body).map((heading) => ({
    author: heading.author,
    ts: heading.ts,
    model: models[heading.ts] ?? null,
  }));
  return { path, raw, frontmatter, parseError, turns };
}

async function readDoc(path: string): Promise<ObservedFile> {
  const raw = await readFile(path, "utf8");
  const { frontmatter, parseError } = splitFrontmatter(raw);
  return { path, raw, frontmatter, parseError };
}

async function markdownFilesUnder(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".md")) found.push(path);
    }
  };
  await walk(root);
  return found.sort();
}

async function readJobLogs(
  workspaceRoot: string,
): Promise<Readonly<Record<string, readonly string[]>>> {
  const dir = join(workspaceRoot, ".corpus", "jobs");
  const logs: Record<string, readonly string[]> = {};
  for (const entry of await listDir(dir)) {
    if (!entry.endsWith(".jsonl")) continue;
    const raw = await readFile(join(dir, entry), "utf8").catch(() => "");
    logs[entry.slice(0, -".jsonl".length)] = raw.split("\n").filter((line) => line !== "");
  }
  return logs;
}

async function gitCommitsSince(
  workspaceRoot: string,
  seedHead: string,
): Promise<readonly ObservedCommit[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--format=%H%x1f%T%x1f%P%x1f%an%x1f%ae%x1f%s", `${seedHead}..HEAD`],
    { cwd: workspaceRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [
        hash = "",
        tree = "",
        parentList = "",
        authorName = "",
        authorEmail = "",
        subject = "",
      ] = line.split("\u001f");
      const parents = parentList.split(" ").filter((parent) => parent !== "");
      return { hash, tree, parents, authorName, authorEmail, subject };
    });
}

async function gitStatusLines(workspaceRoot: string): Promise<readonly string[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd: workspaceRoot,
  });
  return stdout.split("\n").filter((line) => line !== "");
}

/**
 * Everything the disk records, measured from the seed boundary. The driver
 * merges in the `doc check` result it ran while the server was still up.
 */
export async function observeDisk(
  workspaceRoot: string,
  seedHead: string,
): Promise<Omit<Observation, "docCheck" | "baseDirEntries">> {
  const threadFiles = await markdownFilesUnder(join(workspaceRoot, "data", "threads"));
  const docFiles = await markdownFilesUnder(join(workspaceRoot, "data", "docs"));
  return {
    commitsSinceSeed: await gitCommitsSince(workspaceRoot, seedHead),
    gitStatus: await gitStatusLines(workspaceRoot),
    queue: await readQueueState(workspaceRoot),
    jobLogs: await readJobLogs(workspaceRoot),
    threads: await Promise.all(threadFiles.map(readThread)),
    docs: await Promise.all(docFiles.map(readDoc)),
  };
}
