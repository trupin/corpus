// Mirrors `apps/cli/src/git-env.test.ts`. The two implementations are
// deliberate duplicates (sprint-005 Open Conflict 6 — `apps/server` may not
// import from `apps/cli`), so the two test suites are deliberate duplicates
// too: if one drifts, the other keeps its half of the contract honest.

import { describe, expect, it } from "vitest";
import { sanitizeGitEnv } from "./env.js";

describe("sanitizeGitEnv", () => {
  it("drops the whole GIT_ namespace and keeps everything else", () => {
    expect(
      sanitizeGitEnv({
        PATH: "/usr/bin",
        HOME: "/home/operator",
        GIT_DIR: "/elsewhere/.git",
        GIT_WORK_TREE: "/elsewhere",
        GIT_INDEX_FILE: "/elsewhere/.git/index",
        GIT_OBJECT_DIRECTORY: "/elsewhere/.git/objects",
        GIT_COMMON_DIR: "/elsewhere/.git",
        GIT_PREFIX: "sub/",
        GIT_AUTHOR_NAME: "Hook Leak",
        GIT_COMMITTER_EMAIL: "leak@hook.invalid",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "user.email",
        GIT_CONFIG_VALUE_0: "leak@hook.invalid",
        git_work_tree: "/elsewhere",
        GITHUB_TOKEN: "kept: not git's namespace",
        DIGIT_COUNT: "kept: GIT_ must be a prefix, not a substring",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/operator",
      GITHUB_TOKEN: "kept: not git's namespace",
      DIGIT_COUNT: "kept: GIT_ must be a prefix, not a substring",
    });
  });

  it("defaults to the process environment", () => {
    expect(sanitizeGitEnv()).toEqual(sanitizeGitEnv(process.env));
  });
});
