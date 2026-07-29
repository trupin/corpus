/**
 * Copy rules for assembling the published package (INFRA-008).
 *
 * The two non-trivial copies live here because both have a rule that is easy to
 * get subtly wrong and impossible to notice from a green build: the UI build
 * must lose its source maps *including the comment that points at them* (a
 * dangling `sourceMappingURL` is a 404 in the operator's network panel, which is
 * exactly what the packaging E2E exists to catch), and the plugins copy must
 * admit non-underscore plugins while denying dev fixtures.
 *
 * Everything here takes explicit source and destination roots so it can be
 * driven against temp directories — the only way to test the plugin rule while
 * `plugins/_fixture` is the repository's only plugin (sprint-013
 * Adjudication 15).
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** Build output that has no job in a tarball: types, maps, incremental state. */
const EXCLUDED_SUFFIXES: readonly string[] = [
  ".d.ts",
  ".d.ts.map",
  ".d.mts",
  ".d.cts",
  ".map",
  ".tsbuildinfo",
];

export function isPackagedArtifact(fileName: string): boolean {
  return !EXCLUDED_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/**
 * Strips a trailing source-map annotation from a JS or CSS file. Bundlers emit
 * it as the file's last line, in one of two comment syntaxes; leaving it behind
 * while dropping the `.map` file makes every browser with devtools open request
 * a file that is not there.
 */
export function stripSourceMapComment(contents: string): string {
  return contents.replace(
    /\n?(?:\/\/# sourceMappingURL=\S*|\/\*# sourceMappingURL=\S*\s*\*\/)\s*$/,
    "\n",
  );
}

const SOURCE_MAP_ANNOTATED_SUFFIXES: readonly string[] = [".js", ".mjs", ".cjs", ".css"];

function hasSourceMapAnnotation(fileName: string): boolean {
  return SOURCE_MAP_ANNOTATED_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/** Every file under `root`, as paths relative to it, POSIX-separated, sorted. */
export function listFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) found.push(relative(root, absolute).split(sep).join("/"));
    }
  };
  walk(root);
  return found;
}

function writeInto(destination: string, write: (path: string) => void): void {
  mkdirSync(dirname(destination), { recursive: true });
  write(destination);
}

/**
 * Copies a tree, dropping build cruft and stripping source-map annotations.
 * Returns the package-relative paths written, so the caller can report what it
 * staged instead of claiming success blind.
 */
export function stageTree(sourceRoot: string, destinationRoot: string): readonly string[] {
  const staged: string[] = [];
  for (const relativePath of listFiles(sourceRoot)) {
    const fileName = relativePath.split("/").at(-1) ?? relativePath;
    if (!isPackagedArtifact(fileName)) continue;
    const from = join(sourceRoot, relativePath);
    const to = join(destinationRoot, relativePath);
    if (hasSourceMapAnnotation(fileName)) {
      writeInto(to, (path) => {
        writeFileSync(path, stripSourceMapComment(readFileSync(from, "utf8")));
      });
    } else {
      writeInto(to, (path) => {
        copyFileSync(from, path);
      });
    }
    staged.push(relativePath);
  }
  return staged;
}

/**
 * The underscore convention, packaging half (sprint-012 Adjudication 9): a
 * plugin directory starting with `_` is a dev fixture and never reaches a
 * production tarball. Dot-prefixed entries are not plugins at all.
 */
export function isPackagedPluginDir(name: string): boolean {
  return !name.startsWith("_") && !name.startsWith(".");
}

/**
 * What of a plugin directory ships: its **built** output (sprint-012
 * Adjudication 12), the doc types the server reads, the skills `corpus init`
 * installs into the workspace, and its own metadata. Sources do not ship — the
 * tool runs compiled JS.
 */
export const PLUGIN_PACKAGED_SUBTREES: readonly string[] = ["dist", "skills"];
export const PLUGIN_PACKAGED_FILES: readonly string[] = ["types.yaml", "README.md"];

export interface StagedPlugin {
  readonly dir: string;
  readonly files: readonly string[];
}

/**
 * Stages every non-underscore plugin that has been built. A plugin with no
 * `dist/` is skipped loudly by the caller: shipping its sources would ship
 * something the packaged tool cannot run.
 *
 * KNOWN GAP, recorded for PLUGINS-002 (there is no non-underscore plugin to
 * prove it against yet): a packaged plugin's `dist/server/routes.js` still
 * imports `@corpus/contract` as a bare specifier, and that package is inlined
 * into the tool's bundles rather than installed, so the server will contain the
 * failure as a warning. Bundling each plugin's entry points here — with the same
 * first-party-inlined boundary the tool's own bundles use — is the natural fix
 * and belongs in this function.
 */
export function stagePlugins(
  pluginsRoot: string,
  destinationRoot: string,
): readonly StagedPlugin[] {
  if (!existsSync(pluginsRoot)) return [];
  const dirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isPackagedPluginDir(entry.name))
    .map((entry) => entry.name)
    .sort();

  const staged: StagedPlugin[] = [];
  for (const dir of dirs) {
    const source = join(pluginsRoot, dir);
    if (!existsSync(join(source, "dist"))) continue;

    const files: string[] = [];
    for (const subtree of PLUGIN_PACKAGED_SUBTREES) {
      files.push(
        ...stageTree(join(source, subtree), join(destinationRoot, dir, subtree)).map(
          (path) => `${subtree}/${path}`,
        ),
      );
    }
    for (const fileName of PLUGIN_PACKAGED_FILES) {
      const from = join(source, fileName);
      if (!existsSync(from)) continue;
      writeInto(join(destinationRoot, dir, fileName), (path) => {
        copyFileSync(from, path);
      });
      files.push(fileName);
    }
    if (files.length > 0) staged.push({ dir, files });
  }
  return staged;
}
