// Fails when a committed generated artifact is stale relative to its source.
// Run by `.githooks/pre-push` and by the `generated artifacts drift` step in
// `CI / validate`; both consume the one inventory in `generated-artifacts.ts`.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkGeneratedArtifacts,
  GENERATED_ARTIFACTS,
  type CheckEnvironment,
} from "./generated-artifacts.js";

const repoRoot = resolve(import.meta.dirname, "..");

const environment: CheckEnvironment = {
  runCommand(command) {
    const [executable, ...args] = command;
    if (executable === undefined) return { ok: false, output: "empty command" };
    const result = spawnSync(executable, args, { cwd: repoRoot, encoding: "utf8", shell: false });
    return {
      ok: result.status === 0,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  },

  hashFiles(paths) {
    const hash = createHash("sha256");
    for (const path of paths) {
      hash.update(path);
      try {
        hash.update(readFileSync(resolve(repoRoot, path)));
      } catch {
        hash.update("<missing>");
      }
    }
    return hash.digest("hex");
  },

  diffAgainstHead(paths) {
    const result = spawnSync("git", ["--no-pager", "diff", "--stat", "HEAD", "--", ...paths], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const summary = result.stdout ?? "";
    return { clean: result.status === 0 && summary.trim() === "", summary };
  },

  log(line) {
    process.stdout.write(`${line}\n`);
  },
};

if (!checkGeneratedArtifacts(GENERATED_ARTIFACTS, environment)) {
  process.exitCode = 1;
}
