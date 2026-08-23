// `documents.last_actor` on a projection built from files alone (SPEC.md §9.1,
// SERVER-138) — the stream parser against literal git output, and the reader
// against a real repository.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sanitizeGitEnv } from "../git/env.js";
import { DEFAULT_LAST_ACTOR, parseLastActorLog, readLastActors } from "./last-actor.js";

const NUL = "\u0000";

/** One `git log --format=%x00%an --name-only` entry, as git actually prints it. */
const entry = (author: string, ...paths: string[]): string =>
  [`${NUL}${author}`, "", ...paths].join("\n");

describe("parseLastActorLog", () => {
  it("maps each path to the author of the newest commit that touched it", () => {
    const stdout = [
      entry("agent", "data/docs/a.md"),
      entry("user", "data/docs/a.md", "data/docs/b.md"),
    ].join("\n");
    const byPath = parseLastActorLog(stdout);
    // Newest first, so `a.md` keeps the agent even though `user` touched it too.
    expect(byPath.get("data/docs/a.md")).toBe("agent");
    expect(byPath.get("data/docs/b.md")).toBe("user");
  });

  /**
   * §4 authors every auto-commit as `user` or `agent` and nothing else. Every
   * other author a workspace's history can hold — `corpus init`'s bootstrap
   * commit, a person's own `git commit`, and the `recovery` author reserved for
   * a commit whose party an unclean stop destroyed — is a change nobody
   * attributed to the agent, which is a person's.
   */
  it.each(["recovery", "Corpus", "Theophane Rupin", "agentic", ""])(
    "reads `%s` as a person's write",
    (author) => {
      expect(parseLastActorLog(entry(author, "data/docs/a.md")).get("data/docs/a.md")).toBe("user");
    },
  );

  it("knows nothing about a path no commit named", () => {
    expect(parseLastActorLog(entry("agent", "data/docs/a.md")).has("data/docs/b.md")).toBe(false);
  });

  it("is empty for an empty stream", () => {
    expect(parseLastActorLog("").size).toBe(0);
  });
});

describe("readLastActors", () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", env: sanitizeGitEnv() });

  const commit = (author: string, relativePath: string, body: string): void => {
    mkdirSync(join(root, "data/docs"), { recursive: true });
    writeFileSync(join(root, relativePath), body);
    git("add", relativePath);
    git(
      "-c",
      "user.name=Corpus",
      "-c",
      "user.email=corpus@corpus.local",
      "commit",
      "-q",
      `--author=${author} <${author}@corpus.local>`,
      "-m",
      `write ${relativePath}`,
    );
  };

  it("reads the acting party off a real history, one process for the whole walk", () => {
    root = mkdtempSync(join(tmpdir(), "corpus-last-actor-"));
    git("init", "-q", ".");
    commit("user", "data/docs/a.md", "one\n");
    commit("agent", "data/docs/b.md", "two\n");
    // The agent then edits `a.md`, which is what makes "newest wins" observable.
    commit("agent", "data/docs/a.md", "one, edited\n");

    const index = readLastActors(root);
    expect(index.actorFor("data/docs/a.md")).toBe("agent");
    expect(index.actorFor("data/docs/b.md")).toBe("agent");
    // An untracked file, and a path this history never held.
    expect(index.actorFor("data/docs/never.md")).toBe(DEFAULT_LAST_ACTOR);
  });

  it("answers `user` for a workspace with no repository, rather than failing a rebuild", () => {
    root = mkdtempSync(join(tmpdir(), "corpus-last-actor-nogit-"));
    expect(readLastActors(root).actorFor("data/docs/a.md")).toBe(DEFAULT_LAST_ACTOR);
  });

  it("answers `user` for a repository with no commits", () => {
    root = mkdtempSync(join(tmpdir(), "corpus-last-actor-empty-"));
    git("init", "-q", ".");
    expect(readLastActors(root).actorFor("data/docs/a.md")).toBe(DEFAULT_LAST_ACTOR);
  });
});
