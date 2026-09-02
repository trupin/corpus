import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { observeDisk, readQueueState, splitFrontmatter } from "./observe.js";

const execFileAsync = promisify(execFile);

const THREAD_FILE = `---
id: th_abc123
type: thread
title: A question
turnModels:
  2026-09-01T10:00:05Z: claude-sonnet-4-5
---

## user · 2026-09-01T10:00:00Z

The question.

## agent · 2026-09-01T10:00:05Z

The answer.
`;

async function syntheticWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "corpus-observe-test-"));
  for (const status of ["pending", "in-progress", "deferred", "processed", "failed", "abandoned"]) {
    await mkdir(join(root, ".corpus", "queue", status), { recursive: true });
    await writeFile(join(root, ".corpus", "queue", status, ".gitkeep"), "", "utf8");
  }
  await writeFile(
    join(root, ".corpus", "queue", "processed", "evt_ok1.json"),
    JSON.stringify({ id: "evt_ok1", type: "comment.created" }),
    "utf8",
  );
  await writeFile(join(root, ".corpus", "queue", "pending", "evt_bad.json"), "{ not json", "utf8");
  await writeFile(join(root, ".corpus", "queue", "pending", "stray.txt"), "?", "utf8");
  await mkdir(join(root, ".corpus", "jobs"), { recursive: true });
  await writeFile(
    join(root, ".corpus", "jobs", "evt_ok1.jsonl"),
    '{"line":1}\n{"line":2}\n',
    "utf8",
  );
  await mkdir(join(root, "data", "threads"), { recursive: true });
  await writeFile(join(root, "data", "threads", "th_abc123.md"), THREAD_FILE, "utf8");
  await mkdir(join(root, "data", "docs", "inbox"), { recursive: true });
  await writeFile(
    join(root, "data", "docs", "inbox", "note.md"),
    "---\nid: doc_x\ntype: note\n---\n\nBody.\n",
    "utf8",
  );
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "seed"],
    {
      cwd: root,
    },
  );
  return root;
}

describe("readQueueState", () => {
  it("reads events per status, records parse errors, and lists non-event files", async () => {
    const root = await syntheticWorkspace();
    const queue = await readQueueState(root);
    expect(queue.byStatus.processed.map((e) => e.id)).toEqual(["evt_ok1"]);
    expect(queue.byStatus.processed[0]?.parseError).toBeNull();
    expect(queue.byStatus.pending[0]?.id).toBe("evt_bad");
    expect(queue.byStatus.pending[0]?.parseError).not.toBeNull();
    expect(queue.malformed).toHaveLength(1);
    expect(queue.malformed[0]).toContain("stray.txt");
  });
});

describe("splitFrontmatter", () => {
  it("splits a serialized document into frontmatter and body", () => {
    const { frontmatter, body, parseError } = splitFrontmatter(THREAD_FILE);
    expect(parseError).toBeNull();
    expect(frontmatter?.id).toBe("th_abc123");
    expect(body).toContain("## user · 2026-09-01T10:00:00Z");
  });

  it("reports a file with no frontmatter instead of guessing", () => {
    expect(splitFrontmatter("just text").parseError).toBe("no frontmatter block");
  });
});

describe("observeDisk", () => {
  it("reads threads with turns joined to their recorded models, docs, jobs, git", async () => {
    const root = await syntheticWorkspace();
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
    const observation = await observeDisk(root, stdout.trim());

    expect(observation.threads).toHaveLength(1);
    const thread = observation.threads[0];
    expect(thread?.frontmatter?.id).toBe("th_abc123");
    expect(thread?.turns).toEqual([
      { author: "user", ts: "2026-09-01T10:00:00Z", model: null },
      { author: "agent", ts: "2026-09-01T10:00:05Z", model: "claude-sonnet-4-5" },
    ]);

    expect(observation.docs.map((doc) => doc.frontmatter?.id)).toEqual(["doc_x"]);
    expect(observation.jobLogs.evt_ok1).toEqual(['{"line":1}', '{"line":2}']);
    expect(observation.commitsSinceSeed).toEqual([]);
    // The synthetic tree never committed its files, and the observer must say so.
    expect(observation.gitStatus.length).toBeGreaterThan(0);
  });
});
