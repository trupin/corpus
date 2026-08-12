// Real repositories, real commits, real hooks. Git behaviour is the substance
// of SPEC.md §4's audit trail, and a mock of it would assert only that the mock
// was called.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAutoCommitter,
  editingSessionSubject,
  SQUASH_IDLE_MS,
  WINDOW_MAX_MS,
  type AutoCommitter,
} from "./commit.js";
import { createGit, type Git } from "./git.js";
import { sanitizeGitEnv } from "./env.js";
import { disableAutoMaintenance } from "./maintenance.js";

type Repo = {
  readonly root: string;
  readonly committer: AutoCommitter;
  /** Every git invocation the committer made, in order — so "made no call at all" is assertable. */
  readonly calls: string[][];
  /** `[from, to]` for every close that moved a window's commit (SERVER-093). */
  readonly rewrites: [string, string][];
  clock: number;
  git(...args: string[]): string;
  touch(path: string, content: string): void;
  log(format: string): string[];
  close(): void;
};

let repo: Repo | undefined;

afterEach(() => {
  repo?.close();
  repo = undefined;
});

function makeRepo(
  name: string,
  options: {
    init?: boolean;
    identity?: boolean;
    seed?: boolean;
    /** A small ageing-out interval, so §4's backstop is reachable in a test. */
    windowMaxMs?: number;
  } = {},
): Repo {
  const root = mkdtempSync(join(tmpdir(), `corpus-s005-${name}-`));
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      env: sanitizeGitEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  if (options.init !== false) {
    git("init", "--initial-branch=main");
    disableAutoMaintenance(git);
    if (options.identity !== false) {
      git("config", "user.name", "Workspace Owner");
      git("config", "user.email", "owner@example.test");
    }
    if (options.seed !== false) {
      writeFileSync(join(root, "seed.txt"), "seed\n", "utf8");
      git("add", "-A", "--", "seed.txt");
      git("-c", "user.name=Seed", "-c", "user.email=seed@example.test", "commit", "-m", "seed");
    }
  }

  const state = { clock: Date.parse("2026-07-27T09:00:00Z") };
  const calls: string[][] = [];
  const underlying = createGit(root);
  const recording: Git = {
    root,
    exec: (args, execOptions) => {
      calls.push([...args]);
      return underlying.exec(args, execOptions);
    },
  };
  const rewrites: [string, string][] = [];
  const made: Repo = {
    root,
    calls,
    rewrites,
    committer: createAutoCommitter({
      git: recording,
      now: () => state.clock,
      onWindowRewritten: (from, to) => {
        rewrites.push([from, to]);
      },
      ...(options.windowMaxMs === undefined ? {} : { windowMaxMs: options.windowMaxMs }),
    }),
    get clock() {
      return state.clock;
    },
    set clock(value: number) {
      state.clock = value;
    },
    git,
    touch(path, content) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content, "utf8");
    },
    log: (format) =>
      git("log", `--format=${format}`)
        .split("\n")
        .filter((line) => line !== ""),
    close: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
  repo = made;
  return made;
}

const DOC = "data/docs/inbox/note.md";

describe("createAutoCommitter", () => {
  it("authors as the acting party and leaves the committer as the process identity", async () => {
    const r = makeRepo("author");
    r.touch(DOC, "one");
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "agent",
      subject: "doc create: Note (doc_aaaa1111) by agent",
      paths: [DOC],
    });

    expect(outcome.kind).toBe("committed");
    expect(r.log("%an|%ae|%cn|%s")[0]).toBe(
      "agent|agent@corpus.local|Workspace Owner|doc create: Note (doc_aaaa1111) by agent",
    );
    expect(r.git("show", "--stat", "--format=", "HEAD")).toContain(DOC);
  });

  it("writes machine-readable trailers, and the anchors trailer only when anchors moved", async () => {
    const r = makeRepo("trailers");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    expect(r.log("%b")[0]).toBeDefined();
    let body = r.git("log", "-1", "--format=%b");
    expect(body).toContain("Corpus-Doc: doc_aaaa1111");
    expect(body).toContain("Corpus-Actor: user");
    expect(body).not.toContain("Corpus-Anchors");

    r.clock += SQUASH_IDLE_MS * 2;
    r.touch(DOC, "two");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
      anchors: { remapped: ["anc_a"], orphaned: ["anc_b", "anc_c"] },
    });
    body = r.git("log", "-1", "--format=%b");
    expect(body).toContain("Corpus-Anchors: remapped=1 orphaned=2");
  });

  it("folds two rapid saves of one document by one party into one commit", async () => {
    const r = makeRepo("squash");
    const base = r.git("rev-parse", "HEAD").trim();

    r.touch(DOC, "first edit");
    const first = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    const firstAuthorDate = r.git("log", "-1", "--format=%aI").trim();

    r.clock += 100;
    r.touch(DOC, "second edit");
    const second = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    expect(first.kind).toBe("committed");
    expect(second.kind).toBe("amended");
    expect(r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n")).toHaveLength(1);
    expect(r.git("show", "HEAD:" + DOC)).toBe("second edit");
    // The session's author date is when it started; the committer date moves.
    expect(r.git("log", "-1", "--format=%aI").trim()).toBe(firstAuthorDate);
    expect(r.git("log", "-1", "--format=%cI").trim()).not.toBe("");
  });

  it("keeps the session's anchor ids across the amend", async () => {
    const r = makeRepo("squash-anchors");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
      anchors: { remapped: ["anc_a"], orphaned: [] },
    });
    r.clock += 100;
    r.touch(DOC, "two");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
      anchors: { remapped: [], orphaned: ["anc_b"] },
    });

    expect(r.git("log", "-1", "--format=%b")).toContain("Corpus-Anchors: remapped=1 orphaned=1");
  });

  it("promotes a remapped anchor to orphaned when the session later detaches it", async () => {
    const r = makeRepo("squash-anchor-promote");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit",
      paths: [DOC],
      anchors: { remapped: ["anc_a"], orphaned: [] },
    });
    r.clock += 100;
    r.touch(DOC, "two");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit",
      paths: [DOC],
      anchors: { remapped: [], orphaned: ["anc_a"] },
    });

    expect(r.git("log", "-1", "--format=%b")).toContain("Corpus-Anchors: remapped=0 orphaned=1");
  });

  // The `document` scenario this loop used to carry moved out on SERVER-091: a
  // save to another document by the same party is now the *folding* case, and it
  // is asserted as such under "a commit window belongs to a party".
  it("starts a fresh commit past the window, for the other party, or after an interleaved commit", async () => {
    for (const scenario of ["window", "actor", "interleaved"] as const) {
      const r = makeRepo(`squash-break-${scenario}`);
      const base = r.git("rev-parse", "HEAD").trim();
      r.touch(DOC, "one");
      await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc edit: Note (doc_aaaa1111) by user",
        paths: [DOC],
      });

      if (scenario === "window") r.clock += SQUASH_IDLE_MS;
      else r.clock += 100;
      if (scenario === "interleaved") {
        r.touch("unrelated.txt", "outside");
        r.git("add", "-A", "--", "unrelated.txt");
        r.git("commit", "-m", "an unrelated commit");
      }

      r.touch(DOC, "two");
      const outcome = await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: scenario === "actor" ? "agent" : "user",
        subject: "doc edit: second save",
        paths: [DOC],
      });

      expect(outcome.kind, scenario).toBe("committed");
      const made = r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n");
      expect(made.length, scenario).toBe(scenario === "interleaved" ? 3 : 2);
      r.close();
      repo = undefined;
    }
  });

  it("never amends a commit the edit acknowledgment has named", async () => {
    // §4's acknowledgment publishes a commit range in a queue event, and from
    // there it reaches the agent. `endSquashSession` is how it says so; the next
    // save inside the window must then make a *fresh* commit, or the published
    // `to` would name an object no branch holds (SERVER-052 review, PR #22).
    const r = makeRepo("squash-sealed");
    const base = r.git("rev-parse", "HEAD").trim();

    r.touch(DOC, "first edit");
    const first = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    expect(first.kind).toBe("committed");
    const named = first.kind === "committed" ? first.sha : "";

    // The reader closed; the acknowledgment named this commit.
    r.committer.endSquashSession(named);

    // The reader reopens and the person fixes a typo — well inside the window
    // that would otherwise fold.
    r.clock += 100;
    r.touch(DOC, "second edit");
    const second = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    expect(second.kind).toBe("committed");
    const made = r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n");
    expect(made).toHaveLength(2);
    // The named commit is still on the branch, so the range that named it still
    // resolves and the next session's range starts *after* it.
    expect(made).toContain(named);
    expect(r.git("rev-parse", "HEAD^").trim()).toBe(named);
  });

  it("seals only the commit it is given, and forgets nothing else", async () => {
    const r = makeRepo("squash-seal-other");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    // A sha this repository never had — a stale acknowledgment, a session whose
    // commit was itself amended away. It must not break the live session.
    r.committer.endSquashSession("0".repeat(40));

    r.clock += 100;
    r.touch(DOC, "two");
    const second = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    expect(second.kind).toBe("amended");
  });

  it("never amends a detached HEAD, a mid-merge repository, or published history", async () => {
    for (const state of ["detached", "merging", "published"] as const) {
      const r = makeRepo(`squash-safe-${state}`);
      r.touch(DOC, "one");
      await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc edit",
        paths: [DOC],
      });
      const beforeSha = r.git("rev-parse", "HEAD").trim();

      if (state === "detached") r.git("checkout", "--detach", "HEAD");
      if (state === "merging") writeFileSync(join(r.root, ".git", "MERGE_HEAD"), beforeSha, "utf8");
      if (state === "published") r.git("update-ref", "refs/remotes/origin/main", beforeSha);

      r.clock += 100;
      r.touch(DOC, "two");
      const outcome = await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc edit",
        paths: [DOC],
      });

      // Never an amend. A mid-merge repository is stricter still: git itself
      // refuses to commit at all, which is exactly the safe answer — the
      // mutation stands on disk and the failure is reported.
      expect(outcome.kind, state).toBe(state === "merging" ? "failed" : "committed");
      // The commit that would have been rewritten is still reachable, intact.
      expect(r.git("cat-file", "-t", beforeSha).trim(), state).toBe("commit");
      expect(r.git("show", `${beforeSha}:${DOC}`), state).toBe("one");
      r.close();
      repo = undefined;
    }
  });

  it("reports a failing hook without touching the file, and never uses --no-verify", async () => {
    const r = makeRepo("hook");
    const hook = join(r.root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'doc check failed: bad anchor' >&2\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);

    r.touch(DOC, "edited despite the hook");
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit",
      paths: [DOC],
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.output).toContain("doc check failed: bad anchor");
    // The mutation stands: the file holds the edit and git sees it uncommitted.
    expect(execFileSync("cat", [join(r.root, DOC)], { encoding: "utf8" })).toBe(
      "edited despite the hook",
    );
    expect(r.git("status", "--porcelain", "-uall")).toContain(DOC);
    // …and nothing of it is left in the index: the refused commit must not be
    // waiting to ride along on whatever commits next.
    expect(r.git("diff", "--cached", "--name-only").trim()).toBe("");

    // Removing the hook restores normal behaviour.
    rmSync(hook);
    const retry = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit",
      paths: [DOC],
    });
    expect(retry.kind).toBe("committed");
  });

  it("skips the commit when the workspace is not a repository", async () => {
    const r = makeRepo("no-repo", { init: false });
    r.touch(DOC, "one");
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });
    expect(outcome).toEqual({ kind: "skipped", reason: "the workspace is not a git repository" });
  });

  it("skips the commit when git is not on PATH", async () => {
    const r = makeRepo("no-git");
    r.touch(DOC, "one");
    const path = process.env["PATH"];
    process.env["PATH"] = join(r.root, "nowhere");
    try {
      const outcome = await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc create",
        paths: [DOC],
      });
      expect(outcome).toEqual({ kind: "skipped", reason: "git is not available on PATH" });
    } finally {
      process.env["PATH"] = path;
    }
  });

  it("commits only the mutation's paths, leaving unrelated work dirty", async () => {
    const r = makeRepo("scoped");
    r.touch("README.md", "unrelated dirty content\n");
    r.git("add", "-A", "--", "README.md");
    r.touch("staged.txt", "staged but unrelated\n");
    r.git("add", "-A", "--", "staged.txt");

    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });

    expect(r.git("show", "--stat", "--format=", "HEAD").trim()).toContain(DOC);
    expect(r.git("show", "--stat", "--format=", "HEAD")).not.toContain("README.md");
    expect(r.git("status", "--porcelain")).toContain("README.md");
    expect(r.git("status", "--porcelain")).toContain("staged.txt");
  });

  it("commits only the mutation's paths on an unborn branch too", async () => {
    // SERVER-022 finding 5: the `--only` scoping was skipped when there was no
    // HEAD, so the *first* auto-commit in a fresh workspace committed the whole
    // index — an operator who had staged something before the server's first
    // write found it swallowed into a `doc create`, authored by `user`.
    const r = makeRepo("scoped-unborn", { seed: false });
    r.touch("staged.txt", "staged but unrelated\n");
    r.git("add", "-A", "--", "staged.txt");

    r.touch(DOC, "one");
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });

    expect(outcome.kind).toBe("committed");
    const stat = r.git("show", "--stat", "--format=", "HEAD");
    expect(stat).toContain(DOC);
    expect(stat).not.toContain("staged.txt");
    // Still staged, still uncommitted: the operator's index is exactly as they
    // left it.
    expect(r.git("status", "--porcelain").trim()).toBe("A  staged.txt");
  });

  it("stages a removal and skips a path git has never heard of", async () => {
    const r = makeRepo("removal");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });
    r.clock += SQUASH_IDLE_MS * 2;

    rmSync(join(r.root, DOC));
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete",
      // The second path never existed: it must not fail the whole commit.
      paths: [DOC, "data/docs/inbox/never-existed.md"],
    });
    expect(outcome.kind).toBe("committed");
    expect(r.git("log", "--diff-filter=D", "--format=%s", "--", DOC).trim()).toContain(
      "doc delete",
    );
    expect(r.git("show", "HEAD~1:" + DOC)).toBe("one");
  });

  // Regression, evaluator FAIL-1 (SERVER-005-eval): a document created and then
  // deleted inside the idle window used to try to amend the create commit. The
  // amend would have emptied it, git refused, and the deletion was lost — while
  // the staged removal stayed in the index.
  it("falls back to a fresh commit when amending would empty the previous one", async () => {
    const r = makeRepo("amend-would-empty");
    r.touch(DOC, "created inside the window");
    const created = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    expect(created.kind).toBe("committed");
    const createSha = r.git("rev-parse", "HEAD").trim();

    r.clock += 100;
    rmSync(join(r.root, DOC));
    const deleted = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    // A fresh commit, not a refusal and not a rewrite.
    expect(deleted.kind).toBe("committed");
    expect(r.git("rev-parse", "HEAD").trim()).not.toBe(createSha);
    // The deletion is in the audit trail (SPEC.md §4) and the file is gone from
    // the tree, while the create commit still holds its content. That commit's
    // *sha* moved on SERVER-091 — the window it held closed with no act to name
    // it, so its subject was rewritten — but its content is untouched, which is
    // the whole of what this regression is about.
    expect(r.git("log", "--diff-filter=D", "--format=%s", "--", DOC).trim()).toBe(
      "doc delete: Note (doc_aaaa1111) by user",
    );
    expect(r.git("ls-tree", "-r", "--name-only", "HEAD")).not.toContain(DOC);
    expect(r.git("show", "HEAD~1:" + DOC)).toBe("created inside the window");
    expect(r.log("%s")[1]).toBe(editingSessionSubject(1, "user"));
  });

  it("leaves nothing staged after a delete inside the window, so the next commit is uncontaminated", async () => {
    const r = makeRepo("delete-window-index");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    r.clock += 100;
    rmSync(join(r.root, DOC));
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    expect(r.git("status", "--porcelain").trim()).toBe("");

    // The evaluator's contamination scenario, exactly: the operator commits
    // their own unrelated work and must ship nothing of ours with it.
    r.touch("UNRELATED.md", "the operator's own work\n");
    r.git("add", "--", "UNRELATED.md");
    r.git("commit", "-m", "an unrelated user commit");
    const stat = r.git("show", "--stat", "--format=", "HEAD");
    expect(stat).toContain("UNRELATED.md");
    expect(stat).not.toContain(DOC);
  });

  it("leaves nothing staged when git refuses the commit, so the next commit is uncontaminated", async () => {
    const r = makeRepo("refused-index");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });
    r.clock += SQUASH_IDLE_MS * 2;

    const hook = join(r.root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);
    rmSync(join(r.root, DOC));
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete",
      paths: [DOC],
    });
    expect(outcome.kind).toBe("failed");
    rmSync(hook);

    // The deletion still stands on disk, unstaged — `D` in the working tree, not
    // `D ` in the index.
    expect(r.git("status", "--porcelain").trim()).toBe(`D ${DOC}`);
    expect(r.git("diff", "--cached", "--name-only").trim()).toBe("");

    r.touch("UNRELATED.md", "the operator's own work\n");
    r.git("add", "--", "UNRELATED.md");
    r.git("commit", "-m", "an unrelated user commit");
    const stat = r.git("show", "--stat", "--format=", "HEAD");
    expect(stat).toContain("UNRELATED.md");
    expect(stat).not.toContain(DOC);
  });

  it("falls back to a fresh commit when the root commit itself would be emptied", async () => {
    // An unborn branch: the server's own first commit *is* the root commit, so
    // "would the amend be empty" has no parent to compare against and is asked
    // of the tree instead.
    const r = makeRepo("amend-would-empty-root", { seed: false });
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });

    r.clock += 100;
    rmSync(join(r.root, DOC));
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete",
      paths: [DOC],
    });

    expect(outcome.kind).toBe("committed");
    // Two commits, the root one still holding the create (relabelled as the
    // editing session it turned out to be — see the sibling test above).
    expect(r.log("%s")).toEqual(["doc delete", editingSessionSubject(1, "user")]);
    expect(r.git("show", "HEAD~1:" + DOC)).toBe("one");
    expect(r.git("log", "--diff-filter=D", "--format=%s", "--", DOC).trim()).toBe("doc delete");
    expect(r.git("status", "--porcelain").trim()).toBe("");
  });

  it("unstages on an unborn branch too, when the very first commit is refused", async () => {
    const r = makeRepo("unborn-refused", { seed: false });
    const hook = join(r.root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", "utf8");
    chmodSync(hook, 0o755);

    r.touch(DOC, "one");
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC],
    });

    expect(outcome.kind).toBe("failed");
    // Nothing staged, so the operator's own first commit is theirs alone. With
    // no HEAD to reset to, the entry has to leave the index outright.
    expect(r.git("diff", "--cached", "--name-only").trim()).toBe("");
    expect(r.git("status", "--porcelain", "-uall").trim()).toBe(`?? ${DOC}`);
  });

  it("still amends when the previous commit says more than this save touches", async () => {
    const r = makeRepo("amend-wider-head");
    const other = "data/docs/inbox/other.md";
    r.touch(DOC, "one");
    r.touch(other, "kept");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create",
      paths: [DOC, other],
    });
    const base = r.git("rev-parse", "HEAD~1").trim();

    r.clock += 100;
    rmSync(join(r.root, DOC));
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete",
      paths: [DOC],
    });

    // Reverting our path does not empty the commit: it still introduces `other`.
    expect(outcome.kind).toBe("amended");
    expect(r.git("rev-parse", "HEAD~1").trim()).toBe(base);
    expect(r.git("ls-tree", "-r", "--name-only", "HEAD")).toContain(other);
    expect(r.git("ls-tree", "-r", "--name-only", "HEAD")).not.toContain(DOC);
  });

  it("amends under the latest verb's subject, so a folded commit never mislabels itself", async () => {
    const r = makeRepo("fold-subject");
    const base = r.git("rev-parse", "HEAD").trim();
    r.touch(DOC, "created");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc create: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    r.clock += 100;
    r.touch(DOC, "edited");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });
    r.clock += 100;
    r.touch(DOC, "archived");
    const last = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc archive: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    expect(last.kind).toBe("amended");
    expect(r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n")).toHaveLength(1);
    expect(r.log("%s")[0]).toBe("doc archive: Note (doc_aaaa1111) by user");
  });

  it("answers 'nothing to commit' when the paths hold no change", async () => {
    const r = makeRepo("nothing");
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit",
      paths: ["seed.txt"],
    });
    expect(outcome).toEqual({ kind: "skipped", reason: "nothing to commit" });
  });

  it("takes no later save into a `squash: false` commit — it opens no window", async () => {
    // The other half of "a commit that stands alone is its own event, never part
    // of an edit". It was only ever enforced against folding *into* a preceding
    // window; the commit still opened one of its own, so the next save amended
    // it and replaced its subject (SERVER-091). The callers are
    // `skills/rollback.ts` and `threads/reattach.ts`.
    const r = makeRepo("standalone-opens-no-window");
    r.touch(DOC, "the restored version");
    const standalone = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "skill rollback: comment (doc_aaaa1111) by user",
      paths: [DOC],
      squash: false,
    });
    expect(standalone.kind).toBe("committed");
    const standaloneSha = standalone.kind === "committed" ? standalone.sha : "";

    // Same party, no clock movement — everything an ordinary save needs to fold.
    r.clock += 100;
    r.touch(DOC, "typed right after the rollback");
    const save = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [DOC],
    });

    expect(save.kind).toBe("committed");
    expect(r.git("rev-parse", "HEAD^").trim()).toBe(standaloneSha);
    expect(r.git("log", "-1", "--format=%s", standaloneSha).trim()).toBe(
      "skill rollback: comment (doc_aaaa1111) by user",
    );
  });

  it("commits with a fallback identity when the repository configures none", async () => {
    const r = makeRepo("no-identity", { identity: false });
    r.touch(DOC, "one");
    // Point git at an empty home so no global identity is found — the state a
    // fresh machine is in, where a bare `git commit` fails with "tell me who
    // you are" and a mutation would otherwise be lost.
    const home = process.env["HOME"];
    const xdg = process.env["XDG_CONFIG_HOME"];
    process.env["HOME"] = r.root;
    process.env["XDG_CONFIG_HOME"] = join(r.root, "xdg");
    try {
      const outcome = await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc create",
        paths: [DOC],
      });
      expect(outcome.kind).toBe("committed");
      expect(r.log("%an|%cn")[0]).toBe("user|Corpus");
    } finally {
      process.env["HOME"] = home;
      if (xdg === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = xdg;
    }
  });

  it("serializes concurrent commits so neither document's change is lost to the other", async () => {
    // Before SERVER-091 this asserted two commits, one document each — the
    // document was half the fold key. Under §4's party-scoped window the two
    // saves belong to one commit, so what the git lock has to prove is that
    // *both* changes are in it: without the lock the two stage/commit pairs
    // interleave and one overwrites the other's index.
    const r = makeRepo("serialize");
    const base = r.git("rev-parse", "HEAD").trim();
    const paths = ["data/docs/inbox/a.md", "data/docs/inbox/b.md"];

    await Promise.all(
      paths.map(async (path, index) => {
        r.touch(path, `content ${index}`);
        return r.committer.commit({
          docId: index === 0 ? "doc_aaaa1111" : "doc_bbbb2222",
          actor: "user",
          subject: `doc create: ${path}`,
          paths: [path],
        });
      }),
    );

    const shas = r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n");
    expect(shas).toHaveLength(1);
    const stat = r.git("show", "--stat", "--format=", "HEAD");
    for (const [index, path] of paths.entries()) {
      expect(stat).toContain(path);
      expect(r.git("show", `HEAD:${path}`)).toBe(`content ${index}`);
    }
    const trailers = r.git("log", "-1", "--format=%b");
    expect(trailers).toContain("Corpus-Doc: doc_aaaa1111");
    expect(trailers).toContain("Corpus-Doc: doc_bbbb2222");
    // Nothing of the operator's, and nothing repeated.
    expect(r.git("status", "--porcelain").trim()).toBe("");
  });
});

// SPEC.md §4's "One action, one commit" (SERVER-077). The committer is *told*
// an act spans a set — `docIds` — rather than inferring it from document plus
// actor, which by construction can only ever fold saves of one document.
describe("an act over a named set", () => {
  const A = "data/docs/inbox/a.md";
  const B = "data/docs/inbox/b.md";

  it("names every document it changed, one trailer each", async () => {
    const r = makeRepo("act-trailers");
    r.touch(A, "one");
    r.touch(B, "two");

    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      docIds: ["doc_aaaa1111", "doc_bbbb2222"],
      actor: "user",
      subject: "bulk archive: 2 documents by user",
      paths: [A, B],
    });

    expect(outcome.kind).toBe("committed");
    expect(r.git("log", "-1", "--format=%b")).toBe(
      "Corpus-Doc: doc_aaaa1111\nCorpus-Doc: doc_bbbb2222\nCorpus-Actor: user\n\n",
    );
  });

  it("does not fold into the editing session that preceded it", async () => {
    const r = makeRepo("act-no-fold-in");
    r.touch(A, "first edit");
    const session = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [A],
    });
    expect(session.kind).toBe("committed");

    // Same author, same document, no clock movement — everything an ordinary
    // save needs to be folded in.
    r.clock += 100;
    r.touch(A, "archived");
    const act = await r.committer.commit({
      docId: "doc_aaaa1111",
      docIds: ["doc_aaaa1111"],
      actor: "user",
      subject: "bulk archive: 1 document by user",
      paths: [A],
    });

    expect(act.kind).toBe("committed");
    // Two commits, the act's own on top. The editing session below it closed
    // when the act refused to join it, and says so (SERVER-091): §4 has a bulk
    // Save "close the window, let that commit land, and then commit separately".
    expect(r.log("%s").slice(0, 2)).toEqual([
      "bulk archive: 1 document by user",
      editingSessionSubject(1, "user"),
    ]);
    // The session's content is untouched by the relabelling.
    expect(r.git("show", "HEAD~1:" + A)).toBe("first edit");
  });

  it("takes no later save into itself", async () => {
    const r = makeRepo("act-no-fold-onto");
    r.touch(A, "archived");
    const act = await r.committer.commit({
      docId: "doc_aaaa1111",
      docIds: ["doc_aaaa1111"],
      actor: "user",
      subject: "bulk archive: 1 document by user",
      paths: [A],
    });
    expect(act.kind).toBe("committed");
    const actSha = act.kind === "committed" ? act.sha : "";

    r.clock += 100;
    r.touch(A, "typed right after");
    const save = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: Note (doc_aaaa1111) by user",
      paths: [A],
    });

    expect(save.kind).toBe("committed");
    expect(r.git("rev-parse", "HEAD^").trim()).toBe(actSha);
    // The act still records the act, byte for byte.
    expect(r.git("show", `${actSha}:${A}`)).toBe("archived");
  });

  it("still commits alone when the open window is the same party's", async () => {
    // The document used to be half the fold key, so an act on *another*
    // document was kept apart by the key itself. Under the party-scoped window
    // (SERVER-091) only `docIds` keeps it apart, which is the whole point of
    // being told rather than inferring.
    const r = makeRepo("act-alone-party-key");
    r.touch(A, "an ordinary save");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });

    r.clock += 100;
    r.touch(B, "archived");
    const act = await r.committer.commit({
      docId: "doc_bbbb2222",
      docIds: ["doc_bbbb2222"],
      actor: "user",
      subject: "bulk archive: 1 document by user",
      paths: [B],
    });

    expect(act.kind).toBe("committed");
    expect(r.log("%s").slice(0, 2)).toEqual([
      "bulk archive: 1 document by user",
      editingSessionSubject(1, "user"),
    ]);
    // The act's commit names only the act's document — the window's is not
    // swept into it.
    expect(r.git("log", "-1", "--format=%b")).toBe(
      "Corpus-Doc: doc_bbbb2222\nCorpus-Actor: user\n\n",
    );
    expect(r.git("show", "--stat", "--format=", "HEAD")).not.toContain(A);
  });
});

// SPEC.md §4's commit-window rider (SERVER-091): "At most one window is open at
// a time and it belongs to one party". The fold key is the acting party alone,
// the window remembers every document it has held, and closing it is "stop
// amending it" plus — where no act named it — one subject-rewriting amend.
describe("a commit window belongs to a party", () => {
  const A = "data/docs/inbox/a.md";
  const B = "data/docs/inbox/b.md";

  it("gathers every document one party touched into a single commit", async () => {
    const r = makeRepo("window-two-docs");
    const base = r.git("rev-parse", "HEAD").trim();

    r.touch(A, "a one");
    const first = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });
    r.clock += 100;
    r.touch(B, "b one");
    const second = await r.committer.commit({
      docId: "doc_bbbb2222",
      actor: "user",
      subject: "doc edit: B by user",
      paths: [B],
    });
    // Back to the first document: the trailer set must not grow a duplicate.
    r.clock += 100;
    r.touch(A, "a two");
    const third = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });

    expect([first.kind, second.kind, third.kind]).toEqual(["committed", "amended", "amended"]);
    expect(r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n")).toHaveLength(1);
    // One commit, both documents' *latest* content, one trailer each, in the
    // order the documents were first touched.
    expect(r.git("show", `HEAD:${A}`)).toBe("a two");
    expect(r.git("show", `HEAD:${B}`)).toBe("b one");
    expect(r.git("log", "-1", "--format=%b")).toBe(
      "Corpus-Doc: doc_aaaa1111\nCorpus-Doc: doc_bbbb2222\nCorpus-Actor: user\n\n",
    );
    expect(r.log("%an")[0]).toBe("user");
  });

  it("closes on the other party's write, so git log --author stays exact", async () => {
    const r = makeRepo("window-party-change");
    const base = r.git("rev-parse", "HEAD").trim();

    const save = async (actor: "user" | "agent", content: string): Promise<void> => {
      r.touch(A, content);
      await r.committer.commit({
        docId: "doc_aaaa1111",
        actor,
        subject: `doc edit: A by ${actor}`,
        paths: [A],
      });
      r.clock += 100;
    };

    await save("user", "the user types");
    await save("agent", "the agent stewards");
    await save("user", "the user types again");

    // Three commits, in that authorship order — never one commit carrying both
    // parties' work, and never the agent's change folded under `user`.
    expect(r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n")).toHaveLength(3);
    // Newest first: the last window is still open and keeps its save's subject;
    // the two the handover closed each say what they were.
    expect(r.log("%an|%s")).toEqual([
      "user|doc edit: A by user",
      `agent|${editingSessionSubject(1, "agent")}`,
      `user|${editingSessionSubject(1, "user")}`,
      "Seed|seed",
    ]);
    expect(
      r.git("log", "--author=user", "--format=%an", `${base}..HEAD`).trim().split("\n"),
    ).toHaveLength(2);
    expect(
      r.git("log", "--author=agent", "--format=%an", `${base}..HEAD`).trim().split("\n"),
    ).toHaveLength(1);
    // Relabelling a closed window never touches its content.
    expect(r.git("show", "HEAD~2:" + A)).toBe("the user types");
    expect(r.git("show", "HEAD~1:" + A)).toBe("the agent stewards");
    expect(r.git("show", "HEAD:" + A)).toBe("the user types again");
  });

  it("ages out under continuing activity, and the next save opens a fresh window", async () => {
    // §4: "once a window has been open long enough it commits anyway, however
    // busy it has stayed". Saves every 100 ms, so nothing ever goes idle.
    expect(WINDOW_MAX_MS).toBeGreaterThan(SQUASH_IDLE_MS);
    const r = makeRepo("window-age-out", { windowMaxMs: 500 });
    const base = r.git("rev-parse", "HEAD").trim();

    const kinds: string[] = [];
    for (let step = 0; step <= 5; step += 1) {
      r.touch(A, `save ${step}`);
      const outcome = await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: `doc edit: save ${step}`,
        paths: [A],
      });
      kinds.push(outcome.kind);
      r.clock += 100;
    }

    // Five saves fold; the sixth is 500 ms past the window's opening.
    expect(kinds).toEqual(["committed", "amended", "amended", "amended", "amended", "committed"]);
    expect(r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n")).toHaveLength(2);
    // Both are editing sessions — no act named either — and the aged-out one
    // says so rather than keeping the subject of whichever save was last.
    expect(r.log("%s").slice(0, 2)).toEqual(["doc edit: save 5", editingSessionSubject(1, "user")]);
    expect(r.git("show", "HEAD:" + A)).toBe("save 5");
    expect(r.git("show", "HEAD~1:" + A)).toBe("save 4");
  });

  it("does nothing at all when no window is open", async () => {
    const r = makeRepo("window-close-none");
    r.calls.length = 0;
    await expect(r.committer.closeWindow("shutdown")).resolves.toBeUndefined();
    // Not one invocation: every caller in §4's list closes unconditionally, so
    // the common case has to cost nothing.
    expect(r.calls).toEqual([]);
  });

  it("leaves a commit that is no longer HEAD alone", async () => {
    const r = makeRepo("window-close-head-moved");
    r.touch(A, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });

    // A hook, the operator, another tool — anything at all committing after us.
    r.touch("unrelated.txt", "outside");
    r.git("add", "-A", "--", "unrelated.txt");
    r.git("commit", "-m", "an unrelated commit");
    const head = r.git("rev-parse", "HEAD").trim();

    r.calls.length = 0;
    await expect(r.committer.closeWindow("read-back")).resolves.toBeUndefined();

    expect(r.git("rev-parse", "HEAD").trim()).toBe(head);
    expect(r.calls.some((call) => call.includes("--amend"))).toBe(false);
    expect(r.log("%s").slice(0, 2)).toEqual(["an unrelated commit", "doc edit: A by user"]);
  });

  it("refuses the subject rewrite in exactly the states an ordinary amend is refused", async () => {
    for (const state of ["detached", "merging", "published"] as const) {
      const r = makeRepo(`window-close-safe-${state}`);
      r.touch(A, "one");
      await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc edit: A by user",
        paths: [A],
      });
      const beforeSha = r.git("rev-parse", "HEAD").trim();

      if (state === "detached") r.git("checkout", "--detach", "HEAD");
      if (state === "merging") writeFileSync(join(r.root, ".git", "MERGE_HEAD"), beforeSha, "utf8");
      if (state === "published") r.git("update-ref", "refs/remotes/origin/main", beforeSha);

      // Refusing is harmless: the commit keeps the last save's subject and the
      // window closes anyway — the next save cannot fold into it.
      await expect(r.committer.closeWindow("shutdown")).resolves.toBeUndefined();
      expect(r.git("rev-parse", "HEAD").trim(), state).toBe(beforeSha);
      expect(r.git("log", "-1", "--format=%s").trim(), state).toBe("doc edit: A by user");

      r.clock += 100;
      r.touch(A, "two");
      const next = await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc edit: A by user",
        paths: [A],
      });
      expect(next.kind, state).toBe(state === "merging" ? "failed" : "committed");
      r.close();
      repo = undefined;
    }
  });

  it("keeps the subject where an act named the window, and rewrites it where none did", async () => {
    for (const named of [true, false]) {
      const r = makeRepo(`window-close-named-${String(named)}`);
      r.touch(A, "a one");
      await r.committer.commit({
        docId: "doc_aaaa1111",
        actor: "agent",
        subject: "doc edit: A by agent",
        paths: [A],
      });
      r.clock += 100;
      r.touch(B, "b one");
      // The act's own change is the last thing in the window's commit, and its
      // subject names the act (SPEC.md §4).
      await r.committer.commit({
        docId: "doc_bbbb2222",
        actor: "agent",
        subject: "comment: turn on th_a1b2 by agent",
        paths: [B],
        ...(named ? { act: true } : {}),
      });

      await r.committer.closeWindow(named ? "act" : "superseded");

      expect(r.log("%s")[0], String(named)).toBe(
        named ? "comment: turn on th_a1b2 by agent" : editingSessionSubject(2, "agent"),
      );
      // Either way the commit still holds both documents and both trailers, and
      // is still the agent's.
      expect(r.log("%an")[0], String(named)).toBe("agent");
      expect(r.git("log", "-1", "--format=%b"), String(named)).toContain(
        "Corpus-Doc: doc_aaaa1111\nCorpus-Doc: doc_bbbb2222\nCorpus-Actor: agent",
      );
      expect(r.git("show", `HEAD:${A}`), String(named)).toBe("a one");
      expect(r.git("show", `HEAD:${B}`), String(named)).toBe("b one");
      r.close();
      repo = undefined;
    }
  });

  it("closes for good: after closeWindow the next save makes a fresh commit", async () => {
    const r = makeRepo("window-close-is-final");
    const base = r.git("rev-parse", "HEAD").trim();
    r.touch(A, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });

    await r.committer.closeWindow("read-back");
    const closedSha = r.git("rev-parse", "HEAD").trim();

    // Well inside the idle window: only the close stands between these two.
    r.clock += 100;
    r.touch(A, "two");
    const next = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });

    expect(next.kind).toBe("committed");
    expect(r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n")).toHaveLength(2);
    expect(r.git("rev-parse", "HEAD^").trim()).toBe(closedSha);
    expect(r.log("%s")[1]).toBe(editingSessionSubject(1, "user"));
  });

  // SPEC.md §4's read-back rule (SERVER-093): "Nothing reads a history the
  // window is still holding."
  it("announces the sha a relabel moved, so a published range can follow it", async () => {
    const r = makeRepo("window-rewrite-observed");
    r.touch(A, "one");
    const first = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });
    const before = first.kind === "committed" ? first.sha : "";

    await r.committer.closeWindow("read-back");
    const after = r.git("rev-parse", "HEAD").trim();

    // Same tree, new sha: the announcement is the only way anything holding the
    // old one could know.
    expect(after).not.toBe(before);
    expect(r.rewrites).toEqual([[before, after]]);
    expect(r.git("show", `HEAD:${A}`)).toBe("one");
    expect(r.log("%s")[0]).toBe(editingSessionSubject(1, "user"));
  });

  it("announces the sha a fold moved, so a neighbour document's session can follow", async () => {
    // PR #42's review: a fold is an amend too, and under a party-scoped window
    // it moves the commit out from under a document this save does not name.
    const r = makeRepo("window-fold-observed");
    r.touch(A, "a one");
    const first = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });
    const before = first.kind === "committed" ? first.sha : "";
    expect(r.rewrites).toEqual([]);

    r.clock += 100;
    r.touch(B, "b one");
    const second = await r.committer.commit({
      docId: "doc_bbbb2222",
      actor: "user",
      subject: "doc edit: B by user",
      paths: [B],
    });

    expect(second.kind).toBe("amended");
    const after = second.kind === "amended" ? second.sha : "";
    expect(after).not.toBe(before);
    expect(r.rewrites).toEqual([[before, after]]);

    // And the close that follows announces its own move from *there*, so the
    // two rewrites chain: a session that followed both ends on the branch.
    await r.committer.closeWindow("read-back");
    const closed = r.git("rev-parse", "HEAD").trim();
    expect(r.rewrites).toEqual([
      [before, after],
      [after, closed],
    ]);
    expect(r.log("%H")).toContain(closed);
  });

  it("announces nothing for a save that opens a fresh window rather than folding", async () => {
    // The other half of the pair: no amend, no rewrite. A fresh commit adds to
    // the history and moves nothing that anything could be holding.
    const r = makeRepo("window-fresh-silent");
    r.touch(A, "a one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });
    // Past the idle window: the next save closes this one and starts over. The
    // close's own relabel is announced; the commit that follows is not.
    r.clock += SQUASH_IDLE_MS;
    r.touch(B, "b one");
    const second = await r.committer.commit({
      docId: "doc_bbbb2222",
      actor: "user",
      subject: "doc edit: B by user",
      paths: [B],
    });

    expect(second.kind).toBe("committed");
    expect(r.rewrites).toHaveLength(1);
    const [, relabelled] = r.rewrites[0] ?? [];
    expect(r.git("rev-parse", "HEAD^").trim()).toBe(relabelled);
  });

  it("announces nothing when the close left the commit where it was", async () => {
    for (const scenario of ["act-named", "refused", "no-window"] as const) {
      const r = makeRepo(`window-rewrite-silent-${scenario}`);
      if (scenario !== "no-window") {
        r.touch(A, "one");
        await r.committer.commit({
          docId: "doc_aaaa1111",
          actor: "user",
          subject: "doc edit: A by user",
          paths: [A],
          ...(scenario === "act-named" ? { act: true } : {}),
        });
        // A published commit is one §4 refuses to amend at all.
        if (scenario === "refused") {
          r.git("update-ref", "refs/remotes/origin/main", r.git("rev-parse", "HEAD").trim());
        }
      }
      const before = scenario === "no-window" ? "" : r.git("rev-parse", "HEAD").trim();

      await r.committer.closeWindow("read-back");

      expect(r.rewrites, scenario).toEqual([]);
      if (scenario !== "no-window")
        expect(r.git("rev-parse", "HEAD").trim(), scenario).toBe(before);
      r.close();
      repo = undefined;
    }
  });

  it("holds the git lock across the close and the read, so no save slips between them", async () => {
    // The reason the close and the read are one primitive rather than two calls:
    // released in between, an autosave lands and opens a *fresh* window under
    // the read — which is the bug the rule exists to stop.
    const r = makeRepo("window-read-back-atomic");
    r.touch(A, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit: A by user",
      paths: [A],
    });

    const order: string[] = [];
    const read = r.committer.withClosedWindow("read-back", () => {
      order.push("read");
      // What the reader sees: the window is already closed, so this subject is
      // final and this sha will not move.
      return Promise.resolve({
        sha: r.git("rev-parse", "HEAD").trim(),
        subject: r.git("log", "-1", "--format=%s").trim(),
      });
    });
    // Queued behind the read, not interleaved with it — the lock is one chain.
    r.clock += 100;
    r.touch(A, "two");
    const save = r.committer
      .commit({
        docId: "doc_aaaa1111",
        actor: "user",
        subject: "doc edit: A by user",
        paths: [A],
      })
      .then((outcome) => {
        order.push("save");
        return outcome;
      });

    const seen = await read;
    const outcome = await save;

    expect(order).toEqual(["read", "save"]);
    expect(seen.subject).toBe(editingSessionSubject(1, "user"));
    // The window really had closed before the read: the save that followed made
    // a fresh commit rather than amending the one the reader named.
    expect(outcome.kind).toBe("committed");
    expect(r.git("rev-parse", "HEAD^").trim()).toBe(seen.sha);
  });

  it("costs no git invocation when there is no window to close", async () => {
    // The common case — a diff of a document nobody is editing — must not spend
    // a git process on the close.
    const r = makeRepo("window-read-back-cheap");
    r.calls.length = 0;
    const answered = await r.committer.withClosedWindow("read-back", () =>
      Promise.resolve("answered"),
    );
    expect(answered).toBe("answered");
    expect(r.calls).toEqual([]);
  });

  it("preserves a neighbour's committed change when the amend names only one document's paths", () => {
    // The mechanism the whole window rests on, asserted against git itself
    // rather than through the committer: `--amend --only -- <paths>` keeps every
    // *other* path at the version the commit already holds. If a future git
    // stopped doing this, a multi-document window would silently drop documents,
    // and this is the test that would say so.
    const r = makeRepo("amend-only-preserves");
    r.touch(A, "a one");
    r.git("add", "-A", "--", A);
    r.git("commit", "-m", "first", "--only", "--", A);
    const authorDate = r.git("log", "-1", "--format=%aI").trim();

    r.touch(B, "b one");
    r.git("add", "-A", "--", B);
    r.git("commit", "--amend", `--date=${authorDate}`, "-m", "second", "--only", "--", B);

    expect(r.git("ls-tree", "-r", "--name-only", "HEAD")).toContain(A);
    expect(r.git("show", `HEAD:${A}`)).toBe("a one");
    expect(r.git("show", `HEAD:${B}`)).toBe("b one");

    // And the message-only form the close uses: no pathspec at all, so neither
    // the working tree nor a staged change of the operator's reaches the commit.
    r.touch("operator.txt", "the operator's own work\n");
    r.git("add", "--", "operator.txt");
    r.touch(A, "edited after the commit");
    r.git("commit", "--amend", "--only", "-m", editingSessionSubject(2, "user"));

    expect(r.log("%s")[0]).toBe(editingSessionSubject(2, "user"));
    expect(r.git("show", `HEAD:${A}`)).toBe("a one");
    expect(r.git("ls-tree", "-r", "--name-only", "HEAD")).not.toContain("operator.txt");
    expect(r.git("status", "--porcelain")).toContain("operator.txt");
  });
});
