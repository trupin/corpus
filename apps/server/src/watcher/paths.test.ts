import { describe, expect, it } from "vitest";
import { WATCH_ROOTS, classifyWatchPath, isIgnoredEntry } from "./paths.js";

describe("WATCH_ROOTS", () => {
  it("covers every §9.1 root and nothing that is served rather than projected", () => {
    expect([...WATCH_ROOTS]).toEqual([
      "data",
      ".claude/skills",
      ".claude/skills-archived",
      ".claude/agents",
      ".corpus/queue",
      ".corpus/locks",
      ".corpus/jobs",
    ]);
  });
});

describe("isIgnoredEntry", () => {
  it.each([
    [".gitkeep", true],
    [".DS_Store", true],
    [".mortgage.md.swp", true],
    [".tmp-9f3c.md", true],
    [".#mortgage.md", true],
    ["#mortgage.md#", true],
    ["mortgage.md~", true],
    ["mortgage.md.swp", true],
    ["node_modules", true],
    ["mortgage.md", false],
    ["SKILL.md", false],
    ["evt_a1b2c3.json", false],
    ["notes.txt", false],
    ["", false],
  ])("%s -> %s", (name, ignored) => {
    expect(isIgnoredEntry(name)).toBe(ignored);
  });
});

describe("classifyWatchPath", () => {
  it.each([
    ["data/docs/finance/mortgage.md", "document"],
    ["data/docs/mortgage.md", "document"],
    ["data/threads/th_a1b2c3.md", "document"],
    [".claude/skills/orchestrate/SKILL.md", "document"],
    [".claude/skills-archived/old/SKILL.md", "document"],
    [".claude/agents/librarian.md", "document"],
  ])("%s is a document", (path, kind) => {
    expect(classifyWatchPath(path)?.kind).toBe(kind);
  });

  it("reads an event's status from the directory holding it", () => {
    expect(classifyWatchPath(".corpus/queue/in-progress/evt_a1b2c3.json")).toEqual({
      kind: "queue-event",
      status: "in-progress",
      id: "evt_a1b2c3",
    });
  });

  it("reads a lock's document from its filename", () => {
    expect(classifyWatchPath(".corpus/locks/doc_a1b2c3.json")).toEqual({
      kind: "lock",
      docId: "doc_a1b2c3",
    });
    expect(classifyWatchPath(".corpus/locks/th_a1b2c3.json")).toEqual({
      kind: "lock",
      docId: "th_a1b2c3",
    });
  });

  it("reads a job's event from its filename", () => {
    expect(classifyWatchPath(".corpus/jobs/evt_a1b2c3.jsonl")).toEqual({
      kind: "job",
      eventId: "evt_a1b2c3",
    });
  });

  it.each([
    // Not corpus state at all.
    "data/docs/notes.txt",
    "data/attachments/th_a/1.png",
    ".corpus/cache.db",
    ".corpus/cache.db-wal",
    ".corpus/config.json",
    ".corpus/seen.json",
    // A thread is flat; a `.md` next to a `SKILL.md` is not a skill.
    "data/threads/nested/th_a1b2c3.md",
    ".claude/skills/orchestrate/reference.md",
    // The `.gitkeep` every status directory ships with, and the temp file every
    // atomic write leaves behind.
    ".corpus/queue/pending/.gitkeep",
    ".corpus/queue/pending/.tmp-evt_a1b2c3-9f3c.json",
    // Shapes that only look like runtime state.
    ".corpus/queue/nowhere/evt_a1b2c3.json",
    ".corpus/queue/pending/nested/evt_a1b2c3.json",
    ".corpus/queue/pending/notes.json",
    ".corpus/locks/notalock.json",
    ".corpus/jobs/evt_a1b2c3.json",
    "",
  ])("%s is not watched state", (path) => {
    expect(classifyWatchPath(path)).toBeNull();
  });
});
