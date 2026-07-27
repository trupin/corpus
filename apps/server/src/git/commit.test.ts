// Real repositories, real commits, real hooks. Git behaviour is the substance
// of SPEC.md §4's audit trail, and a mock of it would assert only that the mock
// was called.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAutoCommitter, SQUASH_IDLE_MS, type AutoCommitter } from "./commit.js";
import { createGit } from "./git.js";
import { sanitizeGitEnv } from "./env.js";

type Repo = {
  readonly root: string;
  readonly committer: AutoCommitter;
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
  options: { init?: boolean; identity?: boolean; seed?: boolean } = {},
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
  const made: Repo = {
    root,
    committer: createAutoCommitter({ git: createGit(root), now: () => state.clock }),
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

  it("appends a caller's own trailers, and commits with nothing staged when asked", async () => {
    const r = makeRepo("extra-trailers");
    const base = r.git("rev-parse", "HEAD").trim();

    // The shape SERVER-009's force break needs: `.corpus/` is gitignored, so the
    // audit entry stages no path at all and has to be an explicit empty commit,
    // carrying the one fact the standard trailers cannot express.
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "lock: force-break on doc_aaaa1111 (was agent) by user",
      paths: [],
      trailers: ["Corpus-Lock-Holder: agent"],
      allowEmpty: true,
      squash: false,
    });

    expect(outcome.kind).toBe("committed");
    expect(r.log("%an|%s")[0]).toBe("user|lock: force-break on doc_aaaa1111 (was agent) by user");
    // Appended after the standard ones, never in place of them.
    expect(r.git("log", "-1", "--format=%b")).toBe(
      "Corpus-Doc: doc_aaaa1111\nCorpus-Actor: user\nCorpus-Lock-Holder: agent\n\n",
    );
    // Empty in the git sense: a commit on top of the seed that changes no file.
    expect(r.git("rev-parse", "HEAD~1").trim()).toBe(base);
    expect(r.git("show", "--stat", "--format=", "HEAD").trim()).toBe("");
  });

  it("folds two rapid saves of one document by one author into one commit", async () => {
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

  it("starts a fresh commit past the window, for another author, another document, or after an interleaved commit", async () => {
    for (const scenario of ["window", "actor", "document", "interleaved"] as const) {
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

      const second = "data/docs/inbox/other.md";
      r.touch(scenario === "document" ? second : DOC, "two");
      const outcome = await r.committer.commit({
        docId: scenario === "document" ? "doc_bbbb2222" : "doc_aaaa1111",
        actor: scenario === "actor" ? "agent" : "user",
        subject: "doc edit: second save",
        paths: [scenario === "document" ? second : DOC],
      });

      expect(outcome.kind, scenario).toBe("committed");
      const made = r.git("log", "--format=%H", `${base}..HEAD`).trim().split("\n");
      expect(made.length, scenario).toBe(scenario === "interleaved" ? 3 : 2);
      r.close();
      repo = undefined;
    }
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
    expect(r.git("rev-parse", "HEAD~1").trim()).toBe(createSha);
    // The deletion is in the audit trail (SPEC.md §4) and the file is gone from
    // the tree, while the create commit still holds its content.
    expect(r.git("log", "--diff-filter=D", "--format=%s", "--", DOC).trim()).toBe(
      "doc delete: Note (doc_aaaa1111) by user",
    );
    expect(r.git("ls-tree", "-r", "--name-only", "HEAD")).not.toContain(DOC);
    expect(r.git("show", `${createSha}:${DOC}`)).toBe("created inside the window");
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
    const rootSha = r.git("rev-parse", "HEAD").trim();

    r.clock += 100;
    rmSync(join(r.root, DOC));
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc delete",
      paths: [DOC],
    });

    expect(outcome.kind).toBe("committed");
    expect(r.git("rev-parse", "HEAD~1").trim()).toBe(rootSha);
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

  it("makes an empty commit when one is asked for, and never folds it", async () => {
    const r = makeRepo("empty");
    r.touch(DOC, "one");
    await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "doc edit",
      paths: [DOC],
    });
    r.clock += 100;
    const outcome = await r.committer.commit({
      docId: "doc_aaaa1111",
      actor: "user",
      subject: "lock force-break: doc_aaaa1111 held by agent, broken by user",
      paths: [],
      allowEmpty: true,
      squash: false,
    });

    expect(outcome.kind).toBe("committed");
    expect(r.log("%s")[0]).toContain("lock force-break");
    expect(r.git("show", "--stat", "--format=", "HEAD").trim()).toBe("");
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

  it("serializes concurrent commits so no commit carries another document's change", async () => {
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
    expect(shas).toHaveLength(2);
    for (const sha of shas) {
      const stat = r.git("show", "--stat", "--format=", sha);
      const touched = paths.filter((path) => stat.includes(path));
      expect(touched).toHaveLength(1);
      const trailer = r.git("log", "-1", "--format=%b", sha);
      expect(trailer).toContain(touched[0] === paths[0] ? "doc_aaaa1111" : "doc_bbbb2222");
    }
  });
});
