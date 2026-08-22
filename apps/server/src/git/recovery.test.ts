// Real repositories, real commits, real hooks — SPEC.md §4's boot half.
//
// Nothing here pretends recovery is catching a *lost window*: under the amend
// mechanism a window's content is in git at every instant, so there is no such
// thing to catch. Every fixture below reproduces one of the three real sources
// §4 leaves uncommitted — a commit git refused, an out-of-band edit, a file
// written while the server was stopped.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAutoCommitter } from "./commit.js";
import { sanitizeGitEnv } from "./env.js";
import { createGit, type Git } from "./git.js";
import { disableAutoMaintenance } from "./maintenance.js";
import { RECOVERY_ROOTS, recoverUncommittedChanges, recoverySubject } from "./recovery.js";
import type { LogFields } from "../logger.js";

type Logged = {
  readonly level: "info" | "error";
  readonly message: string;
  readonly fields: LogFields;
};

type Repo = {
  readonly root: string;
  readonly git: Git;
  /** Every git invocation recovery made, in order — so "made no call at all" is assertable. */
  readonly calls: string[][];
  readonly logs: Logged[];
  run(...args: string[]): string;
  touch(path: string, content: string): void;
  log(format: string): string[];
  status(...pathspec: string[]): string;
  close(): void;
};

let repo: Repo | undefined;

afterEach(() => {
  repo?.close();
  repo = undefined;
});

function makeRepo(name: string, options: { init?: boolean; identity?: boolean } = {}): Repo {
  const root = mkdtempSync(join(tmpdir(), `corpus-s094-${name}-`));
  const run = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      env: sanitizeGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  const touch = (path: string, content: string): void => {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  };

  if (options.init !== false) {
    run("init", "--initial-branch=main");
    disableAutoMaintenance(run);
    if (options.identity !== false) {
      run("config", "user.name", "Workspace Owner");
      run("config", "user.email", "owner@example.test");
    }
    // What `corpus init` leaves behind: a repository whose tree is clean.
    touch(".gitignore", ".corpus/\n");
    touch("data/docs/inbox/seed.md", "---\nid: doc_seed\n---\n\nseed\n");
    run("add", "-A", "--", ".gitignore", "data");
    run("-c", "user.name=user", "-c", "user.email=user@corpus.local", "commit", "-m", "init");
  }

  const calls: string[][] = [];
  const underlying = createGit(root);
  const recording: Git = {
    root,
    exec: (args, execOptions) => {
      calls.push([...args]);
      return underlying.exec(args, execOptions);
    },
  };

  const logs: Logged[] = [];
  const made: Repo = {
    root,
    git: recording,
    calls,
    logs,
    run,
    touch,
    log: (format) =>
      run("log", `--format=${format}`)
        .split("\n")
        .filter((line) => line !== ""),
    status: (...pathspec) => run("status", "--porcelain", "--", ...pathspec),
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  repo = made;
  return made;
}

const recover = (fixture: Repo): ReturnType<typeof recoverUncommittedChanges> =>
  recoverUncommittedChanges({
    git: fixture.git,
    withGitLock: (task) => task(),
    logger: {
      level: "info",
      info: (message, fields) => {
        fixture.logs.push({ level: "info", message, fields: fields ?? {} });
      },
      debug: () => undefined,
      error: (message, fields) => {
        fixture.logs.push({ level: "error", message, fields: fields ?? {} });
      },
    },
  });

/** Did any invocation actually try to write to the repository? */
const wroteAnything = (calls: readonly string[][]): boolean =>
  calls.some(([verb]) => verb === "commit" || verb === "add" || verb === "reset" || verb === "rm");

describe("boot recovery (SPEC.md §4)", () => {
  it("commits nothing and says nothing when there is nothing to recover", async () => {
    const fixture = makeRepo("clean");
    const before = fixture.log("%H").length;

    const outcome = await recover(fixture);

    expect(outcome).toEqual({ kind: "clean" });
    expect(fixture.log("%H")).toHaveLength(before);
    expect(fixture.logs).toEqual([]);
    // Every ordinary boot takes this path: one question, and nothing else.
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]?.[0]).toBe("status");
    expect(wroteAnything(fixture.calls)).toBe(false);
  });

  it("commits an out-of-band edit as a recovery commit naming the document count", async () => {
    const fixture = makeRepo("edited");
    fixture.touch("data/docs/inbox/seed.md", "---\nid: doc_seed\n---\n\nedited by hand\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    if (outcome.kind !== "recovered") return;
    expect(outcome.documents).toBe(1);
    expect(fixture.log("%s")[0]).toBe(recoverySubject(1));
    expect(fixture.log("%s")[0]).toContain("left uncommitted by a previous run");
    expect(fixture.status()).toBe("");
    expect(fixture.logs).toEqual([
      {
        level: "info",
        message: "recovered changes left uncommitted by a previous run",
        fields: { sha: outcome.sha, documents: 1, files: 1 },
      },
    ]);
  });

  it("commits a file written into the roots while the server was stopped", async () => {
    const fixture = makeRepo("dropped");
    fixture.touch("data/docs/inbox/by-hand.md", "# dropped in by the operator\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    expect(fixture.run("show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "data/docs/inbox/by-hand.md",
    );
  });

  it("claims no acting party: --author=user and --author=agent both fail to match it", async () => {
    const fixture = makeRepo("no-party");
    fixture.touch("data/docs/inbox/seed.md", "changed\n");

    await recover(fixture);

    const head = fixture.log("%H")[0];
    expect(fixture.log("%an <%ae>")[0]).toBe("recovery <recovery@corpus.local>");
    // The trailer §7 puts on every other commit is absent, in both spellings a
    // reader might look for.
    expect(fixture.run("log", "-1", "--format=%B")).not.toContain("Corpus-Actor");
    for (const party of ["user", "agent"]) {
      const matched = fixture
        .run("log", `--author=${party}`, "--format=%H")
        .split("\n")
        .filter((line) => line !== "");
      expect(matched).not.toContain(head);
    }
    // And it is findable as itself, which is what makes the exception legible.
    expect(
      fixture.run("log", "--author=recovery", "--format=%H").split("\n").filter(Boolean),
    ).toEqual([head]);
  });

  it("keeps the workspace's own identity as the committer", async () => {
    const fixture = makeRepo("committer");
    fixture.touch("data/docs/inbox/seed.md", "changed\n");

    await recover(fixture);

    expect(fixture.log("%cn <%ce>")[0]).toBe("Workspace Owner <owner@example.test>");
  });

  it("falls back to a neutral committer when the workspace configures no identity", async () => {
    const fixture = makeRepo("no-identity");
    // An empty value rather than an absent one: `sanitizeGitEnv` leaves the
    // machine's global `~/.gitconfig` reachable, so simply not configuring one
    // would test whoever happens to be running the suite.
    fixture.run("config", "user.email", "");
    fixture.touch("data/docs/inbox/seed.md", "changed\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    expect(fixture.log("%cn <%ce>")[0]).toBe("Corpus <corpus@corpus.local>");
  });

  it("never sweeps up a dirty file outside the document roots", async () => {
    const fixture = makeRepo("scoped");
    fixture.touch("data/docs/inbox/seed.md", "changed\n");
    fixture.touch("notes-to-self.txt", "my own scratch file\n");
    fixture.touch("README.md", "not a corpus document\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    expect(fixture.run("show", "--name-only", "--format=", "HEAD").trim()).toBe(
      "data/docs/inbox/seed.md",
    );
    // Untouched *and* unstaged: still exactly as the operator left them.
    expect(fixture.status("notes-to-self.txt")).toBe("?? notes-to-self.txt\n");
    expect(fixture.status("README.md")).toBe("?? README.md\n");
  });

  it("covers every document root, not `data/docs` alone", async () => {
    const fixture = makeRepo("roots");
    expect([...RECOVERY_ROOTS]).toEqual([
      "data/docs",
      "data/threads",
      ".claude/skills",
      ".claude/skills-archived",
      ".claude/agents",
    ]);
    fixture.touch("data/threads/th_1.md", "---\nid: th_1\n---\n\nthread\n");
    fixture.touch(".claude/skills/demo/SKILL.md", "---\nname: demo\n---\n\nskill\n");
    fixture.touch(".claude/agents/reviewer.md", "---\nname: reviewer\n---\n\nagent\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    if (outcome.kind !== "recovered") return;
    expect(outcome.documents).toBe(3);
    expect(
      fixture.run("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort(),
    ).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/demo/SKILL.md",
      "data/threads/th_1.md",
    ]);
  });

  it("counts documents, not files: a skill folder is several files and one document", async () => {
    const fixture = makeRepo("skill-folder");
    fixture.touch(".claude/skills/demo/SKILL.md", "---\nname: demo\n---\n\nskill\n");
    fixture.touch(".claude/skills/demo/helper.py", "print('hi')\n");
    fixture.touch(".claude/skills/demo/reference/notes.md", "notes\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    if (outcome.kind !== "recovered") return;
    expect(outcome.documents).toBe(1);
    expect(outcome.paths).toHaveLength(3);
    expect(fixture.log("%s")[0]).toBe(recoverySubject(1));
  });

  it("recovers paths with spaces and non-ASCII characters", async () => {
    const fixture = makeRepo("unicode");
    fixture.touch("data/docs/inbox/café note.md", "# Café\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    // `core.quotePath=false` so the assertion reads the path git recorded rather
    // than git's octal rendering of it.
    expect(
      fixture.run("-c", "core.quotePath=false", "show", "--name-only", "--format=", "HEAD").trim(),
    ).toBe("data/docs/inbox/café note.md");
    expect(fixture.status()).toBe("");
  });

  it("stages a deletion made while the server was stopped", async () => {
    const fixture = makeRepo("deleted");
    rmSync(join(fixture.root, "data/docs/inbox/seed.md"));

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    expect(fixture.run("show", "--name-status", "--format=", "HEAD").trim()).toBe(
      "D\tdata/docs/inbox/seed.md",
    );
  });

  it("leaves the changes on disk and the index clean when git refuses the commit", async () => {
    const fixture = makeRepo("refused");
    fixture.touch("data/docs/inbox/seed.md", "changed by hand\n");
    const hook = join(fixture.root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'policy says no' >&2\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);
    const before = fixture.log("%H");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.output).toContain("policy says no");
    // SPEC.md §11: the change stands, and it is not left staged for the next
    // commit by anything at all to swallow.
    expect(fixture.log("%H")).toEqual(before);
    expect(fixture.status()).toBe(" M data/docs/inbox/seed.md\n");
    expect(fixture.run("diff", "--cached", "--name-only")).toBe("");
    expect(fixture.logs).toEqual([
      {
        level: "error",
        message: "could not commit changes left uncommitted by a previous run",
        fields: { reason: "the recovery commit failed", output: outcome.output },
      },
    ]);
  });

  it("skips a detached HEAD, logs once and leaves the tree alone", async () => {
    const fixture = makeRepo("detached");
    fixture.run("checkout", "--detach", "--quiet", "HEAD");
    fixture.touch("data/docs/inbox/seed.md", "changed\n");
    const before = fixture.log("%H");

    const outcome = await recover(fixture);

    expect(outcome).toEqual({ kind: "skipped", reason: "HEAD is detached" });
    expect(fixture.log("%H")).toEqual(before);
    expect(fixture.status()).toBe(" M data/docs/inbox/seed.md\n");
    expect(fixture.logs).toHaveLength(1);
    expect(wroteAnything(fixture.calls)).toBe(false);
  });

  it("skips a repository that is mid-operation", async () => {
    const fixture = makeRepo("mid-rebase");
    mkdirSync(join(fixture.root, ".git", "rebase-merge"), { recursive: true });
    fixture.touch("data/docs/inbox/seed.md", "changed\n");

    const outcome = await recover(fixture);

    expect(outcome).toEqual({
      kind: "skipped",
      reason: "a git operation is in progress (rebase-merge)",
    });
    expect(wroteAnything(fixture.calls)).toBe(false);
  });

  it("says nothing at all in a workspace that is not a git repository", async () => {
    const fixture = makeRepo("no-repo", { init: false });
    fixture.touch("data/docs/inbox/loose.md", "# no repository here\n");

    const outcome = await recover(fixture);

    expect(outcome).toEqual({
      kind: "unavailable",
      reason: "the workspace is not a git repository",
    });
    expect(fixture.logs).toEqual([]);
    expect(wroteAnything(fixture.calls)).toBe(false);
  });

  it("refuses to commit into a repository the workspace merely sits inside", async () => {
    const fixture = makeRepo("nested", { init: false });
    // The parent repository is somebody else's — a workspace scaffolded inside a
    // dotfiles checkout, say. Recovery must not put the operator's documents
    // into a history they never asked for.
    const parent = join(fixture.root, "..", `parent-${Date.now().toString(36)}`);
    mkdirSync(parent, { recursive: true });
    try {
      execFileSync("git", ["init", "--initial-branch=main"], {
        cwd: parent,
        env: sanitizeGitEnv(),
      });
      const nested = join(parent, "ws");
      mkdirSync(join(nested, "data", "docs"), { recursive: true });
      writeFileSync(join(nested, "data", "docs", "a.md"), "# doc\n", "utf8");

      const outcome = await recoverUncommittedChanges({
        git: createGit(nested),
        withGitLock: (task) => task(),
      });

      expect(outcome).toEqual({
        kind: "skipped",
        reason: "the workspace is not the root of its git repository",
      });
      expect(
        execFileSync("git", ["rev-list", "--count", "--all"], {
          cwd: parent,
          env: sanitizeGitEnv(),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).trim(),
      ).toBe("0");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("opens no window: the first save after a recovery makes a fresh commit", async () => {
    const fixture = makeRepo("no-window");
    fixture.touch("data/docs/inbox/seed.md", "recovered content\n");
    const committer = createAutoCommitter({ git: fixture.git });

    const recovered = await recoverUncommittedChanges({
      git: fixture.git,
      withGitLock: (task) => committer.withGitLock(task),
    });
    expect(recovered.kind).toBe("recovered");
    const recoverySha = fixture.log("%H")[0];

    fixture.touch("data/docs/inbox/seed.md", "then the user saved\n");
    const outcome = await committer.commit({
      docId: "doc_seed",
      actor: "user",
      subject: "doc save: seed",
      paths: ["data/docs/inbox/seed.md"],
    });

    expect(outcome.kind).toBe("committed");
    // Two commits, not one amended into the other — the recovery is still there,
    // still with its own subject and its own author.
    expect(fixture.log("%H")[1]).toBe(recoverySha);
    expect(fixture.log("%s").slice(0, 2)).toEqual(["doc save: seed", recoverySubject(1)]);
    expect(fixture.log("%an").slice(0, 2)).toEqual(["user", "recovery"]);
  });

  it("reports zero documents honestly when only a non-document file changed", async () => {
    const fixture = makeRepo("no-documents");
    fixture.touch("data/docs/inbox/diagram.png", "not really a png\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    if (outcome.kind !== "recovered") return;
    expect(outcome.documents).toBe(0);
    expect(fixture.log("%s")[0]).toBe("recovery: 0 documents left uncommitted by a previous run");
  });

  it("commits everything it found as one commit, not one per document", async () => {
    const fixture = makeRepo("single-commit");
    const before = fixture.log("%H").length;
    fixture.touch("data/docs/inbox/a.md", "a\n");
    fixture.touch("data/docs/inbox/b.md", "b\n");
    fixture.touch("data/docs/inbox/c.md", "c\n");

    const outcome = await recover(fixture);

    expect(outcome.kind).toBe("recovered");
    expect(fixture.log("%H")).toHaveLength(before + 1);
    expect(fixture.log("%s")[0]).toBe(recoverySubject(3));
  });
});
