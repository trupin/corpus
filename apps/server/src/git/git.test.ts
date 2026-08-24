// The `execFile` wrapper itself. Most of its behaviour is asserted through the
// modules that use it; what needs its own file is standard input, which only
// `commit.ts`'s snapshot staging uses and whose failure mode is a process-level
// crash rather than a wrong answer (SERVER-142).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sanitizeGitEnv } from "./env.js";
import { createGit } from "./git.js";

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const repository = (): string => {
  root = mkdtempSync(join(tmpdir(), "corpus-git-stdin-"));
  execFileSync("git", ["init", "-q", "--initial-branch=main"], {
    cwd: root,
    env: sanitizeGitEnv(),
  });
  return root;
};

describe("standard input", () => {
  it("hands git the exact bytes, not a re-encoding of them", async () => {
    const git = createGit(repository());
    // Bytes no UTF-8 round trip preserves: a lone surrogate half and a NUL.
    const content = Buffer.from([0xed, 0xa0, 0x80, 0x00, 0x66, 0x69, 0x6e]);

    const written = await git.exec(["hash-object", "-w", "--path", "note.md", "--stdin"], {
      stdin: content,
    });
    expect(written.ok).toBe(true);

    const read = await git.exec(["cat-file", "-s", written.stdout.trim()]);
    expect(read.stdout.trim()).toBe(String(content.length));
  });

  it("reports a refusal rather than crashing when git never reads it", async () => {
    root = mkdtempSync(join(tmpdir(), "corpus-git-stdin-"));
    const git = createGit(root);
    // Not a repository, so `-w` fails immediately — with far more than a pipe
    // buffer still to write. The write then fails with `EPIPE`, and an
    // unhandled `error` on the stream would take the process down instead of
    // this returning an ordinary "git said no".
    const outcome = await git.exec(["hash-object", "-w", "--path", "note.md", "--stdin"], {
      stdin: Buffer.alloc(4 * 1024 * 1024, 0x61),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.spawned).toBe(true);
  });
});
