// The recovery pass over `data/docs` (SERVER-038), including the false-positive
// bar sprint-018's TEST-605 enumerates by name.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeGitEnv } from "../git/env.js";
import { disableAutoMaintenance } from "../git/maintenance.js";
import {
  DOCTOR_WARNING_KINDS,
  UNINDEXABLE_WARNING_LIMIT,
  collectUnindexableFiles,
  type ReadCreatingCommit,
} from "./unindexable.js";

let root: string;
let ws: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "corpus-s018-unindexable-"));
  ws = join(root, "ws");
  mkdirSync(join(ws, "data", "docs"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

function write(relative: string, content: string): string {
  const abs = join(ws, relative);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

const doc = (id: string, title = id): string =>
  `---\nid: ${id}\ntype: note\ntitle: ${title}\ncreated: 2026-07-30T09:00:00Z\nupdated: 2026-07-30T09:00:00Z\n---\n\nBody.\n`;

/** A commit reader that spends no process and records what it was asked. */
function stubCommits(): { read: ReadCreatingCommit; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    read: (_workspaceRoot, relativePath) => {
      asked.push(relativePath);
      return { sha: "abc1234", subject: `added ${relativePath}` };
    },
  };
}

const pathsOf = (warnings: readonly { path?: string | undefined }[]): (string | undefined)[] =>
  warnings.map((warning) => warning.path);

describe("collectUnindexableFiles", () => {
  it("names every shape SERVER-037 proved reachable, sorted by path", () => {
    write("data/docs/.claude/skills/invisible-doc.md", doc("doc_invisible001"));
    write("data/docs/node_modules/ignored-dir-doc.md", doc("doc_invisible002"));
    write("data/docs/notes/.hidden/x/nested-hidden.md", doc("doc_invisible003"));
    const commits = stubCommits();

    const warnings = collectUnindexableFiles(ws, { readCreatingCommit: commits.read });

    expect(pathsOf(warnings)).toEqual([
      "data/docs/.claude/skills/invisible-doc.md",
      "data/docs/node_modules/ignored-dir-doc.md",
      "data/docs/notes/.hidden/x/nested-hidden.md",
    ]);
    expect(warnings.every((warning) => warning.kind === "unindexable_file")).toBe(true);
    expect(warnings[0]?.commit).toBe("abc1234");
    expect(warnings[0]?.detail).toContain("data/docs/.claude/skills/invisible-doc.md");
    expect(warnings[0]?.detail).toContain('Added in abc1234 "added data/docs');
    expect(commits.asked).toHaveLength(3);
  });

  it("stays silent on the whole near-miss list, and spends no git process doing it", () => {
    // Dotted, but not dot-leading — the folders a hand-written skip rule would
    // catch and `classifyPath` correctly does not.
    write("data/docs/my.notes/a.md", doc("doc_near001"));
    write("data/docs/v1.2/b.md", doc("doc_near002"));
    write("data/docs/notes/2026.07/c.md", doc("doc_near003"));
    write("data/docs/a.b/c.d/d.md", doc("doc_near004"));
    write("data/docs/finance/2026/e.md", doc("doc_near005"));
    write("data/docs/archive.2026/f.md", doc("doc_near006"));
    // A *file* named like the ignored directory.
    write("data/docs/node_modules.md", doc("doc_near007"));
    // The seeded folders, and the one README that is a document.
    write("data/docs/inbox/g.md", doc("doc_near008"));
    write("data/docs/templates/note.md", doc("doc_near009"));
    write("data/docs/views/inbox.md", doc("doc_near010"));
    write("data/docs/README.md", doc("doc_near011"));
    // Deep nesting.
    write("data/docs/a/b/c/d/e.md", doc("doc_near012"));
    // Legitimate non-documents.
    write("data/docs/notes.txt", "not markdown\n");
    write("data/docs/assets/diagram.png", "not markdown\n");
    write("data/docs/assets/.gitkeep", "");
    write("data/docs/inbox/.gitkeep", "");
    // The runtime tree, which is not under `data/docs` at all.
    write(".corpus/attachments/th_x/2026/a.md", doc("doc_runtime01"));
    write(".corpus/queue/pending/evt_a.json", "{}");
    // A lease left behind by a workspace that predates SPEC.md §7's key: not
    // watched, not projected, not indexable (SERVER-099).
    write(".corpus/locks/doc_x.json", "{}");
    write(".corpus/jobs/job_x.json", "{}");
    write(".corpus/cache.db", "binary");
    write(".claude/skills/orchestrate/SKILL.md", "---\nname: orchestrate\n---\n\nS.\n");
    write(".claude/agents/reviewer.md", "---\nname: reviewer\n---\n\nA.\n");
    const commits = stubCommits();

    expect(collectUnindexableFiles(ws, { readCreatingCommit: commits.read })).toEqual([]);
    expect(commits.asked).toEqual([]);
  });

  it("reports a dot-leading filename only when it carries a Corpus id", () => {
    write("data/docs/.hidden.md", doc("doc_dotleading1"));
    write("data/docs/.scratch.md", "---\ntitle: just a note to self\n---\n\nNo id.\n");
    write("data/docs/.drafts/wip.md", "Not even frontmatter.\n");
    const commits = stubCommits();

    const warnings = collectUnindexableFiles(ws, { readCreatingCommit: commits.read });

    expect(pathsOf(warnings)).toEqual(["data/docs/.hidden.md"]);
  });

  it("ignores a markdown file with no Corpus frontmatter under a skipped segment", () => {
    write("data/docs/node_modules/left-pad/README.md", "# left-pad\n\nnot a document\n");
    write("data/docs/node_modules/left-pad/package.json", "{}");
    write("data/docs/.claude/skills/helper/SKILL.md", "---\nname: helper\n---\n\nS.\n");

    expect(collectUnindexableFiles(ws, { readCreatingCommit: stubCommits().read })).toEqual([]);
  });

  it("ignores an unreadable candidate rather than failing the check", () => {
    const abs = write("data/docs/.claude/unreadable.md", doc("doc_vanishes01"));
    chmodSync(abs, 0o000);

    expect(collectUnindexableFiles(ws, { readCreatingCommit: stubCommits().read })).toEqual([]);
  });

  it("does not descend into a symlinked directory", () => {
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "doc.md"), doc("doc_outside001"), "utf8");
    mkdirSync(join(ws, "data", "docs", ".vault"), { recursive: true });
    symlinkSync(outside, join(ws, "data", "docs", ".vault", "linked"));

    expect(collectUnindexableFiles(ws, { readCreatingCommit: stubCommits().read })).toEqual([]);
  });

  it("answers an absent data/docs with no findings", () => {
    rmSync(join(ws, "data", "docs"), { recursive: true });

    expect(collectUnindexableFiles(ws)).toEqual([]);
  });

  it("truncates past the limit and says so, rather than listing without end", () => {
    for (const name of ["a", "b", "c", "d"]) {
      write(`data/docs/.archive/${name}.md`, doc(`doc_many${name}0001`));
    }
    const commits = stubCommits();

    const warnings = collectUnindexableFiles(ws, { limit: 2, readCreatingCommit: commits.read });

    expect(pathsOf(warnings)).toEqual([
      "data/docs/.archive/a.md",
      "data/docs/.archive/b.md",
      undefined,
    ]);
    expect(warnings[2]?.kind).toBe("unindexable_files_truncated");
    expect(warnings[2]?.detail).toContain("more than 2 files");
    expect(warnings[2]?.commit).toBeUndefined();
    // The bound is on the expensive half too: one `git log` per listed finding.
    expect(commits.asked).toHaveLength(2);
  });

  it("declares its kinds, and the shipped limit", () => {
    expect([...DOCTOR_WARNING_KINDS]).toEqual([
      "unindexable_file",
      "unindexable_files_truncated",
      "unlistable_directory",
    ]);
    expect(UNINDEXABLE_WARNING_LIMIT).toBe(50);
  });

  it("follows the skip rule wherever it moves, without an edit of its own", async () => {
    // The rule lives in `classifyPath`; this stands in for the ignored-directory
    // declaration gaining an entry. A pass carrying its own copy of the rule
    // would consider this path indexable and report nothing.
    vi.resetModules();
    vi.doMock("./roots.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./roots.js")>();
      return {
        ...actual,
        classifyPath: (path: string) =>
          path.split("/").includes("hypothetical_vendor") ? null : actual.classifyPath(path),
      };
    });
    const { collectUnindexableFiles: collect } = await import("./unindexable.js");
    write("data/docs/hypothetical_vendor/doc.md", doc("doc_hypothetic1"));
    write("data/docs/ordinary/doc.md", doc("doc_ordinary001"));

    const warnings = collect(ws, { readCreatingCommit: stubCommits().read });

    expect(pathsOf(warnings)).toEqual(["data/docs/hypothetical_vendor/doc.md"]);
    vi.doUnmock("./roots.js");
  });
});

describe("readCreatingCommit", () => {
  const run = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: ws,
      env: sanitizeGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("names the commit that added the file, subject included", () => {
    run("init", "--initial-branch=main");
    disableAutoMaintenance(run);
    run("config", "user.name", "Owner");
    run("config", "user.email", "owner@example.test");
    write("data/docs/.claude/skills/invisible-doc.md", doc("doc_invisible001"));
    run("add", "-A", "--", "data/docs");
    run("commit", "-m", "seed an invisible document");
    // A later commit that touches the file must not become "the commit that
    // created it".
    write("data/docs/.claude/skills/invisible-doc.md", doc("doc_invisible001", "edited"));
    run("add", "-A", "--", "data/docs");
    run("commit", "-m", "edit it");

    const [warning, ...rest] = collectUnindexableFiles(ws);

    expect(rest).toEqual([]);
    expect(warning?.commit).toBe(run("rev-parse", "--short", "HEAD~1").trim());
    expect(warning?.detail).toContain('"seed an invisible document"');
  });

  it("survives a commit with no subject at all", () => {
    run("init", "--initial-branch=main");
    disableAutoMaintenance(run);
    run("config", "user.name", "Owner");
    run("config", "user.email", "owner@example.test");
    write("data/docs/.claude/subjectless.md", doc("doc_subjectless"));
    run("add", "-A", "--", "data/docs");
    run("commit", "--allow-empty-message", "-m", "");

    const [warning] = collectUnindexableFiles(ws);

    expect(warning?.commit).toBe(run("rev-parse", "--short", "HEAD").trim());
    expect(warning?.detail).toContain("Added in ");
  });

  it("reports an uncommitted file without a commit rather than not at all", () => {
    write("data/docs/.claude/uncommitted.md", doc("doc_uncommitted"));

    const [warning] = collectUnindexableFiles(ws);

    expect(warning?.path).toBe("data/docs/.claude/uncommitted.md");
    expect(warning?.commit).toBeUndefined();
    expect(warning?.detail).toContain("no creating commit");
  });
});

/**
 * SERVER-065's third reader. `walkUnindexed` swallowed every `readdir` failure,
 * with the same comment the document walk carried — right for `ENOENT` and for a
 * directory that vanished mid-walk, wrong for `EACCES`. It is the worst of the
 * three to get wrong: this pass exists to report files nobody can see, so
 * answering silence for a directory nobody can read is the pass failing at its
 * own job.
 */
describe("a directory the recovery walk cannot list (SERVER-065)", () => {
  it("is reported as its own warning kind, naming the path and the reason", () => {
    rmSync(join(ws, "data", "docs"), { recursive: true, force: true });
    writeFileSync(join(ws, "data", "docs"), "not a directory", "utf8");

    const warnings = collectUnindexableFiles(ws, { readCreatingCommit: stubCommits().read });

    expect(warnings.map((warning) => warning.kind)).toEqual(["unlistable_directory"]);
    expect(warnings[0]?.path).toBe("data/docs");
    expect(warnings[0]?.detail).toContain("ENOTDIR");
  });

  it("is a skip rather than a throw, so the caller still gets a report", () => {
    rmSync(join(ws, "data", "docs"), { recursive: true, force: true });
    writeFileSync(join(ws, "data", "docs"), "not a directory", "utf8");

    // Only `data/docs` itself can produce this in a privilege-free test: the
    // walk descends only into `entry.isDirectory()`, which is false for both a
    // regular file and a symlink, so a *nested* unlistable directory needs a
    // mode — and a mode proves nothing under root (SERVER-063's measurement).
    // What is portable, and what matters, is that the pass returns a report at
    // all rather than propagating the failure into `corpus db doctor`.
    expect(() =>
      collectUnindexableFiles(ws, { readCreatingCommit: stubCommits().read }),
    ).not.toThrow();
  });

  it("says nothing about a `data/docs` that is simply not there", () => {
    rmSync(join(ws, "data", "docs"), { recursive: true, force: true });
    expect(collectUnindexableFiles(ws, { readCreatingCommit: stubCommits().read })).toEqual([]);
  });
});
