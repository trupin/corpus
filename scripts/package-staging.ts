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
import * as esbuild from "esbuild";

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
 * What of a plugin directory ships **verbatim**: the skills `corpus init`
 * installs into the workspace, and the body-only seed templates a doc type may
 * declare in `types.yaml`. Its `dist/` ships too, but bundled rather than
 * copied — see {@link stagePlugins}. Sources do not ship: the tool runs
 * compiled JS (sprint-012 Adjudication 12).
 */
export const PLUGIN_PACKAGED_SUBTREES: readonly string[] = ["skills", "seeds"];
export const PLUGIN_PACKAGED_FILES: readonly string[] = ["types.yaml", "README.md"];

export interface StagedPlugin {
  readonly dir: string;
  readonly files: readonly string[];
}

export interface StagePluginsOptions {
  /**
   * Directories esbuild resolves bare specifiers from — the repository's
   * `node_modules`. Needed because a plugin is bundled from its **own**
   * directory, which in a test is a temp tree with no `node_modules` of its
   * own, and in the repo is a workspace whose dependencies are hoisted.
   */
  readonly nodePaths?: readonly string[];
}

/**
 * The bundle boundary, shared with the tool's own bundles: every `@corpus/*`
 * import is inlined, every other bare specifier stays external and is expected
 * to be a real dependency of the published package. `packages: "external"`
 * cannot express this — it externalises `@corpus/*` too, which is the opposite
 * of what one published package means.
 */
export const externalizeThirdParty: esbuild.Plugin = {
  name: "externalize-third-party",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@corpus/")) return null;
      return { path: args.path, external: true };
    });
  },
};

/**
 * A plugin's runtime entry points inside its `dist/`, relative and POSIX.
 *
 * **Every module the server or the CLI reaches by dynamic import belongs here**,
 * and each one is a separate entry because nothing else in `dist/` is staged: a
 * module the tool imports by convention is reachable from no other entry, so it
 * would simply not be in the tarball. `server/derive.js` is the second such
 * module (SPEC.md §12's derived status, SERVER-085) — the failure it would have
 * shipped is the quiet kind INFRA-008 escalation 3(b) already found once for
 * `server/routes.js`: discovery contains a missing module as a warning, so every
 * todo document would silently fall back to the status its file states, in
 * installed builds only.
 */
export function pluginEntryPoints(distRoot: string): readonly string[] {
  const entries: string[] = [];
  if (existsSync(join(distRoot, "server", "routes.js"))) entries.push("server/routes.js");
  if (existsSync(join(distRoot, "server", "derive.js"))) entries.push("server/derive.js");
  const commands = join(distRoot, "cli", "commands");
  if (existsSync(commands)) {
    entries.push(
      ...readdirSync(commands)
        .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
        .sort()
        .map((name) => `cli/commands/${name}`),
    );
  }
  return entries;
}

/**
 * Stages every non-underscore plugin that has been built. A plugin with no
 * `dist/` is skipped: shipping its sources would ship something the packaged
 * tool cannot run.
 *
 * **Its entry points are bundled, not copied** (INFRA-008 escalation 3(b),
 * sprint-014 TEST-287/TEST-288). `tsc` leaves `@corpus/contract` in a plugin's
 * `dist/server/routes.js` as a bare specifier, and `@corpus/*` is *inlined*
 * into the tool's bundles rather than installed — so in an installed tarball
 * that import threw `ERR_MODULE_NOT_FOUND` at discovery's dynamic import,
 * discovery contained it as a warning, the routes never mounted, and the
 * plugin's CLI verbs (thin clients over those routes) failed at request time.
 * Bundling here with the same first-party-inlined boundary the tool's own
 * bundles use is what makes a packaged plugin actually run.
 *
 * Only the entry points are staged: everything else in `dist/` is reachable
 * from one of them and is inlined into it, so copying the rest would ship
 * unreferenced modules that still carried bare `@corpus/*` specifiers.
 *
 * Known limitation, recorded rather than papered over: a plugin's *third-party*
 * dependencies stay external and are resolved from the published package's own
 * `dependencies`. A plugin needing a package the tool does not already depend
 * on would install broken; nothing in the repository does today, and giving
 * plugins their own dependency contribution is a packaging issue of its own.
 */
export async function stagePlugins(
  pluginsRoot: string,
  destinationRoot: string,
  options: StagePluginsOptions = {},
): Promise<readonly StagedPlugin[]> {
  if (!existsSync(pluginsRoot)) return [];
  const dirs = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isPackagedPluginDir(entry.name))
    .map((entry) => entry.name)
    .sort();

  const staged: StagedPlugin[] = [];
  for (const dir of dirs) {
    const source = join(pluginsRoot, dir);
    const distRoot = join(source, "dist");
    if (!existsSync(distRoot)) continue;

    const files: string[] = [];
    for (const entry of pluginEntryPoints(distRoot)) {
      const outfile = join(destinationRoot, dir, "dist", ...entry.split("/"));
      mkdirSync(dirname(outfile), { recursive: true });
      await esbuild.build({
        entryPoints: [join(distRoot, ...entry.split("/"))],
        outfile,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node22",
        sourcemap: false,
        logLevel: "warning",
        ...(options.nodePaths === undefined ? {} : { nodePaths: [...options.nodePaths] }),
        plugins: [externalizeThirdParty],
      });
      files.push(`dist/${entry}`);
    }

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
