import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where the `corpus` CLI lives, seen from the server.
 *
 * The mirror image of `resolveServerEntry` in `apps/cli/src/commands/server/
 * daemon.ts`, and deliberately shaped the same way: two layouts, the packaged
 * one first, `existsSync` deciding between them. The server's whole part in an
 * upgrade is `spawn` (SPEC.md §2.4 puts download, verification, install,
 * template sync and restart in the CLI), so "where is the tool" is the only
 * question it has to answer for itself — and it has to answer it twice, for the
 * trigger and for nothing else, because the check reaches GitHub directly.
 *
 * Neither candidate can match the other's layout by accident. The packaged CLI
 * bundle is `<package>/dist/corpus.js` and `defaultPackageRoot()` resolves to
 * `<package>` there; in a source checkout the same call resolves to
 * `apps/server`, whose `dist/` is tsc output and holds no `corpus.js`.
 */
export interface CliEntry {
  /** Absolute path of the module `node` is asked to run. */
  readonly modulePath: string;
  /** Extra `node` arguments it needs — the TypeScript loader in the dev layout. */
  readonly nodeArgs: readonly string[];
  readonly layout: "packaged" | "source";
}

export function cliEntryCandidates(packageRoot: string): readonly {
  readonly modulePath: string;
  readonly layout: CliEntry["layout"];
}[] {
  return [
    { modulePath: join(packageRoot, "dist", "corpus.js"), layout: "packaged" },
    { modulePath: resolve(packageRoot, "..", "cli", "src", "bin", "corpus.ts"), layout: "source" },
  ];
}

/** What was looked for, when nothing was found — the paths are the diagnostic. */
export interface CliEntryMissing {
  readonly kind: "missing";
  readonly searched: readonly string[];
}

export type CliEntryLookup = { readonly kind: "found"; readonly entry: CliEntry } | CliEntryMissing;

/**
 * A described answer rather than a throw, for the reason the release lookup
 * gives one: both callers have somewhere honest to put it. The trigger turns it
 * into a `500` naming the paths, and the check — which never needs the CLI —
 * never asks.
 */
export function resolveCliEntry(packageRoot: string): CliEntryLookup {
  const candidates = cliEntryCandidates(packageRoot);
  const found = candidates.find((candidate) => existsSync(candidate.modulePath));
  if (found === undefined) {
    return { kind: "missing", searched: candidates.map((candidate) => candidate.modulePath) };
  }
  if (found.layout === "packaged") {
    return { kind: "found", entry: { ...found, nodeArgs: [] } };
  }

  const loader = tsxLoaderUrl();
  if (loader === null) {
    return { kind: "missing", searched: candidates.map((candidate) => candidate.modulePath) };
  }
  return { kind: "found", entry: { ...found, nodeArgs: ["--import", loader] } };
}

/**
 * The `tsx` ESM loader as an absolute file URL. `--import` resolves bare
 * specifiers against the *child's* cwd — the workspace, where `tsx` is not
 * installed — so the absolute form is the only one that works.
 */
function tsxLoaderUrl(): string | null {
  try {
    return pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  } catch {
    return null;
  }
}
