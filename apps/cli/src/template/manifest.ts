import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { InternalError } from "../errors.js";

/**
 * `.corpus/template-manifest.json` — what `corpus init` installed, so
 * `corpus workspace upgrade` can three-way compare against the **original**
 * bytes later (SPEC.md §2.1).
 *
 * The manifest is worthless if written after the fact: nothing can retroactively
 * learn what the first install contained, which is why `corpus init` writes it in
 * the same run (sprint-003 Open Conflict 10). It records a workspace-relative
 * **post-rename** path, the sha-256 of the bytes that were installed, and — for a
 * plugin-contributed skill — where those bytes came from, so an upgrade refreshes
 * each file from its own source (sprint-012 Adjudication 11).
 *
 * It is deliberately the only thing under `.corpus/` an upgrade may write: the
 * rest of that directory is runtime state the server owns.
 */

/** Prefix of a {@link ManifestEntry.source} naming the plugin a file came from. */
export const PLUGIN_SOURCE_PREFIX = "plugin:";

export interface ManifestEntry {
  /** Workspace-relative, POSIX-separated, post-rename. */
  readonly path: string;
  readonly sha256: string;
  /**
   * Where the file came from when not the workspace template:
   * `"plugin:<dir>"` for a plugin-installed skill (sprint-012 Adjudication
   * 11), so `corpus workspace upgrade` can refresh it from the plugin rather
   * than the template. Absent ⇒ template.
   */
  readonly source?: string;
}

export interface TemplateManifest {
  readonly version: 1;
  readonly tool: string;
  readonly installedAt: string;
  readonly files: readonly ManifestEntry[];
}

export function sha256(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

/** `plugin:<dir>` for a plugin-sourced file, `undefined` for a template one. */
export function pluginSourceMarker(plugin: string): string {
  return `${PLUGIN_SOURCE_PREFIX}${plugin}`;
}

/**
 * Serialized exactly as `corpus init` writes it: 2-space JSON with a trailing
 * newline, so a manifest an upgrade rewrites is diff-comparable with the one the
 * initial commit recorded.
 */
export function serializeManifest(manifest: TemplateManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The workspace's manifest, or `undefined` when there is none — a workspace
 * created before manifests existed is a normal state that
 * `corpus workspace upgrade` handles conservatively, not an error.
 *
 * A manifest that exists but does not parse *is* an error: guessing at a broken
 * baseline is how an upgrade would clobber the file it exists to protect.
 */
export function readTemplateManifest(manifestPath: string): TemplateManifest | undefined {
  if (!existsSync(manifestPath)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (cause) {
    throw manifestError(manifestPath, "it is not valid JSON", cause);
  }
  if (!isManifest(parsed)) throw manifestError(manifestPath, "its shape is not recognised");
  return parsed;
}

function manifestError(path: string, why: string, cause?: unknown): InternalError {
  return new InternalError(`the template manifest at ${path} cannot be read: ${why}.`, {
    hint: "Move it aside and re-run with `--adopt` to write a fresh baseline; nothing is overwritten in the meantime.",
    ...(cause === undefined ? {} : { cause }),
  });
}

function isManifest(value: unknown): value is TemplateManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TemplateManifest>;
  return (
    candidate.version === 1 &&
    typeof candidate.tool === "string" &&
    typeof candidate.installedAt === "string" &&
    Array.isArray(candidate.files) &&
    candidate.files.every(isEntry)
  );
}

function isEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ManifestEntry>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.sha256 === "string" &&
    (candidate.source === undefined || typeof candidate.source === "string")
  );
}
