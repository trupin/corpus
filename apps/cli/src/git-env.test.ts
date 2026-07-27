import { describe, expect, it } from "vitest";
import { sanitizeGitEnv } from "./git-env.js";

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
        // Case-insensitively, because on Windows `git_dir` names the same variable.
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
