import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The two plugin boundary rules of `eslint.config.js` (SPEC.md §10,
 * PLUGINS-001), proven by running ESLint programmatically — a rule that was
 * never seen to fire is a rule that may not exist. Probe files are written
 * into the real tree (the type-aware parser reads from disk) and removed in
 * every exit path.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PLUGIN_PROBE = join(REPO_ROOT, "plugins", "_fixture", "lint-boundary-probe.tmp.ts");
const CORE_PROBE = join(REPO_ROOT, "apps", "ui", "src", "lint-boundary-probe.tmp.ts");

afterAll(() => {
  rmSync(PLUGIN_PROBE, { force: true });
  rmSync(CORE_PROBE, { force: true });
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

describe("the kit-only rule for plugins/**", () => {
  it("fires on a plugin importing apps/ui internals, naming the allowed imports", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        PLUGIN_PROBE,
        'import "../../apps/ui/src/board/Board";\nexport const probe = 1;\n',
      ),
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain("@corpus/kit");
    expect(messages[0]).toContain("@corpus/contract");
  }, 120_000);

  it("fires on a plugin importing another @corpus workspace", async () => {
    const messages = restrictedImportMessages(
      await lintFile(PLUGIN_PROBE, 'import "@corpus/server";\nexport const probe = 1;\n'),
    );
    expect(messages.length).toBeGreaterThan(0);
  }, 120_000);

  it("does not fire on @corpus/kit and @corpus/contract imports", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        PLUGIN_PROBE,
        'import { definePlugin } from "@corpus/kit/plugin";\n' +
          'import type { Doc } from "@corpus/contract";\n' +
          "export const probe = (doc: Doc): unknown => definePlugin;\n",
      ),
    );
    expect(messages).toEqual([]);
  }, 120_000);

  it("admits @corpus/contract/plugin — the types-only plugin surface", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        PLUGIN_PROBE,
        'import type { PluginCommandSpec, PluginServerContext } from "@corpus/contract/plugin";\n' +
          "export const probe = (context: PluginServerContext): string => context.plugin;\n" +
          "export const spec = (value: PluginCommandSpec): string => value.name;\n",
      ),
    );
    expect(messages).toEqual([]);
  }, 120_000);

  it("still rejects the CLI's registry internals by path", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        PLUGIN_PROBE,
        'import type { CommandSpec } from "../../apps/cli/src/registry/types.js";\n' +
          "export const probe = (spec: CommandSpec): string => spec.name;\n",
      ),
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain("internals by path");
  }, 120_000);

  it("still rejects @corpus/contract/client — the transport a plugin may not build", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        PLUGIN_PROBE,
        'import { createCorpusClient } from "@corpus/contract/client";\nexport const probe = createCorpusClient;\n',
      ),
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain("@corpus/kit");
  }, 120_000);
});

describe("the core→plugin ban for apps/** and packages/**", () => {
  it("fires on a core file statically importing plugins/**", async () => {
    const messages = restrictedImportMessages(
      await lintFile(
        CORE_PROBE,
        'import "../../../plugins/_fixture/manifest";\nexport const probe = 1;\n',
      ),
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toContain("discovered, not imported");
  }, 120_000);

  it("allowlists exactly the three discovery entry points, by path", async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    for (const entry of [
      "apps/ui/src/plugins/registry.ts",
      "apps/server/src/plugins/discover.ts",
      "apps/cli/src/registry/plugins.ts",
    ]) {
      const config = (await eslint.calculateConfigForFile(join(REPO_ROOT, entry))) as {
        rules?: Record<string, unknown>;
      };
      const rule = config.rules?.["no-restricted-imports"];
      // Flat-config normalises "off" to [0] / ["off"] / 0.
      expect(JSON.stringify(rule)).toMatch(/^(\[?["']?(off|0))/);
    }
    // A non-entry-point core file keeps the rule on.
    const config = (await eslint.calculateConfigForFile(
      join(REPO_ROOT, "apps/ui/src/board/Column.tsx"),
    )) as { rules?: Record<string, unknown> };
    expect(JSON.stringify(config.rules?.["no-restricted-imports"])).toMatch(/error|2/);
  }, 120_000);
});
