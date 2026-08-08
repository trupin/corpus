/**
 * `npm run version:check` — the version-singularity gate (INFRA-008).
 *
 * Runs in `.githooks/pre-push` (cheap, catches drift long before a tag exists),
 * in `CI / validate`, and in the release workflow, where `GITHUB_REF` also makes
 * it the tag/version guard: a `v1.2.3` tag against a `1.2.4` manifest fails here
 * rather than half-publishing.
 *
 * It reads **both** the working tree and the committed tree (INFRA-022). Reading
 * only disk made it possible to pass locally and fail on CI: `npm version
 * --workspaces --include-workspace-root` rewrites every manifest but commits
 * only the root, so the check saw seven correct files while the tag it had just
 * created pointed at a tree where six of them were stale. A failure belongs
 * where it is cheap — before the push, not after the tag.
 */

import { resolve } from "node:path";
import { checkVersionSources } from "./versions.js";
import { readCommittedSource, readWorkingTreeSource } from "./version-sources.js";

const repoRoot = resolve(import.meta.dirname, "..");

const working = readWorkingTreeSource(repoRoot);
const committed = readCommittedSource(repoRoot);
const result = checkVersionSources(
  committed === undefined ? [working] : [working, committed],
  process.env["GITHUB_REF"],
);

if (committed === undefined) {
  // Never silently: half a gate that looks like a whole one is how this went
  // wrong the first time.
  process.stdout.write(
    "version:check ▷ committed tree not checked (no git repository or no commits here)\n",
  );
}

if (result.ok) {
  const versions = new Set(result.checks.map((check) => String(check.version)));
  const summary =
    versions.size === 1
      ? `every manifest is ${[...versions][0] ?? ""}`
      : result.checks.map((check) => `${check.label} is ${String(check.version)}`).join(", ");
  const where = result.checks.map((check) => check.label).join(", ");
  process.stdout.write(`version:check ✓ ${summary} (${where})\n`);
} else {
  for (const problem of result.problems) process.stderr.write(`version:check ✗ ${problem}\n`);
  process.stderr.write("Bump versions with: npm run release:prepare <x.y.z>\n");
  process.stderr.write(
    "If a tag is already pushed and the release failed, see docs/RELEASING.md → Recovery.\n",
  );
  process.exitCode = 1;
}
