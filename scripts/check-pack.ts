/**
 * `npm run pack:check` — audits the tarball `npm pack` would produce (INFRA-008).
 *
 * Runs `npm pack --dry-run --json` against the staged package and asserts the
 * file list in both directions (see `pack-audit.ts` for the rules). Wired into
 * `CI / validate`, so a change that drops the UI build or leaks the dev fixture
 * fails on the pull request rather than on a user's machine.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { PACKAGE_NAME, STAGE_DIR_NAME } from "./package-manifest.js";
import { auditPackedFiles, type PackedFile } from "./pack-audit.js";

const repoRoot = resolve(import.meta.dirname, "..");
const stageRoot = join(repoRoot, STAGE_DIR_NAME);

/** `npm pack --dry-run --json` reports an array with one entry per packed package. */
const PackReportSchema = z.array(
  z.looseObject({
    name: z.string(),
    version: z.string(),
    size: z.number(),
    unpackedSize: z.number(),
    files: z.array(
      z.looseObject({
        path: z.string(),
        mode: z.number().optional(),
        size: z.number().optional(),
      }),
    ),
  }),
);

function fail(message: string): never {
  process.stderr.write(`pack:check ✗ ${message}\n`);
  process.exit(1);
}

if (!existsSync(join(stageRoot, "package.json"))) {
  fail(`${STAGE_DIR_NAME}/ is not staged — run \`npm run package:build\` first`);
}

const packed = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: stageRoot,
  encoding: "utf8",
  shell: false,
});
if (packed.status !== 0) {
  fail(`npm pack failed:\n${packed.stdout ?? ""}${packed.stderr ?? ""}`);
}

const parsed = PackReportSchema.safeParse(JSON.parse(packed.stdout));
if (!parsed.success) {
  fail(`npm pack --json returned an unexpected shape: ${parsed.error.message}`);
}

const report = parsed.data[0];
if (parsed.data.length !== 1 || report === undefined) {
  fail(`expected exactly one packed package, got ${String(parsed.data.length)}`);
}

// Sizes feed `MAXIMUM_PACKED_BYTES`, the extension-independent guard that a
// model or an inference runtime never gets staged (INFRA-012).
const files: PackedFile[] = report.files.map((file) => ({
  path: file.path,
  ...(file.mode === undefined ? {} : { mode: file.mode }),
  ...(file.size === undefined ? {} : { size: file.size }),
}));
const violations = auditPackedFiles(files);

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`pack:check ✗ ${violation}\n`);
  process.stderr.write(
    `pack:check: ${String(violations.length)} violation(s) in ${report.name}@${report.version}\n`,
  );
  process.exitCode = 1;
} else {
  const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  process.stdout.write(
    `pack:check ✓ ${report.name}@${report.version} — ${String(report.files.length)} files, ` +
      `${mb(report.size)} packed / ${mb(report.unpackedSize)} unpacked\n`,
  );
  if (report.name !== PACKAGE_NAME) {
    process.stdout.write(`pack:check ! staged name is ${report.name}, expected ${PACKAGE_NAME}\n`);
    process.exitCode = 1;
  }
}
