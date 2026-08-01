/**
 * The published tool's identity and its generated `package.json` (INFRA-008).
 *
 * Corpus ships as **one** npm package — "server + CLI + pre-built UI served
 * statically" (CLAUDE.md Architecture Decision 1), assembled by
 * `scripts/build-package.ts` into a staging directory and packed from there. The
 * manifest is generated rather than hand-maintained for two reasons: the
 * workspace manifests declare `"@corpus/contract": "*"`, a range that means
 * nothing on a registry, and the runtime dependency list must be *derived* from
 * what the bundle actually imports — a hand-written list is how `tsx` or
 * `playwright` end up in a global install.
 *
 * Nothing here touches the filesystem: this module is the shape of the
 * published package, `build-package.ts` is the machinery that produces it, and
 * `pack-audit.ts` is the check that the tarball matches.
 */

import { builtinModules } from "node:module";

/**
 * PROVISIONAL — sprint-013 Adjudication 9 (Open Conflict 5). Both `corpus` and
 * `corpus-cli` are already taken on npm, and committing a public package
 * identity is the user's decision, not an agent's. Nothing has been published.
 * The name lives here, in exactly one place, so answering that question is a
 * one-line change; the **bin** name is `corpus` regardless of what the package
 * ends up being called.
 */
export const PACKAGE_NAME = "corpus";

/** The command the operator types. Not provisional — SPEC.md §2 names it. */
export const PACKAGE_BIN_NAME = "corpus";

export const PACKAGE_DESCRIPTION =
  "Conversations around documents, driven by an AI agent — local-first, markdown on disk, one CLI.";

/** Must match the `LICENSE` file at the repo root (MIT, © 2026 Theophane RUPIN). */
export const PACKAGE_LICENSE = "MIT";

export const PACKAGE_REPOSITORY_URL = "git+https://github.com/trupin/corpus.git";
export const PACKAGE_HOMEPAGE = "https://github.com/trupin/corpus#readme";

/** SPEC.md and every workspace manifest agree on the floor. */
export const NODE_ENGINE_RANGE = ">=22";

/** Repo-relative staging directory the package is assembled in, then packed from. */
export const STAGE_DIR_NAME = "dist-package";

/**
 * Where each staged artifact lands *inside the package*. Every one of these is
 * an already-shipped resolver's **packaged candidate**, read out of the tree —
 * changing one here without changing the resolver produces a tarball that
 * installs and then cannot find its own parts.
 *
 * The CLI bundle is `dist/corpus.js` and not `dist/bin/corpus.js` because
 * `cliPackageRoot()` (`apps/cli/src/version.ts`) resolves one level up from its
 * own module directory; a single-file bundle two levels deep would make every
 * packaged candidate miss by one directory.
 */
export const CLI_BUNDLE_PATH = "dist/corpus.js";
export const SERVER_BUNDLE_PATH = "server/main.js";
export const UI_DIR = "ui";
export const TEMPLATE_DIR = "assets/workspace";
export const PLUGINS_DIR = "plugins";

/**
 * An allow-list, not an ignore-list: `.gitignore`d build output (`dist/`, the UI
 * build) is excluded from packs by default, and an allow-list is the only thing
 * that reliably overrides that. npm always adds `package.json`, `README.md` and
 * `LICENSE`; they are listed anyway so the intent is readable.
 */
export const PACKAGE_FILES: readonly string[] = [
  "dist",
  "server",
  "ui",
  "assets",
  "plugins",
  "README.md",
  "LICENSE",
];

/** Raised for anything that would produce a wrong package. Always fatal. */
export class PackagingError extends Error {
  override readonly name = "PackagingError";
}

const NODE_BUILTINS = new Set(builtinModules);

/**
 * The npm package a bare import specifier belongs to, or `undefined` for a Node
 * builtin. `hono/streaming` → `hono`; `@hono/node-server/serve-static` →
 * `@hono/node-server`. Relative and absolute specifiers are never externalised
 * and must not reach here.
 */
export function packageNameFromSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) return undefined;
  if (NODE_BUILTINS.has(specifier)) return undefined;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    throw new PackagingError(`not a bare import specifier: ${specifier}`);
  }
  const segments = specifier.split("/");
  const [first, second] = segments;
  if (first === undefined || first === "") {
    throw new PackagingError(`unparseable import specifier: ${specifier}`);
  }
  if (first.startsWith("@")) {
    if (second === undefined || second === "") {
      throw new PackagingError(`scoped specifier with no package name: ${specifier}`);
    }
    return `${first}/${second}`;
  }
  return first;
}

/** One workspace manifest's declared dependency ranges, for range lookup. */
export interface DeclaredDependencies {
  /** Workspace path, used only in error messages. */
  readonly workspace: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/**
 * Turns the specifiers the bundles left external into the published package's
 * `dependencies`, taking each range from the workspace that already declares it.
 *
 * A specifier no workspace declares is a hard error rather than a guessed
 * `"*"`: it means the bundle imports something the monorepo never installed on
 * purpose, and shipping it unpinned would break on the user's machine, not
 * ours. Two workspaces declaring different ranges for the same package is also
 * an error — one tool, one version of everything.
 */
export function resolveRuntimeDependencies(
  externals: Iterable<string>,
  declared: readonly DeclaredDependencies[],
): Record<string, string> {
  const resolved: Record<string, string> = {};
  const names = new Set<string>();
  for (const specifier of externals) {
    const name = packageNameFromSpecifier(specifier);
    if (name !== undefined) names.add(name);
  }

  for (const name of [...names].sort()) {
    const matches = declared.filter((entry) => entry.dependencies[name] !== undefined);
    const first = matches[0];
    if (first === undefined) {
      throw new PackagingError(
        `the bundle imports "${name}" but no workspace declares it as a dependency — ` +
          "add it to the workspace that imports it, or stop importing it",
      );
    }
    const range = first.dependencies[name];
    if (range === undefined) {
      throw new PackagingError(`no range for "${name}" in ${first.workspace}`);
    }
    const conflicting = matches.filter((entry) => entry.dependencies[name] !== range);
    if (conflicting.length > 0) {
      const where = [first, ...conflicting]
        .map((entry) => `${entry.workspace}: ${String(entry.dependencies[name])}`)
        .join(", ");
      throw new PackagingError(
        `workspaces disagree on the version range for "${name}" (${where}) — ` +
          "the published package can only carry one",
      );
    }
    resolved[name] = range;
  }
  return resolved;
}

/** Dev-only packages that must never become runtime dependencies of the tool. */
export const FORBIDDEN_RUNTIME_DEPENDENCIES: readonly string[] = [
  "tsx",
  "vitest",
  "eslint",
  "prettier",
  "typescript",
  "esbuild",
  "vite",
  "@playwright/test",
  "playwright",
];

/**
 * The derivation above makes a leak structurally unlikely — nothing the bundle
 * does not import can appear — but "unlikely" is not a check. A global install
 * that pulls Playwright is the loudest possible packaging bug, so it gets an
 * assertion of its own.
 */
export function assertNoDevDependencyLeak(dependencies: Readonly<Record<string, string>>): void {
  const leaked = FORBIDDEN_RUNTIME_DEPENDENCIES.filter((name) => dependencies[name] !== undefined);
  if (leaked.length > 0) {
    throw new PackagingError(
      `dev-only packages leaked into the published dependencies: ${leaked.join(", ")}`,
    );
  }
}

/**
 * The other direction of INFRA-012's proof. The tarball must contain no model
 * and no inference runtime — but the *manifest* must then carry the runtime as a
 * dependency, or an install has a semantic stack with nothing to run it on.
 *
 * Both entries are derived, never written: they appear because a bundle imports
 * them. The assertion exists because for `onnxruntime-web` that derivation is
 * unusually thin — `apps/server/src/semantic/engine/runtime.ts` reaches it
 * through a *dynamic* `await import("onnxruntime-web")`, so its presence in
 * `dependencies` rests entirely on esbuild reporting a dynamic external in the
 * metafile. If that ever stopped, nothing would fail: the package would build,
 * pack, install, boot, and report `semanticIndex: "disabled"` forever. That is
 * the quietest failure this repository can produce, so it gets the loudest check.
 */
export const REQUIRED_RUNTIME_DEPENDENCIES: readonly { name: string; reason: string }[] = [
  {
    name: "onnxruntime-web",
    reason:
      "the embedding runtime (sprint-021 OC1-REVISED: wasm in-process, 137.4 MiB in " +
      "node_modules, nothing staged into the tarball) — imported dynamically, so its " +
      "absence here would be silent",
  },
  {
    name: "better-sqlite3",
    reason: "the projection database — a native module npm installs and the pack never carries",
  },
];

/**
 * Fails the build when a dependency the installed tool cannot work without went
 * missing from the derived list.
 */
export function assertRequiredRuntimeDependencies(
  dependencies: Readonly<Record<string, string>>,
): void {
  const missing = REQUIRED_RUNTIME_DEPENDENCIES.filter(
    (entry) => dependencies[entry.name] === undefined,
  );
  if (missing.length > 0) {
    throw new PackagingError(
      `the published dependencies are missing ${missing
        .map((entry) => `"${entry.name}" (${entry.reason})`)
        .join(", ")} — the bundles no longer import it, or esbuild stopped reporting it`,
    );
  }
}

export interface PublishManifestOptions {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** The generated `package.json`, in a stable key order so diffs stay readable. */
export interface PublishManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly repository: { readonly type: "git"; readonly url: string };
  readonly homepage: string;
  readonly type: "module";
  readonly engines: { readonly node: string };
  readonly bin: Readonly<Record<string, string>>;
  readonly files: readonly string[];
  readonly publishConfig: { readonly access: "public" };
  readonly dependencies: Readonly<Record<string, string>>;
}

export function buildPublishManifest(options: PublishManifestOptions): PublishManifest {
  assertNoDevDependencyLeak(options.dependencies);
  assertRequiredRuntimeDependencies(options.dependencies);
  return {
    name: PACKAGE_NAME,
    version: options.version,
    description: PACKAGE_DESCRIPTION,
    license: PACKAGE_LICENSE,
    repository: { type: "git", url: PACKAGE_REPOSITORY_URL },
    homepage: PACKAGE_HOMEPAGE,
    type: "module",
    engines: { node: NODE_ENGINE_RANGE },
    bin: { [PACKAGE_BIN_NAME]: `./${CLI_BUNDLE_PATH}` },
    files: [...PACKAGE_FILES],
    publishConfig: { access: "public" },
    dependencies: { ...options.dependencies },
  };
}
