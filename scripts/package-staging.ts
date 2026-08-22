/**
 * Copy rules for assembling the published package (INFRA-008).
 *
 * The copy lives here because it carries a rule that is easy to get subtly wrong
 * and impossible to notice from a green build: the UI build must lose its source
 * maps *including the comment that points at them*. A dangling
 * `sourceMappingURL` is a 404 in the operator's network panel, which is exactly
 * what the packaging E2E exists to catch.
 *
 * It takes explicit source and destination roots so it can be driven against
 * temp directories.
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
import type * as esbuild from "esbuild";

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
 * The bundle boundary for the CLI and the server bundles: every `@corpus/*`
 * import is inlined, every other bare specifier stays external and is expected
 * to be a real dependency of the published package. `packages: "external"`
 * cannot express this — it externalises `@corpus/*` too, which is the opposite
 * of what one published package means.
 *
 * `esbuild.Plugin` here is esbuild's own extension type. It has no relation to
 * the removed Corpus plugin surface.
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
