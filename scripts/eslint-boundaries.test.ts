import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The one import boundary `eslint.config.js` still enforces, proven by running
 * ESLint programmatically — a rule that was never seen to fire is a rule that
 * may not exist. Probe files are written into the real tree (the type-aware
 * parser reads from disk) and removed in every exit path.
 *
 * This file used to prove the core↔plugin boundary. INFRA-031 deleted
 * `plugins/`, which made that rule vacuous. The file was kept rather than
 * deleted because one clause outlives it: the kit owns the transport, so
 * `apps/ui` never builds a client of its own. That was measured green when it
 * was written, so a failure here is new drift and never a backlog.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const UI_PROBE = join(REPO_ROOT, "apps", "ui", "src", "lint-boundary-probe.tmp.ts");
const SERVER_PROBE = join(REPO_ROOT, "apps", "server", "src", "lint-boundary-probe.tmp.ts");

afterAll(() => {
  rmSync(UI_PROBE, { force: true });
  rmSync(SERVER_PROBE, { force: true });
});

async function lintFile(path: string, contents: string): Promise<readonly ESLint.LintResult[]> {
  writeFileSync(path, contents);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    return await eslint.lintFiles([path]);
  } finally {
    rmSync(path, { force: true });
  }
}

function restrictedImportMessages(results: readonly ESLint.LintResult[]): string[] {
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.ruleId === "no-restricted-imports")
      .map((message) => message.message),
  );
}

describe("the kit owns the transport", () => {
  it("fires on apps/ui importing @corpus/contract/client", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        UI_PROBE,
        'import { createCorpusClient } from "@corpus/contract/client";\n' +
          "export const probe = createCorpusClient;\n",
      ),
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).toContain("@corpus/kit");
  }, 120_000);

  it("does not fire on @corpus/kit or on the contract's own types", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        UI_PROBE,
        'import type { Doc } from "@corpus/contract";\n' +
          'import { useCorpusClient } from "@corpus/kit";\n' +
          "export const probe = (doc: Doc): unknown => [useCorpusClient, doc];\n",
      ),
    );
    expect(messages).toEqual([]);
  }, 120_000);

  it("scopes the rule to apps/ui — the workspaces with no cache to bypass keep the client", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        SERVER_PROBE,
        'import { createCorpusClient } from "@corpus/contract/client";\n' +
          "export const probe = createCorpusClient;\n",
      ),
    );
    expect(messages).toEqual([]);
  }, 120_000);
});
