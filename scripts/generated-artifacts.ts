/**
 * The repo's generated-artifact inventory and the drift check over it, declared
 * once. `.githooks/pre-push` and `CI / validate` both run
 * `scripts/check-generated-artifacts.ts`, which uses this module — two copies of
 * the list would be exactly the drift the check exists to prevent
 * (SPEC.md §9.3 for the contract, §2.3 for the CLI reference).
 */

export interface GeneratedArtifactGroup {
  /** Shown in the check's output. */
  readonly name: string;
  /** Regeneration command, run with the repo root as cwd. Must be a no-op when up to date. */
  readonly command: readonly string[];
  /** Repo-relative paths the command (re)writes. */
  readonly artifacts: readonly string[];
  /** Copy-pasteable fix, named in the failure message. */
  readonly fix: string;
}

export const GENERATED_ARTIFACTS: readonly GeneratedArtifactGroup[] = [
  {
    name: "API contract",
    command: ["npm", "run", "--silent", "generate", "-w", "packages/contract"],
    artifacts: [
      "packages/contract/openapi.json",
      "packages/contract/src/client/schema.generated.ts",
    ],
    fix: "npm run generate -w packages/contract",
  },
  {
    name: "CLI reference",
    command: ["npm", "run", "--silent", "docs:cli", "-w", "apps/cli"],
    artifacts: ["docs/cli.md"],
    fix: "npm run docs:cli -w apps/cli",
  },
];

export interface CheckEnvironment {
  /** Runs a regeneration command; `output` is only shown when it fails. */
  readonly runCommand: (command: readonly string[]) => {
    readonly ok: boolean;
    readonly output: string;
  };
  /** Stable digest of the given repo-relative paths; missing files must not throw. */
  readonly hashFiles: (paths: readonly string[]) => string;
  /** Whether the paths match `HEAD`, so a stale *commit* cannot slip through either. */
  readonly diffAgainstHead: (paths: readonly string[]) => {
    readonly clean: boolean;
    readonly summary: string;
  };
  readonly log: (line: string) => void;
}

/** Returns true when every artifact is up to date. */
export function checkGeneratedArtifacts(
  groups: readonly GeneratedArtifactGroup[],
  environment: CheckEnvironment,
): boolean {
  let clean = true;

  for (const group of groups) {
    const before = environment.hashFiles(group.artifacts);
    const result = environment.runCommand(group.command);
    if (!result.ok) {
      environment.log(`✗ ${group.name}: regeneration failed.`);
      environment.log(result.output);
      clean = false;
      continue;
    }

    // Hashing across the regeneration catches staleness even for an artifact git
    // does not track yet, which a `git diff` would silently skip.
    if (environment.hashFiles(group.artifacts) !== before) {
      environment.log(staleMessage(group));
      clean = false;
      continue;
    }

    const diff = environment.diffAgainstHead(group.artifacts);
    if (!diff.clean) {
      environment.log(staleMessage(group));
      environment.log(diff.summary);
      clean = false;
      continue;
    }

    environment.log(`✓ ${group.name} is up to date (${group.artifacts.join(", ")}).`);
  }

  return clean;
}

function staleMessage(group: GeneratedArtifactGroup): string {
  return [
    `✗ ${group.name} is stale: ${group.artifacts.join(", ")}`,
    `  Fix: ${group.fix} && git add ${group.artifacts.join(" ")}`,
  ].join("\n");
}
