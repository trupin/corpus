/**
 * `npm run package:build` — assembles the published `corpus` package (INFRA-008).
 *
 * Strategy 1 of the issue's two ("bundle"), decided and reasoned in
 * `issues/infra/008-npm-packaging-release.md`. The bundle boundary is
 * **first-party vs. third-party**: every `@corpus/*` import is inlined, so no
 * `@corpus/*` package needs a registry identity, and every other bare specifier
 * stays external and becomes a real npm dependency — which is what keeps
 * `better-sqlite3`, a native module that cannot be bundled, working.
 *
 * Output goes to a staging directory (`dist-package/`, gitignored) rather than
 * into `apps/cli/`: the published manifest is generated, so it never has to
 * carry `"@corpus/contract": "*"`, dev scripts or `private: true`, and no pack
 * ever mutates the source tree.
 *
 * Run `npm run build` first — this script bundles from each package's built
 * `dist` and copies `apps/ui/dist`, and says so rather than silently packing
 * yesterday's UI.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import * as esbuild from "esbuild";
import { z } from "zod";
import {
  buildPublishManifest,
  CLI_BUNDLE_PATH,
  PACKAGE_NAME,
  PackagingError,
  resolveRuntimeDependencies,
  SERVER_BUNDLE_PATH,
  STAGE_DIR_NAME,
  TEMPLATE_DIR,
  UI_DIR,
  type DeclaredDependencies,
} from "./package-manifest.js";
import { externalizeThirdParty, stageTree } from "./package-staging.js";

const repoRoot = resolve(import.meta.dirname, "..");
const stageRoot = join(repoRoot, STAGE_DIR_NAME);

const ManifestSchema = z.looseObject({
  version: z.string().min(1).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
});

function readManifest(relativePath: string): z.infer<typeof ManifestSchema> {
  const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
  return ManifestSchema.parse(parsed);
}

/**
 * Every workspace whose dependencies the bundles can reach. Their declared
 * ranges — not a hand-written list — become the published package's.
 */
const DEPENDENCY_SOURCES: readonly string[] = [
  "apps/cli/package.json",
  "apps/server/package.json",
  "packages/contract/package.json",
  "packages/kit/package.json",
];

interface BundleResult {
  readonly externals: readonly string[];
  readonly bytes: number;
}

async function bundle(entry: string, outfile: string): Promise<BundleResult> {
  const result = await esbuild.build({
    entryPoints: [join(repoRoot, entry)],
    outfile: join(stageRoot, outfile),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    metafile: true,
    // Deliberate: nothing in an installed tool consumes a source map, and the
    // pack audit forbids `**/*.map` outright.
    sourcemap: false,
    plugins: [externalizeThirdParty],
    logLevel: "warning",
  });
  const externals = new Set<string>();
  for (const output of Object.values(result.metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external) externals.add(imported.path);
    }
  }
  return {
    externals: [...externals].sort(),
    bytes: readFileSync(join(stageRoot, outfile)).byteLength,
  };
}

function requireDirectory(relativePath: string, fix: string): string {
  const absolute = join(repoRoot, relativePath);
  if (!existsSync(absolute)) {
    throw new PackagingError(`${relativePath} does not exist — run \`${fix}\` first`);
  }
  return absolute;
}

async function main(): Promise<void> {
  const rootManifest = readManifest("package.json");
  const version = rootManifest.version;
  if (version === undefined) {
    throw new PackagingError('the root package.json declares no "version"');
  }

  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });

  const cli = await bundle("apps/cli/src/bin/corpus.ts", CLI_BUNDLE_PATH);
  const server = await bundle("apps/server/src/main.ts", SERVER_BUNDLE_PATH);

  // The entry's own `#!/usr/bin/env node` is hoisted by esbuild. Asserting it
  // survived is cheaper than discovering it did not from an `exec format error`
  // on a stranger's machine.
  const binPath = join(stageRoot, CLI_BUNDLE_PATH);
  if (!readFileSync(binPath, "utf8").startsWith("#!")) {
    throw new PackagingError(`${CLI_BUNDLE_PATH} lost its shebang during bundling`);
  }
  chmodSync(binPath, 0o755);

  const declared: DeclaredDependencies[] = DEPENDENCY_SOURCES.map((path) => ({
    workspace: path,
    dependencies: readManifest(path).dependencies ?? {},
  }));
  const dependencies = resolveRuntimeDependencies(
    [...cli.externals, ...server.externals],
    declared,
  );

  const templateFiles = stageTree(
    requireDirectory(TEMPLATE_DIR, "git checkout assets/workspace"),
    join(stageRoot, TEMPLATE_DIR),
  );
  const uiFiles = stageTree(
    requireDirectory("apps/ui/dist", "npm run build"),
    join(stageRoot, UI_DIR),
  );
  for (const fileName of ["README.md", "LICENSE"]) {
    const from = join(repoRoot, fileName);
    if (!existsSync(from)) throw new PackagingError(`${fileName} is missing from the repo root`);
    copyFileSync(from, join(stageRoot, fileName));
  }

  writeFileSync(
    join(stageRoot, "package.json"),
    `${JSON.stringify(buildPublishManifest({ version, dependencies }), null, 2)}\n`,
  );

  const kb = (bytes: number): string => `${String(Math.round(bytes / 1024))} kB`;
  process.stdout.write(
    [
      `package:build ✓ ${PACKAGE_NAME}@${version} staged in ${STAGE_DIR_NAME}/`,
      `  ${CLI_BUNDLE_PATH}      ${kb(cli.bytes)}`,
      `  ${SERVER_BUNDLE_PATH}       ${kb(server.bytes)}`,
      `  ${UI_DIR}/                 ${String(uiFiles.length)} files`,
      `  ${TEMPLATE_DIR}/   ${String(templateFiles.length)} files`,
      `  dependencies       ${Object.keys(dependencies).join(", ")}`,
      "",
    ].join("\n"),
  );
}

await main();
