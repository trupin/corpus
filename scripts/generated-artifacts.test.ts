import { describe, expect, it } from "vitest";
import {
  checkGeneratedArtifacts,
  GENERATED_ARTIFACTS,
  type CheckEnvironment,
  type GeneratedArtifactGroup,
} from "./generated-artifacts.js";

const group: GeneratedArtifactGroup = {
  name: "Fixture artifact",
  command: ["npm", "run", "--silent", "generate"],
  artifacts: ["a.json", "b.ts"],
  fix: "npm run generate",
};

function environment(overrides: Partial<CheckEnvironment> = {}): {
  environment: CheckEnvironment;
  log: string[];
} {
  const log: string[] = [];
  return {
    log,
    environment: {
      runCommand: () => ({ ok: true, output: "" }),
      hashFiles: () => "same",
      diffAgainstHead: () => ({ clean: true, summary: "" }),
      log: (line) => void log.push(line),
      ...overrides,
    },
  };
}

describe("the inventory", () => {
  it("covers the contract artifacts and the CLI reference, each with a fix command", () => {
    const artifacts = GENERATED_ARTIFACTS.flatMap((entry) => entry.artifacts);
    expect(artifacts).toContain("packages/contract/openapi.json");
    expect(artifacts).toContain("packages/contract/src/client/schema.generated.ts");
    expect(artifacts).toContain("docs/cli.md");
    for (const entry of GENERATED_ARTIFACTS) {
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.fix.length).toBeGreaterThan(0);
    }
  });
});

describe("checkGeneratedArtifacts", () => {
  it("passes when regeneration changes nothing and the tree matches HEAD", () => {
    const { environment: env, log } = environment();
    expect(checkGeneratedArtifacts([group], env)).toBe(true);
    expect(log.join("\n")).toContain("✓ Fixture artifact is up to date");
  });

  it("fails when regeneration rewrites an artifact, naming the fix", () => {
    let call = 0;
    const { environment: env, log } = environment({
      hashFiles: () => {
        call += 1;
        return call === 1 ? "before" : "after";
      },
    });
    expect(checkGeneratedArtifacts([group], env)).toBe(false);
    expect(log.join("\n")).toContain("Fix: npm run generate && git add a.json b.ts");
  });

  it("fails when the artifact differs from HEAD, printing the diff summary", () => {
    const { environment: env, log } = environment({
      diffAgainstHead: () => ({ clean: false, summary: " a.json | 2 +-" }),
    });
    expect(checkGeneratedArtifacts([group], env)).toBe(false);
    expect(log.join("\n")).toContain("Fix: npm run generate");
    expect(log.join("\n")).toContain(" a.json | 2 +-");
  });

  it("fails when the regeneration command itself fails, showing its output", () => {
    const { environment: env, log } = environment({
      runCommand: () => ({ ok: false, output: "tsx: not found" }),
    });
    expect(checkGeneratedArtifacts([group], env)).toBe(false);
    expect(log.join("\n")).toContain("regeneration failed");
    expect(log.join("\n")).toContain("tsx: not found");
  });

  it("checks every group even after one fails", () => {
    const second: GeneratedArtifactGroup = { ...group, name: "Second", artifacts: ["c.md"] };
    const { environment: env, log } = environment({
      runCommand: (command) => ({ ok: command.length > 0, output: "" }),
      diffAgainstHead: (paths) => ({
        clean: !paths.includes("a.json"),
        summary: "",
      }),
    });
    expect(checkGeneratedArtifacts([group, second], env)).toBe(false);
    expect(log.join("\n")).toContain("✗ Fixture artifact is stale");
    expect(log.join("\n")).toContain("✓ Second is up to date");
  });
});
